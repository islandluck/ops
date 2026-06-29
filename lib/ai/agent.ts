import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Agent, BusinessBrief } from "@/lib/types";

/** Have an agent propose a concrete piece of work (used by "Run agent" + cron). */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export interface GeneratedTask {
  title: string;
  rationale: string;
  draft: string;
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function generateAgentTask(
  agent: Agent,
  brief: BusinessBrief,
): Promise<GeneratedTask> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI drafting is not configured (ANTHROPIC_API_KEY missing).");

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const system = [
    agent.instructions?.trim() || `You are the ${agent.name}.`,
    `You work for ${brief.company_name}. ${brief.business_description} ${brief.core_offer}`.trim(),
    brief.ideal_customer_profile ? `Ideal customer: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
    brief.restricted_phrases.length ? `Never use: ${brief.restricted_phrases.join(", ")}` : "",
    "",
    "Propose ONE concrete, genuinely useful task you would prepare this week for the owner to review. Include a ready-to-use draft (email, copy, or summary as fits your role), on-brand and complete.",
    'Respond with ONLY a JSON object: {"title": string (max ~70 chars), "rationale": string (one sentence, why now), "draft": string}. No markdown, no code fences, no extra text.',
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: "Generate the task now." }],
  });

  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  let parsed: GeneratedTask;
  try {
    parsed = JSON.parse(stripFences(text)) as GeneratedTask;
  } catch {
    throw new Error("The agent returned an unparseable response. Please try again.");
  }
  if (!parsed.title || !parsed.draft) throw new Error("The agent returned an incomplete task.");
  return {
    title: parsed.title.slice(0, 120),
    rationale: parsed.rationale ?? "Prepared by the agent.",
    draft: parsed.draft,
  };
}
