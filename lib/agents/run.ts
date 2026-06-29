import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  agents,
  businessBriefs,
  profiles,
  taskAssets,
  tasks,
  workspaces,
} from "@/lib/db/schema";
import { generateAgentTask } from "@/lib/ai/agent";
import { runTaskExecution } from "@/lib/integrations/execute";
import type { Agent, AssetType, BusinessBrief, Category } from "@/lib/types";

function assetTypeFor(category: Category): AssetType {
  if (category === "content") return "document";
  if (category === "research") return "summary";
  return "email";
}

export interface RunAgentResult {
  ok: boolean;
  taskTitle?: string;
  shipped?: boolean;
  error?: string;
}

/** Have one agent prepare a fresh task (and ship it if the agent is on auto). */
export async function runAgentForWorkspace(
  workspaceId: string,
  agentId: string,
  actor: { name: string; email: string },
): Promise<RunAgentResult> {
  const [a] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.id, agentId)))
    .limit(1);
  if (!a) return { ok: false, error: "Agent not found." };
  if (a.premium) return { ok: false, error: "This is a premium agent (Manager/Executive)." };
  if (a.archived) return { ok: false, error: "This agent is archived." };

  const [briefRow] = await db
    .select()
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  if (!briefRow) return { ok: false, error: "No business brief." };

  let gen;
  try {
    gen = await generateAgentTask(a as unknown as Agent, briefRow as unknown as BusinessBrief);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Generation failed." };
  }

  const now = new Date();
  const taskId = randomUUID();
  const auto = a.permissions_mode === "auto";

  await db.insert(tasks).values({
    id: taskId,
    workspace_id: workspaceId,
    category: a.category,
    title: gen.title,
    description: gen.rationale,
    rationale: gen.rationale,
    status: "ready",
    risk_level: "low",
    priority: "medium",
    due_at: new Date(now.getTime() + 2 * 24 * 3600 * 1000),
    agent_id: a.id,
    created_by_type: "agent",
    requires_approval: !auto,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: a.allowed_integrations,
    proposed_actions: 1,
    impact_score: 42,
    created_at: now,
    updated_at: now,
  });
  await db.insert(taskAssets).values({
    id: randomUUID(),
    task_id: taskId,
    asset_type: assetTypeFor(a.category),
    title: `Drafted by ${a.name}`,
    content: gen.draft,
    metadata: null,
  });
  if (a.log_activity) {
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: taskId,
      event_type: "agent_updated_draft",
      actor_type: "agent",
      actor_id: a.id,
      summary: `${a.name} prepared “${gen.title}”${a.background_enabled ? " in the background" : ""}.`,
      created_at: now,
    });
  }
  await db
    .update(agents)
    .set({ last_run_at: now, tasks_prepared: a.tasks_prepared + 1, status: "waiting" })
    .where(eq(agents.id, a.id));

  if (auto && actor.email) {
    const res = await runTaskExecution(workspaceId, taskId, actor);
    return { ok: true, taskTitle: gen.title, shipped: res.ok };
  }
  return { ok: true, taskTitle: gen.title };
}

/** Cron entry point: run background-enabled agents across all workspaces. */
export async function runBackgroundAgents(limit = 25): Promise<{ ran: number }> {
  const eligible = await db
    .select()
    .from(agents)
    .where(and(eq(agents.background_enabled, true), eq(agents.archived, false)));

  let ran = 0;
  for (const a of eligible) {
    if (ran >= limit) break;
    if (a.premium) continue;
    // Resolve the workspace owner's email for safe (self-send) execution.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, a.workspace_id)).limit(1);
    const [owner] = ws
      ? await db.select().from(profiles).where(eq(profiles.id, ws.owner_id)).limit(1)
      : [];
    try {
      await runAgentForWorkspace(a.workspace_id, a.id, {
        name: owner?.full_name || "Scheduler",
        email: owner?.email || "",
      });
      ran += 1;
    } catch {
      /* skip and continue */
    }
  }
  return { ran };
}
