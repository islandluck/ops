import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";
import type { SourcingPick, SourcingResult, SourcingTrust } from "@/lib/types";

/**
 * Product-sourcing AI — a seasoned purchasing manager. Given "source me a ___", it
 * uses Claude's native web search + fetch to shop reputable retailers AND the user's
 * preferred avenues (eBay / Craigslist / auctions / a specific retailer), opens the
 * promising listings, and REASONS to a single best buy (best value + safe, not just
 * cheapest) with ranked alternatives and the trade-offs. It never buys — it recommends
 * and links the listing. Server-only.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// allowed_callers:["direct"] is REQUIRED — these server tools otherwise default to
// "programmatic tool calling", which models like Haiku 4.5 don't support (→ 400).
const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8, allowed_callers: ["direct" as const] };
const WEB_FETCH_TOOL = { type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: 10, allowed_callers: ["direct" as const] };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function nurl(v: unknown): string | null {
  const s = str(v).trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, 600) : null;
}

function trustOf(v: unknown): SourcingTrust {
  const s = str(v).trim().toLowerCase();
  if (s === "reputable" || s === "trusted" || s === "safe") return "reputable";
  if (s === "caution" || s === "risky" || s === "sketchy" || s === "unverified") return "caution";
  return "unknown";
}

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

function coercePick(v: unknown): SourcingPick | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const title = str(o.title).trim();
  if (!title) return null;
  return {
    title: title.slice(0, 200),
    price: str(o.price).trim().slice(0, 40),
    seller: str(o.seller).trim().slice(0, 120),
    url: nurl(o.url),
    shipping: str(o.shipping).trim().slice(0, 140),
    condition: str(o.condition).trim().slice(0, 60) || "New",
    trust: trustOf(o.trust),
    why: str(o.why).trim().slice(0, 400),
  };
}

function coerceResult(obj: Record<string, unknown> | null, fallbackText: string): SourcingResult {
  if (!obj) {
    // The model said something but not clean JSON — keep its reasoning as the headline.
    return { headline: fallbackText.slice(0, 1200), best: null, alternatives: [], savings_note: "", caveats: "", searched: [] };
  }
  const alts = Array.isArray(obj.alternatives) ? obj.alternatives : [];
  return {
    headline: str(obj.headline).trim().slice(0, 1200),
    best: coercePick(obj.best),
    alternatives: alts.map(coercePick).filter((p): p is SourcingPick => p !== null).slice(0, 6),
    savings_note: str(obj.savings_note).trim().slice(0, 300),
    caveats: str(obj.caveats).trim().slice(0, 600),
    searched: Array.isArray(obj.searched) ? obj.searched.map(str).map((s) => s.trim()).filter(Boolean).slice(0, 12) : [],
  };
}

export interface SourceProductInput {
  query: string;
  /** Preferred avenues to also check for deals (enabled sources). */
  sources: { label: string; site: string; note: string }[];
  brief: { company_name: string; business_description: string };
}

/**
 * Shop the web like a seasoned purchasing manager and return ONE reasoned best buy
 * (+ ranked alternatives with trade-offs). Throws only if the AI key is missing.
 */
export async function sourceProduct(input: SourceProductInput): Promise<SourcingResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();

  const prefLines = input.sources
    .filter((s) => s.site.trim())
    .map((s) => `- ${s.label || s.site} (${s.site})${s.note ? ` — ${s.note}` : ""}`)
    .join("\n");

  const system = [
    "You are a seasoned purchasing manager sourcing a product for a busy founder. You take the headache out of shopping: you find what they asked for at the best price and terms, hunt for deals/discounts/used bargains, and steer them away from bad buys.",
    input.brief.business_description ? `Who you're buying for: ${input.brief.company_name} — ${input.brief.business_description}.` : "",
    "Use web_search to find real, currently-available listings for the requested item across reputable retailers (Amazon, Walmart, Best Buy, Home Depot, B&H, the manufacturer's own store, etc.). Then use web_fetch to OPEN the promising listings and confirm the real price, shipping cost + delivery speed, seller, and condition.",
    prefLines
      ? `The founder ALSO wants you to check these avenues for lower-cost options — search them too and open listings there:\n${prefLines}`
      : "Also consider marketplace/auction options (eBay, etc.) when they're meaningfully cheaper AND the seller looks trustworthy.",
    "Think like a buyer, not a search engine. Weigh TOTAL cost (price + shipping), delivery speed, seller reputation/safety, condition, and return policy. The BEST option is the best overall value that is safe to buy — NOT automatically the cheapest. Call out real deals (e.g. '~30% cheaper than typical').",
    "SAFETY: flag sellers that look sketchy — brand-new accounts, no ratings, prices too good to be true, off-platform payment, knockoff risk. Prefer reputable sellers; if a cheaper option is risky, say so and recommend the safe one.",
    "Only real listings you actually found via search/fetch. NEVER invent a product, price, seller, or URL. If you genuinely can't find good options, say so honestly in the headline and leave best null.",
    "For each option set: title (what it is), price (exactly as shown, e.g. '$24.99'), seller (store or marketplace seller), url (the listing URL), shipping (cost + delivery time in plain words), condition ('New'/'Used – good'/'Refurbished'), trust ('reputable' | 'caution' | 'unknown'), why (one line: why it's the pick, or why this alternative lost).",
    "",
    'When done, respond with ONLY this JSON (no prose, no fences): {"headline": string (the plain-English recommendation, e.g. "The best option for your toaster is the Cuisinart CPT-122 — ~30% cheaper than comparable 2-slice models, Prime free 2-day, sold by Amazon"), "best": Pick|null, "alternatives": Pick[] (2-4, each with why it lost), "savings_note": string, "caveats": string (what to double-check before buying), "searched": string[] (the sites/avenues you checked)}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = `Source me: ${input.query}\n\nShop now (search, then open the best listings to confirm price + shipping + seller), then return the JSON.`;

  // Server tools run inline; a long turn may return stop_reason "pause_turn" — feed the
  // partial turn back to continue. Returns the final assistant text.
  const runWithTools = async (tools: Anthropic.Messages.ToolUnion[]): Promise<string> => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];
    let text = "";
    for (let i = 0; i < 7; i++) {
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
  return coerceResult(parseJsonObject(text), text);
}
