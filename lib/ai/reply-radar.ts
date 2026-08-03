import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Reply-radar scoring — decide which of a watched account's recent tweets are
 * worth REPLYING to, so the owner grows by being seen by the right audience.
 * Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export interface ScoredTweet {
  index: number;
  score: number; // 0–100 reply-worthiness
  reason: string;
}

export async function scoreReplyOpportunities(
  tweets: { text: string; author: string; ageMinutes?: number | null; likes?: number; replies?: number }[],
  ctx: { company?: string; idealCustomer?: string },
): Promise<ScoredTweet[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  if (!tweets.length) return [];
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const system = [
    "You are an X/Twitter growth strategist deciding which tweets are worth REPLYING to, so the account owner gets seen by the RIGHT audience and grows.",
    "Score each tweet 0-100 for reply-worthiness. HIGH when: the owner can add genuine value, it's clearly relevant to the owner's niche, it's recent, and it has reach/momentum but isn't reply-saturated. LOW when: off-topic for the owner, a pure link/promo/giveaway, purely personal with no opening, or there's nothing substantive to add.",
    ctx.company ? `The owner: ${ctx.company}.` : "",
    ctx.idealCustomer ? `The owner's niche / audience: ${ctx.idealCustomer}.` : "",
    "Give a specific one-line reason for each (why it is or isn't a good reply target).",
    'Respond with ONLY a JSON array — exactly one object per tweet, in input order: [{"index": number, "score": number (0-100), "reason": string}]',
  ]
    .filter(Boolean)
    .join("\n");

  const list = tweets
    .map((t, i) => {
      const meta = [
        t.ageMinutes != null ? `${t.ageMinutes}m old` : null,
        t.likes != null ? `${t.likes} likes` : null,
        t.replies != null ? `${t.replies} replies` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `#${i} by ${t.author}${meta ? ` (${meta})` : ""}: ${t.text.replace(/\s+/g, " ")}`;
    })
    .join("\n\n")
    .slice(0, 9000);

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: `Tweets:\n\n${list}\n\nScore each now.` }],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  let arr: unknown;
  try {
    arr = JSON.parse(stripFences(text));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return (arr as Record<string, unknown>[])
    .map((raw) => ({
      index: typeof raw.index === "number" ? raw.index : -1,
      score: typeof raw.score === "number" ? Math.max(0, Math.min(100, Math.round(raw.score))) : 0,
      reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 200) : "",
    }))
    .filter((s) => s.index >= 0 && s.index < tweets.length);
}
