import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, approvalDecisions, profiles, tasks, workspaces } from "@/lib/db/schema";
import { runTaskExecution } from "@/lib/integrations/execute";

/**
 * Scheduling + auto-publish. A human approves *what* and *when*; the scheduler
 * performs the actual send at that instant via the same server-side execution
 * path (`runTaskExecution`) an immediate approval would use — so scheduled work
 * is auditable and respects every guardrail (e.g. the X daily cap).
 */

export interface ScheduleResult {
  ok: boolean;
  error?: string;
}

/** Smallest slack we allow — a time this far in the past is rejected as stale. */
const PAST_GRACE_MS = 60_000;

/**
 * Approve a task and queue it to auto-execute at `whenISO` instead of now.
 * `label` is an optional human-readable time (formatted client-side in the
 * owner's timezone) used only for the activity summary.
 */
export async function scheduleTask(
  workspaceId: string,
  taskId: string,
  whenISO: string,
  actor: { name: string },
  label?: string,
): Promise<ScheduleResult> {
  const when = new Date(whenISO);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "That isn't a valid time." };
  if (when.getTime() < Date.now() - PAST_GRACE_MS) {
    return { ok: false, error: "Pick a time in the future." };
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return { ok: false, error: "Task not found." };
  if (task.status === "done") return { ok: false, error: "That task is already completed." };
  if (task.execution_status === "executing") {
    return { ok: false, error: "That task is already executing." };
  }

  const now = new Date();
  await db
    .update(tasks)
    .set({
      approval_status: "approved",
      status: "approved",
      execution_status: "queued",
      scheduled_at: when,
      requires_approval: true,
      updated_at: now,
    })
    .where(eq(tasks.id, taskId));
  await db.insert(approvalDecisions).values({
    id: randomUUID(),
    task_id: taskId,
    decided_by: actor.name,
    decision_type: "approve",
    comment: `Scheduled for ${label || when.toISOString()}`,
    created_at: now,
  });
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: taskId,
    event_type: "approved",
    actor_type: "human",
    actor_id: actor.name,
    summary: `${actor.name} scheduled “${task.title}” to publish ${label ? label : "at " + when.toISOString()}.`,
    created_at: now,
  });
  return { ok: true };
}

/** Cancel a scheduled task, returning it to the board for review. */
export async function unscheduleTask(
  workspaceId: string,
  taskId: string,
  actor: { name: string },
): Promise<ScheduleResult> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return { ok: false, error: "Task not found." };
  if (task.execution_status !== "queued") {
    return { ok: false, error: "That task isn't scheduled." };
  }

  const now = new Date();
  await db
    .update(tasks)
    .set({
      execution_status: "none",
      scheduled_at: null,
      approval_status: "pending",
      status: "ready",
      updated_at: now,
    })
    .where(eq(tasks.id, taskId));
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: taskId,
    event_type: "status_changed",
    actor_type: "human",
    actor_id: actor.name,
    summary: `${actor.name} unscheduled “${task.title}”. It's back on the board for review.`,
    created_at: now,
  });
  return { ok: true };
}

export interface PublishDueResult {
  published: number;
  failed: number;
}

/**
 * Scheduler entry point: execute every task whose scheduled time has arrived.
 * Each due task is atomically claimed (queued → executing) before it runs, so
 * overlapping ticks can never publish the same post twice.
 */
export async function publishDueScheduledPosts(limit = 25): Promise<PublishDueResult> {
  const now = new Date();
  // tenant-scope-exempt: scheduler flushes due tasks across ALL workspaces; each is
  // then executed via runTaskExecution(workspace_id, id).
  const due = await db
    .select({ id: tasks.id, workspace_id: tasks.workspace_id })
    .from(tasks)
    .where(
      and(
        eq(tasks.execution_status, "queued"),
        eq(tasks.approval_status, "approved"),
        isNotNull(tasks.scheduled_at),
        lte(tasks.scheduled_at, now),
      ),
    )
    .limit(limit);

  let published = 0;
  let failed = 0;

  for (const t of due) {
    // Claim the task so a concurrent tick can't also pick it up.
    const claimed = await db
      .update(tasks)
      .set({ execution_status: "executing", updated_at: new Date() })
      .where(and(eq(tasks.id, t.id), eq(tasks.execution_status, "queued")))
      .returning({ id: tasks.id });
    if (!claimed.length) continue;

    // Resolve the workspace owner for safe (self-send) execution, mirroring the
    // background-agent runner.
    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, t.workspace_id))
      .limit(1);
    const [owner] = ws
      ? await db.select().from(profiles).where(eq(profiles.id, ws.owner_id)).limit(1)
      : [];
    const actor = { name: owner?.full_name || "Scheduler", email: owner?.email || "" };

    try {
      const res = await runTaskExecution(t.workspace_id, t.id, actor);
      if (res.ok) published += 1;
      else failed += 1;
    } catch {
      failed += 1;
      await db
        .update(tasks)
        .set({ execution_status: "failed", updated_at: new Date() })
        .where(eq(tasks.id, t.id));
    }
  }

  return { published, failed };
}
