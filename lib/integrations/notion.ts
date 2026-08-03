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

export interface NotionPageRef {
  id: string;
  title: string;
  url: string;
  last_edited: string;
}

/** Plain-text title of a Notion page from its `properties` (any title property). */
function pageTitle(props: Record<string, unknown> | undefined): string {
  if (!props) return "";
  for (const val of Object.values(props)) {
    const p = val as { type?: string; title?: Array<{ plain_text?: string }> };
    if (p?.type === "title" && Array.isArray(p.title)) {
      return p.title.map((t) => t.plain_text ?? "").join("").trim();
    }
  }
  return "";
}

/**
 * Recently-edited pages the integration can access (the pages the user shared),
 * newest first. Best-effort — returns [] on error/limited access so callers
 * degrade gracefully. Excludes pages Operator itself created (child pages).
 */
export async function searchNotionPages(
  accessToken: string,
  max = 15,
): Promise<NotionPageRef[]> {
  try {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: notionHeaders(accessToken),
      body: JSON.stringify({
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: Math.min(Math.max(max, 5), 100),
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: Array<{
        id: string;
        object: string;
        url?: string;
        last_edited_time?: string;
        properties?: Record<string, unknown>;
      }>;
    };
    return (json.results ?? [])
      .filter((r) => r.object === "page")
      .map((r) => ({
        id: r.id,
        title: pageTitle(r.properties) || "Untitled",
        url: r.url ?? "",
        last_edited: r.last_edited_time ?? "",
      }))
      .slice(0, max);
  } catch {
    return [];
  }
}

/** Flatten a page's block children into readable plain text (best-effort). */
export async function getNotionPageContent(accessToken: string, pageId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      { headers: notionHeaders(accessToken) },
    );
    if (!res.ok) return "";
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const lines: string[] = [];
    for (const block of json.results ?? []) {
      const type = block.type as string | undefined;
      if (!type) continue;
      const body = block[type] as { rich_text?: Array<{ plain_text?: string }>; checked?: boolean } | undefined;
      const text = (body?.rich_text ?? []).map((t) => t.plain_text ?? "").join("").trim();
      if (!text) continue;
      const prefix =
        type === "to_do" ? `- [${body?.checked ? "x" : " "}] ` : type.startsWith("heading") ? "## " : type.includes("list_item") ? "- " : "";
      lines.push(`${prefix}${text}`);
    }
    return lines.join("\n").slice(0, 9000);
  } catch {
    return "";
  }
}
