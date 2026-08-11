import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/client";

/**
 * Turn a natural-language scheduling request ("recurring Monday meeting with the
 * team 8:30–9:30am EST") into concrete calendar-event fields — real date, times,
 * duration, timezone, and recurrence — so the event lands correctly instead of
 * a naive "task title at due_at + 30min".
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export interface ExtractedEvent {
  isEvent: boolean;
  title: string;
  /** Local wall-clock, paired with timeZone (no offset). */
  startLocal: string;
  endLocal: string;
  timeZone: string;
  /** RRULE string (e.g. "RRULE:FREQ=WEEKLY;BYDAY=MO") or null for a one-off. */
  recurrence: string | null;
}

function firstJson<T>(text: string): T | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1)) as T;
  } catch {
    return null;
  }
}

/** Returns null if the model/API is unavailable or the response is unusable —
 *  the caller then falls back to a naive event. */
export async function extractCalendarEvent(
  request: string,
  nowISO: string,
  defaultTz: string,
): Promise<ExtractedEvent | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const tz = defaultTz || "America/New_York";

  const system = [
    "You convert a scheduling request into ONE calendar event. Return STRICT JSON only — no prose, no markdown.",
    `Now (ISO): ${nowISO}. Default timezone: ${tz}.`,
    "Rules:",
    "- Resolve concrete dates relative to Now. 'next Monday' = the soonest upcoming Monday AFTER Now; 'Monday' with a recurring intent = the next Monday.",
    "- Times are wall-clock in the event's timezone (NO offset, NO 'Z'). If the user names a zone, map it: EST/EDT/ET → America/New_York, PST/PDT/PT → America/Los_Angeles, CST/CDT/CT → America/Chicago, MST/MDT/MT → America/Denver. Otherwise use the default.",
    "- Honor explicit start AND end times. If only a start is given, default to a 30-minute duration.",
    "- recurrence: an RRULE when the request repeats (weekly Monday → \"RRULE:FREQ=WEEKLY;BYDAY=MO\"; every weekday → \"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\"; monthly → \"RRULE:FREQ=MONTHLY\"). null for a one-off.",
    "- title: a short, clean event name — NEVER meta text like 'schedule a...' or 'I will create...'. Infer a sensible title (e.g. 'Team Meeting', 'Weekly Standup').",
    "- isEvent=false ONLY if the request has no schedulable time at all.",
    'JSON: {"isEvent":true,"title":"","startLocal":"YYYY-MM-DDTHH:MM:SS","endLocal":"YYYY-MM-DDTHH:MM:SS","timeZone":"IANA","recurrence":"RRULE:..."|null}',
  ].join("\n");

  try {
    const client = getAnthropic({ maxRetries: 1 });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: request.slice(0, 2000) }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const p = firstJson<ExtractedEvent>(text);
    if (!p || typeof p.startLocal !== "string" || typeof p.endLocal !== "string") return null;
    // Basic sanity: must look like a local datetime.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p.startLocal) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p.endLocal)) {
      return null;
    }
    return {
      isEvent: p.isEvent !== false,
      title: String(p.title || "Meeting").slice(0, 200),
      startLocal: p.startLocal,
      endLocal: p.endLocal,
      timeZone: String(p.timeZone || tz),
      recurrence: typeof p.recurrence === "string" && p.recurrence.startsWith("RRULE") ? p.recurrence : null,
    };
  } catch {
    return null;
  }
}
