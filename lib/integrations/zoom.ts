import "server-only";

import { fetchWithTimeout } from "./http";

/** Zoom API — create scheduled meetings on the connected user's account. */

export interface ZoomMeeting {
  id: string;
  join_url: string;
  start_url: string;
  password: string;
  start_time: string;
  topic: string;
}

/**
 * Create a scheduled Zoom meeting for the connected user. `startTime` is an ISO
 * 8601 timestamp; pass a `timezone` (IANA, e.g. "America/New_York") so Zoom shows
 * the right local time.
 */
export async function createZoomMeeting(
  accessToken: string,
  input: { topic: string; startTime: string; durationMin?: number; timezone?: string; agenda?: string },
): Promise<ZoomMeeting> {
  const res = await fetchWithTimeout("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: input.topic.slice(0, 200) || "Meeting",
      type: 2, // scheduled
      start_time: input.startTime,
      duration: Math.min(Math.max(input.durationMin ?? 30, 5), 600),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.agenda ? { agenda: input.agenda.slice(0, 2000) } : {}),
      settings: { join_before_host: true, waiting_room: false, approval_type: 2 },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: number | string;
    join_url?: string;
    start_url?: string;
    password?: string;
    start_time?: string;
    topic?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(`Zoom meeting creation failed: ${json.message ?? res.status}`);
  }
  return {
    id: String(json.id ?? ""),
    join_url: json.join_url ?? "",
    start_url: json.start_url ?? "",
    password: json.password ?? "",
    start_time: json.start_time ?? input.startTime,
    topic: json.topic ?? input.topic,
  };
}
