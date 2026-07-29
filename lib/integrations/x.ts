import "server-only";

/** X (Twitter) API v2 calls with an OAuth 2.0 access token. */

/** Max characters in a standard post. */
export const X_MAX_CHARS = 280;

export async function getXAccount(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { username?: string; name?: string } };
  return json.data?.username ? `@${json.data.username}` : (json.data?.name ?? null);
}

/** Trim text to the limit at a word boundary, adding an ellipsis. */
export function fitToLimit(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  const slice = t.slice(0, limit - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.trimEnd()}…`;
}

/**
 * Publish a text post. Guarantees the post fits X's limit — anything longer is
 * trimmed to a clean word boundary rather than rejected, so publishing never
 * hard-fails on length. Returns the id, a permalink, and whether it was trimmed.
 */
export async function postTweet(
  accessToken: string,
  text: string,
): Promise<{ id: string; url: string; truncated: boolean }> {
  const original = text.trim();
  if (!original) throw new Error("The post is empty.");
  const truncated = original.length > X_MAX_CHARS;
  const body = truncated ? fitToLimit(original, X_MAX_CHARS) : original;
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: body }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string };
    detail?: string;
    title?: string;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok) {
    const msg =
      json.errors?.[0]?.message ||
      json.detail ||
      json.title ||
      (res.status === 403
        ? "X rejected the post (check your app's permissions are Read and write)."
        : res.status === 429
          ? "X rate limit reached. Try again later."
          : `X post failed (${res.status})`);
    throw new Error(msg);
  }
  const id = String(json.data?.id ?? "");
  return { id, url: id ? `https://x.com/i/web/status/${id}` : "https://x.com", truncated };
}
