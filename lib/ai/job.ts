import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import type { EmploymentType, ScreeningQuestion } from "@/lib/types";

/**
 * Job-description writer. Given the company brief + a role title (and optional
 * notes on what the owner wants), drafts a compelling, honest job description in
 * MARKDOWN plus a couple of short screening questions. The owner reviews and
 * edits before posting — never auto-published.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const EMPLOYMENT: EmploymentType[] = ["full_time", "part_time", "contract", "internship", "temporary"];

export interface JobDraftInput {
  title: string;
  location?: string;
  employmentType?: EmploymentType;
  /** Free-text notes from the owner on the role (responsibilities, must-haves). */
  notes?: string;
  brief: {
    company_name: string;
    business_description: string;
    core_offer: string;
    ideal_customer_profile: string;
  };
}

export interface JobDraft {
  title: string;
  location: string;
  employment_type: EmploymentType;
  description_md: string;
  screening_questions: ScreeningQuestion[];
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

/** Draft a job description + screening questions for a role. */
export async function draftJobDescription(input: JobDraftInput): Promise<JobDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const title = input.title.trim();
  if (!title) throw new Error("Give the role a title first.");
  const client = getAnthropic();
  const b = input.brief;

  const system = [
    `You are a senior recruiter and copywriter helping ${b.company_name || "a company"} write a job description that attracts strong, well-matched candidates.`,
    b.business_description ? `What the company does: ${b.business_description}` : "",
    b.core_offer ? `Core offer: ${b.core_offer}` : "",
    b.ideal_customer_profile ? `Who they serve: ${b.ideal_customer_profile}` : "",
    "",
    "Write a job description in MARKDOWN with these sections (use ## headings): About the role, What you'll do, What we're looking for, Nice to have, and a short closing About us. Use short paragraphs and bullet lists. Be specific and honest; do NOT invent compensation, benefits, equity, headcount, or facts you weren't given. Warm, direct, non-corporate tone. No emojis.",
    "Also propose 2-4 SHORT screening questions a candidate answers when applying — the kind that quickly reveal fit for THIS role (not generic). Each has a prompt and whether it's required.",
    "",
    "Respond with ONLY a JSON object (no markdown fences):",
    '{"title": string, "location": string, "employment_type": "full_time"|"part_time"|"contract"|"internship"|"temporary", "description_md": string, "screening_questions": [{"prompt": string, "required": boolean}]}',
    "For location/employment_type, use what the user gave; otherwise infer a sensible default (e.g. \"Remote\", full_time).",
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = [
    `Role title: ${title}`,
    input.location ? `Location: ${input.location}` : "",
    input.employmentType ? `Employment type: ${input.employmentType}` : "",
    input.notes ? `Notes from the hiring manager:\n${input.notes}` : "",
    "",
    "Draft the job description now.",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = msg.content.map((bl) => (bl.type === "text" ? bl.text : "")).join("").trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The draft came back malformed — try again.");
  }

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const empRaw = str(obj.employment_type).trim() as EmploymentType;
  const employment_type = EMPLOYMENT.includes(empRaw) ? empRaw : input.employmentType ?? "full_time";

  const qsRaw = Array.isArray(obj.screening_questions) ? (obj.screening_questions as Record<string, unknown>[]) : [];
  const screening_questions: ScreeningQuestion[] = qsRaw
    .map((q, i) => ({
      id: `q${i + 1}`,
      prompt: str(q.prompt).trim().slice(0, 300),
      required: q.required === true,
    }))
    .filter((q) => q.prompt.length > 0)
    .slice(0, 4);

  return {
    title: str(obj.title).trim().slice(0, 200) || title,
    location: str(obj.location).trim().slice(0, 120) || input.location || "Remote",
    employment_type,
    description_md: str(obj.description_md).trim().slice(0, 12000),
    screening_questions,
  };
}
