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

/** Find a page the integration can write to (the user shares pages at consent time). */
async function findParentPageId(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: notionHeaders(accessToken),
    body: JSON.stringify({
      filter: { property: "object", value: "page" },
      page_size: 5,
      sort: { direction: "descending", timestamp: "last_edited_time" },
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: Array<{ id: string; object: string }> };
  return (json.results ?? []).find((r) => r.object === "page")?.id ?? null;
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
