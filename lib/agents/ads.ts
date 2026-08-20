import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives, businessBriefs } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { runWithUsage } from "@/lib/ai/usage";
import { generateAdCampaign, suggestAdCampaigns } from "@/lib/ai/ads";
import { searchStockImages, stockConfigured } from "@/lib/ai/stock";
import type { AdCampaign, AdCampaignIdea, AdCampaignSummary, AdCreative, AdPlatform } from "@/lib/types";

/**
 * Ads Manager engine (P0 — campaign studio). Turns an objective into ready-to-run
 * ad packages per platform, resolves a stock image per creative, and persists them
 * for review + editing. No external ad-platform APIs yet (direct placement later).
 */

const PLATFORM_ORDER: AdPlatform[] = ["meta", "google", "x", "linkedin"];

function toCreative(r: typeof adCreatives.$inferSelect): AdCreative {
  return {
    id: r.id,
    platform: r.platform as AdPlatform,
    format: r.format,
    headline: r.headline,
    primary_text: r.primary_text,
    description: r.description,
    cta: r.cta,
    keywords: (r.keywords ?? []) as string[],
    audience: r.audience,
    geo: r.geo,
    image_url: r.image_url,
    image_alt: r.image_alt,
    status: r.status,
    placement_ref: r.placement_ref,
  };
}

export async function getAdCampaign(workspaceId: string, id: string): Promise<AdCampaign> {
  const [c] = await db
    .select()
    .from(adCampaigns)
    .where(and(eq(adCampaigns.workspace_id, workspaceId), eq(adCampaigns.id, id)))
    .limit(1);
  const creatives = c
    ? (
        await db
          .select()
          .from(adCreatives)
          .where(and(eq(adCreatives.workspace_id, workspaceId), eq(adCreatives.campaign_id, id)))
      )
        .map(toCreative)
        .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform))
    : [];
  return {
    id: c?.id ?? id,
    name: c?.name ?? "",
    objective: c?.objective ?? "",
    audience: c?.audience ?? "",
    daily_budget_cents: c?.daily_budget_cents ?? 0,
    status: c?.status ?? "draft",
    destination_url: c?.destination_url ?? "",
    creatives,
    created_at: c?.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString(),
  };
}

/** Generate a full multi-platform ad campaign from an objective. */
export async function createAdCampaign(
  workspaceId: string,
  input: { objective: string; platforms: AdPlatform[]; budgetCents?: number },
): Promise<{ ok: true; campaign: AdCampaign } | { ok: false; error: string }> {
  const objective = input.objective.trim();
  if (!objective) return { ok: false, error: "Describe what you want these ads to achieve." };

  return runWithUsage(workspaceId, "ads-generate", async () => {
    const { brief } = await getPlanningContext(workspaceId);
    const context = [brief.business_description, brief.core_offer, brief.ideal_customer_profile]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1500);

    let gen;
    try {
      gen = await generateAdCampaign({
        objective,
        company: brief.company_name ?? "",
        context,
        platforms: input.platforms,
        budgetCents: input.budgetCents,
      });
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't generate the campaign." };
    }
    if (!gen.creatives.length) return { ok: false as const, error: "The campaign came back empty — try again." };

    const imgOn = stockConfigured();
    const now = new Date();
    const campaignId = randomUUID();
    await db.insert(adCampaigns).values({
      id: campaignId,
      workspace_id: workspaceId,
      name: gen.name,
      objective,
      audience: gen.audience,
      daily_budget_cents: gen.daily_budget_cents,
      status: "draft",
      created_at: now,
    });

    // Best-effort stock image per creative (search platforms don't show one).
    const rows = await Promise.all(
      gen.creatives.map(async (c) => {
        let image_url = "";
        let image_alt = "";
        if (imgOn && c.image_keyword && c.platform !== "google") {
          const imgs = await searchStockImages(c.image_keyword, 1).catch(() => []);
          if (imgs[0]) {
            image_url = imgs[0].url;
            image_alt = imgs[0].attribution;
          }
        }
        return {
          id: randomUUID(),
          campaign_id: campaignId,
          workspace_id: workspaceId,
          platform: c.platform,
          format: c.format,
          headline: c.headline,
          primary_text: c.primary_text,
          description: c.description,
          cta: c.cta,
          keywords: c.keywords,
          audience: c.audience,
          geo: c.geo,
          image_url,
          image_alt,
          created_at: now,
          updated_at: now,
        };
      }),
    );
    await db.insert(adCreatives).values(rows);
    return { ok: true as const, campaign: await getAdCampaign(workspaceId, campaignId) };
  });
}

/** Propose 2–3 ad campaigns from the business strategy (brief + goals + Deep Dive). */
export async function suggestCampaigns(
  workspaceId: string,
): Promise<{ ok: true; ideas: AdCampaignIdea[] } | { ok: false; error: string }> {
  return runWithUsage(workspaceId, "ads-suggest", async () => {
    const { brief } = await getPlanningContext(workspaceId);
    const context = [
      brief.business_description,
      brief.core_offer,
      brief.ideal_customer_profile,
      brief.company_context,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2000);
    const [briefRow] = await db
      .select({ goals: businessBriefs.goals })
      .from(businessBriefs)
      .where(eq(businessBriefs.workspace_id, workspaceId))
      .limit(1);

    try {
      const ideas = await suggestAdCampaigns({
        company: brief.company_name ?? "",
        context,
        goals: briefRow?.goals ?? [],
      });
      if (!ideas.length) return { ok: false as const, error: "No campaign ideas came back — try again." };
      return { ok: true as const, ideas };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't suggest campaigns." };
    }
  });
}

export async function listAdCampaigns(workspaceId: string, limit = 30): Promise<AdCampaignSummary[]> {
  const camps = await db
    .select()
    .from(adCampaigns)
    .where(eq(adCampaigns.workspace_id, workspaceId))
    .orderBy(desc(adCampaigns.created_at))
    .limit(limit);
  if (!camps.length) return [];
  const cr = await db
    .select({
      campaign_id: adCreatives.campaign_id,
      platform: adCreatives.platform,
      status: adCreatives.status,
    })
    .from(adCreatives)
    .where(
      and(
        eq(adCreatives.workspace_id, workspaceId),
        inArray(
          adCreatives.campaign_id,
          camps.map((c) => c.id),
        ),
      ),
    );
  const byC = new Map<string, Set<string>>();
  const launched = new Map<string, number>();
  for (const r of cr) {
    const s = byC.get(r.campaign_id) ?? new Set<string>();
    s.add(r.platform);
    byC.set(r.campaign_id, s);
    if (r.status === "launched") launched.set(r.campaign_id, (launched.get(r.campaign_id) ?? 0) + 1);
  }
  return camps.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    platforms: [...(byC.get(c.id) ?? [])].sort(
      (a, b) => PLATFORM_ORDER.indexOf(a as AdPlatform) - PLATFORM_ORDER.indexOf(b as AdPlatform),
    ) as AdPlatform[],
    launched: launched.get(c.id) ?? 0,
    created_at: new Date(c.created_at).toISOString(),
  }));
}

/** Edit one creative's copy / targeting / image before it goes out. */
export async function updateAdCreative(
  workspaceId: string,
  id: string,
  patch: {
    headline?: string;
    primary_text?: string;
    description?: string;
    cta?: string;
    audience?: string;
    geo?: string;
    image_url?: string;
  },
): Promise<{ ok: true }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.headline === "string") set.headline = patch.headline.slice(0, 120);
  if (typeof patch.primary_text === "string") set.primary_text = patch.primary_text.slice(0, 600);
  if (typeof patch.description === "string") set.description = patch.description.slice(0, 200);
  if (typeof patch.cta === "string") set.cta = patch.cta.slice(0, 40);
  if (typeof patch.audience === "string") set.audience = patch.audience.slice(0, 200);
  if (typeof patch.geo === "string") set.geo = patch.geo.slice(0, 80);
  if (typeof patch.image_url === "string") set.image_url = patch.image_url.slice(0, 2000);
  await db
    .update(adCreatives)
    .set(set)
    .where(and(eq(adCreatives.workspace_id, workspaceId), eq(adCreatives.id, id)));
  return { ok: true };
}

export async function deleteAdCampaign(workspaceId: string, id: string): Promise<{ ok: true }> {
  await db.delete(adCampaigns).where(and(eq(adCampaigns.workspace_id, workspaceId), eq(adCampaigns.id, id)));
  return { ok: true };
}

/** Ensure a pasted URL has a scheme so UTM links + previews resolve. "" stays "". */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Set where the campaign's ad clicks should land (drives per-platform UTM links). */
export async function setCampaignDestination(
  workspaceId: string,
  id: string,
  url: string,
): Promise<{ ok: true; destination_url: string }> {
  const destination_url = normalizeUrl(url).slice(0, 2000);
  await db
    .update(adCampaigns)
    .set({ destination_url })
    .where(and(eq(adCampaigns.workspace_id, workspaceId), eq(adCampaigns.id, id)));
  return { ok: true, destination_url };
}

/** Mark one platform's ad launched (or back to draft) + note where it went live. */
export async function setCreativeStatus(
  workspaceId: string,
  creativeId: string,
  status: "draft" | "launched",
  placementRef?: string,
): Promise<{ ok: true; campaignStatus: string } | { ok: false; error: string }> {
  const [row] = await db
    .select({ campaign_id: adCreatives.campaign_id })
    .from(adCreatives)
    .where(and(eq(adCreatives.workspace_id, workspaceId), eq(adCreatives.id, creativeId)))
    .limit(1);
  if (!row) return { ok: false, error: "That ad no longer exists." };

  const set: Record<string, unknown> = { status, updated_at: new Date() };
  if (typeof placementRef === "string") set.placement_ref = placementRef.slice(0, 200);
  await db
    .update(adCreatives)
    .set(set)
    .where(and(eq(adCreatives.workspace_id, workspaceId), eq(adCreatives.id, creativeId)));

  // Roll the campaign's status up: launched if any of its creatives are live.
  const peers = await db
    .select({ status: adCreatives.status })
    .from(adCreatives)
    .where(and(eq(adCreatives.workspace_id, workspaceId), eq(adCreatives.campaign_id, row.campaign_id)));
  const campaignStatus = peers.some((p) => p.status === "launched") ? "launched" : "draft";
  await db
    .update(adCampaigns)
    .set({ status: campaignStatus })
    .where(and(eq(adCampaigns.workspace_id, workspaceId), eq(adCampaigns.id, row.campaign_id)));

  return { ok: true, campaignStatus };
}
