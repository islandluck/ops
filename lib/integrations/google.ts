import "server-only";

import crypto from "node:crypto";
import { getValidAccessToken } from "./tokens";

/** Google API calls (Gmail send, Calendar events) with an OAuth access token. */

export async function getGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { email?: string };
  return json.email ?? null;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * RFC 2047 "B" encoding for email header values containing non-ASCII characters
 * (em dashes, emoji, accents). ASCII-only values pass through unchanged. Folded
 * into ≤45-byte chunks so each encoded-word stays under the 75-char limit and
 * never splits a multi-byte character. Without this, mail clients render raw
 * UTF-8 header bytes as mojibake (e.g. "—" → "Ã¢Â€Â").
 */
function encodeEmailHeader(value: string): string {
  if ([...value].every((c) => c.charCodeAt(0) <= 0x7f)) return value;
  const words: string[] = [];
  let chunk = "";
  const flush = () => {
    if (chunk) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
      chunk = "";
    }
  };
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) flush();
    chunk += ch;
  }
  flush();
  return words.join("\r\n ");
}

export async function sendGmail(
  accessToken: string,
  msg: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    threadId?: string;
    inReplyTo?: string;
    attachments?: { filename: string; mime: string; bytes: Buffer }[];
  },
): Promise<{ id: string }> {
  // Shared headers. Cc is delivered + visible; Bcc is delivered but Gmail strips
  // the header from the recipients' copies (blind).
  const headers = [`To: ${msg.to}`];
  if (msg.cc?.trim()) headers.push(`Cc: ${msg.cc.trim()}`);
  if (msg.bcc?.trim()) headers.push(`Bcc: ${msg.bcc.trim()}`);
  headers.push(`Subject: ${encodeEmailHeader(msg.subject)}`, "MIME-Version: 1.0");
  // Threading: link the reply to the original message so it lands in-thread.
  if (msg.inReplyTo) {
    headers.push(`In-Reply-To: ${msg.inReplyTo}`, `References: ${msg.inReplyTo}`);
  }

  const attachments = msg.attachments ?? [];
  let mimeMessage: string;
  if (attachments.length === 0) {
    mimeMessage = [...headers, "Content-Type: text/plain; charset=UTF-8", "", msg.body].join("\r\n");
  } else {
    // multipart/mixed: the text body, then each attachment base64-encoded.
    const boundary = `mixed_${crypto.randomBytes(12).toString("hex")}`;
    const parts: string[] = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      msg.body,
    ];
    for (const a of attachments) {
      const name = a.filename.replace(/["\r\n]/g, "").slice(0, 255) || "attachment";
      const b64 = a.bytes.toString("base64").replace(/(.{76})/g, "$1\r\n");
      parts.push(
        `--${boundary}`,
        `Content-Type: ${a.mime || "application/octet-stream"}; name="${name}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${name}"`,
        "",
        b64,
      );
    }
    parts.push(`--${boundary}--`);
    mimeMessage = parts.join("\r\n");
  }

  const raw = base64url(mimeMessage);
  const payload: Record<string, string> = { raw };
  if (msg.threadId) payload.threadId = msg.threadId;

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string })?.message;
    throw new Error(`Gmail send failed: ${err ?? res.status}`);
  }
  return { id: String(json.id) };
}

/* ------------------------------ Gmail read (triage) ------------------------- */

export interface GmailMessage {
  id: string;
  threadId: string;
  from: { name: string; email: string };
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  /** RFC 5322 Message-ID header, used to thread replies. */
  messageId: string;
}

/** List recent inbox message ids matching a Gmail search query. */
export async function listInboxMessages(
  accessToken: string,
  opts?: { max?: number; query?: string },
): Promise<{ id: string; threadId: string }[]> {
  const q = encodeURIComponent(opts?.query ?? "in:inbox is:unread");
  const max = opts?.max ?? 15;
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 403) {
    throw new Error("Gmail read access isn't granted. Reconnect Google in Integrations to enable inbox triage.");
  }
  const json = (await res.json()) as { messages?: { id: string; threadId: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Gmail list failed: ${json.error?.message ?? res.status}`);
  return (json.messages ?? []).map((m) => ({ id: m.id, threadId: m.threadId }));
}

type GmailHeader = { name: string; value: string };
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

function headerVal(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  return { name: raw.trim(), email: raw.trim() };
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractBody(payload: GmailPart | undefined): string {
  const find = (p: GmailPart | undefined, mime: string): string | null => {
    if (!p) return null;
    if (p.mimeType === mime && p.body?.data) return decodeB64Url(p.body.data);
    for (const child of p.parts ?? []) {
      const r = find(child, mime);
      if (r) return r;
    }
    return null;
  };
  const plain = find(payload, "text/plain");
  if (plain) return plain;
  const html = find(payload, "text/html");
  return html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "";
}

/** Fetch a single message's sender, subject, body, and threading headers. */
export async function getMessageDetail(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = (await res.json()) as {
    id: string;
    threadId: string;
    snippet?: string;
    payload?: { headers?: GmailHeader[] } & GmailPart;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Gmail get failed: ${json.error?.message ?? res.status}`);
  const headers = json.payload?.headers ?? [];
  return {
    id: json.id,
    threadId: json.threadId,
    from: parseFrom(headerVal(headers, "From")),
    to: headerVal(headers, "To"),
    subject: headerVal(headers, "Subject") || "(no subject)",
    date: headerVal(headers, "Date"),
    snippet: json.snippet ?? "",
    body: extractBody(json.payload).slice(0, 4000),
    messageId: headerVal(headers, "Message-ID"),
  };
}

export interface GmailMeta {
  id: string;
  threadId: string;
  from: { name: string; email: string };
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

/** One page of inbox message ids + a token for the next page (for 10-at-a-time paging). */
export async function listInboxPage(
  accessToken: string,
  opts?: { max?: number; pageToken?: string; query?: string },
): Promise<{ items: { id: string; threadId: string }[]; nextPageToken: string | null }> {
  const q = encodeURIComponent(opts?.query ?? "in:inbox");
  const max = opts?.max ?? 10;
  const pt = opts?.pageToken ? `&pageToken=${encodeURIComponent(opts.pageToken)}` : "";
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}${pt}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 403) {
    throw new Error("Gmail read access isn't granted. Reconnect Google in Integrations to load your inbox.");
  }
  const json = (await res.json()) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Gmail list failed: ${json.error?.message ?? res.status}`);
  return {
    items: (json.messages ?? []).map((m) => ({ id: m.id, threadId: m.threadId })),
    nextPageToken: json.nextPageToken ?? null,
  };
}

/** Light per-message fetch (headers + snippet only) for rendering an inbox row. */
export async function getMessageMeta(accessToken: string, id: string): Promise<GmailMeta> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = (await res.json()) as {
    id: string;
    threadId: string;
    snippet?: string;
    labelIds?: string[];
    payload?: { headers?: GmailHeader[] };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Gmail get failed: ${json.error?.message ?? res.status}`);
  const headers = json.payload?.headers ?? [];
  return {
    id: json.id,
    threadId: json.threadId,
    from: parseFrom(headerVal(headers, "From")),
    subject: headerVal(headers, "Subject") || "(no subject)",
    date: headerVal(headers, "Date"),
    snippet: json.snippet ?? "",
    unread: (json.labelIds ?? []).includes("UNREAD"),
  };
}

/** Shared 403 message when the gmail.modify scope hasn't been granted yet. */
const MODIFY_SCOPE_ERROR =
  "Gmail archive/delete access isn't granted. Reconnect Google in Integrations to enable it.";

/** Archive a message — drop the INBOX label so it leaves the inbox. Needs gmail.modify. */
export async function archiveMessage(accessToken: string, id: string): Promise<void> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    },
  );
  if (res.status === 403) throw new Error(MODIFY_SCOPE_ERROR);
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Gmail archive failed: ${json.error?.message ?? res.status}`);
  }
}

/** Move a message to Trash — recoverable in Gmail for 30 days, NOT a permanent delete. Needs gmail.modify. */
export async function trashMessage(accessToken: string, id: string): Promise<void> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 403) throw new Error(MODIFY_SCOPE_ERROR);
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Gmail trash failed: ${json.error?.message ?? res.status}`);
  }
}

/** Create a spreadsheet and write the given rows (starting at A1). Returns its URL. */
export async function createSpreadsheet(
  accessToken: string,
  sheet: { title: string; rows: string[][] },
): Promise<{ id: string; url?: string }> {
  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title: sheet.title } }),
  });
  const created = (await createRes.json()) as Record<string, unknown>;
  if (!createRes.ok) {
    const err = (created.error as { message?: string })?.message;
    throw new Error(`Sheets create failed: ${err ?? createRes.status}`);
  }
  const id = String(created.spreadsheetId);
  const url = created.spreadsheetUrl ? String(created.spreadsheetUrl) : undefined;

  if (sheet.rows.length) {
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:append?valueInputOption=RAW`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: sheet.rows }),
      },
    );
    if (!appendRes.ok) {
      const err = ((await appendRes.json()) as { error?: { message?: string } }).error?.message;
      throw new Error(`Sheets write failed: ${err ?? appendRes.status}`);
    }
  }
  return { id, url };
}

export async function createCalendarEvent(
  accessToken: string,
  ev: {
    summary: string;
    description: string;
    /** Start time. With `timeZone`, a local wall-clock ("2026-08-10T08:30:00");
     *  without it, an absolute UTC ISO ("...Z"). */
    startISO: string;
    endISO: string;
    /** IANA zone (e.g. "America/New_York") when startISO/endISO are local. */
    timeZone?: string;
    /** RRULE strings, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO"]. */
    recurrence?: string[];
    attendees?: string[];
  },
): Promise<{ id: string; htmlLink?: string }> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: ev.summary,
        description: ev.description,
        start: { dateTime: ev.startISO, ...(ev.timeZone ? { timeZone: ev.timeZone } : {}) },
        end: { dateTime: ev.endISO, ...(ev.timeZone ? { timeZone: ev.timeZone } : {}) },
        ...(ev.recurrence?.length ? { recurrence: ev.recurrence } : {}),
        ...(ev.attendees?.length ? { attendees: ev.attendees.map((email) => ({ email })) } : {}),
      }),
    },
  );
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string })?.message;
    throw new Error(`Calendar event failed: ${err ?? res.status}`);
  }
  return { id: String(json.id), htmlLink: json.htmlLink ? String(json.htmlLink) : undefined };
}

/* ---------------------------- Calendar read (senses) --------------------- */

export interface CalEvent {
  id: string;
  title: string;
  /** ISO start (dateTime for timed events, YYYY-MM-DD for all-day). */
  start: string;
  allDay: boolean;
  attendees: number;
  location: string;
  hangoutLink?: string;
}

export interface CalendarSnapshot {
  connected: boolean;
  events: CalEvent[];
  todayCount: number;
  weekCount: number;
  fetchedAt: string;
}

/** Upcoming events on the primary calendar (next `days`, chronological). */
export async function listUpcomingEvents(
  accessToken: string,
  opts?: { days?: number; max?: number },
): Promise<CalEvent[]> {
  const days = opts?.days ?? 7;
  const max = opts?.max ?? 25;
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?singleEvents=true&orderBy=startTime&maxResults=${max}` +
    `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
    throw new Error(`Calendar list failed: ${err ?? res.status}`);
  }
  const json = (await res.json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      status?: string;
      location?: string;
      hangoutLink?: string;
      start?: { dateTime?: string; date?: string };
      attendees?: unknown[];
    }>;
  };
  return (json.items ?? [])
    .filter((it) => it.status !== "cancelled" && (it.start?.dateTime || it.start?.date))
    .map((it) => ({
      id: String(it.id ?? ""),
      title: String(it.summary ?? "(no title)"),
      start: String(it.start?.dateTime ?? it.start?.date),
      allDay: !it.start?.dateTime,
      attendees: Array.isArray(it.attendees) ? it.attendees.length : 0,
      location: String(it.location ?? ""),
      hangoutLink: it.hangoutLink ? String(it.hangoutLink) : undefined,
    }));
}

/** A short human label for an event's time, in the workspace timezone. */
export function formatEventWhen(iso: string, allDay: boolean, tz?: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { timeZone: tz || undefined, weekday: "short", month: "short", day: "numeric" });
  if (allDay) return `${day} (all day)`;
  const time = d.toLocaleTimeString("en-US", { timeZone: tz || undefined, hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

/** The agent-readable schedule picture. Null = Calendar isn't connected. */
export async function getCalendarSnapshot(workspaceId: string, tz?: string): Promise<CalendarSnapshot | null> {
  const token = await getValidAccessToken(workspaceId, "Google Calendar");
  if (!token) return null;
  let events: CalEvent[];
  try {
    events = await listUpcomingEvents(token, { days: 7, max: 25 });
  } catch {
    // Token present but the read failed (expired/revoked refresh token, or a
    // transient error). Return null so callers OMIT the schedule rather than
    // showing a misleading "nothing scheduled" for a broken connection.
    return null;
  }
  const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz || undefined });
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz || undefined });
  const todayCount = events.filter((e) => localDate(e.start) === todayStr).length;
  return { connected: true, events, todayCount, weekCount: events.length, fetchedAt: new Date().toISOString() };
}

/** One-line schedule summary for agent prompts ("" when not connected / empty). */
export function calendarToContext(snap: CalendarSnapshot | null, tz?: string): string {
  if (!snap || !snap.connected || !snap.events.length) return "";
  const next = snap.events[0];
  return (
    `Calendar: ${snap.todayCount} event${snap.todayCount === 1 ? "" : "s"} today, ` +
    `${snap.weekCount} in the next 7 days. Next: ${next.title} (${formatEventWhen(next.start, next.allDay, tz)}).`
  );
}

/** Cached (10 min) schedule context line for planners/drafters. Never throws. */
const calContextCache = new Map<string, { at: number; text: string }>();
export async function getCalendarContext(workspaceId: string, tz?: string): Promise<string> {
  const cacheKey = `${workspaceId}|${tz ?? ""}`;
  const hit = calContextCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.text;
  try {
    const text = calendarToContext(await getCalendarSnapshot(workspaceId, tz), tz);
    calContextCache.set(cacheKey, { at: Date.now(), text });
    return text;
  } catch {
    return hit?.text ?? "";
  }
}

/* ------------------------------- Drive ---------------------------------- */

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveEntry {
  id: string;
  name: string;
  isFolder: boolean;
  webViewLink: string;
  mimeType: string;
  modifiedTime: string;
}

interface DriveFileRaw {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  modifiedTime?: string;
  parents?: string[];
}

/** List a Drive folder's immediate children (folders first, then files by name). */
export async function listDriveFolder(accessToken: string, folderId: string): Promise<DriveEntry[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,mimeType,webViewLink,modifiedTime)");
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&orderBy=folder,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 403) {
    throw new Error("Google Drive access isn't granted. Reconnect Google in Integrations to enable it.");
  }
  const json = (await res.json()) as { files?: DriveFileRaw[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Drive list failed: ${json.error?.message ?? res.status}`);
  return (json.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    isFolder: f.mimeType === DRIVE_FOLDER_MIME,
    webViewLink: f.webViewLink ?? "",
    mimeType: f.mimeType ?? "",
    modifiedTime: f.modifiedTime ?? "",
  }));
}

/** A folder/file's name + parent ids (for validation + breadcrumbs). */
export async function getDriveMeta(
  accessToken: string,
  fileId: string,
): Promise<{ id: string; name: string; isFolder: boolean; parents: string[] }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 403) throw new Error("Google Drive access isn't granted. Reconnect Google in Integrations.");
  const json = (await res.json()) as DriveFileRaw & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Drive lookup failed: ${json.error?.message ?? res.status}`);
  return {
    id: json.id,
    name: json.name,
    isFolder: json.mimeType === DRIVE_FOLDER_MIME,
    parents: json.parents ?? [],
  };
}

/** True if `folderId` is `teamFolderId` or a descendant of it (bounded parent walk). */
export async function isWithinDriveFolder(
  accessToken: string,
  folderId: string,
  teamFolderId: string,
): Promise<boolean> {
  if (folderId === teamFolderId) return true;
  let current = folderId;
  for (let i = 0; i < 8; i++) {
    const meta = await getDriveMeta(accessToken, current);
    if (meta.parents.includes(teamFolderId)) return true;
    if (!meta.parents.length) return false;
    current = meta.parents[0];
    if (current === teamFolderId) return true;
  }
  return false;
}
