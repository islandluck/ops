import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { taskPlans, tasks } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { getAnthropic } from "@/lib/ai/client";
import { runWithUsage } from "@/lib/ai/usage";
import type { Priority, RiskLevel, TaskPlan, TaskPlanGroup, TaskStatus } from "@/lib/types";

/**
 * Executive triage of the Approval Center ("Plan my day"). Reads all open tasks
 * and assigns each a priority, risk, impact, batch group, rank, and a suggested
 * time block — then writes an ordered plan of action. It NEVER schedules or sends
 * anything; the suggested time is guidance and every task still needs approval.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const OPEN_STATUSES: TaskStatus[] = ["new", "ready", "changes_requested"];
const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
const RISKS: RiskLevel[] = ["low", "medium", "high"];

function toPlan(r: typeof taskPlans.$inferSelect): TaskPlan {
  return {
    summary: r.summary,
    groups: (r.groups ?? []) as TaskPlanGroup[],
    task_count: r.task_count,
    created_at: new Date(r.created_at).toISOString(),
  };
}

/** The latest plan for a workspace (null until "Plan my day" has been run). */
export async function getLatestPlan(workspaceId: string): Promise<TaskPlan | null> {
  const [row] = await db
    .select()
    .from(taskPlans)
    .where(eq(taskPlans.workspace_id, workspaceId))
    .orderBy(desc(taskPlans.created_at))
    .limit(1);
  return row ? toPlan(row) : null;
}

export async function planApprovalCenter(
  workspaceId: string,
): Promise<{ ok: true; plan: TaskPlan; planned: number } | { ok: false; error: string }> {
  const open = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      category: tasks.category,
      description: tasks.description,
      affected_systems: tasks.affected_systems,
      risk_level: tasks.risk_level,
      due_at: tasks.due_at,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspace_id, workspaceId),
        eq(tasks.archived, false),
        inArray(tasks.status, OPEN_STATUSES),
      ),
    )
    .orderBy(desc(tasks.created_at))
    .limit(80);

  if (!open.length) {
    return { ok: false, error: "There are no open tasks to plan right now." };
  }

  return runWithUsage(workspaceId, "task-triage", async () => {
    const { brief } = await getPlanningContext(workspaceId);
    const list = open
      .map(
        (t, i) =>
          `${i + 1}. [${t.id}] (${t.category}) ${t.title}${
            t.affected_systems.length ? ` — uses ${t.affected_systems.join(", ")}` : ""
          }${t.description ? ` — ${t.description.slice(0, 120)}` : ""}`,
      )
      .join("\n");

    const system = [
      `You are the Executive — chief of staff for ${brief.company_name || "the founder"}. The founder is staring at a flat, overwhelming list of ${open.length} open tasks with no order. Triage them so they can just start moving.`,
      brief.business_description ? `Business: ${brief.business_description}` : "",
      "",
      "For EACH task assign:",
      "- priority: one of urgent | high | medium | low",
      "- risk: one of low | medium | high (how much damage a mistake would do)",
      "- impact: 0–100 (how much it moves the business)",
      "- group: a SHORT batch label so similar work clusters (e.g. 'Email outreach', 'Content', 'Admin', 'Finance'). Reuse the same label across related tasks — batching 8 emails under one 'Email outreach' group is the point.",
      "- rank: 1 = do first (global order across everything, by priority then logical sequence)",
      "- suggested_time: a human time block, e.g. '9–10am', 'Today PM', 'Tomorrow AM'. GUIDANCE ONLY — batch similar work into the same block.",
      "",
      "Then write a 2–3 sentence plan-of-action `summary` telling them exactly what to tackle first and why. And return `groups`: the batches in the order to work them, each with a one-line `note` on how to knock it out.",
      "Be decisive — vary the priorities (do NOT mark everything medium). Never invent tasks; only rank the ones listed.",
      "",
      'Respond with ONLY JSON: {"summary": string, "tasks": [{"id": string, "priority": string, "risk": string, "impact": number, "group": string, "rank": number, "suggested_time": string}], "groups": [{"name": string, "note": string, "priority": string, "task_ids": string[]}]}',
    ]
      .filter(Boolean)
      .join("\n");

    const client = getAnthropic();
    let text = "";
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: `The open tasks:\n${list}` }],
      });
      text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "The Executive couldn't build a plan." };
    }

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) return { ok: false as const, error: "The plan came back unreadable — try again." };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return { ok: false as const, error: "Couldn't parse the plan — try again." };
    }

    const openIds = new Set(open.map((t) => t.id));
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const clampPriority = (v: unknown): Priority => (PRIORITIES.includes(str(v) as Priority) ? (str(v) as Priority) : "medium");
    const clampRisk = (v: unknown): RiskLevel => (RISKS.includes(str(v) as RiskLevel) ? (str(v) as RiskLevel) : "low");

    // Persist per-task triage.
    const now = new Date();
    let planned = 0;
    const rows = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    for (const raw of rows) {
      const t = (raw ?? {}) as Record<string, unknown>;
      const id = str(t.id);
      if (!openIds.has(id)) continue;
      const impactNum = Number(t.impact);
      const rankNum = Number(t.rank);
      await db
        .update(tasks)
        .set({
          priority: clampPriority(t.priority),
          risk_level: clampRisk(t.risk),
          impact_score: Number.isFinite(impactNum) ? Math.max(0, Math.min(100, Math.round(impactNum))) : 45,
          plan_group: str(t.group).slice(0, 60) || null,
          plan_rank: Number.isFinite(rankNum) ? Math.round(rankNum) : null,
          suggested_time: str(t.suggested_time).slice(0, 40) || null,
          updated_at: now,
        })
        .where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.id, id)));
      planned += 1;
    }

    const groups: TaskPlanGroup[] = (Array.isArray(parsed.groups) ? parsed.groups : [])
      .map((g) => (g ?? {}) as Record<string, unknown>)
      .map((g) => ({
        name: str(g.name).slice(0, 60),
        note: str(g.note).slice(0, 300),
        priority: clampPriority(g.priority),
        task_ids: (Array.isArray(g.task_ids) ? g.task_ids : []).map((x) => str(x)).filter((x) => openIds.has(x)),
      }))
      .filter((g) => g.name);

    // Keep one current plan per workspace.
    await db.delete(taskPlans).where(eq(taskPlans.workspace_id, workspaceId));
    const [planRow] = await db
      .insert(taskPlans)
      .values({
        workspace_id: workspaceId,
        summary: str(parsed.summary).slice(0, 2000),
        groups,
        task_count: planned,
        created_at: now,
      })
      .returning();

    return { ok: true as const, plan: toPlan(planRow), planned };
  });
}

/** Manually set a task's priority (user override), workspace-scoped. */
export async function setTaskPriority(
  workspaceId: string,
  taskId: string,
  priority: Priority,
): Promise<{ ok: true }> {
  await db
    .update(tasks)
    .set({ priority, updated_at: new Date() })
    .where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.id, taskId)));
  return { ok: true };
}

/** Clear the current plan (task fields keep their triaged values). */
export async function clearPlan(workspaceId: string): Promise<{ ok: true }> {
  await db.delete(taskPlans).where(eq(taskPlans.workspace_id, workspaceId));
  return { ok: true };
}
