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
import { draftWithClaude } from "@/lib/ai/draft";
import { runTaskExecution } from "@/lib/integrations/execute";
import { saveDocument } from "@/lib/db/queries";
import { runEmailTriage } from "./triage";
import { runSocialMediaAgent } from "./social";
import { publishDueScheduledPosts } from "./schedule";
import type { Agent, AssetType, BusinessBrief, Category, DraftRequest } from "@/lib/types";

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

  // The Social Media Agent has its own research → draft workflow.
  if (a.kind === "social") {
    const res = await runSocialMediaAgent(workspaceId, a.id);
    return {
      ok: res.ok,
      taskTitle: res.ok ? `${res.drafted ?? 0} draft${res.drafted === 1 ? "" : "s"} ready to review` : undefined,
      error: res.error,
    };
  }

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
  await saveDocument({
    workspaceId,
    agentId: a.id,
    authorName: a.name,
    taskId,
    taskTitle: gen.title,
    name: gen.title,
    content: gen.draft,
    folder: a.folder,
    docType: assetTypeFor(a.category),
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

/** Cron entry point: run background-enabled agents across all workspaces, then
 *  flush any scheduled posts whose time has arrived. */
export async function runBackgroundAgents(limit = 25): Promise<{ ran: number; published: number }> {
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
    const actor = { name: owner?.full_name || "Scheduler", email: owner?.email || "" };
    try {
      // The Admin agent's background job is inbox triage; others prepare a task.
      if (a.category === "admin") {
        await runEmailTriage(a.workspace_id, actor);
      } else {
        await runAgentForWorkspace(a.workspace_id, a.id, actor);
      }
      ran += 1;
    } catch {
      /* skip and continue */
    }
  }

  // Publish anything whose scheduled time has arrived (auto-publish).
  let published = 0;
  try {
    ({ published } = await publishDueScheduledPosts());
  } catch {
    /* scheduler errors never break the agent run */
  }
  return { ran, published };
}

function deliverableType(category: Category): AssetType {
  if (category === "growth") return "email";
  if (category === "research") return "summary";
  return "document";
}

export interface RunTaskResult {
  ok: boolean;
  title?: string;
  error?: string;
}

/**
 * Have a task's assigned agent produce the deliverable draft — grounded in the
 * task's context (description + any attached context assets) + the business
 * brief + the agent's persona. Attaches it, files it as a document, and moves
 * the task to Ready for the owner's approval. This is how an action task gets
 * "done by an agent" before you review it.
 */
export async function runTaskWithAgent(
  workspaceId: string,
  taskId: string,
): Promise<RunTaskResult> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return { ok: false, error: "Task not found." };

  const [agent] = task.agent_id
    ? await db.select().from(agents).where(eq(agents.id, task.agent_id)).limit(1)
    : [];
  const [briefRow] = await db
    .select()
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  const assetRows = await db.select().from(taskAssets).where(eq(taskAssets.task_id, taskId));
  const context = assetRows
    .map((a) => a.content)
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);

  const req: DraftRequest = {
    category: task.category,
    title: task.title,
    description: [task.description, context].filter(Boolean).join("\n\n"),
    rationale: task.rationale,
    companyName: briefRow?.company_name ?? "",
    companyContext: `${briefRow?.business_description ?? ""} ${briefRow?.core_offer ?? ""}`.trim(),
    idealCustomer: briefRow?.ideal_customer_profile ?? "",
    voiceRules: briefRow?.voice_rules ?? [],
    restrictedPhrases: briefRow?.restricted_phrases ?? [],
    xPost: task.affected_systems.includes("X (Twitter)"),
    agentName: agent?.name,
    agentInstructions: agent?.instructions,
  };

  let draft: string;
  try {
    draft = await draftWithClaude(req);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Drafting failed." };
  }

  const now = new Date();
  const authorName = agent?.name ?? "Operator";
  const type = deliverableType(task.category);

  await db.insert(taskAssets).values({
    id: randomUUID(),
    task_id: taskId,
    asset_type: type,
    title: `Drafted by ${authorName}`,
    content: draft,
    metadata: null,
  });
  await saveDocument({
    workspaceId,
    agentId: agent?.id ?? null,
    authorName,
    taskId,
    taskTitle: task.title,
    name: task.title,
    content: draft,
    folder: agent?.folder ?? "",
    docType: type,
  });
  await db
    .update(tasks)
    .set({ status: "ready", requires_approval: true, updated_at: now })
    .where(eq(tasks.id, taskId));
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: taskId,
    event_type: "agent_updated_draft",
    actor_type: "agent",
    actor_id: agent?.id ?? "sys",
    summary: `${authorName} drafted “${task.title}”.`,
    created_at: now,
  });
  if (agent) {
    await db
      .update(agents)
      .set({ last_run_at: now, tasks_prepared: agent.tasks_prepared + 1, status: "waiting" })
      .where(eq(agents.id, agent.id));
  }
  return { ok: true, title: task.title };
}
