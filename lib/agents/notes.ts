import "server-only";

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, tasks } from "@/lib/db/schema";
import { getConnectedIntegrationNames, getPlanningContext, markNoteActioned } from "@/lib/db/queries";
import { createProject } from "@/lib/agents/project";
import { inferAffectedSystems } from "@/lib/agents/infer-systems";
import type { Category, Note, NoteProposal } from "@/lib/types";

/**
 * Notes → action. The Executive reads a jotted note (grounded in the business
 * brief, CRM, and calendar) and proposes the best way to get it DONE: either a
 * multi-phase PROJECT, or a set of discrete TASKS routed to the right agents.
 * The user approves; approving creates the real work.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const CATEGORIES: Category[] = ["growth", "admin", "content", "research", "finance"];

function firstJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Ask the Executive what to do with a note. Returns a proposal to approve. */
export async function analyzeNote(workspaceId: string, note: Note): Promise<NoteProposal> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const body = (note.content || note.title).trim();
  if (!body) throw new Error("This note is empty — jot something down first.");

  const { brief } = await getPlanningContext(workspaceId);
  const context = [
    `COMPANY: ${brief.company_name}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Audience: ${brief.ideal_customer_profile}` : "",
    brief.company_context ? `Company context: ${brief.company_context}` : "",
    brief.crm_context ? `${brief.crm_context}` : "",
    brief.calendar_context ? `${brief.calendar_context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    "You are the Executive Agent — the founder's Chief of Staff. The founder jotted a quick note. Decide the best way to get it DONE by the team, then return STRICT JSON only (no prose, no markdown fences).",
    "Your agents, by category: growth, admin, content, research, finance.",
    "Choose ONE kind:",
    '- "tasks": the note is a handful of discrete to-dos (1–6). Return each as a task with the RIGHT agent category, a clear imperative title, an actionable description, and a one-line rationale. Prefer this for quick jotted lists.',
    '- "project": the note is genuinely a multi-step initiative that needs a phased plan. Return a crisp project title and a one-sentence goal.',
    "JSON shape (include ONLY the key matching kind):",
    '{"kind":"tasks","summary":"one line on your decision","tasks":[{"title":"","category":"admin","description":"","rationale":""}]}',
    '{"kind":"project","summary":"one line on your decision","project":{"title":"","goal":""}}',
  ].join("\n");

  const user = [context ? `BUSINESS CONTEXT:\n${context}\n` : "", `THE NOTE${note.title ? ` — "${note.title}"` : ""}:\n${body}`]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  let text = "";
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    });
    text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new Error(`Analysis failed (${e.status ?? "API error"}). Try again.`);
    throw e instanceof Error ? e : new Error("Analysis failed.");
  }

  const parsed = firstJson<NoteProposal>(text);
  if (!parsed || (parsed.kind !== "project" && parsed.kind !== "tasks")) {
    throw new Error("Couldn't interpret that note — try adding a bit more detail.");
  }

  if (parsed.kind === "tasks") {
    parsed.tasks = (parsed.tasks ?? [])
      .slice(0, 6)
      .map((t) => ({
        title: String(t.title || "").slice(0, 120),
        category: (CATEGORIES.includes(t.category) ? t.category : "admin") as Category,
        description: String(t.description || "").slice(0, 2000),
        rationale: String(t.rationale || "").slice(0, 300),
      }))
      .filter((t) => t.title);
    if (!parsed.tasks.length) throw new Error("No actionable tasks found in that note.");
    delete parsed.project;
  } else {
    parsed.project = {
      title: String(parsed.project?.title || note.title || "New initiative").slice(0, 120),
      goal: String(parsed.project?.goal || body).slice(0, 500) || body.slice(0, 500),
    };
    delete parsed.tasks;
  }
  parsed.summary = String(parsed.summary || "").slice(0, 300);
  return parsed;
}

async function createNoteTask(
  workspaceId: string,
  t: { title: string; category: Category; description: string; rationale: string },
  connected: string[],
): Promise<void> {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.workspace_id, workspaceId),
        eq(agents.category, t.category),
        eq(agents.premium, false),
        eq(agents.archived, false),
      ),
    )
    .limit(1);
  const systems = inferAffectedSystems(`${t.title} ${t.description}`, connected);
  const now = new Date();
  await db.insert(tasks).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    category: t.category,
    title: t.title.slice(0, 120),
    description: t.description,
    rationale: `From your note. ${t.rationale}`.trim().slice(0, 300),
    status: "new",
    risk_level: "low",
    priority: "medium",
    // A scheduling task gets a real time so the calendar event lands sensibly.
    due_at: systems.includes("Google Calendar") ? new Date(now.getTime() + 24 * 3600 * 1000) : null,
    agent_id: agent?.id ?? null,
    created_by_type: "agent",
    requires_approval: true,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: systems,
    proposed_actions: systems.length,
    impact_score: 45,
    archived: false,
    created_at: now,
    updated_at: now,
  });
}

/** Approve a proposal → create the project or tasks; mark the note actioned. */
export async function actionNote(
  workspaceId: string,
  note: Note,
  proposal: NoteProposal,
): Promise<{ ok: boolean; kind: NoteProposal["kind"]; projectId?: string; taskCount?: number; error?: string }> {
  if (proposal.kind === "project" && proposal.project) {
    const res = await createProject(workspaceId, proposal.project.goal || proposal.project.title, "executive");
    if (!res.ok) return { ok: false, kind: "project", error: res.error };
    await markNoteActioned(workspaceId, note.id, { projectId: res.projectId ?? null });
    return { ok: true, kind: "project", projectId: res.projectId };
  }
  const list = proposal.tasks ?? [];
  if (!list.length) return { ok: false, kind: "tasks", error: "Nothing to create." };
  const connected = await getConnectedIntegrationNames(workspaceId).catch(() => []);
  for (const t of list) await createNoteTask(workspaceId, t, connected);
  await markNoteActioned(workspaceId, note.id, { taskCount: list.length });
  return { ok: true, kind: "tasks", taskCount: list.length };
}
