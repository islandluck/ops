import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";

/**
 * CRM intelligence — drafts a contextual follow-up email for a going-cold deal
 * (grounded only in the real timeline, never fabricated) and enriches a company from
 * the live web. Draft only: follow-ups are staged in the Email Manager to approve + send.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

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

/** Draft a warm, specific follow-up for a stalled deal. Caller stages it in Email Manager. */
export async function draftFollowupEmail(input: {
  company: string;
  personName: string;
  title: string;
  deal: { title: string; stage: string; amount: number | null };
  recentActivity: string[];
  brief: { company_name: string; business_description: string };
  senderName: string;
}): Promise<{ subject: string; body: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const me = input.brief.company_name || "our company";
  const who = input.personName ? `${input.personName}${input.title ? `, ${input.title}` : ""} at ${input.company}` : input.company;

  const system = [
    `You write brief, genuine follow-up emails on behalf of ${me} (sender: ${input.senderName || me}).`,
    input.brief.business_description ? `About us: ${input.brief.business_description}` : "",
    `Write a follow-up to ${who} about the deal "${input.deal.title}" (currently at the "${input.deal.stage}" stage).`,
    "The goal: gently move it forward — check in, offer a next step (a quick call, answers to open questions), make it easy to reply. Reference the relationship only via the recent activity below; do NOT invent prior conversations, promises, numbers, or facts.",
    input.recentActivity.length ? `Recent activity (most recent first):\n- ${input.recentActivity.slice(0, 6).join("\n- ")}` : "No prior logged activity — keep it a light, no-pressure check-in.",
    "Warm, concise, respectful of their time: 4-6 sentences. Plain email prose (no markdown). Sign off from " + (input.senderName || me) + ".",
    "",
    'Respond with ONLY this JSON (no fences): {"subject": string, "body": string}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = `Draft the follow-up to ${who} about "${input.deal.title}".`;
  const msg = await client.messages.create({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: userMsg }] });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const obj = parseJsonObject(text);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    subject: (obj && str(obj.subject).trim().slice(0, 200)) || `Following up — ${input.deal.title}`.slice(0, 200),
    body: (obj && str(obj.body).trim().slice(0, 4000)) || "",
  };
}

// allowed_callers:["direct"] is REQUIRED so these server tools work on Haiku (this
// workspace's model) — without it the request 400s. See lib/ai/sourcing.ts.
const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 6, allowed_callers: ["direct" as const] };
const WEB_FETCH_TOOL = { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 6, allowed_callers: ["direct" as const] };

export interface CompanyEnrichment {
  industry: string;
  size: string;
  summary: string;
  website: string | null;
  domain: string | null;
}

/** Enrich a company from the live web — industry, rough size, a one-liner, official site. */
export async function enrichCompany(input: {
  name: string;
  website?: string | null;
}): Promise<CompanyEnrichment | null> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();

  const system = [
    `Research the company "${input.name}"${input.website ? ` (${input.website})` : ""} on the live web and summarize it factually.`,
    "Use web_search (and web_fetch on its official site) to confirm what it does. Report only what you actually find — never guess or invent. Leave a field empty if you can't verify it.",
    "Give: industry (a short sector label), size (rough employee count or band if stated, else ''), summary (one neutral sentence on what they do), website (official homepage), domain (bare domain like example.com).",
    "",
    'Respond with ONLY this JSON (no prose, no fences): {"industry": string, "size": string, "summary": string, "website": string|null, "domain": string|null}',
  ].join("\n");

  const runWithTools = async (tools: Anthropic.Messages.ToolUnion[]): Promise<string> => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Research ${input.name} now, then return the JSON.` }];
    let text = "";
    for (let i = 0; i < 5; i++) {
      const msg = await client.messages.create({ model: MODEL, max_tokens: 2000, system, tools, messages });
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
  const obj = parseJsonObject(text);
  if (!obj) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const nstr = (v: unknown): string | null => {
    const s = str(v);
    return s && s.toLowerCase() !== "null" ? s : null;
  };
  return {
    industry: str(obj.industry).slice(0, 120),
    size: str(obj.size).slice(0, 60),
    summary: str(obj.summary).slice(0, 400),
    website: nstr(obj.website)?.slice(0, 300) ?? null,
    domain: nstr(obj.domain)?.slice(0, 120) ?? null,
  };
}
