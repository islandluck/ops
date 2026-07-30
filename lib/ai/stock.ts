import "server-only";

/**
 * Stock-photo search via Pexels (free tier). Gated on PEXELS_API_KEY — like
 * Tavily, it degrades gracefully to "no results" when the key is absent, so the
 * feature ships now and lights up once a key is added.
 */

export interface StockImage {
  /** Full-size URL to fetch + store when chosen. */
  url: string;
  /** Small preview URL for the picker grid. */
  thumb: string;
  alt: string;
  width: number;
  height: number;
  attribution: string;
}

export function stockConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

interface PexelsPhoto {
  width: number;
  height: number;
  alt?: string;
  photographer?: string;
  src?: { original?: string; large2x?: string; large?: string; medium?: string; small?: string };
}

export async function searchStockImages(query: string, limit = 12): Promise<StockImage[]> {
  const key = process.env.PEXELS_API_KEY;
  const q = query.trim();
  if (!key || !q) return [];
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${limit}&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: key } });
    if (!res.ok) return [];
    const json = (await res.json()) as { photos?: PexelsPhoto[] };
    return (json.photos ?? [])
      .map((p) => ({
        url: p.src?.large2x || p.src?.large || p.src?.original || "",
        thumb: p.src?.medium || p.src?.small || p.src?.large || "",
        alt: p.alt || q,
        width: p.width,
        height: p.height,
        attribution: p.photographer ? `Photo by ${p.photographer} on Pexels` : "Pexels",
      }))
      .filter((s) => s.url);
  } catch {
    return [];
  }
}
