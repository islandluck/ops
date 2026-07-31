import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { Category, ProjectPhase, ProjectPlan, ProjectStep } from "@/lib/types";

/**
 * Project planner — the leadership brain. Turns a goal ("build our website",
 * "launch the new product") into a realistic, phased project plan whose steps
 * are delegated to worker agents (deliverables) or handed to the owner (human
 * actions). This is what makes a project generalizable rather than hand-built.
 * Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const CATEGORIES: Category[] = ["growth", "admin", "content", "research", "finance"];
const MAX_PHASES = 5;
const MAX_STEPS = 6;

export interface ProjectPlanBrief {
  company_name: string;
  business_description: string;
  core_offer: string;
  ideal_customer_profile: string;
  voice_rules: string[];
  restricted_phrases: string[];
}

export interface ProjectPlanResult {
  title: string;
  summary: string;
  plan: ProjectPlan;
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function planProjectWithClaude(input: {
  goal: string;
  brief: ProjectPlanBrief;
  departments: { category: Category; name: string; description: string }[];
  ownerKind: "manager" | "executive";
}): Promise<ProjectPlanResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI planning is not configured (ANTHROPIC_API_KEY missing).");

  const { goal, brief, departments, ownerKind } = input;
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const role =
    ownerKind === "executive"
      ? "the Executive Agent — a seasoned strategist who runs company-scale initiatives. Think in outcomes and sequencing, not busywork."
      : "the Manager Agent — a hands-on project manager who runs operational projects. Be concrete and tactical.";

  const team = departments.length
    ? departments.map((d) => `- ${d.category}: ${d.name} — ${d.description}`).join("\n")
    : CATEGORIES.map((c) => `- ${c}`).join("\n");

  const system = [
    `You are ${role}`,
    `You work for ${brief.company_name || "the business"}. ${brief.business_description} ${brief.core_offer}`.trim(),
    brief.ideal_customer_profile ? `Ideal customer: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
    brief.restricted_phrases.length ? `Never use: ${brief.restricted_phrases.join(", ")}` : "",
    "",
    "Your worker team — assign each deliverable to ONE department by its key:",
    team,
    "(Social posts / tweets → content.)",
    "",
    "What your agents CAN do: research, plans, strategy, copy, briefs, outreach drafts, social posts, financial models — and act on connected tools (email, calendar, CRM, Notion, X). They can also GENERATE AND PUBLISH a real hosted landing/product page — a page with a working buy button, live in-app at /p/<slug> — from a brief.",
    "What they CANNOT do: put a page on your own domain or external host, buy a domain, run paid ads, connect a live payment account, write or ship code, or anything needing hands-on human execution or a login we don't have. Mark those as \"human\" actions for the owner — never pretend an agent can do them.",
    "",
    "Break the goal into 2–5 ORDERED phases (dependency order — earlier phases unblock later ones). Each phase has 2–6 steps. Each step is one of:",
    '- a "deliverable" assigned to a department (a concrete artifact/draft — copy, email, brief, plan — that department produces), or',
    '- a "page" assigned to "content" (build a real hosted landing/product page with a buy button — generated automatically from the brief), or',
    '- an "action" assigned to "human" (a step the owner performs — e.g. buy a domain, connect a live payment account, point a domain at the page).',
    "Be specific and realistic — no filler steps. Prefer a \"page\" step over a human \"build the website\" step when the goal needs a landing/product page. Honestly separate agent-work from human-work.",
    "",
    "Respond with ONLY this JSON (no markdown, no code fences, no commentary):",
    '{"title": string (<=60 chars), "summary": string (one sentence on the approach), "phases": [{"title": string, "summary": string, "steps": [{"title": string, "brief": string (what to produce, build, or do, one or two sentences), "assignee": "growth"|"admin"|"content"|"research"|"finance"|"human", "kind": "deliverable"|"page"|"action"}]}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: `Goal from the owner: ${goal}\n\nPlan it now.` }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The planner returned an unreadable plan. Please try again.");
  }

  const known = new Set<string>(CATEGORIES);
  const phasesRaw = Array.isArray(raw.phases) ? raw.phases.slice(0, MAX_PHASES) : [];
  const phases: ProjectPhase[] = phasesRaw.map((p, pi) => {
    const pr = (p ?? {}) as Record<string, unknown>;
    const stepsRaw = Array.isArray(pr.steps) ? pr.steps.slice(0, MAX_STEPS) : [];
    const steps: ProjectStep[] = stepsRaw
      .map((s, si): ProjectStep | null => {
        const sr = (s ?? {}) as Record<string, unknown>;
        const title = typeof sr.title === "string" ? sr.title.slice(0, 120) : "";
        if (!title) return null;
        const rawAssignee = typeof sr.assignee === "string" ? sr.assignee.toLowerCase() : "";
        const rawKind = typeof sr.kind === "string" ? sr.kind.toLowerCase() : "";
        const isHuman = rawAssignee === "human";
        // A page step must belong to a department (content) — never "human".
        const assignee: Category | "human" =
          isHuman && rawKind !== "page"
            ? "human"
            : known.has(rawAssignee)
              ? (rawAssignee as Category)
              : "content";
        const kind: ProjectStep["kind"] =
          assignee === "human" ? "action" : rawKind === "page" ? "page" : "deliverable";
        return {
          id: `p${pi}s${si}`,
          title,
          brief: typeof sr.brief === "string" ? sr.brief.slice(0, 600) : "",
          assignee,
          kind,
        };
      })
      .filter((s): s is ProjectStep => s !== null);
    return {
      title: typeof pr.title === "string" ? pr.title.slice(0, 100) : `Phase ${pi + 1}`,
      summary: typeof pr.summary === "string" ? pr.summary.slice(0, 300) : "",
      steps,
    };
  }).filter((ph) => ph.steps.length > 0);

  if (!phases.length) throw new Error("The planner produced an empty plan. Please try again.");

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, 80) : goal.slice(0, 80),
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 300) : "",
    plan: { phases },
  };
}
