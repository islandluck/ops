import "server-only";

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
  const empty: HunterResult = { email: null, score: null, status: null };
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
      data?: { email?: string | null; score?: number | null; verification?: { status?: string | null } | null };
    };
    const d = json.data ?? {};
    return {
      email: d.email && d.email.trim() ? d.email.trim() : null,
      score: typeof d.score === "number" ? d.score : null,
      status: d.verification?.status ?? null,
    };
  } catch (e) {
    console.warn(`[hunter] email-finder failed: ${e instanceof Error ? e.message : String(e)}`);
    return empty;
  }
}
