import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { adCampaigns, adCreatives } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { runWithUsage } from "@/lib/ai/usage";
import { generateAdCampaign } from "@/lib/ai/ads";
import { searchStockImages, stockConfigured } from "@/lib/ai/stock";
import type { AdCampaign, AdCampaignSummary, AdCreative, AdPlatform } from "@/lib/types";

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

export async function listAdCampaigns(workspaceId: string, limit = 30): Promise<AdCampaignSummary[]> {
  const camps = await db
    .select()
    .from(adCampaigns)
    .where(eq(adCampaigns.workspace_id, workspaceId))
    .orderBy(desc(adCampaigns.created_at))
    .limit(limit);
  if (!camps.length) return [];
  const cr = await db
    .select({ campaign_id: adCreatives.campaign_id, platform: adCreatives.platform })
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
  for (const r of cr) {
    const s = byC.get(r.campaign_id) ?? new Set<string>();
    s.add(r.platform);
    byC.set(r.campaign_id, s);
  }
  return camps.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    platforms: [...(byC.get(c.id) ?? [])].sort(
      (a, b) => PLATFORM_ORDER.indexOf(a as AdPlatform) - PLATFORM_ORDER.indexOf(b as AdPlatform),
    ) as AdPlatform[],
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
