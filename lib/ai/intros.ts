import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";

/**
 * Warm-intro AI — for a target VC, finds the portfolio companies closest to us and their
 * founders (Claude native web search + fetch), and drafts a warm first-touch email asking
 * a portfolio founder for a short call. Draft only; nothing sends. Never invents a company,
 * person, email, or a relationship that wasn't given. Server-only.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// allowed_callers:["direct"] is REQUIRED — these server tools otherwise demand
// "programmatic tool calling" (unsupported on Haiku) and the request 400s.
const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 10, allowed_callers: ["direct" as const] };
const WEB_FETCH_TOOL = { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 12, allowed_callers: ["direct" as const] };

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const o = JSON.parse(c);
      if (o && typeof o === "object") return o as Record<string, unknown>;
    } catch {
      /* next */
    }
  }
  return null;
}

export interface PortfolioFounder {
  company: string;
  website: string | null;
  founder_name: string;
  founder_title: string;
  /** A REAL published email if one was actually seen — never guessed. Else null (Hunter resolves it). */
  founder_email: string | null;
  /** One line on why this portfolio company is close to us. */
  relevance: string;
  /** 0-100 similarity to us. */
  relevance_score: number | null;
}

function coerceFounders(obj: Record<string, unknown> | null): PortfolioFounder[] {
  if (!obj) return [];
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const nstr = (v: unknown): string | null => {
    const s = str(v).trim();
    return s && s.toLowerCase() !== "null" ? s : null;
  };
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  };
  const raw = Array.isArray(obj.founders) ? (obj.founders as Record<string, unknown>[]) : [];
  return raw
    .map((s) => ({
      company: str(s.company).trim().slice(0, 160),
      website: nstr(s.website)?.slice(0, 300) ?? null,
      founder_name: str(s.founder_name).trim().slice(0, 120),
      founder_title: str(s.founder_title).trim().slice(0, 160),
      founder_email: nstr(s.founder_email)?.slice(0, 200) ?? null,
      relevance: str(s.relevance).trim().slice(0, 400),
      relevance_score: num(s.relevance_score),
    }))
    .filter((s) => s.company.length > 0)
    .slice(0, 10);
}

/**
 * Find the portfolio companies of a VC that are closest to us, and their founders. Ranks by
 * genuine similarity (sector / stage / thesis), returns a relevance line + score for each.
 */
export async function findPortfolioFounders(input: {
  vcFirm: string;
  brief: { company_name: string; business_description: string };
  count: number;
  exclude?: string[];
}): Promise<PortfolioFounder[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const n = Math.max(1, Math.min(input.count || 3, 8));
  const me = input.brief.company_name || "our company";

  const system = [
    `You help ${me} find WARM-INTRO paths into the VC firm "${input.vcFirm}".`,
    input.brief.business_description ? `About us (the company seeking intros): ${input.brief.business_description}` : "",
    "",
    "A warm intro is far more valuable than a cold one. The play: find a founder in this VC's",
    "portfolio whose company is genuinely similar to us — they can later introduce us to the VC.",
    "",
    "Do this in order:",
    `1. Use web_search + web_fetch to find "${input.vcFirm}"'s actual portfolio companies (their own portfolio page, Crunchbase, press). Only real companies they actually backed.`,
    `2. Rank those portfolio companies by how CLOSE they are to ${me} — same sector, technology, stage, or thesis. Pick the ${n} closest.`,
    "3. For each, open the company's team/about page to find the FOUNDER or CEO — real name + exact title.",
    "4. founder_email: include ONLY a real address you actually SAW published — never guess, construct, or pattern-match one. Else null.",
    "",
    "Give for each: company (real name), website (official homepage, for email lookup), founder_name, founder_title, founder_email (or null), relevance (one specific line on why this company is close to us), relevance_score (0-100 similarity to us).",
    `Return the ${n} closest matches. Only real companies this VC actually backed and real founders you verified. Never invent a company, person, or email.`,
    input.exclude && input.exclude.length ? `Skip these (already found): ${input.exclude.slice(0, 40).join(", ")}.` : "",
    "",
    'Respond with ONLY this JSON (no prose, no fences): {"founders": [{"company": string, "website": string|null, "founder_name": string, "founder_title": string, "founder_email": string|null, "relevance": string, "relevance_score": number}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = `Find ${n} portfolio founders at ${input.vcFirm} closest to ${me}. Research now (portfolio page + each company's team page), then return the JSON.`;

  const runWithTools = async (tools: Anthropic.Messages.ToolUnion[]): Promise<string> => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];
    let text = "";
    for (let i = 0; i < 8; i++) {
      const msg = await client.messages.create({ model: MODEL, max_tokens: 4500, system, tools, messages });
      text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      break;
    }
    return text;
  };

  let text: string;
  try {
    text = await runWithTools([WEB_SEARCH_TOOL, WEB_FETCH_TOOL]);
  } catch {
    text = await runWithTools([WEB_SEARCH_TOOL]);
  }
  return coerceFounders(parseJsonObject(text));
}

/**
 * Draft a warm first-touch email from us to a portfolio founder, asking for a SHORT CALL to
 * connect (not a blunt intro ask — rapport first; the VC intro comes later). Grounded only in
 * what's given: never fabricate a mutual contact, metric, or prior conversation.
 */
export async function draftIntroRequest(input: {
  founderName: string;
  founderTitle: string;
  portfolioCompany: string;
  vcFirm: string;
  brief: { company_name: string; business_description: string };
  senderName: string;
}): Promise<{ subject: string; body: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const me = input.brief.company_name || "our company";
  const who = input.founderName
    ? `${input.founderName}${input.founderTitle ? `, ${input.founderTitle}` : ""} at ${input.portfolioCompany}`
    : `the founder of ${input.portfolioCompany}`;

  const system = [
    `You write warm, concise, genuine founder-to-founder emails on behalf of ${me} (sender: ${input.senderName || me}).`,
    input.brief.business_description ? `About us: ${input.brief.business_description}` : "",
    `Write a first-touch email to ${who}.`,
    `Context: ${input.portfolioCompany} is a portfolio company of ${input.vcFirm}, and we're raising and exploring working with ${input.vcFirm}.`,
    "The goal of THIS email is to open a genuine founder-to-founder relationship and ask for a SHORT CALL to connect —",
    `NOT to bluntly ask them to introduce us to ${input.vcFirm} in this first email. The intro can come naturally after rapport.`,
    "Open with one specific, genuine line on why their company / journey resonates with us (grounded only in what's given — never invent a fact, metric, mutual contact, or prior conversation).",
    `Introduce who we are in one line, note briefly that we admire ${input.vcFirm}'s portfolio (which is how we found them), and ask for a brief 15-minute call to connect founder-to-founder. Warm, peer-to-peer, respectful of their time: 5-7 sentences.`,
    "Do NOT ask outright for an introduction in this email. Do NOT fabricate specifics, numbers, deadlines, or relationships. Plain email prose (no markdown). Sign off from " + (input.senderName || me) + ".",
    "",
    'Respond with ONLY this JSON (no fences): {"subject": string, "body": string}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = `Recipient: ${who} (portfolio company of ${input.vcFirm}). Write the warm founder-to-founder email asking for a short call. Return the JSON.`;

  const msg = await client.messages.create({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: userMsg }] });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const obj = parseJsonObject(text);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    subject: (obj && str(obj.subject).trim().slice(0, 200)) || `${me} — would love to connect`.slice(0, 200),
    body: (obj && str(obj.body).trim().slice(0, 4000)) || "",
  };
}
