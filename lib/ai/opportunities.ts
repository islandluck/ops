import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { ScanUsage } from "@/lib/types";
import { fetchGrantDetail, searchGrantsGov, type GrantDetail, type GrantHit } from "@/lib/integrations/grantsgov";

/**
 * Grant scanning via the grants.gov public API (free, official, every federal
 * agency — not just SBIR). We pull structured facts directly, then use ONE small
 * Claude call to do the only thing code can't: score how well each grant fits
 * THIS company. Search + details cost nothing; the model input/output is tiny.
 *
 * GROUNDING: every displayed fact (title, url, amount, deadline, eligibility)
 * comes from grants.gov. The model only returns a score + one-line rationale, so
 * it cannot invent grants or links.
 */

// Scoring is a cheap, structured task — default to Haiku. Override with env.
const RANK_MODEL = process.env.OPPORTUNITY_SCAN_MODEL || "claude-haiku-4-5";
const RANK_TIMEOUT_MS = 45_000;

// Haiku $/Mtok, for rough internal metering. grants.gov search itself is free.
const RATE = { in: 1, out: 5 };

// Only surface grants that rank ABOVE this fit score — weaker matches are noise.
const MIN_FIT_SCORE = 37;
// How many top search hits to pull details for and score per run.
const DETAIL_LIMIT = 18;

export interface GrantScanInput {
  company: {
    name: string;
    description: string;
    coreOffer: string;
    idealCustomer: string;
    goals: string[];
    context: string;
  };
  location: { city: string; state: string; country: string };
  scope: "local" | "state" | "national";
  /** Unused for grants.gov (federal DB); reserved for future state/web sources. */
  sources: string[];
  limit: number;
}

export interface ScannedOpportunity {
  title: string;
  org: string;
  url: string;
  summary: string;
  deadline: string;
  amount: string;
  location: string;
  fit_score: number;
  fit_rationale: string;
  requirements: string;
}

export interface ScanResult {
  opportunities: ScannedOpportunity[];
  usage: ScanUsage;
}

function str(x: unknown, max: number): string {
  return typeof x === "string" ? x.trim().slice(0, max) : "";
}
function asRec(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}
function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return (m ? m[1] : t).trim();
}
/** Pull a JSON object out of a reply, even when it's wrapped in prose. */
function extractObject(text: string): Record<string, unknown> | null {
  const cleaned = stripFences(text);
  try {
    const j = JSON.parse(cleaned);
    if (j && typeof j === "object") return asRec(j);
  } catch {
    /* fall through to brace-slice */
  }
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      const j = JSON.parse(cleaned.slice(s, e + 1));
      if (j && typeof j === "object") return asRec(j);
    } catch {
      /* not recoverable */
    }
  }
  return null;
}

function accumulate(acc: ScanUsage, u: Anthropic.Usage | undefined): void {
  if (!u) return;
  const it = u.input_tokens ?? 0;
  const ot = u.output_tokens ?? 0;
  acc.input_tokens += it;
  acc.output_tokens += ot;
  acc.est_cost_cents += Math.round(((it / 1e6) * RATE.in + (ot / 1e6) * RATE.out) * 100);
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "that", "this", "we", "our",
  "are", "is", "by", "at", "as", "from", "their", "it", "its", "be", "will", "can", "your", "you", "into",
]);

/** Derive a grants.gov keyword string from the company's own words. */
function keywordsFor(company: GrantScanInput["company"]): string {
  const text = [company.coreOffer, company.description].filter(Boolean).join(" ").toLowerCase();
  const words = text.match(/[a-z][a-z-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const w of words) {
    if (STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    terms.push(w);
    if (terms.length >= 8) break;
  }
  return terms.join(" ");
}

/** Compact one grant into a line for the scoring prompt. */
function scoreLine(d: GrantDetail, i: number): string {
  return [
    `[${i + 1}] ${d.title}`,
    d.agency ? `agency: ${d.agency}` : "",
    d.category ? `category: ${d.category}` : "",
    d.summary ? `about: ${d.summary.slice(0, 240)}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/** Scan grants.gov for open federal grants that fit the company. */
export async function scanGrants(input: GrantScanInput): Promise<ScanResult> {
  const { company, scope, limit } = input;
  const usage: ScanUsage = { input_tokens: 0, output_tokens: 0, searches: 0, est_cost_cents: 0, runs: 1 };

  // 1) SEARCH — grants.gov (free). A focused query plus a broad one for breadth.
  const kw = keywordsFor(company) || "small business innovation research";
  const broad = kw.split(" ").slice(0, 3).join(" ");
  const [primary, secondary] = await Promise.all([
    searchGrantsGov(kw, { rows: 20 }),
    broad && broad !== kw ? searchGrantsGov(broad, { rows: 12 }) : Promise.resolve<GrantHit[]>([]),
  ]);
  usage.searches = secondary.length || broad !== kw ? 2 : 1;

  const byId = new Map<string, GrantHit>();
  for (const h of [...primary, ...secondary]) if (!byId.has(h.id)) byId.set(h.id, h);
  const hits = [...byId.values()].slice(0, DETAIL_LIMIT);
  if (!hits.length) return { opportunities: [], usage };

  // 2) DETAILS — grants.gov fetchOpportunity (free), in parallel.
  const details = (await Promise.all(hits.map((h) => fetchGrantDetail(h)))).filter(
    (d): d is GrantDetail => Boolean(d && d.title),
  );
  if (!details.length) return { opportunities: [], usage };

  // 3) SCORE FIT — one small Claude call. It returns only {i, fit, why}; every
  //    other fact is merged from grants.gov, so nothing can be hallucinated.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: RANK_TIMEOUT_MS });

  const scopeLine =
    scope === "national"
      ? "This company is open to national/federal programs."
      : `This company is based in ${[input.location.city, input.location.state].filter(Boolean).join(", ") || "the US"}; still score federal programs on merit.`;

  const system = [
    `You score how well U.S. federal grants fit a specific company, 0-100 (sector, stage, eligibility, use-of-funds).`,
    `COMPANY: ${company.name}. ${[company.description, company.coreOffer].filter(Boolean).join(" ")}`.trim(),
    company.idealCustomer ? `Customers: ${company.idealCustomer}` : "",
    company.context ? `Context (from a deep dive):\n${company.context.slice(0, 1200)}` : "",
    scopeLine,
    "You are given a numbered list of real grants. For EACH, return its number, a fit score 0-100, and a one-line (<=18 word) rationale.",
    'Respond with ONLY this JSON — no prose, no fences: {"scores":[{"i":number,"fit":number,"why":string}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const userContent = `Grants:\n\n${details.map(scoreLine).join("\n")}`;

  let obj: Record<string, unknown> | null = null;
  const msg = await client.messages.create({
    model: RANK_MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: userContent }],
  });
  accumulate(usage, msg.usage);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  obj = extractObject(text);

  const scores = new Map<number, { fit: number; why: string }>();
  const rawScores = obj && Array.isArray(obj.scores) ? obj.scores : [];
  for (const sc of rawScores) {
    const r = asRec(sc);
    const i = Math.round(Number(r.i) || 0);
    if (i >= 1) scores.set(i, { fit: Math.max(0, Math.min(100, Math.round(Number(r.fit) || 0))), why: str(r.why, 400) });
  }

  // 4) MERGE + FILTER — grounded facts from grants.gov, fit from the model.
  const opportunities: ScannedOpportunity[] = details
    .map((d, idx) => {
      const sc = scores.get(idx + 1) ?? { fit: 0, why: "" };
      return {
        title: str(d.title, 200),
        org: str(d.agency, 160),
        url: str(d.url, 600),
        summary: str(d.summary, 800),
        deadline: str(d.deadline, 120),
        amount: str(d.amount, 120),
        location: "",
        fit_score: sc.fit,
        fit_rationale: sc.why,
        requirements: str(d.requirements, 600),
      };
    })
    .filter((o) => o.title && /^https?:\/\//i.test(o.url) && o.fit_score > MIN_FIT_SCORE)
    .sort((a, b) => b.fit_score - a.fit_score)
    .slice(0, limit);

  return { opportunities, usage };
}
