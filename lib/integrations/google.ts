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

export async function sendGmail(
  accessToken: string,
  msg: { to: string; subject: string; body: string },
): Promise<{ id: string }> {
  const raw = base64url(
    [
      `To: ${msg.to}`,
      `Subject: ${msg.subject}`,
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
