import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, projects, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { planProjectWithClaude } from "@/lib/ai/project";
import { runTaskWithAgent } from "./run";
import type { Category, Project, ProjectPlan, ProjectStatus } from "@/lib/types";

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
    plan: row.plan,
    current_phase: row.current_phase,
    created_by_type: row.created_by_type,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    progress,
  };
}

/** Overall completion: done tasks over the plan's total step count. */
async function progressFor(projectId: string, plan: ProjectPlan): Promise<{ total: number; done: number }> {
  const total = plan.phases.reduce((n, ph) => n + ph.steps.length, 0);
  const rows = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.project_id, projectId));
  return { total, done: rows.filter((r) => r.status === "done").length };
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
  const phase = project.plan.phases[phaseIndex];
  if (!phase || !phase.steps.length) return;
  const now = new Date();

  const workers = await db
    .select({ id: agents.id, category: agents.category })
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.premium, false), eq(agents.archived, false)));
  const workerFor = (cat: Category) => workers.find((w) => w.category === cat)?.id ?? null;

  const toDraft: string[] = [];
  for (const step of phase.steps) {
    const isAction = step.kind === "action" || step.assignee === "human";
    const category: Category = isAction ? "admin" : (step.assignee as Category);
    const agentId = isAction ? null : workerFor(category);
    const taskId = uid();
    await db.insert(tasks).values({
      id: taskId,
      workspace_id: workspaceId,
      category,
      title: step.title.slice(0, 120),
      description: step.brief,
      rationale: `${project.title} · ${phase.title}`,
      status: isAction || !agentId ? "ready" : "agent_working",
      risk_level: "low",
      priority: "medium",
      due_at: null,
      project_id: project.id,
      project_phase: phaseIndex,
      project_step_kind: isAction ? "action" : "deliverable",
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

    if (isAction) {
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

  // Draft deliverables concurrently; a failure just leaves the task Ready to draft manually.
  await Promise.all(
    toDraft.map((taskId) =>
      runTaskWithAgent(workspaceId, taskId).catch(async () => {
        await db.update(tasks).set({ status: "ready", updated_at: new Date() }).where(eq(tasks.id, taskId));
      }),
    ),
  );
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
  await db.update(projects).set({ status: "active", current_phase: 0, updated_at: now }).where(eq(projects.id, projectId));
  await materializePhase(workspaceId, toProject(row), 0);
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
  const phaseTasks = await db
    .select({ status: tasks.status, approval_status: tasks.approval_status })
    .from(tasks)
    .where(and(eq(tasks.project_id, projectId), eq(tasks.project_phase, phaseIdx)));

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

export async function listProjects(workspaceId: string): Promise<Project[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.workspace_id, workspaceId))
    .orderBy(desc(projects.created_at));
  return Promise.all(rows.map(async (r) => toProject(r, await progressFor(r.id, r.plan))));
}

export async function getProject(workspaceId: string, projectId: string): Promise<Project | null> {
  const [r] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!r) return null;
  return toProject(r, await progressFor(r.id, r.plan));
}
