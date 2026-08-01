import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { PlanBrief } from "@/lib/ai/plan";
import type { ResearchResult } from "@/lib/ai/research";

/**
 * Social media content drafting. Produces on-brand X posts + blog drafts,
 * grounded in the business brief, the agent's persona, and (when available)
 * current researched topics. Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export type SocialChannel = "x" | "blog";
export interface SocialPiece {
  channel: SocialChannel;
  title: string;
  content: string;
  hashtags: string[];
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function generateSocialBatch(
  brief: PlanBrief,
  persona: string,
  research: ResearchResult | null,
  config: { x: number; blog: number },
  styleProfile?: string | null,
): Promise<SocialPiece[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const system = [
    persona?.trim() || `You are the social media manager for ${brief.company_name || "the company"}.`,
    `You work for ${brief.company_name || "the company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Audience: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
    brief.restricted_phrases.length ? `Never use / never claim: ${brief.restricted_phrases.join(", ")}` : "",
    styleProfile?.trim()
      ? `\nWrite the X posts in the OWNER'S personal voice — match this style closely:\n${styleProfile}`
      : "",
    "",
    `Create ${config.x} X/Twitter post(s) and ${config.blog} blog draft(s) — on-brand and genuinely useful to the audience.`,
    "X posts: ≤ 200 characters of body text (NO hashtags in the body — they're appended separately and must fit X's 280-character limit), punchy and specific; give 2–3 relevant lowercase hashtags separately. Blog drafts: a title + 3–5 short paragraphs.",
    "Ground everything in the company's industry and the current topics provided. Never fabricate statistics, quotes, or unverifiable claims.",
    "",
    "Respond with ONLY a JSON array — no markdown or code fences:",
    '[{"channel": "x" | "blog", "title": string (short label), "content": string, "hashtags": string[] (X only, no # prefix)}]',
  ]
    .filter(Boolean)
    .join("\n");

  const topics = research?.sources.length
    ? "Current topics (from live research):\n" +
      research.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.snippet}`).join("\n")
    : "No live research available — draw on the company's industry and offering from the brief.";

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: `${topics}\n\nCreate the content now.` }],
  });
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

  let arr: unknown;
  try {
    arr = JSON.parse(stripFences(text));
  } catch {
    throw new Error("The social agent returned an unreadable response. Please try again.");
  }
  if (!Array.isArray(arr)) throw new Error("The social agent returned an unexpected shape.");

  const pieces: SocialPiece[] = [];
  for (const raw of arr as Record<string, unknown>[]) {
    const channel: SocialChannel = raw.channel === "blog" ? "blog" : "x";
    const content = typeof raw.content === "string" ? raw.content : "";
    if (!content.trim()) continue;
    pieces.push({
      channel,
      title:
        typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, 120) : content.slice(0, 60),
      content,
      hashtags: Array.isArray(raw.hashtags)
        ? raw.hashtags
            .filter((h): h is string => typeof h === "string")
            .map((h) => h.replace(/^#/, "").trim())
            .filter(Boolean)
            .slice(0, 4)
        : [],
    });
  }
  return pieces;
}
