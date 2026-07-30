import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { fitToX } from "@/lib/social/x-post";
import type { Category, DraftRequest } from "@/lib/types";

/**
 * Phase 2 — real AI drafting with Claude. Agents draft business content
 * (emails, copy, summaries, social posts) grounded in the workspace's business
 * brief, and revise drafts on request. Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const CATEGORY_AGENT: Record<Category, string> = {
  growth: "Growth",
  admin: "Admin",
  content: "Content",
  research: "Research",
  finance: "Finance",
};

function systemPrompt(r: DraftRequest): string {
  const voice = r.voiceRules.length
    ? r.voiceRules.map((v) => `- ${v}`).join("\n")
    : "- Warm, clear, and professional";
  const restricted = r.restrictedPhrases.length
    ? r.restrictedPhrases.join(", ")
    : "(none specified)";

  const persona =
    r.agentInstructions?.trim() ||
    `You are the ${CATEGORY_AGENT[r.category]} Agent, an operations assistant that prepares business content for the owner to review and approve.`;

  return [
    `${persona}`,
    `You work for ${r.companyName}.`,
    "",
    `About the business: ${r.companyContext}`,
    r.idealCustomer ? `Ideal customer: ${r.idealCustomer}` : "",
    "",
    "Write in this brand voice:",
    voice,
    "",
    `Never use these restricted phrases: ${restricted}.`,
    "",
    r.xPost
      ? "This is a post for X (Twitter): write ONE complete, self-contained post of AT MOST 280 characters — a finished thought that fits within the limit, never a truncated paragraph. Keep any hashtags inline, within the 280."
      : "",
    "Output ONLY the finished draft, ready to use — no preamble, no explanation, no meta-commentary, no markdown code fences, and no notes about what you changed. Do not begin with phrases like \"Here is\" or \"Sure\". If you are drafting an email, include a Subject line and the body.",
  ]
    .filter(Boolean)
    .join("\n");
}

function userPrompt(r: DraftRequest): string {
  if (r.instruction && r.existingDraft) {
    return [
      `Task: ${r.title}`,
      `Details: ${r.description}`,
      "",
      "Here is the current draft:",
      "---",
      r.existingDraft,
      "---",
      "",
      `Revise the draft based on this feedback: "${r.instruction}"`,
      "Return the full revised draft.",
    ].join("\n");
  }
  return [
    `Task: ${r.title}`,
    `Details: ${r.description}`,
    r.rationale ? `Why this matters now: ${r.rationale}` : "",
    "",
    "Write the draft for this task now.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Generate (or revise) a draft. Throws a friendly Error on failure. */
export async function draftWithClaude(req: DraftRequest): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI drafting is not configured (ANTHROPIC_API_KEY missing).");

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: systemPrompt(req),
      messages: [{ role: "user", content: userPrompt(req) }],
    });

    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    if (!text) throw new Error("The model returned an empty draft. Please try again.");
    // Guarantee X posts fit — the model is asked to, but this is the hard cap.
    return req.xPost ? fitToX(text) : text;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("AI drafting failed: the Anthropic API key is invalid.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("AI drafting is rate-limited right now. Please try again in a moment.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`AI drafting failed (${err.status ?? "API error"}). Please try again.`);
    }
    throw err instanceof Error ? err : new Error("AI drafting failed.");
  }
}
