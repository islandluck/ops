import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, companyGoals, executiveMemory, executiveMessages, projects, tasks } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { computeKpis } from "@/lib/executive/kpis";
import { executiveReply, type ExecTool } from "@/lib/ai/executive";
import { createProject } from "./project";
import { createGrowthCampaign } from "./growth";
import type {
  CompanyGoal,
  ExecKpi,
  ExecMemory,
  ExecMessage,
  ExecutiveBundle,
  GoalStatus,
  MemoryKind,
} from "@/lib/types";

/**
 * The Executive Agent engine — the founder's Chief of Staff. Assembles a live,
 * grounded view of the business (brief + KPIs + goals + memory + current work),
 * runs the tool-using chat loop, and owns the durable memory + company goals.
 * Everything is workspace-scoped.
 */

const uid = () => randomUUID();
const iso = (d: Date | string) => new Date(d).toISOString();
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const MEMORY_KINDS: MemoryKind[] = ["fact", "preference", "decision", "insight"];
const memKind = (v: unknown): MemoryKind => (MEMORY_KINDS.includes(v as MemoryKind) ? (v as MemoryKind) : "fact");

/* ------------------------------- mappers -------------------------------- */

type MsgRow = typeof executiveMessages.$inferSelect;
type MemRow = typeof executiveMemory.$inferSelect;
type GoalRow = typeof companyGoals.$inferSelect;

const toMsg = (r: MsgRow): ExecMessage => ({
  id: r.id,
  role: r.role,
  content: r.content,
  actions: r.actions ?? [],
  created_at: iso(r.created_at),
});
const toMem = (r: MemRow): ExecMemory => ({
  id: r.id,
  content: r.content,
  kind: r.kind,
  source: r.source,
  pinned: r.pinned,
  created_at: iso(r.created_at),
});
const toGoal = (r: GoalRow): CompanyGoal => ({
  id: r.id,
  title: r.title,
  detail: r.detail,
  metric: r.metric,
  target: r.target,
  status: r.status,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});

/* --------------------------- context assembler --------------------------- */

async function buildSystemPrompt(workspaceId: string, kpis: ExecKpi[]): Promise<string> {
  const { brief } = await getPlanningContext(workspaceId);

  const [goals, memory, activeProjects, taskRows] = await Promise.all([
    db
      .select()
      .from(companyGoals)
      .where(and(eq(companyGoals.workspace_id, workspaceId), eq(companyGoals.status, "active"))),
    db
      .select()
      .from(executiveMemory)
      .where(eq(executiveMemory.workspace_id, workspaceId))
      .orderBy(desc(executiveMemory.pinned), desc(executiveMemory.created_at))
      .limit(40),
    db
      .select({ title: projects.title, kind: projects.kind, status: projects.status })
      .from(projects)
      .where(and(eq(projects.workspace_id, workspaceId), eq(projects.status, "active"))),
    db
      .select({ status: tasks.status, archived: tasks.archived })
      .from(tasks)
      .where(eq(tasks.workspace_id, workspaceId)),
  ]);

  const readyCount = taskRows.filter((t) => t.status === "ready" && !t.archived).length;
  const workingCount = taskRows.filter((t) => t.status === "agent_working" && !t.archived).length;

  const lines: string[] = [
    `You are the Executive Agent — the founder's Chief of Staff and COO for ${brief.company_name || "their company"}.`,
    [brief.business_description, brief.core_offer].filter(Boolean).join(" "),
    brief.ideal_customer_profile ? `Who they serve: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Company voice: ${brief.voice_rules.join("; ")}` : "",
    "",
    "You have a complete, live view of the business. Ground EVERY claim in the data below — never invent numbers.",
    "",
    "CURRENT KPIs:",
    ...kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}${k.hint ? ` — ${k.hint}` : ""}`),
    "",
    "COMPANY GOALS (active):",
    ...(goals.length
      ? goals.map((g) => `- ${g.title}${g.target ? ` → target ${g.target}` : ""}${g.detail ? `: ${g.detail}` : ""}`)
      : ["- (none set yet — help the founder set clear ones)"]),
    "",
    "WHAT'S HAPPENING NOW:",
    ...(activeProjects.length
      ? activeProjects.map((p) => `- Active ${p.kind === "growth" ? "growth campaign" : "project"}: ${p.title}`)
      : ["- No active projects or campaigns right now."]),
    `- ${readyCount} task${readyCount === 1 ? "" : "s"} awaiting the founder's approval; ${workingCount} being drafted by agents.`,
    "",
    "WHAT YOU'VE LEARNED (your memory of this business):",
    ...(memory.length ? memory.map((m) => `- [${m.kind}] ${m.content}`) : ["- (nothing yet — build this up over time)"]),
    "",
    "HOW YOU OPERATE:",
    "- Be a sharp, high-signal strategic partner: direct, warm, concise. Give real opinions and push back when the data warrants it. No corporate filler, no flattery.",
    "- Keep replies tight — a few short paragraphs at most. Lead with the answer.",
    "- Use your tools proactively but sensibly: when the founder sets a goal or ambition, log_company_goal. When you learn something durable about the business, their strategy, or their preferences, remember it. When they decide to kick off an initiative, create_project (or create_growth_campaign for audience growth) — these become draft plans they approve, so it's safe to start them.",
    "- Only act via tools when it genuinely helps; most turns are just good conversation and advice.",
  ];

  return lines.filter((l) => l !== "").join("\n");
}

/* -------------------------------- tools --------------------------------- */

function buildTools(workspaceId: string): ExecTool[] {
  return [
    {
      definition: {
        name: "log_company_goal",
        description:
          "Record a company-wide goal the founder wants to pursue. Use when they state a goal, target, or ambition worth tracking.",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short goal statement" },
            detail: { type: "string", description: "Any specifics or context" },
            metric: { type: "string", description: "What to measure, e.g. MRR, followers, signups" },
            target: { type: "string", description: "The target, e.g. $10k, +100/week, 5,000" },
          },
          required: ["title"],
        },
      },
      run: async (input) => {
        const now = new Date();
        await db.insert(companyGoals).values({
          id: uid(),
          workspace_id: workspaceId,
          title: str(input.title).slice(0, 200) || "Untitled goal",
          detail: str(input.detail).slice(0, 500),
          metric: str(input.metric).slice(0, 100),
          target: str(input.target).slice(0, 100),
          status: "active",
          created_at: now,
          updated_at: now,
        });
        return { summary: `Logged company goal: "${str(input.title).slice(0, 80)}".` };
      },
    },
    {
      definition: {
        name: "remember",
        description:
          "Save a durable fact, preference, decision, or insight about the business to long-term memory, so you recall it in future conversations and briefs.",
        input_schema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The thing to remember, stated concisely" },
            kind: { type: "string", enum: ["fact", "preference", "decision", "insight"] },
          },
          required: ["content"],
        },
      },
      run: async (input) => {
        const now = new Date();
        await db.insert(executiveMemory).values({
          id: uid(),
          workspace_id: workspaceId,
          content: str(input.content).slice(0, 600),
          kind: memKind(input.kind),
          source: "agent",
          pinned: false,
          created_at: now,
          updated_at: now,
        });
        return { summary: `Noted for the future: "${str(input.content).slice(0, 80)}".` };
      },
    },
    {
      definition: {
        name: "create_project",
        description:
          "Kick off a multi-step Project run by the Executive (a launch, a build, a coordinated push). It becomes a draft plan the founder approves in Projects, so starting one is low-risk.",
        input_schema: {
          type: "object",
          properties: { goal: { type: "string", description: "The outcome to accomplish" } },
          required: ["goal"],
        },
      },
      run: async (input) => {
        const res = await createProject(workspaceId, str(input.goal), "executive");
        if (!res.ok) return { summary: `Couldn't create the project: ${res.error}` };
        return {
          summary: `Drafted a project plan${res.title ? `: "${res.title}"` : ""}. It's in Projects awaiting your approval.`,
          href: "/projects",
        };
      },
    },
    {
      definition: {
        name: "create_growth_campaign",
        description:
          "Start a finite follower-growth campaign (weekly cadence toward a per-week follower target). Becomes a draft plan the founder approves in Projects.",
        input_schema: {
          type: "object",
          properties: {
            goal: { type: "string", description: "The growth goal / who to reach" },
            weeks: { type: "number", description: "Campaign length in weeks (default 6)" },
            followers_per_week: { type: "number", description: "Target new followers per week (default 100)" },
          },
          required: ["goal"],
        },
      },
      run: async (input) => {
        const res = await createGrowthCampaign(workspaceId, {
          goal: str(input.goal),
          weeks: num(input.weeks, 6),
          followerGoalPerWeek: num(input.followers_per_week, 100),
        });
        if (!res.ok) return { summary: `Couldn't create the campaign: ${res.error}` };
        return { summary: "Drafted a growth campaign. It's in Projects awaiting your approval.", href: "/projects" };
      },
    },
  ];
}

/* ------------------------------- chat ----------------------------------- */

export async function sendExecutiveMessage(
  workspaceId: string,
  text: string,
): Promise<{ ok: boolean; reply?: ExecMessage; error?: string }> {
  const clean = text.trim();
  if (!clean) return { ok: false, error: "Type a message first." };

  // Prior turns (oldest→newest) before recording this one.
  const historyRows = await db
    .select()
    .from(executiveMessages)
    .where(eq(executiveMessages.workspace_id, workspaceId))
    .orderBy(desc(executiveMessages.created_at))
    .limit(20);
  const history = historyRows.reverse().map((m) => ({ role: m.role, content: m.content }));

  const now = new Date();
  await db.insert(executiveMessages).values({
    id: uid(),
    workspace_id: workspaceId,
    role: "user",
    content: clean.slice(0, 4000),
    actions: [],
    created_at: now,
  });

  const kpis = await computeKpis(workspaceId);
  const system = await buildSystemPrompt(workspaceId, kpis);
  const tools = buildTools(workspaceId);

  let result;
  try {
    result = await executiveReply({ system, history, userMessage: clean, tools });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The Executive Agent couldn't respond." };
  }

  const asstAt = new Date();
  const asstId = uid();
  await db.insert(executiveMessages).values({
    id: asstId,
    workspace_id: workspaceId,
    role: "assistant",
    content: result.text,
    actions: result.actions,
    created_at: asstAt,
  });

  return {
    ok: true,
    reply: { id: asstId, role: "assistant", content: result.text, actions: result.actions, created_at: iso(asstAt) },
  };
}

/* ------------------------------- bundle --------------------------------- */

export async function getExecutiveBundle(workspaceId: string): Promise<ExecutiveBundle> {
  const [[execAgent], messages, memory, goals, kpis] = await Promise.all([
    db
      .select({ name: agents.name })
      .from(agents)
      .where(and(eq(agents.workspace_id, workspaceId), eq(agents.tier, "executive")))
      .limit(1),
    db
      .select()
      .from(executiveMessages)
      .where(eq(executiveMessages.workspace_id, workspaceId))
      .orderBy(asc(executiveMessages.created_at))
      .limit(200),
    db
      .select()
      .from(executiveMemory)
      .where(eq(executiveMemory.workspace_id, workspaceId))
      .orderBy(desc(executiveMemory.pinned), desc(executiveMemory.created_at)),
    db
      .select()
      .from(companyGoals)
      .where(eq(companyGoals.workspace_id, workspaceId))
      .orderBy(desc(companyGoals.created_at)),
    computeKpis(workspaceId),
  ]);

  return {
    agentName: execAgent?.name ?? "Executive Agent",
    messages: messages.map(toMsg),
    memory: memory.map(toMem),
    goals: goals.map(toGoal),
    kpis,
  };
}

/* --------------------------- memory + goals ----------------------------- */

export async function addMemory(
  workspaceId: string,
  content: string,
  kind: MemoryKind = "fact",
): Promise<{ ok: boolean; error?: string }> {
  const c = content.trim();
  if (!c) return { ok: false, error: "Nothing to remember." };
  const now = new Date();
  await db.insert(executiveMemory).values({
    id: uid(),
    workspace_id: workspaceId,
    content: c.slice(0, 600),
    kind: memKind(kind),
    source: "user",
    pinned: false,
    created_at: now,
    updated_at: now,
  });
  return { ok: true };
}

export async function togglePinMemory(workspaceId: string, id: string, pinned: boolean): Promise<{ ok: boolean }> {
  await db
    .update(executiveMemory)
    .set({ pinned, updated_at: new Date() })
    .where(and(eq(executiveMemory.workspace_id, workspaceId), eq(executiveMemory.id, id)));
  return { ok: true };
}

export async function deleteMemory(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(executiveMemory)
    .where(and(eq(executiveMemory.workspace_id, workspaceId), eq(executiveMemory.id, id)));
  return { ok: true };
}

export async function addGoal(
  workspaceId: string,
  input: { title: string; detail?: string; metric?: string; target?: string },
): Promise<{ ok: boolean; error?: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the goal a title." };
  const now = new Date();
  await db.insert(companyGoals).values({
    id: uid(),
    workspace_id: workspaceId,
    title: title.slice(0, 200),
    detail: (input.detail ?? "").slice(0, 500),
    metric: (input.metric ?? "").slice(0, 100),
    target: (input.target ?? "").slice(0, 100),
    status: "active",
    created_at: now,
    updated_at: now,
  });
  return { ok: true };
}

export async function setGoalStatus(
  workspaceId: string,
  id: string,
  status: GoalStatus,
): Promise<{ ok: boolean }> {
  await db
    .update(companyGoals)
    .set({ status, updated_at: new Date() })
    .where(and(eq(companyGoals.workspace_id, workspaceId), eq(companyGoals.id, id)));
  return { ok: true };
}

export async function deleteGoal(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(companyGoals).where(and(eq(companyGoals.workspace_id, workspaceId), eq(companyGoals.id, id)));
  return { ok: true };
}
