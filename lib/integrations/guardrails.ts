import "server-only";

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, executionRuns, tasks } from "@/lib/db/schema";

/**
 * Execution guardrails for a multi-tenant beta. The kill switch halts ALL task
 * execution instantly (flip the env var in prod — the big red button); the
 * per-workspace daily cap and the auto-mode re-check bound what UNATTENDED
 * automation (an auto-mode agent shipping without a human) can do on its own.
 * Human-approved execution is never capped — the person is the safety valve.
 */

/** Global kill switch — set OPERATOR_EXECUTION_DISABLED=1 to halt all execution. */
export function executionKilled(): boolean {
  const v = (process.env.OPERATOR_EXECUTION_DISABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Per-workspace ceiling on unattended executions per day (anti-runaway). */
export function dailyAutomationCap(): number {
  const n = Number(process.env.OPERATOR_DAILY_ACTION_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

/** How many execution runs this workspace has started since local midnight. */
export async function executionsToday(workspaceId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: executionRuns.id })
    .from(executionRuns)
    .innerJoin(tasks, eq(tasks.id, executionRuns.task_id))
    .where(and(eq(tasks.workspace_id, workspaceId), gte(executionRuns.started_at, start)));
  return rows.length;
}

export interface GuardDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Gate an unattended (autopilot) execution: refuse if the kill switch is on, if
 * the workspace has hit its daily automation cap, or if the owning agent isn't
 * genuinely in auto mode (defense-in-depth against shipping without a human).
 */
export async function guardUnattendedExecution(
  workspaceId: string,
  agentId: string | null,
): Promise<GuardDecision> {
  if (executionKilled()) {
    return { allowed: false, reason: "Execution is paused (kill switch is on)." };
  }
  const cap = dailyAutomationCap();
  const used = await executionsToday(workspaceId);
  if (used >= cap) {
    return {
      allowed: false,
      reason: `Daily automation cap reached (${used}/${cap}). Approve manually, or it resumes tomorrow.`,
    };
  }
  if (agentId) {
    const [a] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (a && a.permissions_mode !== "auto") {
      return { allowed: false, reason: "Agent is not in auto mode — unattended execution refused." };
    }
  }
  return { allowed: true };
}
