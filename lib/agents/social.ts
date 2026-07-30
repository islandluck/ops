import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, approvalDecisions, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext, saveDocument } from "@/lib/db/queries";
import { researchTopics } from "@/lib/ai/research";
import { generateSocialBatch, type SocialPiece } from "@/lib/ai/social";
import { nextPublishSlots } from "./slots";
import { composeXPost } from "@/lib/social/x-post";

/**
 * Social Media Agent — researches current topics in the company's industry
 * (Tavily; falls back to brief-grounded when no key), drafts a batch of on-brand
 * X posts + blog drafts, and routes each to the approval board + the file
 * manager. Draft-only for now: approving files it; publishing is a later phase.
 */

export interface SocialRunResult {
  ok: boolean;
  drafted?: number;
  error?: string;
}

/** How many pieces one run produces in approval mode (rate cap). */
const CONFIG = { x: 3, blog: 1 };

/** Autopilot keeps this many scheduled X posts in the pipeline at once. Bounding
 *  the pipeline (not the run frequency) means a frequent cron can't run away:
 *  each run only tops the pipeline back up to this target. */
const AUTOPILOT_TARGET = 3;

export async function runSocialMediaAgent(
  workspaceId: string,
  agentId: string | null,
): Promise<SocialRunResult> {
  const [agent] = agentId
    ? await db
        .select()
        .from(agents)
        .where(and(eq(agents.workspace_id, workspaceId), eq(agents.id, agentId)))
        .limit(1)
    : await db
        .select()
        .from(agents)
        .where(and(eq(agents.workspace_id, workspaceId), eq(agents.kind, "social")))
        .limit(1);

  const { brief } = await getPlanningContext(workspaceId);
  const autopilot = agent?.permissions_mode === "auto";
  const now = new Date();

  // Autopilot: draft, schedule, and publish to X without approval — but keep
  // only a bounded pipeline of upcoming scheduled posts, and skip the LLM
  // entirely when that pipeline is already full (so a frequent cron is a no-op).
  let slots: Date[] = [];
  let genConfig: { x: number; blog: number } = CONFIG;
  if (autopilot) {
    const upcoming = await db
      .select({ scheduled_at: tasks.scheduled_at })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspace_id, workspaceId),
          eq(tasks.execution_status, "queued"),
          gt(tasks.scheduled_at, now),
          sql`${"X (Twitter)"} = any(${tasks.affected_systems})`,
        ),
      );
    const need = Math.max(0, AUTOPILOT_TARGET - upcoming.length);
    const occupied = upcoming
      .map((u) => (u.scheduled_at ? new Date(u.scheduled_at).getTime() : 0))
      .filter(Boolean);
    slots = need > 0 ? nextPublishSlots(need, brief.timezone, occupied, now) : [];
    if (slots.length === 0) {
      // Pipeline full (or no free slots) — nothing to do; don't call the model.
      if (agent) {
        await db.update(agents).set({ last_run_at: now, status: "waiting" }).where(eq(agents.id, agent.id));
      }
      return { ok: true, drafted: 0 };
    }
    genConfig = { x: slots.length, blog: 0 };
  }

  // Live research (falls back to brief-grounded when TAVILY_API_KEY is absent).
  const query = `latest news, trends, and discussions relevant to this business: ${brief.business_description} ${brief.core_offer}`
    .slice(0, 380)
    .trim();
  const research = await researchTopics(query);

  let pieces: SocialPiece[];
  try {
    pieces = await generateSocialBatch(brief, agent?.instructions ?? "", research, genConfig);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Content generation failed." };
  }
  if (!pieces.length) return { ok: true, drafted: 0 };

  const authorName = agent?.name ?? "Social Media Agent";
  const authorId = agent?.id ?? null;
  const folder = agent?.folder || "Social";
  let scheduledCount = 0;
  let xSlot = 0;

  for (const p of pieces) {
    const isX = p.channel === "x";
    const finalContent = isX ? composeXPost(p.content, p.hashtags) : p.content;
    const label = isX ? "X post" : "Blog draft";
    const heading = `${label}: ${p.title}`.slice(0, 120);
    const taskId = randomUUID();
    // In autopilot, each X post claims the next open slot and ships without approval.
    const slot = autopilot && isX ? (slots[xSlot++] ?? null) : null;
    const isScheduled = slot != null;
    if (isScheduled) scheduledCount += 1;

    await db.insert(tasks).values({
      id: taskId,
      workspace_id: workspaceId,
      category: "content",
      title: heading,
      description: isX
        ? isScheduled
          ? "Autopilot scheduled this to auto-publish to X. Cancel any time before it goes out."
          : "Ready-to-post X/Twitter draft. Approving publishes it to X (once connected)."
        : "Blog draft for your review.",
      rationale: research?.sources.length
        ? "Drafted from current industry topics."
        : "Drafted from your business brief.",
      status: isScheduled ? "approved" : "ready",
      risk_level: "low",
      priority: "medium",
      due_at: null,
      scheduled_at: slot,
      agent_id: authorId,
      created_by_type: "agent",
      requires_approval: !isScheduled,
      approval_status: isScheduled ? "approved" : "pending",
      execution_status: isScheduled ? "queued" : "none",
      // X posts publish for real (on approval, or at their scheduled time under
      // autopilot); blog drafts have no publish target yet (file manager only).
      affected_systems: isX ? ["X (Twitter)"] : [],
      proposed_actions: 1,
      impact_score: 40,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskAssets).values({
      id: randomUUID(),
      task_id: taskId,
      asset_type: isX ? "social_post" : "document",
      title: isX ? "X post" : p.title,
      content: finalContent,
      metadata: isX ? { channel: "X (Twitter)", chars: finalContent.length } : { channel: "Blog" },
    });
    if (isScheduled && slot) {
      // Record the auto-approval so the eventual publish has an audit trail.
      await db.insert(approvalDecisions).values({
        id: randomUUID(),
        task_id: taskId,
        decided_by: authorName,
        decision_type: "approve",
        comment: `Autopilot scheduled for ${slot.toISOString()}`,
        created_at: now,
      });
    }
    await saveDocument({
      workspaceId,
      agentId: authorId,
      authorName,
      taskId,
      taskTitle: heading,
      name: heading,
      content: finalContent,
      folder,
      docType: isX ? "social_post" : "document",
    });
  }

  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "agent_updated_draft",
    actor_type: "agent",
    actor_id: authorId ?? "sys",
    summary: autopilot
      ? `${authorName} auto-scheduled ${scheduledCount} post${scheduledCount === 1 ? "" : "s"} to publish to X.`
      : `${authorName} drafted ${pieces.length} piece${pieces.length === 1 ? "" : "s"} of content${research?.sources.length ? " from current topics" : ""}.`,
    created_at: now,
  });
  if (agent) {
    await db
      .update(agents)
      .set({ last_run_at: now, tasks_prepared: agent.tasks_prepared + pieces.length, status: "waiting" })
      .where(eq(agents.id, agent.id));
  }
  return { ok: true, drafted: pieces.length };
}
