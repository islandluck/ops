import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Category, PlannedTask, RiskLevel } from "@/lib/types";

/**
 * Task planner — turns a user's plain-language request into a concrete plan:
 * which integrations it needs, a ready-to-use draft of the actual content, and
 * a category + risk. This is what makes a manually-created task "think" instead
 * of landing as an empty shell. Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const CATEGORIES: Category[] = ["growth", "admin", "content", "research", "finance"];
const RISKS: RiskLevel[] = ["low", "medium", "high"];

export interface PlanBrief {
  company_name: string;
  business_description: string;
  core_offer: string;
  ideal_customer_profile: string;
  voice_rules: string[];
  restricted_phrases: string[];
}

export interface PlanContext {
  brief: PlanBrief;
  integrations: { name: string; connected: boolean }[];
}

function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function planTask(
  input: { title: string; notes?: string },
  ctx: PlanContext,
): Promise<PlannedTask> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI planning is not configured (ANTHROPIC_API_KEY missing).");

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const b = ctx.brief;
  const toolLines = ctx.integrations.length
    ? ctx.integrations.map((i) => `- ${i.name}${i.connected ? " (connected)" : " (NOT connected)"}`).join("\n")
    : "- (no tools available)";

  const system = [
    `You are Operator, an autonomous operations assistant for ${b.company_name || "the business"}.`,
    [b.business_description, b.core_offer].filter(Boolean).join(" "),
    b.ideal_customer_profile ? `Ideal customer: ${b.ideal_customer_profile}` : "",
    b.voice_rules.length ? `Brand voice: ${b.voice_rules.join("; ")}` : "",
    b.restricted_phrases.length ? `Never use: ${b.restricted_phrases.join(", ")}` : "",
    "",
    "The owner has handed you a task. Think it through and PLAN it:",
    "1. Work out what they actually want done.",
    "2. Decide which tools are required to complete it — use ONLY the exact tool names listed below. If a required tool is NOT connected, still include it (the owner will be told to connect it).",
    "3. Write a complete, ready-to-use DRAFT of the actual content the task acts on — the full email, document, page, or spreadsheet rows. This is what the owner reviews and approves. No placeholders like [name] unless the value is truly unknowable.",
    "4. Choose a category and a risk level.",
    "",
    "Available tools (use these EXACT names in affected_systems):",
    toolLines,
    "",
    `Categories: ${CATEGORIES.join(", ")}.`,
    "Risk: low (routine/internal), medium (external-facing or money-adjacent), high (irreversible or high-stakes).",
    'If the task sends an email, the draft MUST begin with a "Subject:" line, then a blank line, then the body.',
    "",
    "Respond with ONLY this JSON object (no markdown, no code fences, no commentary):",
    '{"title": string (max ~70 chars), "category": string, "affected_systems": string[], "risk_level": "low"|"medium"|"high", "requires_approval": boolean, "rationale": string (one sentence on what you will do), "draft": string}',
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = [
    `Task from the owner: ${input.title}`,
    input.notes ? `Extra details: ${input.notes}` : "",
    "",
    "Plan it now.",
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = message.content
    .map((blk) => (blk.type === "text" ? blk.text : ""))
    .join("")
    .trim();

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("Operator returned an unreadable plan. Please try again.");
  }

  const known = new Set(ctx.integrations.map((i) => i.name));
  const connected = new Set(ctx.integrations.filter((i) => i.connected).map((i) => i.name));
  const affected = Array.isArray(raw.affected_systems)
    ? (raw.affected_systems.filter((n): n is string => typeof n === "string" && known.has(n)))
    : [];
  const category: Category =
    typeof raw.category === "string" && (CATEGORIES as string[]).includes(raw.category)
      ? (raw.category as Category)
      : "admin";
  const risk: RiskLevel =
    typeof raw.risk_level === "string" && (RISKS as string[]).includes(raw.risk_level)
      ? (raw.risk_level as RiskLevel)
      : "low";

  return {
    title: String(raw.title || input.title).slice(0, 120),
    category,
    affected_systems: affected,
    risk_level: risk,
    requires_approval: raw.requires_approval !== false,
    rationale: String(raw.rationale || "Prepared by Operator.").slice(0, 300),
    draft: typeof raw.draft === "string" ? raw.draft : "",
    needs_connection: affected.filter((n) => !connected.has(n)),
  };
}
