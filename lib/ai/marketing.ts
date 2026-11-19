import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import type { MarketingChannel } from "@/lib/types";

/**
 * Marketing campaign planner — turns an objective into a multi-week plan of
 * ready-to-edit content across the chosen channels, in the company's voice.
 * Draft only: the owner reviews, edits, and schedules each item.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const CHANNELS: MarketingChannel[] = ["x", "linkedin", "blog", "newsletter"];

const CHANNEL_GUIDE: Record<MarketingChannel, string> = {
  x: "x = a short, punchy tweet (≤270 chars), scroll-stopping, 0-1 hashtags.",
  linkedin:
    "linkedin = a professional LinkedIn post (a few short paragraphs, a hook first line, a clear takeaway; line breaks ok).",
  blog: "blog = a company blog post: a specific title + a genuinely useful markdown article draft (## sections, short paragraphs).",
  newsletter:
    "newsletter = a company email newsletter section: a subject-worthy headline + a warm, useful email body (short paragraphs, a clear takeaway, a soft CTA).",
};

export interface PlannedItem {
  channel: MarketingChannel;
  title: string;
  body_md: string;
  /** Days from the campaign start (for spreading on the calendar). */
  day_offset: number;
}

export interface PlanInput {
  objective: string;
  weeks: number;
  channels: MarketingChannel[];
  brief: {
    company_name: string;
    business_description: string;
    core_offer: string;
    ideal_customer_profile: string;
  };
  styleProfile?: string | null;
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function planCampaign(input: PlanInput): Promise<PlannedItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const objective = input.objective.trim();
  if (!objective) throw new Error("Describe the campaign objective first.");
  const channels = input.channels.filter((c) => CHANNELS.includes(c));
  if (!channels.length) throw new Error("Pick at least one channel.");
  const weeks = Math.max(1, Math.min(input.weeks || 2, 8));
  const client = getAnthropic();
  const b = input.brief;

  const system = [
    `You are a senior marketing strategist for ${b.company_name || "the company"}.`,
    b.business_description ? `What they do: ${b.business_description}` : "",
    b.core_offer ? `Core offer: ${b.core_offer}` : "",
    b.ideal_customer_profile ? `Audience: ${b.ideal_customer_profile}` : "",
    input.styleProfile ? `Voice/style to match: ${input.styleProfile}` : "",
    "",
    `Plan a ${weeks}-week marketing campaign for the objective below. Produce a coherent sequence of ready-to-edit content items spread across these channels: ${channels.join(", ")}.`,
    ...channels.map((c) => `- ${CHANNEL_GUIDE[c]}`),
    "",
    "Write the ACTUAL draft content for each item (not a description of it), in the company's voice — ready for the owner to tweak and schedule. Vary the angles across the campaign (hooks, proof, use-cases, CTAs) so it reads as a planned arc, not repetition.",
    "HARD RULES: never invent facts, numbers, stats, customers, or claims not implied by the brief. No hype/clickbait. Keep it honest and specific.",
    `Produce 6-12 items total. day_offset is an integer number of days from the campaign start (0 to ${weeks * 7 - 1}), spread sensibly.`,
    "",
    "Respond with ONLY this JSON (no fences):",
    '{"items": [{"channel": "x"|"linkedin"|"blog"|"newsletter", "title": string, "body_md": string, "day_offset": number}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: `Objective: ${objective}\n\nPlan the campaign now.` }],
  });
  const text = msg.content.map((bl) => (bl.type === "text" ? bl.text : "")).join("").trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The plan came back malformed — try again.");
  }
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const raw = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : [];
  const maxDay = weeks * 7 - 1;
  return raw
    .map((r) => {
      const channel = str(r.channel).trim() as MarketingChannel;
      const dayRaw = typeof r.day_offset === "number" ? r.day_offset : Number(r.day_offset);
      return {
        channel,
        title: str(r.title).trim().slice(0, 200),
        body_md: str(r.body_md).trim().slice(0, 12000),
        day_offset: Number.isFinite(dayRaw) ? Math.max(0, Math.min(Math.round(dayRaw), maxDay)) : 0,
      };
    })
    .filter((i) => CHANNELS.includes(i.channel) && i.body_md.length > 0)
    .slice(0, 12);
}

/** Draft ONE post for a single channel, tied to a campaign (name + objective). */
export async function draftPost(input: {
  channel: MarketingChannel;
  campaignName: string;
  objective: string;
  brief: { company_name: string; business_description: string; core_offer: string; ideal_customer_profile: string };
  styleProfile?: string | null;
}): Promise<{ title: string; body_md: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const b = input.brief;

  const system = [
    `You are a senior marketing copywriter for ${b.company_name || "the company"}.`,
    b.business_description ? `What they do: ${b.business_description}` : "",
    b.core_offer ? `Core offer: ${b.core_offer}` : "",
    b.ideal_customer_profile ? `Audience: ${b.ideal_customer_profile}` : "",
    input.styleProfile ? `Voice/style to match: ${input.styleProfile}` : "",
    "",
    `Write ONE ${input.channel} post for the campaign below, in the company's voice. ${CHANNEL_GUIDE[input.channel] ?? ""}`,
    "Write the ACTUAL draft content (ready to edit + post), not a description. Never invent facts, numbers, customers, or claims not implied by the brief. No hype or clickbait.",
    "",
    "Respond with ONLY this JSON (no fences):",
    '{"title": string, "body_md": string}',
    'For channels without a visible title (x, linkedin, newsletter body), still give a short internal "title" to label it in the UI.',
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [
      {
        role: "user",
        content: `Campaign: ${input.campaignName}\nObjective: ${input.objective}\n\nWrite the ${input.channel} post now.`,
      },
    ],
  });
  const text = msg.content.map((bl) => (bl.type === "text" ? bl.text : "")).join("").trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The draft came back malformed — try again.");
  }
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    title: str(obj.title).trim().slice(0, 200) || input.campaignName,
    body_md: str(obj.body_md).trim().slice(0, 12000),
  };
}
