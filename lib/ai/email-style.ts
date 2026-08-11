import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";

/**
 * Learn how the founder writes email — infer their signature block + reply style
 * from a sample of SENT messages, so the Admin agent can draft in their voice.
 * Server-only; gated on ANTHROPIC_API_KEY. Purely advisory: the result is shown
 * for the user to review and save, never applied silently.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export interface LearnedStyle {
  signature: string;
  reply_style: string;
}

/** Drop quoted history so we learn only what the founder actually wrote. */
function stripQuoted(body: string): string {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*On .+wrote:\s*$/.test(line)) break;
    if (/^\s*-{2,}\s*Original Message/i.test(line)) break;
    if (/^\s*_{5,}\s*$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export async function learnEmailStyle(sentBodies: string[]): Promise<LearnedStyle> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Style learning isn't configured (ANTHROPIC_API_KEY missing).");
  const samples = sentBodies
    .map(stripQuoted)
    .filter((s) => s.length > 20)
    .slice(0, 12);
  if (!samples.length) throw new Error("No sent emails long enough to learn from yet.");

  const client = getAnthropic();
  const system = [
    "You analyze a founder's SENT emails and infer how they write, so an assistant can draft replies in their voice.",
    'Return ONLY JSON: {"signature": string, "reply_style": string} — no markdown, no code fences.',
    "signature: the exact recurring sign-off block they use (e.g. 'Best,\\nAlex Rivera\\nFounder, Northwind Studio'). If they vary, pick the cleanest common version. If there's no consistent sign-off, use an empty string.",
    "reply_style: 2–4 sentences describing their tone, greeting, typical length, formatting, and sign-off habits — concrete enough to guide drafting (not generic praise).",
  ].join("\n");
  const userMsg = samples.map((s, i) => `--- Sent email ${i + 1} ---\n${s.slice(0, 1200)}`).join("\n\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Couldn't read the learned style. Try again.");
  let parsed: { signature?: unknown; reply_style?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Couldn't read the learned style. Try again.");
  }
  return {
    signature: typeof parsed.signature === "string" ? parsed.signature.slice(0, 1000) : "",
    reply_style: typeof parsed.reply_style === "string" ? parsed.reply_style.slice(0, 1000) : "",
  };
}
