import "server-only";

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { BriefKind, BriefSuggestion, BriefSuggestionKind, Category, ExecBriefContent } from "@/lib/types";

const CATEGORIES: Category[] = ["growth", "admin", "content", "research", "finance"];
const SUGGESTION_KINDS: BriefSuggestionKind[] = ["project", "campaign", "task"];

/**
 * The Executive Agent's conversational brain — a tool-using chat loop. The engine
 * (lib/agents/executive.ts) supplies the grounded system prompt and the tool
 * implementations; this runs the Claude turn(s), executing tools the model calls
 * (create a project, log a goal, remember a fact) until it produces a final reply.
 * Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/** A tool the Executive Agent can call. `run` executes it and returns a short
 *  result the model sees, plus an optional deep link surfaced to the user. */
export interface ExecTool {
  definition: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<{ summary: string; href?: string }>;
}

export interface ExecReplyResult {
  text: string;
  actions: { tool: string; summary: string; href?: string }[];
}

export async function executiveReply(opts: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  tools: ExecTool[];
}): Promise<ExecReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const toolDefs = opts.tools.map((t) => t.definition);
  const toolByName = new Map(opts.tools.map((t) => [t.definition.name, t]));

  const messages: Anthropic.MessageParam[] = [
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: opts.userMessage },
  ];

  const actions: { tool: string; summary: string; href?: string }[] = [];
  let finalText = "";

  // Bounded tool loop: the model may call tools across a few rounds before it
  // settles on a final text reply.
  for (let round = 0; round < 5; round++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: opts.system,
      ...(toolDefs.length ? { tools: toolDefs } : {}),
      messages,
    });

    const textBlocks = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textBlocks.length) finalText = textBlocks.join("\n").trim();

    if (res.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const tool = toolByName.get(block.name);
      let resultText = "That tool isn't available.";
      if (tool) {
        try {
          const r = await tool.run((block.input ?? {}) as Record<string, unknown>);
          resultText = r.summary;
          actions.push({ tool: block.name, summary: r.summary, href: r.href });
        } catch (e) {
          resultText = `Error: ${e instanceof Error ? e.message : "the tool failed"}`;
        }
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) finalText = actions.length ? "Done." : "I didn't catch that — could you rephrase?";
  return { text: finalText, actions };
}

/* ------------------------------ daily brief ----------------------------- */

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

const strArray = (v: unknown, cap = 8): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, cap) : [];

/**
 * Synthesize the founder's daily executive brief from a data dossier the engine
 * assembles. Grounded and honest — it must not invent numbers, tasks, or outcomes.
 */
export async function generateBrief(
  dossier: string,
  companyName: string,
  kind: BriefKind = "daily",
): Promise<ExecBriefContent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const isWeekly = kind === "weekly";

  const system = [
    `You are the Executive Agent — Chief of Staff for ${companyName || "the company"}. Write the founder's ${isWeekly ? "WEEKLY STRATEGIC REVIEW: a retrospective on the week plus a look ahead" : "daily brief: a sharp, honest, high-signal snapshot of the business"}.`,
    "Ground EVERYTHING in the DATA dossier provided — never invent numbers, tasks, content, or outcomes. If a section is empty (e.g. no revenue yet, nothing shipped), say so plainly and constructively rather than padding.",
    "Write for a busy founder: concise, direct, every line earns its place. No corporate filler, no flattery.",
    isWeekly
      ? "This is a WEEKLY review — take a higher altitude than a daily update. Focus on what genuinely MOVED this week, progress (or drift) against goals, and momentum patterns. End the insights with ONE sharp strategic recommendation for the coming week. Think like a board-ready operator, not a status bot."
      : "",
    "",
    "Sections to produce:",
    isWeekly
      ? "- headline: one punchy line capturing the week's story."
      : "- headline: one punchy line on where things stand today.",
    "- kpi_review: 2–4 sentences reading the numbers — what's moving, what isn't, and what it means.",
    isWeekly ? "- shipped: what actually got done this week (concrete items). Empty if nothing." : "- shipped: what actually got done recently (concrete items). Empty if nothing.",
    "- in_motion: what's currently underway (active projects/campaigns, work in progress).",
    isWeekly ? "- next: the focus for next week — priorities, decisions, what needs the founder." : "- next: what's next or needs the founder's attention (approvals, decisions, upcoming).",
    "- insights: 2–4 forward-looking ideas or observations — patterns you notice plus concrete, specific, original suggestions for the future. This is where you add the most value; be genuinely useful, not generic.",
    "- suggestions: 2–4 concrete NEXT ACTIONS the founder could greenlight, each tied to what's outstanding or to one of your insights. Each has a kind: \"project\" (a multi-step initiative — e.g. building a fundraising narrative, a launch), \"campaign\" (a follower-growth push), or \"task\" (a single discrete to-do). Give each a clear title, a one-line rationale (why now), and a 'goal': for project/campaign the outcome to accomplish (specific enough to plan against), for a task the concrete thing to do. For task suggestions also give a category (one of: growth, admin, content, research, finance). Propose real, high-leverage moves — not busywork. If nothing is worth proposing, return an empty array.",
    "",
    'Respond with ONLY this JSON (no markdown, no code fences): {"headline": string, "kpi_review": string, "shipped": string[], "in_motion": string[], "next": string[], "insights": [{"title": string, "detail": string}], "suggestions": [{"kind": "project"|"campaign"|"task", "title": string, "rationale": string, "goal": string, "category": string (task only, optional)}]}',
  ].join("\n");

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system,
    messages: [{ role: "user", content: `Today's data dossier:\n\n${dossier}\n\nWrite the brief now.` }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The brief came back unreadable. Please try again.");
  }

  const insights = Array.isArray(raw.insights)
    ? (raw.insights as Record<string, unknown>[])
        .map((i) => ({
          title: typeof i.title === "string" ? i.title.trim().slice(0, 120) : "",
          detail: typeof i.detail === "string" ? i.detail.trim().slice(0, 500) : "",
        }))
        .filter((i) => i.title || i.detail)
        .slice(0, 5)
    : [];

  const suggestions: BriefSuggestion[] = Array.isArray(raw.suggestions)
    ? (raw.suggestions as Record<string, unknown>[])
        .map((s): BriefSuggestion => {
          const kind = SUGGESTION_KINDS.includes(s.kind as BriefSuggestionKind)
            ? (s.kind as BriefSuggestionKind)
            : "task";
          const cat = typeof s.category === "string" && CATEGORIES.includes(s.category as Category)
            ? (s.category as Category)
            : null;
          return {
            id: randomUUID(),
            kind,
            title: typeof s.title === "string" ? s.title.trim().slice(0, 140) : "",
            rationale: typeof s.rationale === "string" ? s.rationale.trim().slice(0, 300) : "",
            goal: typeof s.goal === "string" ? s.goal.trim().slice(0, 600) : "",
            category: kind === "task" ? cat : null,
            status: "proposed",
            ref_href: null,
          };
        })
        .filter((s) => s.title && s.goal)
        .slice(0, 5)
    : [];

  return {
    headline: typeof raw.headline === "string" ? raw.headline.trim().slice(0, 240) : "Here's where things stand.",
    kpi_review: typeof raw.kpi_review === "string" ? raw.kpi_review.trim().slice(0, 900) : "",
    shipped: strArray(raw.shipped),
    in_motion: strArray(raw.in_motion),
    next: strArray(raw.next),
    insights,
    suggestions,
  };
}
