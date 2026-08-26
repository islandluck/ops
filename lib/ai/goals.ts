import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import type { GoalSuggestion, GoalTarget } from "@/lib/types";

/**
 * Propose goals for the Command Center — the Executive suggesting next goals grounded
 * in the business context, active projects, and the founder's CURRENT goals (so it
 * complements rather than duplicates). Advisory only: the user accepts what they want.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
// "parking" intentionally omitted — the Parking Lot column was removed from the UI.
const TARGETS: GoalTarget[] = ["monthly", "weekly", "daily", "year", "future", "moonshot"];

export async function proposeGoals(input: {
  company: string;
  context: string;
  projects: string;
  currentGoals: string;
}): Promise<GoalSuggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI goal suggestions aren't configured (ANTHROPIC_API_KEY missing).");

  const client = getAnthropic();
  const system = [
    `You are a sharp startup chief-of-staff proposing concrete goals for ${input.company || "the company"}.`,
    input.context ? `Business context: ${input.context}` : "",
    input.projects ? `Active projects in flight: ${input.projects}` : "",
    input.currentGoals
      ? `The founder's CURRENT goals — do NOT repeat these; propose complementary or next-step goals:\n${input.currentGoals}`
      : "The founder hasn't written any goals yet.",
    "",
    "Propose 6–10 SHORT goal bullets spread across these targets (skip a target if you have nothing strong):",
    "- monthly: this month's objectives   - weekly: this week's focus   - daily: near-term actions",
    "- parking: ideas to revisit later   - year: 12-month goals   - future: 2–3 year goals   - moonshot: the big dream",
    "Each bullet: a few words to one line, action-oriented, SPECIFIC to this business (never generic filler).",
    "",
    'Respond with ONLY a JSON array — no markdown, no code fences:',
    '[{"target": "monthly|weekly|daily|parking|year|future|moonshot", "text": string}]',
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: "Propose the goals now." }],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => (r ?? {}) as Record<string, unknown>)
    .filter((r) => typeof r.text === "string" && (TARGETS as string[]).includes(r.target as string))
    .map((r) => ({ target: r.target as GoalTarget, text: (r.text as string).trim().slice(0, 200) }))
    .filter((s) => s.text)
    .slice(0, 12);
}
