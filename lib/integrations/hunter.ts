import "server-only";

import type { OutreachDomainPerson } from "@/lib/types";

/**
 * Hunter.io email finding — resolve a person's REAL email from their name + company
 * domain, with a confidence score, so Outreach reaches real inboxes instead of guesses.
 * Optional: without HUNTER_API_KEY, callers fall back to web-only email finding.
 */

const BASE = "https://api.hunter.io/v2";

/** Minimum Hunter confidence (0-100) to trust an email — below this we'd risk a bounce. */
export const HUNTER_MIN_SCORE = 70;

export function hunterConfigured(): boolean {
  return Boolean(process.env.HUNTER_API_KEY);
}

export interface HunterResult {
  /** The found email, or null when Hunter couldn't resolve one. */
  email: string | null;
  /** Hunter's confidence 0-100 (null when not returned). */
  score: number | null;
  /** Verification status if present ("valid" | "invalid" | "accept_all" | "webmail" | …). */
  status: string | null;
  /** Source page URLs Hunter cites for the address (evidence it was really seen). */
  sources: string[];
}

/** Derive a bare domain (example.com) from a website URL or domain-ish string. */
export function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  let s = website.trim().toLowerCase();
  if (!s) return null;
  try {
    if (!/^https?:\/\//.test(s)) s = `https://${s}`;
    const host = new URL(s).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/**
 * Find a person's email via Hunter's Email Finder. Needs a name and either a domain or
 * a company. Returns the email as Hunter reports it (with its confidence) — the caller
 * applies the HUNTER_MIN_SCORE gate. Never throws: any error degrades to a null result.
 */
export async function findEmail(input: {
  fullName: string;
  domain?: string | null;
  company?: string | null;
}): Promise<HunterResult> {
  const key = process.env.HUNTER_API_KEY;
  const empty: HunterResult = { email: null, score: null, status: null, sources: [] };
  if (!key) return empty;
  const name = input.fullName.trim();
  const domain = input.domain?.trim() || null;
  const company = input.company?.trim() || null;
  if (!name || (!domain && !company)) return empty;

  const params = new URLSearchParams({ api_key: key, full_name: name });
  if (domain) params.set("domain", domain);
  else if (company) params.set("company", company);

  try {
    const res = await fetch(`${BASE}/email-finder?${params.toString()}`, {
      headers: { Accept: "application/json" },
      // Don't let a slow lookup hang the whole sourcing run.
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[hunter] email-finder ${res.status} for ${domain ?? company ?? name}`);
      return empty;
    }
    const json = (await res.json()) as {
      data?: {
        email?: string | null;
        score?: number | null;
        verification?: { status?: string | null } | null;
        sources?: Array<{ uri?: string | null }> | null;
      };
    };
    const d = json.data ?? {};
    return {
      email: d.email && d.email.trim() ? d.email.trim() : null,
      score: typeof d.score === "number" ? d.score : null,
      status: d.verification?.status ?? null,
      sources: (d.sources ?? []).map((s) => (s?.uri ?? "").trim()).filter(Boolean).slice(0, 6),
    };
  } catch (e) {
    console.warn(`[hunter] email-finder failed: ${e instanceof Error ? e.message : String(e)}`);
    return empty;
  }
}

export interface HunterAccount {
  searches_used: number | null;
  searches_available: number | null;
  verifications_used: number | null;
  verifications_available: number | null;
}

/** Fetch the account's remaining search + verification credits. Free call (no credit). */
export async function accountCredits(): Promise<HunterAccount | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}/account?api_key=${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        requests?: {
          searches?: { used?: number; available?: number };
          verifications?: { used?: number; available?: number };
        };
      };
    };
    const r = json.data?.requests ?? {};
    return {
      searches_used: r.searches?.used ?? null,
      searches_available: r.searches?.available ?? null,
      verifications_used: r.verifications?.used ?? null,
      verifications_available: r.verifications?.available ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Domain Search — list the real people + emails Hunter has on file for a company, so the
 * user can SEE the roster and pick who to contact. Bills per result; the caller gates it
 * behind an explicit click. Prefers personal (individual) addresses over role inboxes.
 */
export async function domainSearch(input: {
  domain?: string | null;
  company?: string | null;
  limit?: number;
}): Promise<OutreachDomainPerson[]> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return [];
  const domain = input.domain?.trim() || null;
  const company = input.company?.trim() || null;
  if (!domain && !company) return [];

  const params = new URLSearchParams({ api_key: key, limit: String(Math.max(1, Math.min(input.limit ?? 15, 25))), type: "personal" });
  if (domain) params.set("domain", domain);
  else if (company) params.set("company", company);

  try {
    const res = await fetch(`${BASE}/domain-search?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`[hunter] domain-search ${res.status} for ${domain ?? company}`);
      return [];
    }
    const json = (await res.json()) as {
      data?: {
        emails?: Array<{
          value?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          position?: string | null;
          confidence?: number | null;
          type?: string | null;
          sources?: Array<{ uri?: string | null }> | null;
        }>;
      };
    };
    return (json.data?.emails ?? [])
      .filter((e) => e.value && e.value.trim())
      .map((e) => ({
        email: e.value!.trim(),
        first_name: (e.first_name ?? "").trim(),
        last_name: (e.last_name ?? "").trim(),
        position: (e.position ?? "").trim(),
        confidence: typeof e.confidence === "number" ? e.confidence : null,
        type: (e.type ?? "").trim(),
        sources: (e.sources ?? []).map((s) => (s?.uri ?? "").trim()).filter(Boolean).slice(0, 4),
      }));
  } catch (e) {
    console.warn(`[hunter] domain-search failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export interface HunterVerify {
  /** "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown" | null */
  status: string | null;
  /** Deliverability score 0-100. */
  score: number | null;
}

/** Verify one email's deliverability via Hunter's Email Verifier (separate credit pool). */
export async function verifyEmail(email: string): Promise<HunterVerify> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { status: null, score: null };
  const e = email.trim();
  if (!e) return { status: null, score: null };
  try {
    const res = await fetch(`${BASE}/email-verifier?email=${encodeURIComponent(e)}&api_key=${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn(`[hunter] email-verifier ${res.status}`);
      return { status: null, score: null };
    }
    const json = (await res.json()) as { data?: { status?: string | null; score?: number | null } };
    return {
      status: json.data?.status ?? null,
      score: typeof json.data?.score === "number" ? json.data.score : null,
    };
  } catch (err) {
    console.warn(`[hunter] email-verifier failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: null, score: null };
  }
}
