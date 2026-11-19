import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import type { TavilyResult } from "@/lib/integrations/tavily";
import type { ScoutLead } from "@/lib/types";

/**
 * Recruiting scout — distills live web-search results into candidate LEADS for a
 * role (real people found in the results, never invented), and drafts a warm
 * outreach message. Suggestions only: the owner reaches out themselves.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function scoutCandidates(input: {
  job: { title: string; description_md: string };
  brief: { company_name: string; business_description: string };
  results: TavilyResult[];
}): Promise<ScoutLead[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  if (!input.results.length) return [];
  const client = getAnthropic();

  const system = [
    `You help a recruiter at ${input.brief.company_name || "a company"} source candidates for a role from web-search results.`,
    "From the results, extract REAL named individuals who could be strong candidates (e.g. from LinkedIn profiles, team/about pages, author bylines, conference speaker lists, directories).",
    "For each: name, headline (their role/title or a one-line descriptor), why_fit (ONE sentence tying their background to this role), url (the source profile/page from the results).",
    "HARD RULES: only real people actually present in the results. NEVER invent names, titles, or URLs. Skip results that aren't about a specific person. If the results are thin, return fewer (or none). At most 8.",
    "",
    "Respond with ONLY this JSON (no fences): {\"leads\": [{\"name\": string, \"headline\": string, \"why_fit\": string, \"url\": string}]}",
  ].join("\n");

  const resultsBlock = input.results
    .slice(0, 12)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 600)}`)
    .join("\n\n");

  const userMsg = [
    `# Role: ${input.job.title}`,
    input.job.description_md.slice(0, 2500) || "(no description)",
    "",
    "# Web search results",
    resultsBlock,
    "",
    "Extract the candidate leads now.",
  ].join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    return [];
  }
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const raw = Array.isArray(obj.leads) ? (obj.leads as Record<string, unknown>[]) : [];
  return raw
    .map((l) => ({
      name: str(l.name).trim().slice(0, 120),
      headline: str(l.headline).trim().slice(0, 200),
      why_fit: str(l.why_fit).trim().slice(0, 300),
      url: str(l.url).trim().slice(0, 500),
    }))
    .filter((l) => l.name.length > 0)
    .slice(0, 8);
}

export async function draftOutreach(input: {
  job: { title: string };
  lead: { name: string; headline: string };
  brief: { company_name: string; business_description: string };
  senderName: string;
}): Promise<{ message: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = getAnthropic();
  const company = input.brief.company_name || "our company";
  const first = input.lead.name.split(/\s+/)[0] || "there";

  const system = [
    `You write short, warm, personalized recruiting outreach messages for ${company}.`,
    input.brief.business_description ? `About the company: ${input.brief.business_description}` : "",
    `Write a message to ${first} (currently: ${input.lead.headline || "—"}) about the ${input.job.title} role. Say why you're reaching out (tie to their background), a sentence on the role/company, and a soft ask to chat. 4-6 sentences, friendly and genuine — not spammy or over-formal.`,
    "Do NOT invent specifics about them beyond the headline given, and do NOT fabricate compensation or details. Sign off from " + (input.senderName || company) + ".",
    "",
    "Respond with ONLY this JSON (no fences): {\"message\": string}",
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system,
    messages: [
      {
        role: "user",
        content: `Candidate: ${input.lead.name} — ${input.lead.headline}\nRole: ${input.job.title}\nCompany: ${company}\nFrom: ${input.senderName || company}\n\nWrite the outreach now.`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 2000) };
  }
  const message = typeof obj.message === "string" ? obj.message.trim().slice(0, 2000) : "";
  return { message };
}
