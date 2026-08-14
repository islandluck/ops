import "server-only";

import { getAnthropic } from "@/lib/ai/client";

/**
 * Compose a ready-to-send outbound email from a one-line instruction, in the
 * founder's voice. Returns the recipient it inferred + a subject + a body WITHOUT
 * a signature (the engine appends the saved signature verbatim, so formatting is
 * always clean). Never fabricates facts, meetings, names, or numbers.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export interface ComposedEmail {
  recipient_name: string;
  recipient_email: string;
  subject: string;
  body: string;
}

export async function composeOutbound(input: {
  intent: string;
  company: string;
  context: string;
  replyStyle: string;
}): Promise<ComposedEmail> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Email drafting isn't configured (ANTHROPIC_API_KEY missing).");

  const client = getAnthropic();
  const system = [
    `You are the executive assistant for ${input.company || "the company"}, turning a one-line instruction into a complete, ready-to-send business email in the founder's voice.`,
    input.context ? `About the business: ${input.context}` : "",
    input.replyStyle ? `Write in this tone and style: ${input.replyStyle}` : "Write warm, clear, and professional.",
    "",
    "From the instruction, determine:",
    '- recipient_name: who the email is addressed to (e.g. "Jane", "Jane Doe", "the Gates Foundation program officer"). Your best guess; "" if truly unclear.',
    '- recipient_email: ONLY if an email address appears literally in the instruction; otherwise "".',
    "- subject: a concise, specific subject line (no \"Re:\").",
    "- body: the full email — a greeting, 1–3 tight paragraphs that accomplish the ask, and a sign-off line (e.g. \"Best,\").",
    "  Do NOT add a signature, the sender's name, title, or contact details after the sign-off — those are appended automatically.",
    "  Never invent facts, meetings, dates, numbers, links, or names that aren't in the instruction or the business context. If a detail is unknown, keep it general.",
    "",
    'Respond with ONLY JSON, no markdown fences: {"recipient_name": string, "recipient_email": string, "subject": string, "body": string}',
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: input.intent.slice(0, 1000) }],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The model didn't return a usable draft.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Couldn't parse the drafted email.");
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    recipient_name: str(parsed.recipient_name).slice(0, 200),
    recipient_email: str(parsed.recipient_email).slice(0, 200),
    subject: str(parsed.subject).slice(0, 300) || "Quick note",
    body: str(parsed.body),
  };
}
