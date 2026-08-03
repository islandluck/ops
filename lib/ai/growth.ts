import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { PlanBrief } from "@/lib/ai/plan";

/**
 * Growth-campaign planner — an Executive-level strategist turns a follower goal
 * into a weekly cadence (tweets/replies/day, blogs/week) + a per-week theme arc.
 * Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export interface GrowthPlan {
  title: string;
  summary: string;
  cadence: { tweets_per_day: number; replies_per_day: number; blogs_per_week: number };
  weeks: { theme: string; focus: string }[];
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof n === "number" ? Math.round(n) : Number(n);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};

export async function planGrowthCampaign(
  input: { goal: string; weeks: number; followerGoalPerWeek: number },
  brief: PlanBrief,
  styleProfile?: string | null,
): Promise<GrowthPlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const weeks = clamp(input.weeks, 1, 12, 4);

  const system = [
    "You are a world-class X/Twitter growth strategist and head of content, planning a follower-growth campaign for a founder.",
    `They run ${brief.company_name || "a company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Niche / audience they want to grow with: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
    styleProfile ? `The founder's personal writing voice:\n${styleProfile}` : "",
    "",
    `Design a ${weeks}-week campaign to hit the goal of +${input.followerGoalPerWeek} followers per week.`,
    "Decide a realistic daily/weekly CADENCE with three levers: tweets/day (original posts — punchy, specific, genuinely high viral potential), replies/day (thoughtful replies to bigger accounts in the niche — the single fastest growth lever), and blogs/week (longform for authority + SEO). Ground the numbers in what actually drives the target: reply volume matters most for reach; tweet consistency compounds; blogs build authority.",
    "Then design a per-week THEME arc — each week a content theme + a one-line focus that builds momentum toward the goal (e.g. week 1 establish a clear point of view, later weeks lean into what's resonating and go deeper).",
    "Be realistic and non-spammy: growth comes from consistency + genuinely valuable, on-niche content + replying to the right people. Never recommend engagement-bait, follow-for-follow, or fake activity.",
    "",
    "Respond with ONLY this JSON object (no markdown, no code fences):",
    '{"title": string (a short campaign name), "summary": string (2-3 sentences on the strategy + why this cadence hits the goal), "cadence": {"tweets_per_day": number, "replies_per_day": number, "blogs_per_week": number}, "weeks": [{"theme": string, "focus": string}]}',
    `The "weeks" array MUST contain exactly ${weeks} items.`,
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: "user", content: `Goal: ${input.goal}\n\nPlan the ${weeks}-week campaign now.` }],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The strategist returned an unreadable plan. Please try again.");
  }

  const cad = (raw.cadence ?? {}) as Record<string, unknown>;
  const weeksRaw = Array.isArray(raw.weeks) ? (raw.weeks as Record<string, unknown>[]) : [];
  const parsedWeeks = weeksRaw
    .map((w) => ({
      theme: typeof w.theme === "string" ? w.theme.trim().slice(0, 120) : "",
      focus: typeof w.focus === "string" ? w.focus.trim().slice(0, 300) : "",
    }))
    .filter((w) => w.theme);
  // Ensure exactly `weeks` entries (pad with a sensible default if short).
  while (parsedWeeks.length < weeks) {
    parsedWeeks.push({ theme: `Week ${parsedWeeks.length + 1}`, focus: "Keep the cadence; double down on what's resonating." });
  }

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 120) : "Follower growth campaign",
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 600) : "",
    cadence: {
      tweets_per_day: clamp(cad.tweets_per_day, 1, 10, 3),
      replies_per_day: clamp(cad.replies_per_day, 0, 25, 10),
      blogs_per_week: clamp(cad.blogs_per_week, 0, 5, 1),
    },
    weeks: parsedWeeks.slice(0, weeks),
  };
}
