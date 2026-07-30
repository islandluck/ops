import "server-only";

import { fitToX, X_MAX_CHARS } from "@/lib/social/x-post";

/** X (Twitter) API v2 calls with an OAuth 2.0 access token. */
export { X_MAX_CHARS };

export async function getXAccount(accessToken: string): Promise<string | null> {
  const res = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { username?: string; name?: string } };
  return json.data?.username ? `@${json.data.username}` : (json.data?.name ?? null);
}

/**
 * Upload an image to X and return its media id, for attaching to a post.
 * Requires the `media.write` scope on the connected account (reconnect X if it
 * was authorized before images were added).
 */
export async function uploadMediaToX(accessToken: string, bytes: Buffer, mime: string): Promise<string> {
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(bytes)], { type: mime }));
  form.append("media_category", "tweet_image");
  const res = await fetch("https://api.x.com/2/media/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` }, // fetch sets the multipart boundary
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; media_key?: string };
    id?: string;
    media_id_string?: string;
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
        ? "X rejected the media upload — reconnect X to grant media permission."
        : `X media upload failed (${res.status})`);
    throw new Error(msg);
  }
  const id = json.data?.id || json.id || json.media_id_string;
  if (!id) throw new Error("X media upload returned no id.");
  return String(id);
}

/**
 * Publish a text post (optionally with uploaded media). Guarantees the text fits
 * X's limit — anything longer is trimmed to a clean word boundary rather than
 * rejected, so publishing never hard-fails on length. Returns the id, a
 * permalink, and whether the text was trimmed.
 */
export async function postTweet(
  accessToken: string,
  text: string,
  mediaIds?: string[],
): Promise<{ id: string; url: string; truncated: boolean }> {
  const original = text.trim();
  if (!original) throw new Error("The post is empty.");
  const truncated = original.length > X_MAX_CHARS;
  const body = truncated ? fitToX(original) : original;
  const payload: { text: string; media?: { media_ids: string[] } } = { text: body };
  if (mediaIds && mediaIds.length) payload.media = { media_ids: mediaIds };
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
