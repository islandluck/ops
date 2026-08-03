import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, approvalDecisions, postChannels, posts, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext, getXStyleProfile } from "@/lib/db/queries";
import {
  atomizeToThread,
  generateLongform,
  growthBoostLongform,
  type BoostedLongform,
  type ContentContext,
  type LongformDraft,
} from "@/lib/ai/content";
import { buildSubstackHandoff } from "@/lib/content/substack";
import { markdownToHtml } from "@/lib/content/format";
import { createHostedPost } from "@/lib/pages";
import { nextPublishSlots } from "./slots";
import { fitToX } from "@/lib/social/x-post";
import type { ChannelKind, PackagedVariant, Post, PostChannel } from "@/lib/types";

/**
 * The content engine — one longform master (a `posts` row) is generated, boosted
 * (growth-marketer rewrite), packaged into per-channel variants, and distributed
 * through channel adapters: a hosted article page (auto-publish), an X thread
 * (scheduled auto-publish), and a Substack handoff (perfect paste + export).
 * Each destination's status lives in `post_channels`.
 */

const uid = () => randomUUID();
const iso = (d: Date | string) => new Date(d).toISOString();

type PostRow = typeof posts.$inferSelect;
type ChannelRow = typeof postChannels.$inferSelect;

function toPost(row: PostRow, channels?: PostChannel[]): Post {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    title: row.title,
    dek: row.dek,
    body_md: row.body_md,
    hero_image_url: row.hero_image_url,
    status: row.status,
    boosted: row.boosted,
    created_by_type: row.created_by_type,
    agent_id: row.agent_id,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    channels,
  };
}

function toChannel(row: ChannelRow): PostChannel {
  return {
    id: row.id,
    post_id: row.post_id,
    channel: row.channel,
    status: row.status,
    variant: row.variant,
    ref_id: row.ref_id,
    url: row.url,
    scheduled_at: row.scheduled_at ? iso(row.scheduled_at) : null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

async function contextFor(workspaceId: string): Promise<ContentContext> {
  const { brief } = await getPlanningContext(workspaceId);
  const styleProfile = await getXStyleProfile(workspaceId);
  return { brief, styleProfile };
}

/* ------------------------------ master post ------------------------------ */

export interface CreatePostResult {
  ok: boolean;
  postId?: string;
  error?: string;
}

/** Create a longform master — generate it from a topic, or seed it blank/from paste. */
export async function createPost(
  workspaceId: string,
  input: { topic?: string; angle?: string; title?: string; dek?: string; body_md?: string; generate?: boolean },
): Promise<CreatePostResult> {
  let draft: LongformDraft = {
    title: (input.title ?? "").trim(),
    dek: (input.dek ?? "").trim(),
    body_md: (input.body_md ?? "").trim(),
  };

  const wantsGeneration = input.generate !== false && !draft.body_md && Boolean(input.topic?.trim());
  if (wantsGeneration) {
    try {
      draft = await generateLongform({ topic: input.topic!.trim(), angle: input.angle }, await contextFor(workspaceId));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the post." };
    }
  }
  if (!draft.title && !draft.body_md) return { ok: false, error: "Give the post a topic or a title first." };

  const id = uid();
  const now = new Date();
  await db.insert(posts).values({
    id,
    workspace_id: workspaceId,
    project_id: null,
    title: (draft.title || input.topic || "Untitled post").slice(0, 200),
    dek: draft.dek.slice(0, 300),
    body_md: draft.body_md,
    hero_image_url: null,
    status: "draft",
    boosted: false,
    created_by_type: "human",
    agent_id: null,
    created_at: now,
    updated_at: now,
  });
  return { ok: true, postId: id };
}

export async function updatePost(
  workspaceId: string,
  postId: string,
  patch: { title?: string; dek?: string; body_md?: string; hero_image_url?: string | null; boosted?: boolean },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 200);
  if (patch.dek !== undefined) set.dek = patch.dek.slice(0, 300);
  if (patch.body_md !== undefined) set.body_md = patch.body_md;
  if (patch.hero_image_url !== undefined) set.hero_image_url = patch.hero_image_url;
  if (patch.boosted !== undefined) set.boosted = patch.boosted;
  await db.update(posts).set(set).where(and(eq(posts.workspace_id, workspaceId), eq(posts.id, postId)));
  return { ok: true };
}

async function loadPostRow(workspaceId: string, postId: string): Promise<PostRow | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.workspace_id, workspaceId), eq(posts.id, postId)))
    .limit(1);
  return row ?? null;
}

export async function getPost(workspaceId: string, postId: string): Promise<Post | null> {
  const row = await loadPostRow(workspaceId, postId);
  if (!row) return null;
  const chans = await db
    .select()
    .from(postChannels)
    .where(and(eq(postChannels.workspace_id, workspaceId), eq(postChannels.post_id, postId)));
  return toPost(row, chans.map(toChannel));
}

export async function listPosts(workspaceId: string): Promise<Post[]> {
  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.workspace_id, workspaceId))
    .orderBy(desc(posts.created_at));
  if (!rows.length) return [];
  const chans = await db
    .select()
    .from(postChannels)
    .where(eq(postChannels.workspace_id, workspaceId));
  const byPost = new Map<string, PostChannel[]>();
  for (const c of chans) {
    const list = byPost.get(c.post_id) ?? [];
    list.push(toChannel(c));
    byPost.set(c.post_id, list);
  }
  return rows.map((r) => toPost(r, byPost.get(r.id) ?? []));
}

/* --------------------------------- boost --------------------------------- */

/** Growth-marketer viral rewrite of the master (advisory — returned, not saved). */
export async function boostPost(workspaceId: string, postId: string): Promise<BoostedLongform> {
  const row = await loadPostRow(workspaceId, postId);
  if (!row) throw new Error("Post not found.");
  return growthBoostLongform({ title: row.title, dek: row.dek, body_md: row.body_md }, await contextFor(workspaceId));
}

/* -------------------------------- package -------------------------------- */

/** Upsert a channel row, but never clobber one already scheduled/published. */
async function upsertChannel(
  workspaceId: string,
  postId: string,
  channel: ChannelKind,
  variant: PackagedVariant,
  status: "packaged" | "handoff",
): Promise<void> {
  const [existing] = await db
    .select()
    .from(postChannels)
    .where(
      and(
        eq(postChannels.workspace_id, workspaceId),
        eq(postChannels.post_id, postId),
        eq(postChannels.channel, channel),
      ),
    )
    .limit(1);
  const now = new Date();
  if (existing) {
    if (existing.status === "scheduled" || existing.status === "published") return; // live — leave it
    await db
      .update(postChannels)
      .set({ variant, status, updated_at: now })
      .where(eq(postChannels.id, existing.id));
    return;
  }
  await db.insert(postChannels).values({
    id: uid(),
    workspace_id: workspaceId,
    post_id: postId,
    channel,
    status,
    variant,
    ref_id: null,
    url: null,
    scheduled_at: null,
    created_at: now,
    updated_at: now,
  });
}

/** Package the master into per-channel variants for the requested destinations. */
export async function packagePost(
  workspaceId: string,
  postId: string,
  channels: ChannelKind[],
): Promise<{ ok: boolean; error?: string }> {
  const row = await loadPostRow(workspaceId, postId);
  if (!row) return { ok: false, error: "Post not found." };
  if (!row.body_md.trim()) return { ok: false, error: "Write or generate the post before packaging it." };
  const ctx = await contextFor(workspaceId);
  const post = { title: row.title, dek: row.dek, body_md: row.body_md, hero_image_url: row.hero_image_url };

  for (const channel of channels) {
    try {
      if (channel === "x_thread") {
        const tweets = await atomizeToThread(post, ctx);
        await upsertChannel(workspaceId, postId, channel, { tweets }, "packaged");
      } else if (channel === "substack") {
        const handoff = buildSubstackHandoff(post);
        await upsertChannel(workspaceId, postId, channel, handoff, "handoff");
      } else if (channel === "page") {
        await upsertChannel(workspaceId, postId, channel, { html: markdownToHtml(row.body_md) }, "packaged");
      }
    } catch (e) {
      // One channel's failure never blocks the others.
      if (channel === "x_thread") {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't package the X thread." };
      }
    }
  }
  return { ok: true };
}

/* ---------------------------- channel adapters --------------------------- */

async function loadChannelRow(
  workspaceId: string,
  postId: string,
  channel: ChannelKind,
): Promise<ChannelRow | null> {
  const [row] = await db
    .select()
    .from(postChannels)
    .where(
      and(
        eq(postChannels.workspace_id, workspaceId),
        eq(postChannels.post_id, postId),
        eq(postChannels.channel, channel),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function markDistributed(workspaceId: string, postId: string): Promise<void> {
  await db
    .update(posts)
    .set({ status: "distributed", updated_at: new Date() })
    .where(and(eq(posts.workspace_id, workspaceId), eq(posts.id, postId)));
}

/** Page adapter — publish the master as a hosted article page (auto-publish). */
export async function publishPageChannel(
  workspaceId: string,
  postId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const row = await loadPostRow(workspaceId, postId);
  if (!row) return { ok: false, error: "Post not found." };
  if (!row.body_md.trim()) return { ok: false, error: "Nothing to publish yet." };

  const page = await createHostedPost(workspaceId, {
    title: row.title,
    dek: row.dek,
    bodyHtml: markdownToHtml(row.body_md),
    heroImageUrl: row.hero_image_url,
    projectId: row.project_id,
    publish: true,
  });
  const url = `/p/${page.slug}`;
  const now = new Date();
  const existing = await loadChannelRow(workspaceId, postId, "page");
  if (existing) {
    await db
      .update(postChannels)
      .set({ status: "published", ref_id: page.id, url, updated_at: now })
      .where(eq(postChannels.id, existing.id));
  } else {
    await db.insert(postChannels).values({
      id: uid(),
      workspace_id: workspaceId,
      post_id: postId,
      channel: "page",
      status: "published",
      variant: { html: markdownToHtml(row.body_md) },
      ref_id: page.id,
      url,
      scheduled_at: null,
      created_at: now,
      updated_at: now,
    });
  }
  await markDistributed(workspaceId, postId);
  await db.insert(activityEvents).values({
    id: uid(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "status_changed",
    actor_type: "human",
    actor_id: "you",
    summary: `Published “${row.title}” as an article page (${url}).`,
    created_at: now,
  });
  return { ok: true, url };
}

/** X-thread adapter — schedule the packaged thread as an approved, auto-publishing
 *  task. Publishes as a real connected thread via the execute path's thread branch. */
export async function scheduleThreadChannel(
  workspaceId: string,
  postId: string,
  input: { whenISO?: string } = {},
): Promise<{ ok: boolean; scheduledAt?: string; error?: string }> {
  const row = await loadPostRow(workspaceId, postId);
  if (!row) return { ok: false, error: "Post not found." };
  const channel = await loadChannelRow(workspaceId, postId, "x_thread");
  const tweets = (channel?.variant.tweets ?? []).map((t) => fitToX(t)).filter(Boolean);
  if (tweets.length < 1) return { ok: false, error: "Package the X thread first." };
  if (channel && channel.status === "scheduled") {
    return { ok: false, error: "This thread is already scheduled." };
  }

  const { brief } = await getPlanningContext(workspaceId);
  const now = new Date();
  let when = input.whenISO ? new Date(input.whenISO) : null;
  if (!when || Number.isNaN(when.getTime()) || when.getTime() < now.getTime()) {
    when = nextPublishSlots(1, brief.timezone, [], now, [10])[0] ?? new Date(now.getTime() + 2 * 60 * 60 * 1000);
  }

  const [socialAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.kind, "social")))
    .limit(1);

  const taskId = uid();
  const readable = tweets.join("\n\n———\n\n");
  await db.insert(tasks).values({
    id: taskId,
    workspace_id: workspaceId,
    category: "content",
    title: `X thread: ${row.title}`.slice(0, 120),
    description: "A thread repurposed from your post, scheduled to auto-publish to X.",
    rationale: `Content engine · repurposed from “${row.title}”`.slice(0, 300),
    status: "approved",
    risk_level: "low",
    priority: "medium",
    due_at: null,
    scheduled_at: when,
    project_id: null,
    agent_id: socialAgent?.id ?? null,
    created_by_type: "human",
    requires_approval: false,
    approval_status: "approved",
    execution_status: "queued",
    affected_systems: ["X (Twitter)"],
    proposed_actions: tweets.length,
    impact_score: 45,
    created_at: now,
    updated_at: now,
  });
  await db.insert(taskAssets).values({
    id: uid(),
    task_id: taskId,
    asset_type: "social_post",
    title: "X thread",
    content: readable,
    metadata: { channel: "X (Twitter)", thread_json: JSON.stringify(tweets), tweet_count: tweets.length },
  });
  await db.insert(approvalDecisions).values({
    id: uid(),
    task_id: taskId,
    decided_by: "you",
    decision_type: "approve",
    comment: `Thread scheduled for ${when.toISOString()}`,
    created_at: now,
  });

  if (channel) {
    await db
      .update(postChannels)
      .set({ status: "scheduled", ref_id: taskId, scheduled_at: when, updated_at: now })
      .where(eq(postChannels.id, channel.id));
  }
  await markDistributed(workspaceId, postId);
  await db.insert(activityEvents).values({
    id: uid(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "agent_updated_draft",
    actor_type: "human",
    actor_id: "you",
    summary: `Scheduled a ${tweets.length}-tweet thread from “${row.title}” to auto-publish to X.`,
    created_at: now,
  });
  return { ok: true, scheduledAt: iso(when) };
}

/** Persist edited X-thread tweets back to the channel (before scheduling). */
export async function updateThreadTweets(
  workspaceId: string,
  postId: string,
  tweets: string[],
): Promise<{ ok: boolean; error?: string }> {
  const clean = tweets.map((t) => t.trim()).filter(Boolean).slice(0, 25);
  if (!clean.length) return { ok: false, error: "A thread needs at least one tweet." };
  const row = await loadChannelRow(workspaceId, postId, "x_thread");
  if (!row) return { ok: false, error: "Package the thread first." };
  if (row.status === "scheduled") return { ok: false, error: "Unschedule the thread before editing it." };
  await db
    .update(postChannels)
    .set({ variant: { ...row.variant, tweets: clean }, updated_at: new Date() })
    .where(eq(postChannels.id, row.id));
  return { ok: true };
}

/** Substack (or any handoff) — mark the channel done once the owner has posted it. */
export async function markChannelPublished(
  workspaceId: string,
  postId: string,
  channel: ChannelKind,
  url?: string,
): Promise<{ ok: boolean }> {
  const row = await loadChannelRow(workspaceId, postId, channel);
  if (!row) return { ok: false };
  await db
    .update(postChannels)
    .set({ status: "published", url: url?.trim() || row.url, updated_at: new Date() })
    .where(eq(postChannels.id, row.id));
  await markDistributed(workspaceId, postId);
  return { ok: true };
}

export async function deletePost(workspaceId: string, postId: string): Promise<{ ok: boolean }> {
  await db.delete(posts).where(and(eq(posts.workspace_id, workspaceId), eq(posts.id, postId)));
  return { ok: true };
}
