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

/** One block's own plain text (not its children). Handles the common Notion
 *  shapes, including table rows (text is in `cells`) and child-page/db titles. */
function blockText(block: Record<string, unknown>): string {
  const type = block.type as string | undefined;
  if (!type) return "";
  const body = block[type] as
    | {
        rich_text?: Array<{ plain_text?: string }>;
        checked?: boolean;
        title?: string;
        cells?: Array<Array<{ plain_text?: string }>>;
      }
    | undefined;

  // Table rows keep their text in `cells` (array of cells, each an array of rich_text).
  if (type === "table_row" && Array.isArray(body?.cells)) {
    const cells = body.cells.map((cell) => (cell ?? []).map((t) => t.plain_text ?? "").join("").trim());
    return cells.some(Boolean) ? cells.join(" | ") : "";
  }
  // A nested page or database shows up as a title-only block.
  if (type === "child_page" || type === "child_database") return (body?.title ?? "").trim();

  const text = (body?.rich_text ?? []).map((t) => t.plain_text ?? "").join("").trim();
  if (!text) return "";
  const prefix =
    type === "to_do"
      ? `- [${body?.checked ? "x" : " "}] `
      : type.startsWith("heading")
        ? "## "
        : type.includes("list_item")
          ? "- "
          : type === "quote"
            ? "> "
            : "";
  return `${prefix}${text}`;
}

/**
 * Flatten a Notion page into readable plain text (best-effort).
 *
 * Notion AI "Meeting Notes" and the AI transcriber wrap their summary and
 * transcript inside CONTAINER blocks — toggles, callouts, column_list/column,
 * synced blocks — whose own level has no text; the real content lives in their
 * child blocks. So we RECURSE into any block that has children (bounded by depth
 * and a total-block cap) and also paginate each level, instead of reading only
 * the top level. Reading just the first level is why those pages used to come
 * back blank. We don't descend into child pages/databases (title only) to avoid
 * pulling in unrelated pages.
 */
export async function getNotionPageContent(accessToken: string, pageId: string): Promise<string> {
  const lines: string[] = [];
  const MAX_BLOCKS = 400;
  const MAX_CHARS = 14000;
  const MAX_DEPTH = 5;
  let count = 0;

  async function walk(blockId: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || count >= MAX_BLOCKS) return;
    let cursor: string | undefined;
    do {
      const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("start_cursor", cursor);
      const res = await fetch(url, { headers: notionHeaders(accessToken) });
      if (!res.ok) return;
      const json = (await res.json()) as {
        results?: Array<Record<string, unknown>>;
        next_cursor?: string | null;
        has_more?: boolean;
      };
      for (const block of json.results ?? []) {
        if (count >= MAX_BLOCKS) break;
        count++;
        const text = blockText(block);
        if (text) lines.push(text);
        const type = block.type as string | undefined;
        // Descend into containers (toggle, callout, column_list/column, synced_block,
        // list items with sub-items, tables…) — never into nested pages/databases.
        if (block.has_children && type !== "child_page" && type !== "child_database") {
          await walk(block.id as string, depth + 1);
        }
      }
      cursor = json.has_more ? json.next_cursor ?? undefined : undefined;
    } while (cursor && count < MAX_BLOCKS);
  }

  try {
    await walk(pageId, 0);
  } catch {
    /* return whatever we gathered so far */
  }
  return lines.join("\n").slice(0, MAX_CHARS);
}
