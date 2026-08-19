import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import type { BoardRecommendation } from "@/lib/types";

/**
 * The Boardroom's debate engine. Each member speaks in their own voice (opening →
 * rebuttal), then the Chair synthesizes a verdict. The board's mandate: drive the
 * company to a $10B valuation as fast as possible, biased to action, and hold the
 * founder accountable — even when the truth is unwelcome.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const MISSION = [
  "The board's single mission: get this company to a $10B valuation as fast as possible.",
  "You carry the collective wisdom of the best blue-chip VC partners in your domain.",
  "Be direct and specific. Have a spine — take positions that may be counter to what the founder wants to hear.",
  "Bias hard toward action over analysis. Hold the founder accountable for results, not effort.",
  "Never invent facts, numbers, funding rounds, or competitors that aren't in the context or the market intel.",
].join(" ");

interface MemberRef {
  name: string;
  role: string;
  mandate: string;
  emoji?: string;
}

function othersBlock(members: { name: string; role: string; content: string }[]): string {
  return members.map((m) => `— ${m.name} (${m.role}):\n${m.content}`).join("\n\n");
}

export async function boardOpening(input: {
  member: MemberRef;
  company: string;
  context: string;
  question: string;
}): Promise<string> {
  const client = getAnthropic();
  const system = [
    `You are ${input.member.name}, the ${input.member.role} voice on the board of directors for ${input.company || "the company"}.`,
    input.member.mandate,
    MISSION,
    "",
    "Give your OPENING position on the matter before the board — through your domain lens, grounded in the context and today's market. Take a clear, decisive stance. 2–4 tight paragraphs. No hedging, no throat-clearing, no filler.",
  ].join("\n");
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    system,
    messages: [{ role: "user", content: `Matter before the board:\n${input.question}\n\nContext:\n${input.context}`.slice(0, 12000) }],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

export async function boardRebuttal(input: {
  member: MemberRef;
  company: string;
  context: string;
  question: string;
  openings: { name: string; role: string; content: string }[];
}): Promise<string> {
  const client = getAnthropic();
  const system = [
    `You are ${input.member.name}, the ${input.member.role} voice on the board for ${input.company || "the company"}.`,
    input.member.mandate,
    MISSION,
    "",
    "You've heard the other members' opening positions. Now DEBATE: say where they're wrong, what they're missing, where you agree and want to push harder. Challenge them by name. This is a real boardroom argument — be pointed and specific. 1–3 tight paragraphs.",
  ].join("\n");
  const others = othersBlock(input.openings.filter((o) => o.name !== input.member.name));
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system,
    messages: [
      {
        role: "user",
        content: `Matter: ${input.question}\n\nThe other members opened with:\n\n${others}\n\nContext:\n${input.context}`.slice(0, 14000),
      },
    ],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

export interface BoardVerdict {
  verdict: string;
  disagreements: string[];
  recommendations: BoardRecommendation[];
  accountability: string;
}

export async function boardVerdict(input: {
  company: string;
  context: string;
  question: string;
  openings: { name: string; role: string; content: string }[];
  rebuttals: { name: string; role: string; content: string }[];
}): Promise<BoardVerdict> {
  const client = getAnthropic();
  const system = [
    `You are the Chair of the board of directors for ${input.company || "the company"}.`,
    MISSION,
    "",
    "You've heard the members' openings and their debate. Deliver the board's VERDICT. Be direct and hold the founder accountable — the verdict may be exactly what they don't want to hear. Bias to action.",
    "",
    'Respond with ONLY JSON, no markdown fences:',
    '{"verdict": string (the board\'s call, 1–3 paragraphs), "disagreements": string[] (0–4 short lines where the board genuinely split), "recommendations": [{"title": string, "detail": string}] (3–6 concrete next moves, most important first, action-oriented), "accountability": string (1–2 sentences: what the founder must own and be measured on now)}',
  ].join("\n");
  const openings = othersBlock(input.openings);
  const rebuttals = othersBlock(input.rebuttals);
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1600,
    system,
    messages: [
      {
        role: "user",
        content:
          `Matter: ${input.question}\n\nOPENINGS:\n${openings}\n\nDEBATE:\n${rebuttals}\n\nContext:\n${input.context}`.slice(
            0,
            18000,
          ),
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const fallback: BoardVerdict = { verdict: text.slice(0, 2000), disagreements: [], recommendations: [], accountability: "" };
  if (start === -1 || end === -1) return fallback;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return fallback;
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, 6) : [];
  const recs = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .map((r) => (r ?? {}) as Record<string, unknown>)
        .map((r) => ({ title: str(r.title), detail: str(r.detail) }))
        .filter((r) => r.title)
        .slice(0, 6)
    : [];
  return {
    verdict: str(parsed.verdict) || fallback.verdict,
    disagreements: strArr(parsed.disagreements),
    recommendations: recs,
    accountability: str(parsed.accountability),
  };
}
