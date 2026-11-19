import "server-only";

import { getAnthropic } from "@/lib/ai/client";

/**
 * Candidate screener — scores how well one applicant fits a specific role, based
 * only on job-relevant evidence (JD + résumé + their cover note and screening
 * answers). Fair by construction: it is instructed to ignore name/gender/age/etc.
 * Advisory only — the owner decides; nothing is auto-rejected.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export interface ScreenResult {
  /** 0-100 fit score for this specific role. */
  score: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  /** Worth an interview? */
  recommend: boolean;
}

export interface ScreenInput {
  job: { title: string; description_md: string; screening_questions: { prompt: string }[] };
  application: { cover_note: string; answers: { question: string; answer: string }[] };
  resumeText: string;
  brief: { company_name: string; business_description: string; core_offer: string };
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function screenCandidate(input: ScreenInput): Promise<ScreenResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const b = input.brief;

  const system = [
    `You are an experienced, fair hiring screener for ${b.company_name || "the company"}.`,
    b.business_description ? `Company: ${b.business_description}` : "",
    "Evaluate how well ONE candidate fits ONE specific role, using only job-relevant evidence.",
    "Score 0-100 for fit to THIS role, calibrated: 85+ = strong, clearly worth interviewing; 60-84 = plausible, worth a look; below 60 = weak fit. Base it on skills, experience, and the role's actual requirements.",
    "FAIRNESS (important): judge only job-relevant qualifications. Ignore and never reward or penalize name, gender, age, ethnicity, nationality, marital/family status, photos, or similar. If the résumé is thin or missing, note the lack of evidence rather than guessing.",
    "Be concrete and honest — cite what in their materials supports your read. Short bullets.",
    "",
    "Respond with ONLY this JSON (no markdown fences):",
    '{"score": number (0-100 integer), "summary": string (1-2 sentences), "strengths": string[], "concerns": string[], "recommend": boolean}',
  ]
    .filter(Boolean)
    .join("\n");

  const qLines = input.job.screening_questions.map((q) => `- ${q.prompt}`).join("\n");
  const aLines = input.application.answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");

  const userMsg = [
    `# Role: ${input.job.title}`,
    input.job.description_md || "(no description)",
    qLines ? `\n## Screening questions asked\n${qLines}` : "",
    "",
    "# Candidate materials",
    input.application.cover_note ? `## Why they're a fit (their words)\n${input.application.cover_note}` : "",
    aLines ? `## Their screening answers\n${aLines}` : "",
    input.resumeText.trim() ? `## Résumé\n${input.resumeText.slice(0, 9000)}` : "## Résumé\n(no résumé text could be read)",
    "",
    "Evaluate this candidate's fit for the role now.",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = msg.content.map((bl) => (bl.type === "text" ? bl.text : "")).join("").trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("Screening came back malformed — try again.");
  }

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => str(x).trim()).filter(Boolean).slice(0, 6) : [];
  const rawScore = typeof obj.score === "number" ? obj.score : Number(obj.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;

  return {
    score,
    summary: str(obj.summary).trim().slice(0, 600),
    strengths: arr(obj.strengths),
    concerns: arr(obj.concerns),
    recommend: obj.recommend === true,
  };
}
