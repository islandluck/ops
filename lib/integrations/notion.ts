import "server-only";

/** Notion API calls with an OAuth access token. */

const NOTION_VERSION = "2022-06-28";

function notionHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

/**
 * Find the page to create under. Targets the page(s) the user actually SHARED —
 * a top-level page whose parent is the workspace — chosen deterministically so
 * it's the same every time.
 *
 * Pages Operator creates are always children of another page (parent.type
 * "page_id"), so they're never selected here. The previous implementation
 * picked the most-recently-edited page, which meant each new page nested inside
 * the one just created (a cascade), since creating a page makes it the newest.
 */
async function findParentPageId(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: notionHeaders(accessToken),
    body: JSON.stringify({
      filter: { property: "object", value: "page" },
      page_size: 100,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    results?: Array<{ id: string; object: string; created_time?: string; parent?: { type?: string } }>;
  };
  const pages = (json.results ?? []).filter((r) => r.object === "page");
  if (!pages.length) return null;

  // Prefer top-level (workspace-parented) pages the user shared; fall back to
  // all accessible pages if they only shared a sub-page.
  const shared = pages.filter((p) => p.parent?.type === "workspace");
  const pool = shared.length ? shared : pages;

  // Stable target across sends: the earliest-created page in the pool (always
  // older than anything Operator generated).
  pool.sort((a, b) => new Date(a.created_time ?? 0).getTime() - new Date(b.created_time ?? 0).getTime());
  return pool[0]?.id ?? null;
}

/** Split plain text into Notion paragraph blocks (≤1900 chars each, capped). */
function paragraphBlocks(text: string) {
  const chunks = text
    .split(/\n{2,}/)
    .flatMap((p) => p.match(/[\s\S]{1,1900}/g) ?? [])
    .slice(0, 40);
  return chunks.map((content) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content } }] },
  }));
}

/**
 * Create a page under a page the integration can access. Users grant access to
 * specific pages during OAuth consent; if none were shared we surface a clear,
 * actionable error rather than a generic 404.
 */
export async function createNotionPage(
  accessToken: string,
  page: { title: string; content: string },
): Promise<{ id: string; url?: string }> {
  const parentId = await findParentPageId(accessToken);
  if (!parentId) {
    throw new Error(
      "No accessible Notion page. In Notion, share a page with the Operator integration, then retry.",
    );
  }
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(accessToken),
    body: JSON.stringify({
      parent: { page_id: parentId },
      properties: { title: { title: [{ type: "text", text: { content: page.title } }] } },
      children: paragraphBlocks(page.content || page.title),
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((json.message as string) || `Notion page create failed (${res.status})`);
  }
  return { id: String(json.id), url: json.url ? String(json.url) : undefined };
}
