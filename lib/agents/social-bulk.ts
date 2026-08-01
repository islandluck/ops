import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, approvalDecisions, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext, saveDocument } from "@/lib/db/queries";
import { fitToX } from "@/lib/social/x-post";
import { nextPublishSlots } from "./slots";

/**
 * Bulk X composer — turn a pasted list of tweet ideas into individual
 * auto-publishing scheduled posts, spread across upcoming days at the chosen
 * cadence. Reuses the same scheduled-task shape the Social agent's autopilot
 * uses, so the existing cron (publishDueScheduledPosts) posts them for real.
 */

/** Split pasted text into individual tweet drafts. Blank-line-separated blocks
 *  first (so multi-line tweets survive); otherwise one tweet per non-empty line. */
export function parseTweets(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const parts =
    blocks.length > 1 ? blocks : text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Strip common list prefixes people paste ("1. ", "- ", "• ").
  return parts
    .map((t) => t.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 100);
}

/** Evenly-spaced local posting hours across a daily window (perDay posts/day). */
export function spreadHours(perDay: number, startHour = 9, endHour = 19): number[] {
  const n = Math.max(1, Math.min(Math.round(perDay), 8));
  if (n === 1) return [Math.round((startHour + endHour) / 2)];
  const step = (endHour - startHour) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(startHour + i * step));
}

export interface BulkScheduleConfig {
  perDay: number;
  startHour?: number;
  endHour?: number;
}

export interface BulkScheduleResult {
  scheduled: number;
  when: string[]; // ISO instants, in order
}

/** Create one queued+approved scheduled X task per tweet, spread across days. */
export async function scheduleBulkTweets(
  workspaceId: string,
  tweets: string[],
  config: BulkScheduleConfig,
  actor: { name: string },
): Promise<BulkScheduleResult> {
  const clean = tweets
    .map((t) => fitToX(t.trim()))
    .filter(Boolean)
    .slice(0, 100);
  if (!clean.length) return { scheduled: 0, when: [] };

  const { brief } = await getPlanningContext(workspaceId);
  const now = new Date();

  // Don't stack on top of already-scheduled upcoming X posts.
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
  const occupied = upcoming
    .map((u) => (u.scheduled_at ? new Date(u.scheduled_at).getTime() : 0))
    .filter(Boolean);

  const hours = spreadHours(config.perDay, config.startHour, config.endHour);
  const slots = nextPublishSlots(clean.length, brief.timezone, occupied, now, hours);

  const [socialAgent] = await db
    .select({ id: agents.id, name: agents.name, folder: agents.folder })
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.kind, "social")))
    .limit(1);
  const authorId = socialAgent?.id ?? null;
  const authorName = socialAgent?.name ?? "Social Media Agent";
  const folder = socialAgent?.folder || "Social";

  const n = Math.min(clean.length, slots.length);
  for (let i = 0; i < n; i++) {
    const text = clean[i];
    const slot = slots[i];
    const taskId = randomUUID();
    const heading = `X post: ${text.slice(0, 60)}`.slice(0, 120);

    await db.insert(tasks).values({
      id: taskId,
      workspace_id: workspaceId,
      category: "content",
      title: heading,
      description:
        "Scheduled from your bulk composer to auto-publish to X. Cancel any time before it posts.",
      rationale: "Bulk-scheduled in your voice.",
      status: "approved",
      risk_level: "low",
      priority: "medium",
      due_at: null,
      scheduled_at: slot,
      agent_id: authorId,
      created_by_type: "human",
      requires_approval: false,
      approval_status: "approved",
      execution_status: "queued",
      affected_systems: ["X (Twitter)"],
      proposed_actions: 1,
      impact_score: 40,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskAssets).values({
      id: randomUUID(),
      task_id: taskId,
      asset_type: "social_post",
      title: "X post",
      content: text,
      metadata: { channel: "X (Twitter)", chars: text.length },
    });
    await db.insert(approvalDecisions).values({
      id: randomUUID(),
      task_id: taskId,
      decided_by: actor.name,
      decision_type: "approve",
      comment: `Bulk-scheduled for ${slot.toISOString()}`,
      created_at: now,
    });
    await saveDocument({
      workspaceId,
      agentId: authorId,
      authorName,
      taskId,
      taskTitle: heading,
      name: heading,
      content: text,
      folder,
      docType: "social_post",
    });
  }

  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "agent_updated_draft",
    actor_type: "human",
    actor_id: actor.name,
    summary: `Bulk-scheduled ${n} post${n === 1 ? "" : "s"} to auto-publish to X.`,
    created_at: now,
  });

  return { scheduled: n, when: slots.slice(0, n).map((s) => s.toISOString()) };
}
