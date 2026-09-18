import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, approvalDecisions, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext, getXStyleProfile, linkMediaToTask, saveDocument } from "@/lib/db/queries";
import { fitToX } from "@/lib/social/x-post";
import { runTaskExecution } from "@/lib/integrations/execute";
import { atomizeToThread, growthBoostLongform } from "@/lib/ai/content";
import { runWithUsage } from "@/lib/ai/usage";
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

export interface BulkTweetItem {
  text: string;
  /** Optional pre-uploaded media row (task_id null) to attach to this tweet's task. */
  mediaId?: string | null;
}

/** Create one queued+approved scheduled X task per tweet, spread across days. */
export async function scheduleBulkTweets(
  workspaceId: string,
  items: BulkTweetItem[],
  config: BulkScheduleConfig,
  actor: { name: string },
  opts: { requireApproval?: boolean; projectId?: string | null; projectPhase?: number | null } = {},
): Promise<BulkScheduleResult> {
  const clean = items
    .map((it) => ({ text: fitToX(it.text.trim()), mediaId: it.mediaId ?? null }))
    .filter((it) => it.text)
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
    const { text, mediaId } = clean[i];
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
      status: opts.requireApproval ? "ready" : "approved",
      risk_level: "low",
      priority: "medium",
      due_at: null,
      scheduled_at: slot,
      project_id: opts.projectId ?? null,
      project_phase: opts.projectPhase ?? null,
      agent_id: authorId,
      created_by_type: "human",
      requires_approval: opts.requireApproval ?? false,
      approval_status: opts.requireApproval ? "pending" : "approved",
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
    if (mediaId) await linkMediaToTask(workspaceId, mediaId, taskId);
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

/* --------------------------- single tweet (composer) ---------------------- */

/** Stage ONE X task written by the user — a single tweet, or a THREAD (when `thread`
 *  has 2+ tweets). Approved + queued at `slot`, or approved + ready-to-run
 *  (execution_status "none") when slot is null. Returns its ids. A thread stores its
 *  ordered tweets on the asset's `metadata.thread_json` — the publish path posts it
 *  as a connected thread. */
async function stageXTask(
  workspaceId: string,
  input: { text: string; mediaId?: string | null; slot: Date | null; thread?: string[] | null },
  actor: { name: string },
): Promise<{ taskId: string; assetId: string } | null> {
  const thread = (input.thread ?? []).map((t) => fitToX(t.trim())).filter(Boolean);
  const isThread = thread.length > 1;
  const text = isThread ? thread[0] : fitToX(input.text.trim());
  if (!text) return null;
  const now = new Date();
  const taskId = randomUUID();
  const assetId = randomUUID();
  const heading = `${isThread ? "X thread" : "X post"}: ${text.slice(0, 54)}`.slice(0, 120);
  const [socialAgent] = await db
    .select({ folder: agents.folder })
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.kind, "social")))
    .limit(1);
  const folder = socialAgent?.folder || "Social";
  const scheduled = input.slot != null;
  const label = isThread ? `thread (${thread.length} tweets)` : "tweet";

  await db.insert(tasks).values({
    id: taskId,
    workspace_id: workspaceId,
    category: "content",
    title: heading,
    description: scheduled
      ? `Scheduled from the composer to auto-publish this ${label} to X. Cancel any time before it posts.`
      : `Posted this ${label} to X from the composer.`,
    rationale: "Written by you in the composer.",
    status: "approved",
    risk_level: "low",
    priority: "medium",
    due_at: null,
    scheduled_at: input.slot,
    agent_id: null,
    created_by_type: "human",
    requires_approval: false,
    approval_status: "approved",
    execution_status: scheduled ? "queued" : "none",
    affected_systems: ["X (Twitter)"],
    proposed_actions: isThread ? thread.length : 1,
    impact_score: 40,
    created_at: now,
    updated_at: now,
  });
  await db.insert(taskAssets).values({
    id: assetId,
    task_id: taskId,
    asset_type: "social_post",
    title: isThread ? "X thread" : "X post",
    content: text,
    metadata: isThread
      ? { channel: "X (Twitter)", chars: text.length, thread_json: JSON.stringify(thread), thread_count: thread.length }
      : { channel: "X (Twitter)", chars: text.length },
  });
  await db.insert(approvalDecisions).values({
    id: randomUUID(),
    task_id: taskId,
    decided_by: actor.name,
    decision_type: "approve",
    comment: scheduled ? `Scheduled for ${input.slot!.toISOString()}` : "Posted now",
    created_at: now,
  });
  await saveDocument({
    workspaceId,
    agentId: null,
    authorName: actor.name,
    taskId,
    taskTitle: heading,
    name: heading,
    content: isThread ? thread.map((t, i) => `${i + 1}/ ${t}`).join("\n\n") : text,
    folder,
    docType: "social_post",
  });
  if (input.mediaId) await linkMediaToTask(workspaceId, input.mediaId, taskId);
  return { taskId, assetId };
}

/**
 * Turn pasted long text into an X thread. Applies a growth-marketer viral pass
 * (unless boost=false), then atomizes into ordered, self-contained tweets in the
 * owner's X voice. Returns the tweets + a short note of the growth levers applied.
 */
export async function makeThreadFromText(
  workspaceId: string,
  text: string,
  opts: { boost?: boolean } = {},
): Promise<{ ok: true; tweets: string[]; changes: string[] } | { ok: false; error: string }> {
  const body = text.trim();
  if (body.length < 40) return { ok: false, error: "Paste more text — a thread needs something to work with." };
  return runWithUsage(workspaceId, "social-thread", async () => {
    try {
      const { brief } = await getPlanningContext(workspaceId);
      const styleProfile = await getXStyleProfile(workspaceId);
      const ctx = { brief, styleProfile };
      let post = { title: "", dek: "", body_md: body };
      let changes: string[] = [];
      if (opts.boost !== false) {
        const boosted = await growthBoostLongform(post, ctx);
        post = { title: boosted.title, dek: boosted.dek, body_md: boosted.body_md };
        changes = boosted.changes;
      }
      const tweets = (await atomizeToThread(post, ctx, { maxTweets: 12 })).map((t) => fitToX(t)).filter(Boolean);
      if (tweets.length < 2) return { ok: false as const, error: "Couldn't make a thread from that — try more text." };
      return { ok: true as const, tweets, changes };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't build the thread." };
    }
  });
}

/** Schedule ONE tweet at a specific future time (composer "Schedule"). */
export async function scheduleSingleTweet(
  workspaceId: string,
  input: { text: string; mediaId?: string | null; whenISO: string; thread?: string[] | null },
  actor: { name: string },
): Promise<{ ok: true; when: string } | { ok: false; error: string }> {
  const isThread = (input.thread?.length ?? 0) > 1;
  if (!input.text.trim() && !isThread) return { ok: false, error: "Write your tweet first." };
  const when = new Date(input.whenISO);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Pick a valid time." };
  if (when.getTime() < Date.now() + 30_000) return { ok: false, error: "Pick a time in the future." };
  const r = await stageXTask(
    workspaceId,
    { text: input.text, mediaId: input.mediaId, slot: when, thread: input.thread },
    actor,
  );
  if (!r) return { ok: false, error: "Write your tweet first." };
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: r.taskId,
    event_type: "agent_updated_draft",
    actor_type: "human",
    actor_id: actor.name,
    summary: `Scheduled a ${isThread ? "thread" : "tweet"} to auto-publish to X on ${when.toISOString()}.`,
    created_at: new Date(),
  });
  return { ok: true, when: when.toISOString() };
}

/** Post ONE tweet to X right now (composer "Post now") — stages the task then runs
 *  the real publish immediately, so it lands in the sent tally with a live URL. */
export async function postSingleTweetNow(
  workspaceId: string,
  input: { text: string; mediaId?: string | null; thread?: string[] | null },
  actor: { name: string; email: string },
): Promise<{ ok: true; summary?: string; taskId: string } | { ok: false; error: string }> {
  const isThread = (input.thread?.length ?? 0) > 1;
  if (!input.text.trim() && !isThread) return { ok: false, error: "Write your tweet first." };
  const r = await stageXTask(
    workspaceId,
    { text: input.text, mediaId: input.mediaId, slot: null, thread: input.thread },
    actor,
  );
  if (!r) return { ok: false, error: "Write your tweet first." };
  const exec = await runTaskExecution(workspaceId, r.taskId, actor);
  if (!exec.ok) return { ok: false, error: exec.error ?? "Couldn't post to X." };
  return { ok: true, summary: exec.summary, taskId: r.taskId };
}
