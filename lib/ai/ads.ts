import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import type { AdPlatform } from "@/lib/types";

/**
 * Ads Manager creative engine — turn a campaign objective into launch-ready,
 * platform-native ad packages (copy + targeting + budget). One call for all
 * requested platforms (kept cheap). Never fabricates offers, prices, or claims
 * beyond what the objective + business context state.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export const AD_PLATFORMS: { key: AdPlatform; label: string; format: string }[] = [
  { key: "meta", label: "Meta (Facebook/Instagram)", format: "Facebook / Instagram feed" },
  { key: "google", label: "Google (Search / YouTube)", format: "Google responsive search ad" },
  { key: "x", label: "X (Twitter)", format: "X promoted post" },
  { key: "linkedin", label: "LinkedIn", format: "LinkedIn sponsored content" },
];

export interface GeneratedAdCreative {
  platform: AdPlatform;
  format: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  keywords: string[];
  audience: string;
  geo: string;
  image_keyword: string;
}

export interface GeneratedAdCampaign {
  name: string;
  audience: string;
  daily_budget_cents: number;
  creatives: GeneratedAdCreative[];
}

const PLATFORM_SPEC: Record<AdPlatform, string> = {
  meta: "Meta (Facebook/Instagram feed): primary_text ≤125 chars (the hook), headline ≤40, description ≤30, cta a button label (Learn More / Shop Now / Sign Up / Get Offer). image_keyword required.",
  google:
    "Google responsive search ad: headline ≤30 chars (the single strongest), description ≤90 chars, 6–10 tight search keywords, cta a short action phrase. No image (search).",
  x: "X promoted post: primary_text ≤270 chars (a scroll-stopping post, sparing hashtags), a short headline, cta a button label. image_keyword required.",
  linkedin:
    "LinkedIn sponsored content: primary_text ≤150 chars (professional, value-first), headline ≤70, cta a button label (Learn More / Download / Register). image_keyword required.",
};

export async function generateAdCampaign(input: {
  objective: string;
  company: string;
  context: string;
  platforms: AdPlatform[];
  budgetCents?: number;
}): Promise<GeneratedAdCampaign> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Ad generation isn't configured (ANTHROPIC_API_KEY missing).");
  const platforms = input.platforms.length ? input.platforms : (["meta", "google", "x"] as AdPlatform[]);

  const client = getAnthropic();
  const system = [
    `You are a world-class performance marketer building a paid-ad campaign for ${input.company || "the company"}.`,
    input.context ? `Business context: ${input.context}` : "",
    input.budgetCents
      ? `The founder set a daily budget of about $${(input.budgetCents / 100).toFixed(0)}.`
      : "Recommend a sensible starting daily budget (usually $20–$60/day for a small business test).",
    "",
    "Write one native ad for EACH requested platform — tailored to that platform's format and limits below. Copy must be sharp, specific, and honest: never invent prices, guarantees, stats, or claims not supported by the objective/context.",
    "For each platform also give: a 1-line target audience, a geo (use the business's implied market, else \"United States\"), and a 1–3 word stock-photo search term (image_keyword) for the visual.",
    "",
    "Platform specs:",
    ...platforms.map((p) => `- ${p}: ${PLATFORM_SPEC[p]}`),
    "",
    'Respond with ONLY JSON, no fences: {"name": short campaign name, "audience": one-line overall target audience, "daily_budget_cents": integer, "creatives": [{"platform": one of the requested keys, "format": platform format, "headline": string, "primary_text": string, "description": string, "cta": string, "keywords": string[], "audience": string, "geo": string, "image_keyword": string}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system,
    messages: [
      {
        role: "user",
        content: `Campaign objective:\n${input.objective}\n\nBuild ads for: ${platforms.join(", ")}.`.slice(0, 4000),
      },
    ],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model didn't return a usable campaign.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Couldn't parse the generated campaign.");
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, 12) : []);
  const valid = new Set(platforms);
  const specByKey = new Map(AD_PLATFORMS.map((p) => [p.key, p]));

  const creatives = (Array.isArray(parsed.creatives) ? parsed.creatives : [])
    .map((c) => (c ?? {}) as Record<string, unknown>)
    .filter((c) => valid.has(c.platform as AdPlatform))
    .map((c) => {
      const platform = c.platform as AdPlatform;
      return {
        platform,
        format: str(c.format) || specByKey.get(platform)?.format || "",
        headline: str(c.headline).slice(0, 120),
        primary_text: str(c.primary_text).slice(0, 600),
        description: str(c.description).slice(0, 200),
        cta: str(c.cta).slice(0, 40),
        keywords: arr(c.keywords),
        audience: str(c.audience).slice(0, 200),
        geo: str(c.geo).slice(0, 80) || "United States",
        image_keyword: str(c.image_keyword).slice(0, 60),
      };
    });

  const budget = Number(parsed.daily_budget_cents);
  return {
    name: str(parsed.name).slice(0, 120) || "New ad campaign",
    audience: str(parsed.audience).slice(0, 300),
    daily_budget_cents: input.budgetCents ?? (Number.isFinite(budget) && budget > 0 ? Math.round(budget) : 3000),
    creatives,
  };
}
