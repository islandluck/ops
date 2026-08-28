import "server-only";

import { getAnthropic } from "@/lib/ai/client";

/**
 * Meeting-notes extractor (team plane) — reads a Notion meeting transcript
 * (typically captured by Notion AI) and structures it: the participants and the
 * action items, each with the person it was assigned to and a due date when the
 * notes state one. Advisory only — the manager confirms participants and
 * assignments before anything is created. Runs on the low-cost Haiku tier.
 */

const MODEL = process.env.TEAM_ASSISTANT_MODEL || "claude-haiku-4-5-20251001";

export interface MeetingActionDraft {
  title: string;
  detail: string;
  /** The participant name the item was assigned to, exactly as written; null if unassigned. */
  owner: string | null;
  /** ISO date (YYYY-MM-DD) if a due date is clearly stated; else null. */
  due: string | null;
}

export interface MeetingExtraction {
  title: string;
  /** ISO date (YYYY-MM-DD) of the meeting if stated; else null. */
  date: string | null;
  summary: string;
  participants: string[];
  actions: MeetingActionDraft[];
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Structure a meeting transcript into a title, participants, and action items.
 * Returns null when the page is empty or the model returns nothing usable.
 */
export async function extractMeeting(
  page: { title: string; text: string },
  roster: string[],
  today: string,
): Promise<MeetingExtraction | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const content = page.text.trim();
  if (!content) return null;
  const client = getAnthropic();

  const system = [
    "You read a meeting transcript or meeting notes (often captured by Notion AI) and structure it for a team.",
    `Today is ${today}.`,
    roster.length
      ? `The team roster: ${roster.join(", ")}. Prefer these exact names whenever a participant or an action-item owner matches one of them.`
      : "",
    "",
    "Extract:",
    "- title: a short, clear meeting title (reuse the page title if it is already good).",
    "- date: the meeting's date as YYYY-MM-DD if it is stated or clear from the notes; else null.",
    "- summary: 1-3 sentences on what the meeting covered.",
    "- participants: the names of the people who attended, exactly as written.",
    "- actions: every concrete action item, follow-up, or commitment. For each: title (a short imperative), detail (what needs to happen plus the relevant context), owner (the participant name the item was assigned to, exactly as written, or null if unassigned), due (YYYY-MM-DD if a deadline is clearly stated — resolve relative dates like \"by Friday\" against today's date — else null).",
    "",
    "Only include action items that are actually in the notes. Never invent people, tasks, dates, or facts that are not there.",
    "Respond with ONLY a JSON object (no markdown, no code fences):",
    '{"title": string, "date": string|null, "summary": string, "participants": string[], "actions": [{"title": string, "detail": string, "owner": string|null, "due": string|null}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [
      { role: "user", content: `Meeting page: "${page.title}"\n\n${content}\n\nStructure this meeting now.` },
    ],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  let obj: unknown;
  try {
    obj = JSON.parse(stripFences(text));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const nDate = (v: unknown): string | null =>
    typeof v === "string" && ISO_DATE.test(v.trim()) ? v.trim() : null;

  const actionsRaw = Array.isArray(o.actions) ? (o.actions as Record<string, unknown>[]) : [];
  const actions: MeetingActionDraft[] = actionsRaw
    .map((r) => {
      const owner = str(r.owner).trim();
      return {
        title: str(r.title).trim().slice(0, 160),
        detail: str(r.detail).trim().slice(0, 2000),
        owner: owner ? owner.slice(0, 120) : null,
        due: nDate(r.due),
      };
    })
    .filter((a) => a.title.length > 0)
    .slice(0, 40);

  const participants = Array.isArray(o.participants)
    ? (o.participants as unknown[])
        .map((p) => str(p).trim())
        .filter(Boolean)
        .slice(0, 40)
    : [];

  return {
    title: str(o.title).trim().slice(0, 200) || page.title,
    date: nDate(o.date),
    summary: str(o.summary).trim().slice(0, 2000),
    participants,
    actions,
  };
}
