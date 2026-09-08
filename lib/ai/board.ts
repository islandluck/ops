import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import { DEFAULT_BOARD_GOAL } from "@/lib/constants";
import type { BoardRecommendation } from "@/lib/types";

/**
 * The Boardroom's debate engine. Each member speaks in their own voice (opening →
 * rebuttal), then the Chair synthesizes a verdict. The mission is the workspace's
 * own goal (default: a $10B valuation, fast); the fixed board character below keeps
 * it VC-caliber, direct, and accountable regardless of the goal.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/** The board's mission preamble = the workspace's goal + the fixed board character. */
export function buildMission(goal: string): string {
  return [
    `The board's single mission: ${(goal || DEFAULT_BOARD_GOAL).trim()}`,
    "You carry the collective wisdom of the best blue-chip VC partners in your domain.",
    "Be direct and specific. Have a spine — take positions that may be counter to what the founder wants to hear.",
    "Bias hard toward action over analysis. Hold the founder accountable for results, not effort.",
    "Never invent facts, numbers, funding rounds, or competitors that aren't in the context or the market intel.",
  ].join(" ");
}

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
  mission: string;
}): Promise<string> {
  const client = getAnthropic();
  const system = [
    `You are ${input.member.name}, the ${input.member.role} voice on the board of directors for ${input.company || "the company"}.`,
    input.member.mandate,
    input.mission,
    "",
    "Give your OPENING position on the matter before the board — through your domain lens, grounded in the context and today's market. Take a clear, decisive stance. 2–4 tight paragraphs. No hedging, no throat-clearing, no filler.",
  ].join("\n");
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1600,
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
  mission: string;
}): Promise<string> {
  const client = getAnthropic();
  const system = [
    `You are ${input.member.name}, the ${input.member.role} voice on the board for ${input.company || "the company"}.`,
    input.member.mandate,
    input.mission,
    "",
    "You've heard the other members' opening positions. Now DEBATE: say where they're wrong, what they're missing, where you agree and want to push harder. Challenge them by name. This is a real boardroom argument — be pointed and specific. 1–3 tight paragraphs.",
  ].join("\n");
  const others = othersBlock(input.openings.filter((o) => o.name !== input.member.name));
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1400,
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
  founderInput?: string;
  mission: string;
}): Promise<BoardVerdict> {
  const client = getAnthropic();
  const system = [
    `You are the Chair of the board of directors for ${input.company || "the company"}.`,
    input.mission,
    "",
    "You've heard the members' openings and their debate. Deliver the board's VERDICT. Be direct and hold the founder accountable — the verdict may be exactly what they don't want to hear. Bias to action.",
    input.founderInput
      ? "The founder responded to the debate (below). Weigh it seriously and correct your assumptions where they clearly have better information — but do NOT simply capitulate. If they're wrong, rationalizing, or dodging, say so directly."
      : "",
    "",
    'Respond with ONLY JSON, no markdown fences:',
    '{"verdict": string (the board\'s call, 1–3 paragraphs), "disagreements": string[] (0–4 short lines where the board genuinely split), "recommendations": [{"title": string, "detail": string}] (3–6 concrete next moves, most important first, action-oriented), "accountability": string (1–2 sentences: what the founder must own and be measured on now)}',
  ]
    .filter(Boolean)
    .join("\n");
  const openings = othersBlock(input.openings);
  const rebuttals = othersBlock(input.rebuttals);
  const founder = input.founderInput ? `\n\nTHE FOUNDER RESPONDED TO THE DEBATE:\n${input.founderInput}` : "";
  const msg = await client.messages.create({
    model: MODEL,
    // Generous headroom: a full verdict + disagreements + recommendations must
    // never truncate (a cut-off JSON blob is what broke rendering before).
    max_tokens: 4000,
    system,
    messages: [
      {
        role: "user",
        content:
          `Matter: ${input.question}\n\nOPENINGS:\n${openings}\n\nDEBATE:\n${rebuttals}${founder}\n\nContext:\n${input.context}`.slice(
            0,
            18000,
          ),
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  // If the JSON ever fails to parse, salvage the verdict prose (never dump raw,
  // fenced, or truncated JSON at the founder).
  const salvage = (): BoardVerdict => {
    const m = text.match(/"verdict"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const verdict = m
      ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    return { verdict, disagreements: [], recommendations: [], accountability: "" };
  };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return salvage();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return salvage();
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
    verdict: str(parsed.verdict) || salvage().verdict,
    disagreements: strArr(parsed.disagreements),
    recommendations: recs,
    accountability: str(parsed.accountability),
  };
}

export interface BoardDiscussReply {
  /** The Chair's response to the founder (always present). */
  reply: string;
  /** True when the founder's point changed the board's call → the verdict fields below apply. */
  revised: boolean;
  verdict?: string;
  disagreements?: string[];
  recommendations?: BoardRecommendation[];
  accountability?: string;
}

/**
 * Post-verdict discussion. The founder pushes back on / questions / corrects the
 * board's verdict; the Chair answers for the board — and, only when the founder has
 * surfaced a genuine error or new information, REVISES the verdict. Pressure alone is
 * never enough to move it.
 */
export async function boardDiscuss(input: {
  company: string;
  context: string;
  question: string;
  openings: { name: string; role: string; content: string }[];
  rebuttals: { name: string; role: string; content: string }[];
  verdict: string;
  disagreements: string[];
  recommendations: BoardRecommendation[];
  accountability: string;
  thread: { role: "founder" | "board"; content: string }[];
  message: string;
  mission: string;
}): Promise<BoardDiscussReply> {
  const client = getAnthropic();
  const system = [
    `You are the Chair of the board of directors for ${input.company || "the company"}.`,
    input.mission,
    "",
    "The board already deliberated and you delivered the verdict below. The founder is now discussing it with you — pushing back, adding context, or pointing out a mistake. Answer AS THE CHAIR, speaking for the board: address their point head-on, with a spine.",
    "If they've surfaced a GENUINE error or new information that changes the right call, REVISE the verdict and say what changed and why. If they're applying pressure, rationalizing, or dodging, hold the board's position and tell them so directly. Do NOT capitulate just because they disagree. Never invent facts.",
    "",
    "Respond with ONLY JSON, no markdown fences:",
    '{"reply": string (the Chair\'s response to the founder, 1–3 tight paragraphs), "revise": boolean, "verdict": string (REQUIRED only if revise=true — the full updated verdict, 1–3 paragraphs), "disagreements": string[] (0–4 lines, only if revise=true), "recommendations": [{"title": string, "detail": string}] (3–6 concrete next moves, only if revise=true), "accountability": string (only if revise=true)}',
  ]
    .filter(Boolean)
    .join("\n");

  const recsText = input.recommendations.map((r, i) => `${i + 1}. ${r.title}${r.detail ? ` — ${r.detail}` : ""}`).join("\n");
  const threadText = input.thread
    .map((t) => `${t.role === "founder" ? "FOUNDER" : "CHAIR"}: ${t.content}`)
    .join("\n\n");
  const priorVerdict = [
    `VERDICT:\n${input.verdict}`,
    input.disagreements.length ? `WHERE THE BOARD SPLIT:\n- ${input.disagreements.join("\n- ")}` : "",
    recsText ? `RECOMMENDATIONS:\n${recsText}` : "",
    input.accountability ? `ACCOUNTABILITY:\n${input.accountability}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [
      {
        role: "user",
        content: `Matter: ${input.question}\n\nTHE BOARD'S CURRENT POSITION:\n${priorVerdict}${
          threadText ? `\n\nDISCUSSION SO FAR:\n${threadText}` : ""
        }\n\nTHE FOUNDER NOW SAYS:\n${input.message}\n\nContext:\n${input.context}`.slice(0, 20000),
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

  const salvage = (): BoardDiscussReply => {
    const m = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const reply = m
      ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    return { reply: reply || "The board stands by its verdict.", revised: false };
  };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return salvage();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return salvage();
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const strArr = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, 6) : []);
  const reply = str(parsed.reply) || salvage().reply;
  const revised = parsed.revise === true && str(parsed.verdict).length > 0;
  if (!revised) return { reply, revised: false };
  const recs = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .map((r) => (r ?? {}) as Record<string, unknown>)
        .map((r) => ({ title: str(r.title), detail: str(r.detail) }))
        .filter((r) => r.title)
        .slice(0, 6)
    : [];
  return {
    reply,
    revised: true,
    verdict: str(parsed.verdict),
    disagreements: strArr(parsed.disagreements),
    recommendations: recs,
    accountability: str(parsed.accountability),
  };
}

export interface BoardScanAlert {
  member_role: string;
  severity: "info" | "attention" | "urgent";
  title: string;
  detail: string;
  action: string;
}

/**
 * The board's standing autonomous scan. Given the company's state + today's market
 * intel, raise ONLY genuinely material, dot-connecting findings — or nothing. One
 * call (kept cheap so it can run on a cadence). Attributes each to a member's role.
 */
export async function boardScan(input: {
  company: string;
  context: string;
  roles: string[];
  mission: string;
}): Promise<BoardScanAlert[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const client = getAnthropic();
  const roleList = input.roles.join(", ");
  const system = [
    `You are the collective board of directors for ${input.company || "the company"}, doing your standing market scan.`,
    input.mission,
    "",
    "You've reviewed the company's current state and today's market intel (below). Raise ONLY genuinely material, non-obvious findings that connect dots the founder likely can't see — a competitor's move, a market shift, a metric that should alarm someone, a time-sensitive opening, or a real risk to the mission.",
    `If nothing is genuinely material, raise NOTHING (an empty array). Never manufacture noise. At most 3, most urgent first. Attribute each to the member whose domain it is — one of: ${roleList}.`,
    "",
    'Respond with ONLY JSON, no fences: {"alerts": [{"member_role": one of the roles above, "severity": "info"|"attention"|"urgent", "title": short punchy line, "detail": 1–2 sentences (the finding + why it matters now), "action": one concrete next step}]}',
  ].join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1400,
    system,
    messages: [{ role: "user", content: `Company state + today's market intel:\n${input.context}`.slice(0, 16000) }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  let parsed: { alerts?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { alerts?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.alerts)) return [];
  const sev = new Set(["info", "attention", "urgent"]);
  const roles = new Set(input.roles);
  return parsed.alerts
    .map((a) => (a ?? {}) as Record<string, unknown>)
    .map((a) => ({
      member_role: typeof a.member_role === "string" && roles.has(a.member_role) ? a.member_role : "strategy",
      severity: (typeof a.severity === "string" && sev.has(a.severity) ? a.severity : "attention") as BoardScanAlert["severity"],
      title: typeof a.title === "string" ? a.title.trim().slice(0, 200) : "",
      detail: typeof a.detail === "string" ? a.detail.trim().slice(0, 800) : "",
      action: typeof a.action === "string" ? a.action.trim().slice(0, 400) : "",
    }))
    .filter((a) => a.title)
    .slice(0, 3);
}
