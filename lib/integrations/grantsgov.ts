import "server-only";

/**
 * grants.gov public API (Search2 + fetchOpportunity). Free, no key, official —
 * the federal grants database across every agency. We pull structured facts
 * (title, agency, dates, award size, eligibility, description) directly, so the
 * model never has to browse or extract — it only scores fit. Cheap and grounded.
 */

const SEARCH_URL = "https://api.grants.gov/v1/api/search2";
const FETCH_URL = "https://api.grants.gov/v1/api/fetchOpportunity";
const TIMEOUT_MS = 20_000;

export interface GrantHit {
  id: string;
  number: string;
  title: string;
  agency: string;
  closeDate: string;
}

export interface GrantDetail {
  id: string;
  title: string;
  agency: string;
  url: string;
  summary: string;
  amount: string;
  deadline: string;
  requirements: string;
  category: string;
}

function asRec(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}
function s(x: unknown): string {
  return typeof x === "string" ? x : typeof x === "number" ? String(x) : "";
}
function clean(str: string): string {
  return str
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function stripHtml(str: string): string {
  return clean(str.replace(/<[^>]+>/g, " "));
}
function num(x: unknown): number {
  const n = typeof x === "number" ? x : parseInt(s(x).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function money(n: number): string {
  return n.toLocaleString("en-US");
}

async function post(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return asRec(await res.json());
  } catch {
    return null;
  }
}

/** Search currently-open federal grant opportunities. Never throws. */
export async function searchGrantsGov(
  keyword: string,
  opts: { rows?: number; oppStatuses?: string } = {},
): Promise<GrantHit[]> {
  const json = await post(SEARCH_URL, {
    keyword: keyword.slice(0, 200),
    oppStatuses: opts.oppStatuses ?? "posted",
    rows: opts.rows ?? 25,
  });
  const hits = asRec(json?.data).oppHits;
  if (!Array.isArray(hits)) return [];
  return hits
    .map((h) => {
      const r = asRec(h);
      return {
        id: s(r.id),
        number: s(r.number),
        title: clean(s(r.title)),
        agency: s(r.agencyCode) || s(r.agency),
        closeDate: s(r.closeDate),
      };
    })
    .filter((h) => h.id && h.title);
}

function fmtAmount(syn: Record<string, unknown>): string {
  const ceil = num(syn.awardCeiling);
  const floor = num(syn.awardFloor);
  const est = num(syn.estimatedFunding);
  if (floor && ceil && floor !== ceil) return `$${money(floor)}–$${money(ceil)}`;
  if (ceil) return `Up to $${money(ceil)}`;
  if (est) return `~$${money(est)} total funding`;
  return "";
}
function applicantSummary(types: unknown): string {
  if (!Array.isArray(types)) return "";
  const labels = types.map((t) => clean(s(asRec(t).description))).filter(Boolean);
  return labels.slice(0, 2).join("; ").slice(0, 300);
}
function categoryLabel(cats: unknown): string {
  if (!Array.isArray(cats)) return "";
  return cats
    .map((c) => clean(s(asRec(c).description)))
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

/** Fetch one opportunity's full detail. Never throws; null on failure. */
export async function fetchGrantDetail(hit: GrantHit): Promise<GrantDetail | null> {
  const json = await post(FETCH_URL, { opportunityId: Number(hit.id) || hit.id });
  const d = asRec(json?.data);
  if (!Object.keys(d).length) return null;
  const syn = asRec(d.synopsis);
  const agency = clean(s(syn.agencyName) || s(asRec(d.topAgencyDetails).agencyName) || hit.agency);
  return {
    id: hit.id,
    title: clean(s(d.opportunityTitle) || hit.title),
    agency,
    url: `https://www.grants.gov/search-results-detail/${hit.id}`,
    summary: stripHtml(s(syn.synopsisDesc)).slice(0, 700),
    amount: fmtAmount(syn),
    deadline: hit.closeDate || clean(s(syn.responseDateDesc)),
    requirements: applicantSummary(syn.applicantTypes),
    category: categoryLabel(syn.fundingActivityCategories),
  };
}
