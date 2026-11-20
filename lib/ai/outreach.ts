import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";

/**
 * Outreach AI — finds real companies that fit an outreach idea, then the right
 * decision-maker at each (by target role) using Claude's native web search + fetch,
 * and drafts a personalized outreach email. Draft only: emails are staged in the
 * Email Manager for the owner to review + send. Never fabricates a company, person,
 * or email address.
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

export interface OutreachLead {
  company: string;
  website: string | null;
  /** The named decision-maker, when one was actually found (else empty). */
  person_name: string;
  /** Their role/title at the company. */
  title: string;
  /** A real personal/role email ONLY if one was actually found (never guessed). */
  contact_email: string | null;
  /** The person's LinkedIn profile or the company's contact page, when there's no email. */
  contact_url: string | null;
  note: string;
}

/** Coerce a model's `{contacts:[...]}` JSON into clean OutreachLead[] (max 10). */
function coerceContacts(obj: Record<string, unknown> | null): OutreachLead[] {
  if (!obj) return [];
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const nstr = (v: unknown): string | null => {
    const s = str(v).trim();
    return s && s.toLowerCase() !== "null" ? s : null;
  };
  const raw = Array.isArray(obj.contacts) ? (obj.contacts as Record<string, unknown>[]) : [];
  return raw
    .map((s) => ({
      company: str(s.company).trim().slice(0, 160),
      website: nstr(s.website)?.slice(0, 300) ?? null,
      person_name: str(s.person_name).trim().slice(0, 120),
      title: str(s.title).trim().slice(0, 160),
      contact_email: nstr(s.contact_email)?.slice(0, 200) ?? null,
      contact_url: nstr(s.contact_url)?.slice(0, 500) ?? null,
      note: str(s.note).trim().slice(0, 300),
    }))
    .filter((s) => s.company.length > 0)
    .slice(0, 10);
}

// allowed_callers:["direct"] is REQUIRED: these server tools default to requiring
// "programmatic tool calling", which models like Haiku 4.5 don't support — without
// it the request 400s. "direct" lets any model invoke the tool directly.
const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 10, allowed_callers: ["direct" as const] };
const WEB_FETCH_TOOL = { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 12, allowed_callers: ["direct" as const] };

/**
 * Primary contact sourcing — Claude's native web search + fetch. Claude finds real
 * companies that fit the outreach idea, then opens each company's leadership / team /
 * "about" page to identify the right decision-maker for the target roles, then tries
 * to pin down that person's REAL email (or, failing that, their LinkedIn profile or
 * the company's contact page). Never guesses or invents a company, person, or address.
 * Throws if the web tools are unavailable.
 */
export async function searchContacts(input: {
  idea: string;
  description: string;
  targetRoles: string;
  count: number;
  brief: { company_name: string; business_description: string };
  exclude?: string[];
}): Promise<OutreachLead[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const n = Math.max(1, Math.min(input.count || 5, 15));
  const roles = input.targetRoles.trim() || "the most senior relevant decision-maker (business development, partnerships, or operations)";

  const system = [
    `You are a business-development researcher helping ${input.brief.company_name || "a company"} find the right people to reach out to.`,
    input.brief.business_description ? `About the sender: ${input.brief.business_description}` : "",
    `The outreach goal: ${input.idea}.`,
    input.description ? `Context / pitch: ${input.description}` : "",
    "",
    "Do this in order:",
    "1. Use web_search to find real, reputable companies that genuinely fit this outreach goal — the recognized names in the relevant industry, anywhere in the world. Skip directories, marketplaces, aggregators, listicles, and no-name resellers.",
    `2. For each company, use web_search + web_fetch to OPEN its leadership / team / "about us" / contact page and identify the single best person to contact for this goal, matching these target roles: ${roles}. Capture their real name and exact title.`,
    "3. Find how to reach that person:",
    "   - contact_email: a REAL email you ACTUALLY SAW on their page / in a result (personal, or a department inbox they clearly own). NEVER guess, construct, pattern-match, or invent an address (no 'first.last@domain' guessing). If you did not see a real address, set it null.",
    "   - contact_url: when there's no published email, their LinkedIn profile URL, or the company's 'Contact us' page where this person could be reached. Capture the most direct one you found.",
    "Also give: company (real name), website (official homepage), person_name (may be empty if you truly could not identify a person), title, note (one line on why this company/person fits).",
    `Find ${n} strong contacts. Only real companies and real people you verified. A contact may have an email, a profile/contact URL, or (rarely) neither — still include the company + person so the user can follow up.`,
    input.exclude && input.exclude.length
      ? `Do NOT return any of these companies (already in the pipeline): ${input.exclude.slice(0, 60).join(", ")}.`
      : "",
    "",
    'When done, respond with ONLY this JSON (no prose, no fences): {"contacts": [{"company": string, "website": string|null, "person_name": string, "title": string, "contact_email": string|null, "contact_url": string|null, "note": string}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = [
    `Outreach goal: ${input.idea}`,
    input.description ? `Context: ${input.description}` : "",
    `Target roles: ${roles}`,
    "",
    "Research now (search, then open leadership/contact pages), then return the JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  // Server tools run inline; a long turn may return stop_reason "pause_turn" — feed
  // the partial turn back to continue. Returns the final assistant text.
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

  // Prefer search + fetch; if web_fetch isn't enabled on the key, keep the search
  // quality by retrying with search only.
  let text: string;
  try {
    text = await runWithTools([WEB_SEARCH_TOOL, WEB_FETCH_TOOL]);
  } catch {
    text = await runWithTools([WEB_SEARCH_TOOL]);
  }
  return coerceContacts(parseJsonObject(text));
}

/** Draft a personalized outreach email to one contact → the caller stages/sends it. */
export async function draftOutreachEmail(input: {
  company: string;
  personName: string;
  title: string;
  campaign: { idea: string; description: string };
  brief: { company_name: string; business_description: string };
  senderName: string;
}): Promise<{ subject: string; body: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const me = input.brief.company_name || "our company";
  const who = input.personName ? `${input.personName}${input.title ? `, ${input.title}` : ""} at ${input.company}` : input.company;

  const system = [
    `You write concise, genuine B2B outreach emails on behalf of ${me} (sender: ${input.senderName || me}).`,
    input.brief.business_description ? `About us: ${input.brief.business_description}` : "",
    `Write a first-touch outreach email to ${who}.`,
    `The goal of this outreach: ${input.campaign.idea}.`,
    input.campaign.description ? `Context / what we want to convey: ${input.campaign.description}` : "",
    "Open with one specific, genuine line on why THEM / their company (grounded only in what's given — never invent a fact, metric, mutual contact, or prior conversation). Introduce who we are in one line, state clearly why we're reaching out and the specific ask, and end with a low-friction call to action (e.g. a short intro call). Warm, direct, respectful of their time: 5-8 sentences.",
    "Do NOT fabricate specifics, numbers, deadlines, or relationships. Plain email prose (no markdown). Sign off from " + (input.senderName || me) + ".",
    "",
    'Respond with ONLY this JSON (no fences): {"subject": string, "body": string}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = [
    `Recipient: ${who}`,
    `Our outreach goal: ${input.campaign.idea}`,
    input.campaign.description ? `Context: ${input.campaign.description}` : "",
    "",
    "Write the outreach email now.",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: userMsg }] });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const obj = parseJsonObject(text);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    subject: (obj && str(obj.subject).trim().slice(0, 200)) || `${me} — ${input.campaign.idea}`.slice(0, 200),
    body: (obj && str(obj.body).trim().slice(0, 4000)) || "",
  };
}
