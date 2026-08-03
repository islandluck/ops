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
 * Fetch the connected account's own recent ORIGINAL tweets (no retweets/replies)
 * so we can learn how the owner writes. Best-effort — returns [] on any error or
 * limited read access, so voice-learning degrades to the paste flow.
 */
export async function getUserTweets(accessToken: string, max = 40): Promise<string[]> {
  try {
    const me = await fetch("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!me.ok) return [];
    const meJson = (await me.json()) as { data?: { id?: string } };
    const id = meJson.data?.id;
    if (!id) return [];
    const params = new URLSearchParams({
      max_results: String(Math.min(Math.max(max, 5), 100)),
      exclude: "retweets,replies",
      "tweet.fields": "text",
    });
    const res = await fetch(`https://api.x.com/2/users/${id}/tweets?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ text?: string }> };
    return (json.data ?? [])
      .map((t) => (t.text ?? "").trim())
      .filter((t) => t.length > 0 && !t.startsWith("RT @"))
      .slice(0, max);
  } catch {
    return [];
  }
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
  replyToTweetId?: string,
): Promise<{ id: string; url: string; truncated: boolean }> {
  const original = text.trim();
  if (!original) throw new Error("The post is empty.");
  const truncated = original.length > X_MAX_CHARS;
  const body = truncated ? fitToX(original) : original;
  const payload: {
    text: string;
    media?: { media_ids: string[] };
    reply?: { in_reply_to_tweet_id: string };
  } = { text: body };
  if (mediaIds && mediaIds.length) payload.media = { media_ids: mediaIds };
  if (replyToTweetId) payload.reply = { in_reply_to_tweet_id: replyToTweetId };
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

/**
 * Fetch one tweet's text + author handle by id. Best-effort — returns null on
 * any error or limited read access, so the reply assistant falls back to a
 * pasted tweet. (Reading arbitrary tweets at scale needs the X API Basic tier.)
 */
export async function getTweetById(
  accessToken: string,
  tweetId: string,
): Promise<{ id: string; text: string; author: string | null } | null> {
  try {
    const params = new URLSearchParams({
      "tweet.fields": "text,author_id",
      expansions: "author_id",
      "user.fields": "username",
    });
    const res = await fetch(`https://api.x.com/2/tweets/${tweetId}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { id?: string; text?: string; author_id?: string };
      includes?: { users?: Array<{ id?: string; username?: string }> };
    };
    if (!json.data?.text) return null;
    const user = json.includes?.users?.find((u) => u.id === json.data?.author_id);
    return {
      id: json.data.id ?? tweetId,
      text: json.data.text.trim(),
      author: user?.username ? `@${user.username}` : null,
    };
  } catch {
    return null;
  }
}

/** Resolve an @handle to an X user id (best-effort — null on error/limited access). */
export async function getUserByUsername(
  accessToken: string,
  handle: string,
): Promise<{ id: string; username: string } | null> {
  try {
    const h = handle.replace(/^@/, "").trim();
    if (!h) return null;
    const res = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(h)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { id?: string; username?: string } };
    return json.data?.id ? { id: String(json.data.id), username: json.data.username ?? h } : null;
  } catch {
    return null;
  }
}

export interface XTweet {
  id: string;
  text: string;
  created_at: string | null;
  likes: number;
  replies: number;
  reposts: number;
}

/**
 * Fetch a user's recent ORIGINAL tweets (no retweets/replies) for the reply
 * radar. Returns null on any error or limited read access (403/429) — reading
 * arbitrary users' timelines needs the X API Basic tier — so callers can show a
 * clear "needs Basic tier" state; [] means "reachable, nothing new".
 */
export async function getUserRecentTweets(
  accessToken: string,
  userId: string,
  opts: { sinceId?: string | null; max?: number } = {},
): Promise<XTweet[] | null> {
  try {
    const params = new URLSearchParams({
      max_results: String(Math.min(Math.max(opts.max ?? 10, 5), 100)),
      exclude: "retweets,replies",
      "tweet.fields": "created_at,public_metrics,text",
    });
    if (opts.sinceId) params.set("since_id", opts.sinceId);
    const res = await fetch(`https://api.x.com/2/users/${userId}/tweets?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{
        id?: string;
        text?: string;
        created_at?: string;
        public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number };
      }>;
    };
    return (json.data ?? [])
      .filter((t) => t.id && t.text)
      .map((t) => ({
        id: String(t.id),
        text: (t.text ?? "").trim(),
        created_at: t.created_at ?? null,
        likes: t.public_metrics?.like_count ?? 0,
        replies: t.public_metrics?.reply_count ?? 0,
        reposts: t.public_metrics?.retweet_count ?? 0,
      }));
  } catch {
    return null;
  }
}
