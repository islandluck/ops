import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, pages, projects, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { planProjectWithClaude } from "@/lib/ai/project";
import { generateAndSavePage } from "@/lib/pages";
import { runTaskWithAgent } from "./run";
import { materializeGrowthPhase, snapshotFollowers } from "./growth";
import type { Category, Project, ProjectPlan, ProjectStatus, ProjectStep } from "@/lib/types";

/**
 * Project orchestration — the Manager/Executive engine. A leadership agent turns
 * a goal into a phased plan (planProjectWithClaude); on plan approval the current
 * phase's steps become tasks (deliverables drafted by the assigned worker, or
 * human actions for the owner); as a phase's tasks resolve, the next phase is
 * released — advanced continuously by the cron heartbeat. It's the same
 * approval-center model, one level up: approve the plan, approve each deliverable.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

type ProjectRow = typeof projects.$inferSelect;

function toProject(row: ProjectRow, progress?: { total: number; done: number }): Project {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    goal: row.goal,
    title: row.title,
    summary: row.summary,
    status: row.status,
    owner_kind: row.owner_kind,
    owner_agent_id: row.owner_agent_id,
    kind: row.kind,
    plan: row.plan,
    current_phase: row.current_phase,
    created_by_type: row.created_by_type,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    progress,
  };
}

/** Overall completion: done tasks over the plan's total step count. */
async function progressFor(
  workspaceId: string,
  projectId: string,
  plan: ProjectPlan,
): Promise<{ total: number; done: number }> {
  const total = plan.phases.reduce((n, ph) => n + ph.steps.length, 0);
  const rows = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.project_id, projectId)));
  return { total, done: rows.filter((r) => r.status === "done").length };
}

/** Progress for a project card. Growth campaigns are measured in weeks elapsed
 *  (their phases hold no steps); everything else in done tasks over total steps. */
async function computeProgress(row: ProjectRow): Promise<{ total: number; done: number }> {
  if (row.plan?.growth) {
    const weeks = row.plan.growth.weeks || row.plan.phases.length || 1;
    const done = row.status === "done" ? weeks : Math.min(row.current_phase, weeks);
    return { total: weeks, done };
  }
  return progressFor(row.workspace_id, row.id, row.plan);
}

async function logProject(
  workspaceId: string,
  eventType: "agent_updated_draft" | "approved" | "status_changed",
  actorType: "agent" | "human" | "system",
  actorId: string,
  summary: string,
): Promise<void> {
  await db.insert(activityEvents).values({
    id: uid(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: eventType,
    actor_type: actorType,
    actor_id: actorId,
    summary,
    created_at: new Date(),
  });
}

export interface CreateProjectResult {
  ok: boolean;
  projectId?: string;
  title?: string;
  error?: string;
}

/** Plan a project from a goal (status "planning"; awaits the owner's plan approval). */
export async function createProject(
  workspaceId: string,
  goal: string,
  ownerKind: "manager" | "executive",
): Promise<CreateProjectResult> {
  const trimmed = goal.trim();
  if (!trimmed) return { ok: false, error: "Describe the goal first." };

  const { brief } = await getPlanningContext(workspaceId);

  // Available worker departments (one agent per category), + the owner agent.
  const roster = await db
    .select({
      id: agents.id,
      name: agents.name,
      category: agents.category,
      description: agents.description,
      tier: agents.tier,
      premium: agents.premium,
      archived: agents.archived,
    })
    .from(agents)
    .where(eq(agents.workspace_id, workspaceId));

  const departments: { category: Category; name: string; description: string }[] = [];
  for (const a of roster) {
    if (a.premium || a.archived) continue;
    if (departments.some((d) => d.category === a.category)) continue;
    departments.push({ category: a.category, name: a.name, description: a.description });
  }
  const ownerTier = ownerKind === "executive" ? "executive" : "manager";
  const owner = roster.find((a) => a.tier === ownerTier);

  let result;
  try {
    result = await planProjectWithClaude({ goal: trimmed, brief, departments, ownerKind });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't plan that project." };
  }

  const projectId = uid();
  const now = new Date();
  await db.insert(projects).values({
    id: projectId,
    workspace_id: workspaceId,
    goal: trimmed,
    title: result.title,
    summary: result.summary,
    status: "planning",
    owner_kind: ownerKind,
    owner_agent_id: owner?.id ?? null,
    plan: result.plan,
    current_phase: 0,
    created_by_type: "human",
    created_at: now,
    updated_at: now,
  });
  const steps = result.plan.phases.reduce((n, ph) => n + ph.steps.length, 0);
  await logProject(
    workspaceId,
    "agent_updated_draft",
    "agent",
    owner?.id ?? "sys",
    `${owner?.name ?? (ownerKind === "executive" ? "Executive Agent" : "Manager Agent")} drafted a ${result.plan.phases.length}-phase plan (${steps} steps) for “${result.title}”.`,
  );
  return { ok: true, projectId, title: result.title };
}

/** Materialize one phase's steps into tasks; draft the deliverables in parallel. */
async function materializePhase(workspaceId: string, project: Project, phaseIndex: number): Promise<void> {
  // Growth campaigns run on their own weekly engine (schedule tweets, draft
  // blogs, set the reply target) — their phases carry no generic steps.
  if (project.kind === "growth") {
    await materializeGrowthPhase(workspaceId, project, phaseIndex);
    return;
  }
  const phase = project.plan.phases[phaseIndex];
  if (!phase || !phase.steps.length) return;
  const now = new Date();

  const workers = await db
    .select({ id: agents.id, category: agents.category })
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.premium, false), eq(agents.archived, false)));
  const workerFor = (cat: Category) => workers.find((w) => w.category === cat)?.id ?? null;

  const toDraft: string[] = [];
  const pageJobs: Array<{ taskId: string; step: ProjectStep }> = [];
  for (const step of phase.steps) {
    const isPage = step.kind === "page" && step.assignee !== "human";
    const isAction = !isPage && (step.kind === "action" || step.assignee === "human");
    const category: Category = isPage ? "content" : isAction ? "admin" : (step.assignee as Category);
    const agentId = isAction ? null : workerFor(category);
    const taskId = uid();
    await db.insert(tasks).values({
      id: taskId,
      workspace_id: workspaceId,
      category,
      title: step.title.slice(0, 120),
      description: step.brief,
      rationale: `${project.title} · ${phase.title}`,
      status: isAction || (!agentId && !isPage) ? "ready" : "agent_working",
      risk_level: "low",
      priority: "medium",
      due_at: null,
      project_id: project.id,
      project_phase: phaseIndex,
      project_step_kind: isPage ? "page" : isAction ? "action" : "deliverable",
      agent_id: agentId,
      created_by_type: "agent",
      requires_approval: true,
      approval_status: "pending",
      execution_status: "none",
      affected_systems: [],
      proposed_actions: 1,
      impact_score: 42,
      created_at: now,
      updated_at: now,
    });

    if (isPage) {
      pageJobs.push({ taskId, step });
    } else if (isAction) {
      await db.insert(taskAssets).values({
        id: uid(),
        task_id: taskId,
        asset_type: "checklist",
        title: `Your step — ${step.title}`.slice(0, 120),
        content: step.brief,
        metadata: null,
      });
    } else if (agentId) {
      toDraft.push(taskId);
    } else {
      // No worker in that department — leave the brief as a note for the owner.
      await db.insert(taskAssets).values({
        id: uid(),
        task_id: taskId,
        asset_type: "summary",
        title: `Brief — ${step.title}`.slice(0, 120),
        content: step.brief,
        metadata: null,
      });
    }
  }

  // Draft deliverables + generate pages concurrently; failures just leave the
  // task Ready with the brief attached.
  const fallbackReady = async (taskId: string, step: ProjectStep) => {
    await db
      .insert(taskAssets)
      .values({ id: uid(), task_id: taskId, asset_type: "summary", title: `Brief — ${step.title}`.slice(0, 120), content: step.brief, metadata: null });
    await db.update(tasks).set({ status: "ready", updated_at: new Date() }).where(eq(tasks.id, taskId));
  };
  await Promise.all([
    ...toDraft.map((taskId) =>
      runTaskWithAgent(workspaceId, taskId).catch(async () => {
        await db.update(tasks).set({ status: "ready", updated_at: new Date() }).where(eq(tasks.id, taskId));
      }),
    ),
    ...pageJobs.map(({ taskId, step }) =>
      generatePageForProjectTask(workspaceId, project, taskId, step).catch(() => fallbackReady(taskId, step)),
    ),
  ]);
}

/** A "page" step: generate a real (draft) page and attach it to the task, linked
 *  by page_id so approving the task publishes it. */
async function generatePageForProjectTask(
  workspaceId: string,
  project: Project,
  taskId: string,
  step: ProjectStep,
): Promise<void> {
  const res = await generateAndSavePage(workspaceId, {
    offer: `${step.title}. ${step.brief}`.trim(),
    pageType: "landing",
    projectId: project.id,
  });
  if (!res.ok || !res.page) throw new Error(res.error ?? "Page generation failed.");
  const p = res.page;
  const preview = [
    `Draft page generated: “${p.content.headline}”`,
    p.content.subheadline,
    "",
    `Approving this task publishes the page live at /p/${p.slug}.`,
  ]
    .filter(Boolean)
    .join("\n");
  await db.insert(taskAssets).values({
    id: uid(),
    task_id: taskId,
    asset_type: "document",
    title: `Page — ${p.title}`.slice(0, 120),
    content: preview,
    metadata: { page_id: p.id, slug: p.slug },
  });
  await db.update(tasks).set({ status: "ready", updated_at: new Date() }).where(eq(tasks.id, taskId));
}

/** Approve the plan and kick off phase 1. */
export async function approveProjectPlan(
  workspaceId: string,
  projectId: string,
  actor: { name: string },
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!row) return { ok: false, error: "Project not found." };
  if (row.status !== "planning") return { ok: false, error: "This plan was already approved." };

  const now = new Date();
  // Growth campaigns advance on a weekly clock — anchor week 1 to go-live so the
  // timeline doesn't drift from a plan that sat unapproved for a while.
  const isGrowth = row.plan?.growth != null;
  await db
    .update(projects)
    .set({ status: "active", current_phase: 0, updated_at: now, ...(isGrowth ? { created_at: now } : {}) })
    .where(eq(projects.id, projectId));
  await materializePhase(workspaceId, toProject(isGrowth ? { ...row, created_at: now } : row), 0);
  await logProject(
    workspaceId,
    "approved",
    "human",
    actor.name,
    `${actor.name} approved the plan for “${row.title}” — phase 1 is underway.`,
  );
  return { ok: true };
}

export interface AdvanceResult {
  advanced: boolean;
  status: ProjectStatus;
}

/** If the current phase is fully resolved, release the next phase (or finish). */
export async function advanceProject(workspaceId: string, projectId: string): Promise<AdvanceResult> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!row || row.status !== "active") return { advanced: false, status: row?.status ?? "cancelled" };

  const phaseIdx = row.current_phase;

  // Growth campaigns advance on a weekly clock (content auto-publishes across the
  // week), not on task completion. Week N ends 7 days after go-live × (N+1).
  if (row.plan?.growth) {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const project = toProject(row);
    const weeks = row.plan.growth.weeks || project.plan.phases.length || 1;
    const phaseEndsAt = new Date(row.created_at).getTime() + (phaseIdx + 1) * weekMs;
    if (Date.now() < phaseEndsAt) return { advanced: false, status: "active" };

    const now = new Date();
    const nextIdx = phaseIdx + 1;
    if (nextIdx >= weeks) {
      await db.update(projects).set({ status: "done", updated_at: now }).where(eq(projects.id, projectId));
      await snapshotFollowers(workspaceId, projectId).catch(() => null);
      await logProject(
        workspaceId,
        "status_changed",
        "system",
        "sys",
        `Growth campaign “${row.title}” wrapped after ${weeks} week${weeks === 1 ? "" : "s"}. 🎉`,
      );
      return { advanced: true, status: "done" };
    }
    await db.update(projects).set({ current_phase: nextIdx, updated_at: now }).where(eq(projects.id, projectId));
    await materializePhase(workspaceId, project, nextIdx);
    await logProject(
      workspaceId,
      "status_changed",
      "system",
      "sys",
      `“${row.title}” → week ${nextIdx + 1}: ${project.plan.phases[nextIdx]?.title ?? ""}.`,
    );
    return { advanced: true, status: "active" };
  }

  const phaseTasks = await db
    .select({ status: tasks.status, approval_status: tasks.approval_status })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspace_id, workspaceId),
        eq(tasks.project_id, projectId),
        eq(tasks.project_phase, phaseIdx),
      ),
    );

  // A phase is complete when every one of its tasks is resolved (done, or the
  // owner rejected/skipped it). Empty phase-tasks means it hasn't materialized —
  // don't advance past that.
  const complete =
    phaseTasks.length > 0 &&
    phaseTasks.every((t) => t.status === "done" || t.approval_status === "rejected");
  if (!complete) return { advanced: false, status: "active" };

  const now = new Date();
  const nextIdx = phaseIdx + 1;
  const project = toProject(row);
  if (nextIdx >= project.plan.phases.length) {
    await db.update(projects).set({ status: "done", updated_at: now }).where(eq(projects.id, projectId));
    await logProject(workspaceId, "status_changed", "system", "sys", `Project “${row.title}” is complete. 🎉`);
    return { advanced: true, status: "done" };
  }
  await db.update(projects).set({ current_phase: nextIdx, updated_at: now }).where(eq(projects.id, projectId));
  await materializePhase(workspaceId, project, nextIdx);
  await logProject(
    workspaceId,
    "status_changed",
    "system",
    "sys",
    `“${row.title}” advanced to phase ${nextIdx + 1}: ${project.plan.phases[nextIdx].title}.`,
  );
  return { advanced: true, status: "active" };
}

/** Cron heartbeat: advance every active project whose current phase is done. */
export async function advanceActiveProjects(limit = 20): Promise<{ advanced: number }> {
  // tenant-scope-exempt: cron heartbeat scans active projects across ALL workspaces;
  // each is then advanced via advanceProject(workspace_id, id), which is scoped.
  const active = await db
    .select({ id: projects.id, workspace_id: projects.workspace_id })
    .from(projects)
    .where(eq(projects.status, "active"))
    .limit(limit);
  let advanced = 0;
  for (const p of active) {
    try {
      const r = await advanceProject(p.workspace_id, p.id);
      if (r.advanced) advanced += 1;
    } catch {
      /* one bad project never blocks the rest */
    }
  }
  return { advanced };
}

/** Reset project tasks wedged mid-execution (e.g. the server died during a run)
 *  back to "ready for review", preserving the drafted deliverable. Executions run
 *  synchronously in seconds, so anything still "executing" after 5 min is dead. */
export async function healStuckProjectTasks(workspaceId: string): Promise<{ healed: number }> {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const res = await db
    .update(tasks)
    .set({ status: "ready", approval_status: "pending", execution_status: "none", updated_at: new Date() })
    .where(
      and(
        eq(tasks.workspace_id, workspaceId),
        isNotNull(tasks.project_id),
        eq(tasks.execution_status, "executing"),
        lt(tasks.updated_at, staleBefore),
      ),
    )
    .returning({ id: tasks.id });
  return { healed: res.length };
}

/** Advance every active project in ONE workspace whose current phase is done.
 *  Used to auto-progress phases when the user opens the Projects page (so it
 *  works locally without the cron, and matches "I finished the phase" intent). */
export async function advanceWorkspaceProjects(workspaceId: string): Promise<{ advanced: number }> {
  const active = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.status, "active")))
    .limit(50);
  let advanced = 0;
  for (const p of active) {
    try {
      const r = await advanceProject(workspaceId, p.id);
      if (r.advanced) advanced += 1;
    } catch {
      /* one bad project never blocks the rest */
    }
  }
  return { advanced };
}

export async function cancelProject(
  workspaceId: string,
  projectId: string,
  actor: { name: string },
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({ title: projects.title, status: projects.status })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!row) return { ok: false, error: "Project not found." };
  await db
    .update(projects)
    .set({ status: "cancelled", updated_at: new Date() })
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)));
  await logProject(workspaceId, "status_changed", "human", actor.name, `${actor.name} cancelled “${row.title}”.`);
  return { ok: true };
}

/**
 * Delete a project entirely and discard its work. All of its tasks are removed
 * (their assets/decisions/runs cascade, and any queued scheduled post is thereby
 * canceled so nothing publishes later); follower snapshots cascade with the
 * project; unpublished project pages are removed. Already-published pages stay
 * live (remove those from Pages).
 */
export async function deleteProject(
  workspaceId: string,
  projectId: string,
  actor: { name: string },
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!row) return { ok: false, error: "Project not found." };

  await db.delete(tasks).where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.project_id, projectId)));
  await db
    .delete(pages)
    .where(and(eq(pages.workspace_id, workspaceId), eq(pages.project_id, projectId), eq(pages.status, "draft")));
  await db.delete(projects).where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)));

  await logProject(
    workspaceId,
    "status_changed",
    "human",
    actor.name,
    `${actor.name} deleted “${row.title}” and discarded its tasks.`,
  );
  return { ok: true };
}

export async function listProjects(workspaceId: string): Promise<Project[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.workspace_id, workspaceId))
    .orderBy(desc(projects.created_at));
  return Promise.all(rows.map(async (r) => toProject(r, await computeProgress(r))));
}

export async function getProject(workspaceId: string, projectId: string): Promise<Project | null> {
  const [r] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!r) return null;
  return toProject(r, await computeProgress(r));
}
