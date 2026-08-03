import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { PlanBrief } from "@/lib/ai/plan";
import type { Category } from "@/lib/types";

/**
 * Notion triage extractor — reads a Notion page (typically meeting notes from a
 * Zoom call captured by Notion AI) and pulls out the OWNER'S action items, each
 * with a drafted deliverable when it warrants one (an email or a document).
 * Server-only; gated on ANTHROPIC_API_KEY. Purely advisory — nothing is sent or
 * created without the downstream approval flow.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const DEPARTMENTS: Category[] = ["growth", "admin", "content", "research", "finance"];
export type NotionDeliverable = "email" | "document" | "none";
const DELIVERABLES: NotionDeliverable[] = ["email", "document", "none"];

export interface NotionAction {
  title: string;
  detail: string;
  department: Category;
  deliverable: NotionDeliverable;
  /** A ready draft for email/document deliverables; empty for "none". */
  draft: string;
  /** Email recipient — only when explicitly present in the notes; else null. */
  recipient: string | null;
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function extractNotionActions(
  page: { title: string; text: string },
  brief: PlanBrief,
): Promise<NotionAction[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const content = page.text.trim();
  if (!content) return [];
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const system = [
    "You extract the OWNER'S action items from a Notion page — typically meeting notes (e.g. from a Zoom call captured by Notion AI). The owner is a busy founder.",
    `They run ${brief.company_name || "a company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Their customers: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Their brand voice: ${brief.voice_rules.join("; ")}` : "",
    "",
    "Pull out ONLY concrete action items the owner (or their team) needs to DO — commitments made, follow-ups, deliverables promised, things to send, meetings to schedule, prep. IGNORE: general notes, background, other people's action items, and anything already done (e.g. checked-off to-dos).",
    "For each action item: title (a short imperative), detail (what needs to happen + the relevant context from the notes + a suggested first step), department (growth, admin, content, research, finance).",
    "deliverable: if the item is fundamentally to SEND AN EMAIL, set \"email\" and write the full email draft — begin with a \"Subject:\" line, then a blank line, then the body; on-brand and ready to send after a glance. If it's to PRODUCE A DOCUMENT (a one-pager, summary, brief, deck outline), set \"document\" and write a solid first draft. Otherwise \"none\" with an empty draft.",
    "recipient: for an \"email\" deliverable, the recipient's email address ONLY if it is explicitly present in the notes; otherwise null. NEVER invent, guess, or use a placeholder address.",
    "Never fabricate facts, figures, names, or quotes that aren't in the notes. If a draft genuinely needs information you don't have, leave a clear [bracketed placeholder].",
    "",
    `Departments: ${DEPARTMENTS.join(", ")}.`,
    "Respond with ONLY a JSON array (no markdown, no code fences) — return [] if there are no action items:",
    '[{"title": string, "detail": string, "department": string, "deliverable": "email"|"document"|"none", "draft": string, "recipient": string|null}]',
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [
      {
        role: "user",
        content: `Notion page: "${page.title}"\n\n${content}\n\nExtract the owner's action items now.`,
      },
    ],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  let arr: unknown;
  try {
    arr = JSON.parse(stripFences(text));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const pickDept = (v: unknown): Category =>
    typeof v === "string" && (DEPARTMENTS as string[]).includes(v) ? (v as Category) : "admin";
  const pickDeliv = (v: unknown): NotionDeliverable =>
    typeof v === "string" && (DELIVERABLES as string[]).includes(v) ? (v as NotionDeliverable) : "none";
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return (arr as Record<string, unknown>[])
    .map((r) => {
      const rec = str(r.recipient).trim();
      return {
        title: str(r.title).trim().slice(0, 120),
        detail: str(r.detail).trim().slice(0, 2000),
        department: pickDept(r.department),
        deliverable: pickDeliv(r.deliverable),
        draft: str(r.draft).trim().slice(0, 6000),
        recipient: emailRe.test(rec) ? rec : null,
      };
    })
    .filter((a) => a.title.length > 0);
}
