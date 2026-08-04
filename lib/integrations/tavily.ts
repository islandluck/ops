import "server-only";

/**
 * Tavily web search — a dedicated search API used by the Opportunities scanners.
 * Chosen over model-side web search because it's fast (~6s), deterministic, and
 * has no "server tool use" rate limits that stall an agentic turn for minutes.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 20_000;

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export function tavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/** Run one Tavily search. Never throws — returns [] on any error. */
export async function tavilySearch(
  query: string,
  opts: { maxResults?: number; searchDepth?: "basic" | "advanced"; includeDomains?: string[] } = {},
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: opts.searchDepth ?? "advanced",
        max_results: opts.maxResults ?? 6,
        include_answer: false,
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (json.results ?? [])
      .map((r) => ({
        title: String(r.title ?? "").slice(0, 300),
        url: String(r.url ?? ""),
        content: String(r.content ?? "").slice(0, 1200),
      }))
      .filter((r) => /^https?:\/\//i.test(r.url));
  } catch {
    return [];
  }
}
