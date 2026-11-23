import "server-only";

import { getAnthropic } from "@/lib/ai/client";
import type { WorkstreamDelegateKind, WorkstreamProposal } from "@/lib/types";

/**
 * Propose-first planning for an owner-led project's workstream. The founder drives
 * the project and hands ONE direction to the Executive; before anything is sourced
 * or drafted, the Executive proposes an approach (+ the exact accelerator params) for
 * the founder to approve. Smart when ANTHROPIC_API_KEY is set; otherwise a sensible
 * deterministic plan, so the handoff flow works with or without a key. Server-only.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export interface ProposeInput {
  projectTitle: string;
  projectGoal: string;
  workstreamTitle: string;
  workstreamNotes: string;
  kind: WorkstreamDelegateKind;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clampCount(n: unknown, dflt: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.max(1, Math.min(Math.round(v), 20));
}

/** Deterministic proposal — used when no API key is set or the model call fails. */
function fallbackProposal(input: ProposeInput): WorkstreamProposal {
  const subject = input.workstreamTitle || input.projectTitle;
  const created_at = new Date().toISOString();
  if (input.kind === "research") {
    return {
      kind: "research",
      approach: `Research "${subject}" on the live web and summarize the key options, findings, and trade-offs for your decision.`,
      query: subject,
      created_at,
    };
  }
  if (input.kind === "quotes") {
    return {
      kind: "quotes",
      approach: `Source ~5 suppliers for "${subject}" on the live web and draft a request-for-quote to each in the Email Manager — nothing sends until you approve.`,
      title: subject,
      spec: input.workstreamNotes || input.projectGoal,
      target_count: 5,
      created_at,
    };
  }
  return {
    kind: "outreach",
    approach: `Find ~5 companies that fit "${subject}", identify the right contact at each, and draft a personalized email to each in the Email Manager — nothing sends until you approve.`,
    title: subject,
    description: input.workstreamNotes || input.projectGoal,
    target_roles: "",
    target_count: 5,
    created_at,
  };
}

/** Tolerant of ```json fences and surrounding prose; returns the outermost object. */
function extractJson(s: string): string {
  const t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const body = fence ? fence[1] : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export async function proposeWorkstreamApproach(input: ProposeInput): Promise<WorkstreamProposal> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackProposal(input);
  try {
    const client = getAnthropic();
    const paramHint =
      input.kind === "research"
        ? `"query": a focused web-search question`
        : input.kind === "quotes"
          ? `"title": a short label for the quote request, "spec": the RFQ requirements to send suppliers, "target_count": how many suppliers to source (default 5)`
          : `"title": a short campaign label, "description": the pitch/context to personalize each email, "target_roles": the decision-maker roles to target, "target_count": how many companies to find (default 5)`;
    const system = [
      "You are the founder's Executive assistant. They are driving a project and have handed you ONE workstream (one direction they're weighing) to accelerate.",
      "Propose HOW you'll tackle it, concisely, as a plan they approve BEFORE you spend anything. Be specific and practical; ground it in their notes.",
      `The handoff is a "${input.kind}" task. Reply with ONLY a JSON object: { "approach": a 1-2 sentence plain-English plan the founder reads, ${paramHint} }.`,
      "Never promise to send anything — you only source/draft/research; the founder reviews and sends.",
    ].join("\n");
    const user = [
      `PROJECT: ${input.projectTitle}`,
      input.projectGoal ? `GOAL: ${input.projectGoal}` : "",
      `WORKSTREAM: ${input.workstreamTitle}`,
      input.workstreamNotes ? `MY NOTES: ${input.workstreamNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const approach = str(parsed.approach) || fallbackProposal(input).approach;
    const created_at = new Date().toISOString();
    if (input.kind === "research") {
      return {
        kind: "research",
        approach,
        query: str(parsed.query) || input.workstreamTitle || input.projectTitle,
        created_at,
      };
    }
    if (input.kind === "quotes") {
      return {
        kind: "quotes",
        approach,
        title: str(parsed.title) || input.workstreamTitle || input.projectTitle,
        spec: str(parsed.spec) || input.workstreamNotes || input.projectGoal,
        target_count: clampCount(parsed.target_count, 5),
        created_at,
      };
    }
    return {
      kind: "outreach",
      approach,
      title: str(parsed.title) || input.workstreamTitle || input.projectTitle,
      description: str(parsed.description) || input.workstreamNotes || input.projectGoal,
      target_roles: str(parsed.target_roles),
      target_count: clampCount(parsed.target_count, 5),
      created_at,
    };
  } catch {
    return fallbackProposal(input);
  }
}
