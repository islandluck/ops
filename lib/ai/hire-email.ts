import "server-only";

import { getAnthropic } from "@/lib/ai/client";

/**
 * Candidate-facing email drafter — writes a rejection or an interview-invite for
 * a specific applicant + role, in the company's voice. Draft only: it's staged
 * into the Email Manager for the owner to review and send. Never auto-sends.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export type HiringEmailKind = "rejection" | "interview";

export interface HiringEmailInput {
  kind: HiringEmailKind;
  job: { title: string };
  candidateName: string;
  senderName: string;
  brief: { company_name: string; business_description: string };
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function draftHiringEmail(input: HiringEmailInput): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const company = input.brief.company_name || "the company";
  const first = input.candidateName.split(/\s+/)[0] || "there";

  const guidance =
    input.kind === "rejection"
      ? [
          `Write a warm, respectful REJECTION email to ${first}, who applied for the ${input.job.title} role at ${company}.`,
          "Thank them sincerely for their time and interest. Let them know you won't be moving forward with their application at this time. Be kind and human, keep it brief (3-5 short sentences).",
          "Do NOT give detailed critique or reasons (keep it gracious and legally safe), do NOT make promises, and do NOT invent specifics. You may encourage them to apply for future roles if they'd be a fit.",
        ]
      : [
          `Write a warm, enthusiastic INTERVIEW-INVITE email to ${first}, who applied for the ${input.job.title} role at ${company}.`,
          "Thank them for applying, say you were impressed and would like to invite them to an interview, and ask for a few times that work in the next week or two so you can coordinate. Keep it brief and friendly (3-5 short sentences).",
          "Do NOT invent a specific date/time, a video link, or interviewer names — just ask for their availability.",
        ];

  const system = [
    "You draft short, genuine, professional candidate-facing emails for a hiring team. Plain email prose (no markdown, no placeholders like [Name] — use the actual names given).",
    ...guidance,
    `Sign off from ${input.senderName || company}.`,
    "",
    "Respond with ONLY this JSON (no fences):",
    '{"subject": string, "body": string}',
  ].join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system,
    messages: [
      {
        role: "user",
        content: `Candidate: ${input.candidateName}\nRole: ${input.job.title}\nCompany: ${company}\nSender: ${input.senderName || company}\n\nWrite the email now.`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The email draft came back malformed — try again.");
  }
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const fallbackSubject =
    input.kind === "rejection" ? `Update on your application — ${input.job.title}` : `Interview for ${input.job.title} at ${company}`;
  return {
    subject: str(obj.subject).trim().slice(0, 200) || fallbackSubject,
    body: str(obj.body).trim().slice(0, 4000),
  };
}
