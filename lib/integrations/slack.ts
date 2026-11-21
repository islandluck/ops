import "server-only";

import { fetchWithTimeout } from "./http";

import { getValidAccessToken } from "./tokens";

/** Slack Web API client + workspace notification helper (chat.postMessage). */

const SLACK_API = "https://slack.com/api";

interface SlackResponse {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

/** Call a Slack Web API method with a bot token (form-encoded body). */
async function slackApi(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<SlackResponse> {
  const res = await fetchWithTimeout(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(params),
  });
  return (await res.json().catch(() => ({ ok: false, error: "bad_json" }))) as SlackResponse;
}

// Slack channel/group/DM IDs look like C0123ABCD / G… / D…; names don't.
const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{6,}$/;

/**
 * Resolve a channel name ("#general" or "general") to its ID. Encoded IDs pass
 * through unchanged. Returns null if no public channel matches.
 */
async function resolveChannelId(token: string, channel: string): Promise<string | null> {
  const trimmed = channel.trim();
  if (CHANNEL_ID_RE.test(trimmed)) return trimmed;
  const name = trimmed.replace(/^#/, "");
  if (!name) return null;
  // One page of public channels — covers workspaces up to 1000 channels.
  const res = await slackApi(token, "conversations.list", {
    types: "public_channel",
    exclude_archived: "true",
    limit: "1000",
  });
  if (!res.ok) return null;
  const channels = (res.channels as { id: string; name: string }[] | undefined) ?? [];
  return channels.find((ch) => ch.name === name)?.id ?? null;
}

export interface SlackPostResult {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
  /** True when Slack simply isn't connected — a no-op, not a real failure. */
  skipped?: boolean;
}

/** Post a message to a channel (name or ID) using a bot token. */
export async function postSlackMessage(
  token: string,
  channel: string,
  text: string,
): Promise<SlackPostResult> {
  const id = (await resolveChannelId(token, channel)) ?? channel.trim().replace(/^#/, "");
  const res = await slackApi(token, "chat.postMessage", {
    channel: id,
    text: text.slice(0, 3500),
    unfurl_links: "false",
  });
  if (!res.ok) return { ok: false, error: String(res.error ?? "post_failed") };
  return { ok: true, channel: String(res.channel ?? id), ts: res.ts ? String(res.ts) : undefined };
}

/**
 * Post a workspace notification to Slack (best-effort, never throws). No-ops
 * (skipped) when Slack isn't connected. Channel resolution: explicit override →
 * SLACK_DEFAULT_CHANNEL env → "general".
 */
export async function notifySlack(
  workspaceId: string,
  text: string,
  channelOverride?: string,
): Promise<SlackPostResult> {
  try {
    const token = await getValidAccessToken(workspaceId, "Slack");
    if (!token) return { ok: false, skipped: true };
    const channel = channelOverride?.trim() || process.env.SLACK_DEFAULT_CHANNEL?.trim() || "general";
    return await postSlackMessage(token, channel, text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "notify_failed" };
  }
}
