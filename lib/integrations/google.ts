import "server-only";

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
  msg: { to: string; subject: string; body: string },
): Promise<{ id: string }> {
  const raw = base64url(
    [
      `To: ${msg.to}`,
      `Subject: ${encodeEmailHeader(msg.subject)}`,
      "Content-Type: text/plain; charset=UTF-8",
      "MIME-Version: 1.0",
      "",
      msg.body,
    ].join("\r\n"),
  );
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    },
  );
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string })?.message;
    throw new Error(`Gmail send failed: ${err ?? res.status}`);
  }
  return { id: String(json.id) };
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
  ev: { summary: string; description: string; startISO: string; endISO: string },
): Promise<{ id: string; htmlLink?: string }> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: ev.summary,
        description: ev.description,
        start: { dateTime: ev.startISO },
        end: { dateTime: ev.endISO },
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
