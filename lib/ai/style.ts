import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Writing-voice learning + bulk tweet cleanup. Distills a reusable style guide
 * from the owner's real tweets, and polishes rough tweet drafts into ready-to-post
 * tweets in that same voice. Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

/** Distill a concise, reusable "writing voice" guide from a sample of tweets. */
export async function analyzeTweetStyle(tweets: string[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const sample = tweets
    .map((t) => `- ${t.replace(/\s+/g, " ").trim()}`)
    .join("\n")
    .slice(0, 8000);
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const system = [
    "You are a writing-voice analyst. Study the person's real tweets and produce a concise, reusable STYLE GUIDE another writer can follow to sound exactly like them.",
    "Cover: tone & personality; sentence length & rhythm; capitalization & punctuation habits; emoji use (which, how often); hashtag use; formatting quirks (line breaks, lists, one-liners); vocabulary & signature phrases; and what they clearly AVOID.",
    "Be specific and observational — quote tiny fragments as evidence. 150–220 words, tight bullet points, no preamble or sign-off.",
  ].join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    system,
    messages: [{ role: "user", content: `Here are the tweets:\n\n${sample}\n\nWrite the style guide.` }],
  });
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

/**
 * Polish a list of rough tweet drafts into ready-to-post tweets in the owner's
 * voice. This is a LIGHT edit — preserve their meaning, ideas, and creativity;
 * never rewrite wholesale. Returns one cleaned tweet per input, in order.
 */
export async function cleanUpTweets(
  raw: string[],
  ctx: { company?: string; voiceRules?: string[]; styleProfile?: string | null },
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  if (!raw.length) return [];
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const system = [
    "You polish a person's rough tweet drafts into ready-to-post tweets.",
    "CRITICAL: preserve their meaning, ideas, and creativity — you are LIGHTLY editing, not rewriting. Keep their voice and intent. If a draft is already good, return it essentially unchanged.",
    ctx.styleProfile ? `Match this writing voice:\n${ctx.styleProfile}` : "",
    ctx.company ? `They post for ${ctx.company}.` : "",
    ctx.voiceRules?.length ? `Brand voice rules: ${ctx.voiceRules.join("; ")}.` : "",
    "Rules: fix grammar, spelling, and awkward phrasing; keep each tweet ≤ 280 characters; keep any hashtags/@mentions the author intended but don't add ones they didn't; never invent facts, stats, or quotes; don't homogenize — keep each tweet distinct.",
    "Respond with ONLY a JSON array of strings — exactly one cleaned tweet per input draft, in the same order. No markdown, no commentary.",
  ]
    .filter(Boolean)
    .join("\n");

  const numbered = raw
    .map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ").trim()}`)
    .join("\n")
    .slice(0, 9000);

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: `Clean up these ${raw.length} drafts:\n\n${numbered}` }],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  let arr: unknown;
  try {
    arr = JSON.parse(stripFences(text));
  } catch {
    throw new Error("Couldn't read the cleaned tweets. Please try again.");
  }
  if (!Array.isArray(arr)) throw new Error("The cleanup returned an unexpected shape.");
  return (arr as unknown[])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .map((s) => (s.length > 280 ? s.slice(0, 277).trimEnd() + "…" : s));
}
