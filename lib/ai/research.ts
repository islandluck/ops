import "server-only";

/**
 * Live topic research via the Tavily search API (news-focused). Server-only.
 * Gracefully returns null when TAVILY_API_KEY isn't set, so callers fall back to
 * brief-grounded content until the key is added.
 */

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchResult {
  answer: string;
  sources: ResearchSource[];
}

export function hasResearchKey(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function researchTopics(
  query: string,
  opts?: { maxResults?: number; days?: number },
): Promise<ResearchResult | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        topic: "news",
        search_depth: "basic",
        max_results: opts?.maxResults ?? 6,
        days: opts?.days ?? 7,
        include_answer: true,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return {
      answer: json.answer ?? "",
      sources: (json.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 500),
      })),
    };
  } catch {
    return null;
  }
}
