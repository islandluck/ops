import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { PlanBrief } from "@/lib/ai/plan";

/**
 * The content engine's AI: draft a longform post in the owner's voice, run it
 * through a growth-marketer viral rewrite, and atomize it into an X thread for
 * repurposing. Deterministic per-channel formatting (Markdown → HTML / page
 * sections) lives in lib/content/*, not here. Server-only; gated on the API key.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  return new Anthropic({ apiKey, maxRetries: 2 });
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function textOf(msg: Anthropic.Message): string {
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

/** The audience/voice context every content call shares. */
export interface ContentContext {
  brief: PlanBrief;
  styleProfile?: string | null;
}

function voiceLines(ctx: ContentContext): string[] {
  const { brief, styleProfile } = ctx;
  return [
    `You write for ${brief.company_name || "the company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Audience: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
    brief.restricted_phrases.length ? `Never use / never claim: ${brief.restricted_phrases.join(", ")}` : "",
    styleProfile?.trim() ? `Write in the owner's personal voice — match this style closely:\n${styleProfile}` : "",
  ].filter(Boolean);
}

export interface LongformDraft {
  title: string;
  dek: string;
  body_md: string;
}

/** Draft a genuinely useful longform blog post (title + dek + markdown body). */
export async function generateLongform(
  input: { topic: string; angle?: string },
  ctx: ContentContext,
): Promise<LongformDraft> {
  const topic = input.topic.trim();
  if (!topic) throw new Error("Give the post a topic first.");

  const system = [
    "You are a world-class content writer and ghostwriter. Write a genuinely useful, specific longform blog post the target reader would bookmark and share.",
    ...voiceLines(ctx),
    "",
    "Requirements:",
    "- A compelling, specific TITLE (not clickbait) and a one-sentence DEK (standfirst) that frames the value.",
    "- A well-structured MARKDOWN body: a strong opening, `## ` section headings, short skimmable paragraphs, and lists where they help. ~600–1000 words.",
    "- Concrete and grounded in the company's real domain. NEVER fabricate statistics, quotes, studies, or customer outcomes. If you'd need a specific number you don't have, make the point qualitatively.",
    "- No SEO keyword-stuffing, no filler, no AI throat-clearing ('In today's fast-paced world').",
    "",
    "Respond with ONLY this JSON (no markdown, no code fences):",
    '{"title": string, "dek": string, "body_md": string (markdown)}',
  ]
    .filter(Boolean)
    .join("\n");

  const user = input.angle?.trim()
    ? `Topic: ${topic}\n\nAngle / must-include: ${input.angle.trim()}\n\nWrite the post now.`
    : `Topic: ${topic}\n\nWrite the post now.`;

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
  });

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stripFences(textOf(msg))) as Record<string, unknown>;
  } catch {
    throw new Error("The writer returned an unreadable draft. Please try again.");
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const body_md = typeof raw.body_md === "string" ? raw.body_md.trim() : "";
  if (!body_md) throw new Error("The writer returned an empty draft. Please try again.");
  return {
    title: (title || topic).slice(0, 200),
    dek: typeof raw.dek === "string" ? raw.dek.trim().slice(0, 300) : "",
    body_md,
  };
}

export interface BoostedLongform extends LongformDraft {
  /** Short, plain-English list of the levers applied, for the accept/tweak view. */
  changes: string[];
}

/**
 * Growth-marketer viral rewrite of a longform post — a scroll-stopping headline,
 * a hook that earns the first paragraph, skimmable structure, open loops, and a
 * shareable takeaway — WITHOUT changing what the post actually says or inventing
 * facts. Returns the rewrite plus a note of what changed (advisory: the author
 * accepts or tweaks).
 */
export async function growthBoostLongform(
  post: { title: string; dek: string; body_md: string },
  ctx: ContentContext,
): Promise<BoostedLongform> {
  if (!post.body_md.trim()) throw new Error("Nothing to boost.");

  const system = [
    "You are a world-class growth marketer and viral content editor. Rewrite the author's blog post to maximize genuine reach and shares.",
    "Levers to pull: a sharper, more specific HEADLINE; an opening HOOK that makes the reader need the next line; tighter, skimmable STRUCTURE (clear sections, short paragraphs, a scannable list or two); OPEN LOOPS that pull the reader down the page; and a crisp, quotable TAKEAWAY they'd want to share.",
    "HARD RULES: keep the author's actual message, claims, and point of view — you are editing for impact, not changing substance; keep their voice — never hypey, cringe, clickbait, or engagement-bait; NEVER invent facts, numbers, quotes, studies, or outcomes; keep it honest longform (don't gut it into a listicle if that loses the substance).",
    ...voiceLines(ctx),
    "",
    "Respond with ONLY this JSON (no markdown, no code fences):",
    '{"title": string, "dek": string, "body_md": string (markdown), "changes": string[] (2–4 short bullets naming what you improved)}',
  ]
    .filter(Boolean)
    .join("\n");

  const user = `Post to boost:\n\nTITLE: ${post.title}\nDEK: ${post.dek}\n\n${post.body_md}`;
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
  });

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stripFences(textOf(msg))) as Record<string, unknown>;
  } catch {
    throw new Error("Couldn't read the boosted draft. Please try again.");
  }
  const body_md = typeof raw.body_md === "string" ? raw.body_md.trim() : "";
  if (!body_md) throw new Error("The boost returned an empty draft. Please try again.");
  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : post.title,
    dek: typeof raw.dek === "string" ? raw.dek.trim().slice(0, 300) : post.dek,
    body_md,
    changes: Array.isArray(raw.changes)
      ? raw.changes.filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean).slice(0, 4)
      : [],
  };
}

/**
 * Atomize a longform post into an X thread — a hook tweet, then tweets carrying
 * the key ideas, ending on a takeaway. Each ≤ 280 chars, in the owner's voice,
 * no fabricated facts, no "🧵 a thread" cringe. Returns ordered tweets.
 */
export async function atomizeToThread(
  post: { title: string; dek: string; body_md: string },
  ctx: ContentContext,
  opts: { maxTweets?: number } = {},
): Promise<string[]> {
  if (!post.body_md.trim()) throw new Error("Nothing to atomize.");
  const maxTweets = Math.max(3, Math.min(opts.maxTweets ?? 8, 12));

  const system = [
    "You turn a blog post into a high-quality X/Twitter THREAD that stands on its own and makes people want the full post.",
    ...voiceLines(ctx),
    "",
    `Write ${maxTweets} tweets or fewer:`,
    "- Tweet 1 is a scroll-stopping HOOK — the single most compelling idea, concrete and specific. No 'a thread 🧵', no 'let me explain'.",
    "- Middle tweets each carry ONE real idea from the post — self-contained, specific, valuable on its own.",
    "- The last tweet lands a takeaway. Do NOT add a link or 'read more' — a link is appended later.",
    "HARD RULES: every tweet ≤ 270 characters; keep the author's voice and meaning; NEVER fabricate facts, numbers, or quotes; no hashtags unless truly natural; no engagement-bait. Each tweet must be genuinely worth posting alone.",
    "",
    'Respond with ONLY a JSON array of strings (the tweets, in order) — no markdown, no code fences.',
  ]
    .filter(Boolean)
    .join("\n");

  const user = `Post:\n\nTITLE: ${post.title}\nDEK: ${post.dek}\n\n${post.body_md}`;
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
  });

  let arr: unknown;
  try {
    arr = JSON.parse(stripFences(textOf(msg)));
  } catch {
    throw new Error("Couldn't read the thread. Please try again.");
  }
  if (!Array.isArray(arr)) throw new Error("The thread came back in an unexpected shape.");
  const tweets = (arr as unknown[])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean)
    .map((t) => (t.length > 280 ? t.slice(0, 277).trimEnd() + "…" : t))
    .slice(0, maxTweets);
  if (!tweets.length) throw new Error("The thread came back empty. Please try again.");
  return tweets;
}
