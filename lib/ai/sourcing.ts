import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";
import type { TavilyResult } from "@/lib/integrations/tavily";

/**
 * Quote sourcing AI — distills web-search results into real SUPPLIERS of a
 * product/service (never invented), and drafts a professional request-for-quote
 * email. Draft only: RFQs are staged in the Email Manager for the owner to send.
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

export interface SupplierLead {
  company: string;
  website: string | null;
  /** A real contact/sales email ONLY if one was actually found (never guessed). */
  contact_email: string | null;
  /** The supplier's "request a quote"/contact-page URL, when there's no email. */
  contact_url: string | null;
  note: string;
}

/** Coerce a model's `{suppliers:[...]}` JSON into clean SupplierLead[] (max 8). */
function coerceLeads(obj: Record<string, unknown> | null): SupplierLead[] {
  if (!obj) return [];
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const nstr = (v: unknown): string | null => {
    const s = str(v).trim();
    return s && s.toLowerCase() !== "null" ? s : null;
  };
  const raw = Array.isArray(obj.suppliers) ? (obj.suppliers as Record<string, unknown>[]) : [];
  return raw
    .map((s) => ({
      company: str(s.company).trim().slice(0, 160),
      website: nstr(s.website)?.slice(0, 300) ?? null,
      contact_email: nstr(s.contact_email)?.slice(0, 200) ?? null,
      contact_url: nstr(s.contact_url)?.slice(0, 500) ?? null,
      note: str(s.note).trim().slice(0, 300),
    }))
    .filter((s) => s.company.length > 0)
    .slice(0, 8);
}

export async function distillSuppliers(input: {
  query: string;
  spec: string;
  brief: { company_name: string; business_description: string };
  results: TavilyResult[];
}): Promise<SupplierLead[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  if (!input.results.length) return [];
  const client = getAnthropic();

  const system = [
    `You help ${input.brief.company_name || "a company"} find SUPPLIERS to request a quote from, using web-search results.`,
    "From the results, extract real companies that actually SUPPLY or manufacture the requested product/service — vendors you could email for a quote. Prefer the supplier's own site over directories/marketplaces/articles.",
    "For each: company (the real name), website (their homepage URL from the results), contact_email (ONLY if a real sales/contact/quote email is visibly present in the result text — otherwise null; NEVER guess or invent an address), note (one line on what they offer / why they fit).",
    "HARD RULES: only real companies present in the results. NEVER invent company names, URLs, or emails. Skip results that aren't a specific supplier. At most 8.",
    "",
    'Respond with ONLY this JSON (no fences): {"suppliers": [{"company": string, "website": string|null, "contact_email": string|null, "note": string}]}',
  ].join("\n");

  const resultsBlock = input.results
    .slice(0, 12)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 600)}`)
    .join("\n\n");

  const userMsg = [
    `Looking for suppliers of: ${input.query}`,
    input.spec ? `Spec/details: ${input.spec}` : "",
    "",
    "# Web search results",
    resultsBlock,
    "",
    "Extract the suppliers now.",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({ model: MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: userMsg }] });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return coerceLeads(parseJsonObject(text));
}

// allowed_callers:["direct"] is REQUIRED: these server tools default to requiring
// "programmatic tool calling", which models like Haiku 4.5 don't support — without
// it the request 400s. "direct" lets any model invoke the tool directly.
const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8, allowed_callers: ["direct" as const] };
const WEB_FETCH_TOOL = { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 10, allowed_callers: ["direct" as const] };

/**
 * Primary supplier sourcing — Claude's native web-search + web-fetch tools. Claude
 * drives its OWN queries using its knowledge of the sector (so it surfaces the
 * recognized market leaders, not whatever a single keyword query ranks first),
 * then OPENS each supplier's own contact / "request a quote" page to pin down a
 * REAL published email — or, when there's no email (common for large suppliers who
 * only take RFQs via a web form), the URL of that form. Never guesses or invents a
 * company, URL, or address. Throws if the web tools are unavailable.
 */
export async function searchSuppliers(input: {
  query: string;
  spec: string;
  brief: { company_name: string; business_description: string };
}): Promise<SupplierLead[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();

  const system = [
    `You are a procurement researcher helping ${input.brief.company_name || "a company"} find SUPPLIERS to request a quote from.`,
    input.brief.business_description ? `About the buyer: ${input.brief.business_description}` : "",
    "Use web_search to find real companies that manufacture or supply the requested product/service, then use web_fetch to OPEN each promising supplier's own site — their 'Contact', 'Contact sales', or 'Request a quote' page — to pin down how to reach them for a quote.",
    "PRIORITIZE established, reputable, recognized suppliers — the known industry leaders for this category, anywhere in the world. Start from the leading names you already know, then search/fetch to confirm each one's current official homepage.",
    "HARD EXCLUSIONS: skip B2B marketplaces and directories (Alibaba, Made-in-China, GlobalSources, IndiaMART, ThomasNet listing pages, Amazon, eBay, DHgate), lead-gen/aggregator pages, blog/news articles, and anonymous or no-name resellers. Prefer the manufacturer's OWN website.",
    "For each supplier, determine how to request a quote:",
    "- contact_email: a REAL sales/quote/contact email you ACTUALLY SAW on their page or in a result. NEVER guess, construct, pattern-match, or invent an address (no 'sales@domain' guessing). If you did not see a real address, set it null.",
    "- contact_url: when there is no published email, the URL of their 'Request a quote' / 'Contact sales' / 'Contact us' page (where a person would submit an RFQ form). Many large suppliers only take quotes via a web form — capture that URL.",
    "Also give: company (real name), website (official homepage), note (one line on what they offer / why they fit).",
    "Find 5-8 strong suppliers. Only real companies you verified. Prefer a real email; otherwise a form URL; a supplier may have one, the other, or (rarely) neither.",
    "",
    'When done, respond with ONLY this JSON (no prose, no fences): {"suppliers": [{"company": string, "website": string|null, "contact_email": string|null, "contact_url": string|null, "note": string}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = [
    `Find suppliers of: ${input.query}`,
    input.spec ? `Spec/requirements: ${input.spec}` : "",
    "",
    "Research now (search, then open contact pages), then return the JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  // Server tools run inline; a long turn may return stop_reason "pause_turn" — feed
  // the partial turn back to continue. Returns the final assistant text.
  const runWithTools = async (tools: Anthropic.Messages.ToolUnion[]): Promise<string> => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];
    let text = "";
    for (let i = 0; i < 6; i++) {
      const msg = await client.messages.create({ model: MODEL, max_tokens: 4000, system, tools, messages });
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
  // quality by retrying with search only (rather than dropping to the Tavily path).
  let text: string;
  try {
    text = await runWithTools([WEB_SEARCH_TOOL, WEB_FETCH_TOOL]);
  } catch {
    text = await runWithTools([WEB_SEARCH_TOOL]);
  }
  return coerceLeads(parseJsonObject(text));
}

export async function draftRfqEmail(input: {
  company: string;
  request: { title: string; spec: string };
  brief: { company_name: string; business_description: string };
  senderName: string;
}): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const me = input.brief.company_name || "our company";

  const system = [
    `You write concise, professional request-for-quote (RFQ) emails on behalf of ${me} (sender: ${input.senderName || me}).`,
    input.brief.business_description ? `About us: ${input.brief.business_description}` : "",
    `Write an RFQ to ${input.company}. Briefly introduce who we are (one line), clearly state we'd like a quote for the item below, include the key specs/requirements, and ask for: price, lead time, and any minimums or terms. Polite, direct, 5-8 sentences. A clear subject line.`,
    "Do NOT invent specs, quantities, budgets, deadlines, or facts beyond what's given. Plain email prose (no markdown). Sign off from " + (input.senderName || me) + ".",
    "",
    'Respond with ONLY this JSON (no fences): {"subject": string, "body": string}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = [
    `Supplier: ${input.company}`,
    `We want a quote for: ${input.request.title}`,
    input.request.spec ? `Spec/requirements: ${input.request.spec}` : "",
    "",
    "Write the RFQ email now.",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: userMsg }] });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const obj = parseJsonObject(text);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    subject: (obj && str(obj.subject).trim().slice(0, 200)) || `Request for quote — ${input.request.title}`,
    body: (obj && str(obj.body).trim().slice(0, 4000)) || "",
  };
}
