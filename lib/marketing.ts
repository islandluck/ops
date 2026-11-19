import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { marketingCampaigns, marketingItems, pages } from "@/lib/db/schema";
import { createHostedPost } from "@/lib/pages";
import { getPlanningContext, getXStyleProfile } from "@/lib/db/queries";
import { markdownToHtml } from "@/lib/content/format";
import { postSingleTweetNow, scheduleSingleTweet } from "@/lib/agents/social-bulk";
import { draftPost, planCampaign } from "@/lib/ai/marketing";
import { growthBoostTweet } from "@/lib/ai/style";
import { growthBoostLongform } from "@/lib/ai/content";
import { runWithUsage } from "@/lib/ai/usage";
import { fitToX } from "@/lib/social/x-post";
import type {
  CampaignProgress,
  CampaignStatus,
  MarketingChannel,
  MarketingCampaign,
  MarketingItem,
} from "@/lib/types";

/**
 * Marketing engine — campaigns + a cross-channel content calendar. A campaign
 * owns `marketing_items`; each item is planned content for one channel. On
 * schedule/publish, items materialize onto the EXISTING rails: X → a scheduled
 * social task (lib/agents/social-bulk), blog → a hosted Pages post. LinkedIn
 * stays manual (draft → preview → copy); nothing is pushed to LinkedIn.
 * Server-only.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();
const isoN = (d: Date | null) => (d ? new Date(d).toISOString() : null);

type CampaignRow = typeof marketingCampaigns.$inferSelect;
type ItemRow = typeof marketingItems.$inferSelect;

function toCampaign(r: CampaignRow): MarketingCampaign {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    objective: r.objective,
    status: r.status,
    starts_at: isoN(r.starts_at),
    ends_at: isoN(r.ends_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
function toItem(r: ItemRow, campaignName?: string | null): MarketingItem {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    campaign_id: r.campaign_id,
    campaign_name: campaignName ?? null,
    channel: r.channel,
    title: r.title,
    body_md: r.body_md,
    image_url: r.image_url,
    status: r.status,
    scheduled_at: isoN(r.scheduled_at),
    ref_type: r.ref_type,
    ref_id: r.ref_id,
    ref_url: r.ref_url,
    posted_at: isoN(r.posted_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/* ------------------------------- campaigns ------------------------------- */

export async function listCampaigns(workspaceId: string): Promise<MarketingCampaign[]> {
  const rows = await db
    .select()
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.workspace_id, workspaceId))
    .orderBy(desc(marketingCampaigns.created_at));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const items = await db
    .select({ campaign_id: marketingItems.campaign_id, status: marketingItems.status, channel: marketingItems.channel })
    .from(marketingItems)
    .where(and(eq(marketingItems.workspace_id, workspaceId), inArray(marketingItems.campaign_id, ids)));

  const emptyChannels = (): Record<MarketingChannel, number> => ({ x: 0, linkedin: 0, blog: 0, newsletter: 0 });
  type Agg = { total: number; scheduled: number; published: number; byChannel: Record<MarketingChannel, number> };
  const agg = new Map<string, Agg>();
  for (const it of items) {
    if (!it.campaign_id) continue;
    let a = agg.get(it.campaign_id);
    if (!a) {
      a = { total: 0, scheduled: 0, published: 0, byChannel: emptyChannels() };
      agg.set(it.campaign_id, a);
    }
    a.total++;
    a.byChannel[it.channel] = (a.byChannel[it.channel] ?? 0) + 1;
    if (it.status === "scheduled") a.scheduled++;
    if (it.status === "published") a.published++;
  }

  function progressOf(r: CampaignRow, a: Agg | undefined): CampaignProgress {
    if (r.status === "done") return "published";
    if (!a || a.total === 0) return "not_started";
    if (a.published === a.total) return "published";
    if (a.scheduled > 0) return "scheduled";
    return "drafting";
  }

  return rows.map((r) => {
    const a = agg.get(r.id);
    return {
      ...toCampaign(r),
      item_count: a?.total ?? 0,
      scheduled_count: a?.scheduled ?? 0,
      published_count: a?.published ?? 0,
      progress: progressOf(r, a),
      posts_by_channel: a?.byChannel ?? emptyChannels(),
    };
  });
}

export async function getCampaign(workspaceId: string, id: string): Promise<MarketingCampaign | null> {
  const [r] = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.workspace_id, workspaceId), eq(marketingCampaigns.id, id)))
    .limit(1);
  return r ? toCampaign(r) : null;
}

export interface CampaignInput {
  name: string;
  objective?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: CampaignStatus;
}

export async function createCampaign(
  workspaceId: string,
  input: CampaignInput,
): Promise<{ ok: true; campaign: MarketingCampaign } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the campaign a name." };
  const id = uid();
  const now = new Date();
  await db.insert(marketingCampaigns).values({
    id,
    workspace_id: workspaceId,
    name: name.slice(0, 200),
    objective: (input.objective ?? "").slice(0, 2000),
    status: input.status ?? "draft",
    starts_at: input.starts_at ? new Date(input.starts_at) : null,
    ends_at: input.ends_at ? new Date(input.ends_at) : null,
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).limit(1);
  return { ok: true, campaign: toCampaign(row) };
}

export async function updateCampaign(
  workspaceId: string,
  id: string,
  patch: Partial<CampaignInput>,
): Promise<{ ok: boolean; error?: string }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return { ok: false, error: "Name can't be empty." };
    set.name = patch.name.trim().slice(0, 200);
  }
  if (patch.objective !== undefined) set.objective = patch.objective.slice(0, 2000);
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.starts_at !== undefined) set.starts_at = patch.starts_at ? new Date(patch.starts_at) : null;
  if (patch.ends_at !== undefined) set.ends_at = patch.ends_at ? new Date(patch.ends_at) : null;
  await db
    .update(marketingCampaigns)
    .set(set)
    .where(and(eq(marketingCampaigns.workspace_id, workspaceId), eq(marketingCampaigns.id, id)));
  return { ok: true };
}

export async function deleteCampaign(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(marketingCampaigns)
    .where(and(eq(marketingCampaigns.workspace_id, workspaceId), eq(marketingCampaigns.id, id)));
  return { ok: true };
}

/** AI-plan a campaign: draft a multi-week arc of content across channels and
 *  create the campaign + its items (each at a PROPOSED time, status "drafted" —
 *  the owner reviews, edits, and schedules each). Metered. */
export async function planAndCreateCampaign(
  workspaceId: string,
  input: { name: string; objective: string; weeks: number; channels: MarketingChannel[]; startISO?: string },
): Promise<{ ok: true; campaign: MarketingCampaign; items: number } | { ok: false; error: string }> {
  if (!input.name.trim()) return { ok: false, error: "Give the campaign a name." };
  if (!input.objective.trim()) return { ok: false, error: "Describe the objective." };
  const { brief } = await getPlanningContext(workspaceId);
  const styleProfile = await getXStyleProfile(workspaceId);

  let planned;
  try {
    planned = await runWithUsage(workspaceId, "marketing-plan", () =>
      planCampaign({ objective: input.objective, weeks: input.weeks, channels: input.channels, brief, styleProfile }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't plan the campaign." };
  }

  const start = input.startISO ? new Date(input.startISO) : new Date();
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Pick a valid start date." };
  const created = await createCampaign(workspaceId, {
    name: input.name,
    objective: input.objective,
    status: "active",
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + input.weeks * 7 * 86_400_000).toISOString(),
  });
  if (!created.ok) return created;

  const now = new Date();
  const rows = planned.map((p) => {
    const when = new Date(start.getTime() + p.day_offset * 86_400_000);
    when.setHours(10, 0, 0, 0); // proposed 10am local slot
    return {
      id: uid(),
      workspace_id: workspaceId,
      campaign_id: created.campaign.id,
      channel: p.channel,
      title: p.title.slice(0, 200),
      body_md: p.body_md.slice(0, 12000),
      image_url: null,
      status: "drafted" as const,
      scheduled_at: when,
      created_at: now,
      updated_at: now,
    };
  });
  if (rows.length) await db.insert(marketingItems).values(rows);
  return { ok: true, campaign: created.campaign, items: rows.length };
}

/** Generate one post per requested channel for an existing campaign (metered). */
export async function generateCampaignPosts(
  workspaceId: string,
  campaignId: string,
  channels: MarketingChannel[],
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const campaign = await getCampaign(workspaceId, campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  const chans = channels.filter((c): c is MarketingChannel => ["x", "linkedin", "blog", "newsletter"].includes(c));
  if (!chans.length) return { ok: false, error: "Pick at least one channel." };
  const { brief } = await getPlanningContext(workspaceId);
  const styleProfile = await getXStyleProfile(workspaceId);
  let created = 0;
  for (const channel of chans) {
    try {
      const post = await runWithUsage(workspaceId, "marketing-draft", () =>
        draftPost({ channel, campaignName: campaign.name, objective: campaign.objective, brief, styleProfile }),
      );
      await createItem(workspaceId, { campaign_id: campaignId, channel, title: post.title, body_md: post.body_md });
      created++;
    } catch {
      /* skip a channel that fails; keep going */
    }
  }
  return created > 0 ? { ok: true, created } : { ok: false, error: "Couldn't generate posts — try again." };
}

/* --------------------------------- items --------------------------------- */

export async function listItems(
  workspaceId: string,
  opts: { campaignId?: string } = {},
): Promise<MarketingItem[]> {
  const rows = await db
    .select({ it: marketingItems, campaignName: marketingCampaigns.name })
    .from(marketingItems)
    .leftJoin(marketingCampaigns, eq(marketingItems.campaign_id, marketingCampaigns.id))
    .where(
      and(
        eq(marketingItems.workspace_id, workspaceId),
        opts.campaignId ? eq(marketingItems.campaign_id, opts.campaignId) : undefined,
      ),
    )
    .orderBy(desc(marketingItems.created_at));
  return rows.map((r) => toItem(r.it, r.campaignName));
}

export interface ItemInput {
  campaign_id?: string | null;
  channel: MarketingChannel;
  title?: string;
  body_md?: string;
  image_url?: string | null;
  scheduled_at?: string | null;
}

export async function createItem(
  workspaceId: string,
  input: ItemInput,
): Promise<{ ok: true; item: MarketingItem } | { ok: false; error: string }> {
  const id = uid();
  const now = new Date();
  await db.insert(marketingItems).values({
    id,
    workspace_id: workspaceId,
    campaign_id: input.campaign_id ?? null,
    channel: input.channel,
    title: (input.title ?? "").slice(0, 200),
    body_md: (input.body_md ?? "").slice(0, 12000),
    image_url: input.image_url ?? null,
    status: "drafted",
    scheduled_at: input.scheduled_at ? new Date(input.scheduled_at) : null,
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(marketingItems).where(eq(marketingItems.id, id)).limit(1);
  return { ok: true, item: toItem(row) };
}

export async function updateItem(
  workspaceId: string,
  id: string,
  patch: { title?: string; body_md?: string; image_url?: string | null; campaign_id?: string | null },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 200);
  if (patch.body_md !== undefined) set.body_md = patch.body_md.slice(0, 12000);
  if (patch.image_url !== undefined) set.image_url = patch.image_url;
  if (patch.campaign_id !== undefined) set.campaign_id = patch.campaign_id;
  await db.update(marketingItems).set(set).where(and(eq(marketingItems.workspace_id, workspaceId), eq(marketingItems.id, id)));
  return { ok: true };
}

export async function deleteItem(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(marketingItems).where(and(eq(marketingItems.workspace_id, workspaceId), eq(marketingItems.id, id)));
  return { ok: true };
}

/** Growth-Marketer boost for a marketing item — the same pass used on tweets.
 *  X → sharper option takes; other channels → a longform viral rewrite. */
export interface GrowthBoostResult {
  kind: "options" | "rewrite";
  options?: { text: string; note: string }[];
  body_md?: string;
  changes?: string[];
}
export async function growthBoostMarketingItem(
  workspaceId: string,
  id: string,
): Promise<{ ok: true; result: GrowthBoostResult } | { ok: false; error: string }> {
  const item = await getItemRow(workspaceId, id);
  if (!item) return { ok: false, error: "Item not found." };
  if (!item.body_md.trim()) return { ok: false, error: "Write the post first." };
  const { brief } = await getPlanningContext(workspaceId);
  const styleProfile = await getXStyleProfile(workspaceId);
  try {
    if (item.channel === "x") {
      const options = await runWithUsage(workspaceId, "marketing-boost", () =>
        growthBoostTweet(item.body_md, { company: brief.company_name, styleProfile }),
      );
      return { ok: true, result: { kind: "options", options: options.map((o) => ({ text: o.boosted, note: o.note })) } };
    }
    const boosted = await runWithUsage(workspaceId, "marketing-boost", () =>
      growthBoostLongform({ title: item.title, dek: "", body_md: item.body_md }, { brief, styleProfile }),
    );
    return { ok: true, result: { kind: "rewrite", body_md: boosted.body_md, changes: boosted.changes } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't run the growth marketer." };
  }
}

async function getItemRow(workspaceId: string, id: string): Promise<ItemRow | null> {
  const [row] = await db
    .select()
    .from(marketingItems)
    .where(and(eq(marketingItems.workspace_id, workspaceId), eq(marketingItems.id, id)))
    .limit(1);
  return row ?? null;
}

/* --------------------------- schedule / publish -------------------------- */

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || "";

/** Materialize a blog item into a hosted Pages post. `publishNow` → live now;
 *  otherwise a draft with `publish_at` (flipped live by the publish cron). */
async function materializeBlog(
  workspaceId: string,
  item: ItemRow,
  publishNow: boolean,
  when: Date | null,
): Promise<{ pageId: string; url: string | null }> {
  const page = await createHostedPost(workspaceId, {
    title: item.title || "Untitled post",
    dek: "",
    bodyHtml: markdownToHtml(item.body_md || ""),
    heroImageUrl: item.image_url,
    publish: publishNow,
  });
  if (!publishNow && when) {
    await db.update(pages).set({ publish_at: when, updated_at: new Date() }).where(eq(pages.id, page.id));
  }
  const url = page.slug ? `${APP_URL()}/p/${page.slug}` : null;
  return { pageId: page.id, url: publishNow ? url : null };
}

/** Schedule an item for a future time. X → a scheduled social task; blog → a
 *  draft page with publish_at; linkedin → just a dated reminder (manual). */
export async function scheduleItem(
  workspaceId: string,
  id: string,
  whenISO: string,
  actor: { name: string },
): Promise<{ ok: boolean; error?: string }> {
  const item = await getItemRow(workspaceId, id);
  if (!item) return { ok: false, error: "Item not found." };
  const when = new Date(whenISO);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Pick a valid date and time." };

  const set: Record<string, unknown> = { scheduled_at: when, status: "scheduled", updated_at: new Date() };

  if (item.channel === "x") {
    const text = fitToX(item.body_md);
    if (!text.trim()) return { ok: false, error: "Add the post text first." };
    const r = await scheduleSingleTweet(workspaceId, { text, whenISO: when.toISOString() }, actor);
    if (!r.ok) return { ok: false, error: r.error };
    set.ref_type = "task";
  } else if (item.channel === "blog") {
    if (!item.title.trim()) return { ok: false, error: "Give the blog post a title." };
    const { pageId } = await materializeBlog(workspaceId, item, false, when);
    set.ref_type = "page";
    set.ref_id = pageId;
  }
  // linkedin: manual — just records the scheduled time as a reminder.

  await db.update(marketingItems).set(set).where(and(eq(marketingItems.workspace_id, workspaceId), eq(marketingItems.id, id)));
  return { ok: true };
}

/** Publish an item now. X → posts immediately; blog → live page; linkedin →
 *  marks it posted (the owner posts it manually from the copy). */
export async function publishItemNow(
  workspaceId: string,
  id: string,
  actor: { name: string; email: string },
): Promise<{ ok: boolean; url?: string | null; error?: string }> {
  const item = await getItemRow(workspaceId, id);
  if (!item) return { ok: false, error: "Item not found." };
  const now = new Date();
  const set: Record<string, unknown> = { status: "published", posted_at: now, updated_at: now };

  if (item.channel === "x") {
    const text = fitToX(item.body_md);
    if (!text.trim()) return { ok: false, error: "Add the post text first." };
    const r = await postSingleTweetNow(workspaceId, { text }, actor);
    if (!r.ok) return { ok: false, error: r.error };
    set.ref_type = "task";
    set.ref_id = r.taskId;
  } else if (item.channel === "blog") {
    if (!item.title.trim()) return { ok: false, error: "Give the blog post a title." };
    const { pageId, url } = await materializeBlog(workspaceId, item, true, null);
    set.ref_type = "page";
    set.ref_id = pageId;
    set.ref_url = url;
  }
  // linkedin: just marks posted (manual copy/paste by the owner).

  await db.update(marketingItems).set(set).where(and(eq(marketingItems.workspace_id, workspaceId), eq(marketingItems.id, id)));
  return { ok: true, url: typeof set.ref_url === "string" ? set.ref_url : null };
}

/** Mark a manual (LinkedIn) item as posted — or revert to drafted. */
export async function setItemPosted(
  workspaceId: string,
  id: string,
  posted: boolean,
): Promise<{ ok: boolean }> {
  await db
    .update(marketingItems)
    .set({ status: posted ? "published" : "drafted", posted_at: posted ? new Date() : null, updated_at: new Date() })
    .where(and(eq(marketingItems.workspace_id, workspaceId), eq(marketingItems.id, id)));
  return { ok: true };
}
