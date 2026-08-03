import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  agents,
  companyGoals,
  executiveBriefs,
  executiveMemory,
  executiveMessages,
  pages,
  posts,
  projects,
  tasks,
} from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { computeKpis } from "@/lib/executive/kpis";
import { computeNudges } from "@/lib/executive/nudges";
import { executiveReply, generateBrief, type ExecTool } from "@/lib/ai/executive";
import { createProject } from "./project";
import { createGrowthCampaign } from "./growth";
import type {
  BriefSuggestion,
  Category,
  CompanyGoal,
  ExecBrief,
  ExecBriefContent,
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

  // Prior turns in the current chat (oldest→newest) before recording this one.
  const historyRows = await db
    .select()
    .from(executiveMessages)
    .where(and(eq(executiveMessages.workspace_id, workspaceId), eq(executiveMessages.archived, false)))
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

/** Start a fresh conversation — archives the current chat (kept for history).
 *  The agent's memory is separate and unaffected, so it still knows the business. */
export async function startNewExecutiveChat(workspaceId: string): Promise<{ ok: boolean }> {
  await db
    .update(executiveMessages)
    .set({ archived: true })
    .where(and(eq(executiveMessages.workspace_id, workspaceId), eq(executiveMessages.archived, false)));
  return { ok: true };
}

/* ---------------------------- daily brief ------------------------------- */

/** Assemble the full data dossier the daily brief is synthesized from. */
async function gatherBriefDossier(
  workspaceId: string,
  kpis: ExecKpi[],
): Promise<{ dossier: string; companyName: string }> {
  const { brief } = await getPlanningContext(workspaceId);
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const [goals, memory, activeProjects, taskRows, postRows, pageRows, activity] = await Promise.all([
    db
      .select()
      .from(companyGoals)
      .where(and(eq(companyGoals.workspace_id, workspaceId), eq(companyGoals.status, "active"))),
    db
      .select()
      .from(executiveMemory)
      .where(eq(executiveMemory.workspace_id, workspaceId))
      .orderBy(desc(executiveMemory.pinned), desc(executiveMemory.created_at))
      .limit(30),
    db
      .select({ title: projects.title, kind: projects.kind, current_phase: projects.current_phase, plan: projects.plan })
      .from(projects)
      .where(and(eq(projects.workspace_id, workspaceId), eq(projects.status, "active"))),
    db
      .select({
        title: tasks.title,
        status: tasks.status,
        archived: tasks.archived,
        updated_at: tasks.updated_at,
        scheduled_at: tasks.scheduled_at,
        execution_status: tasks.execution_status,
      })
      .from(tasks)
      .where(eq(tasks.workspace_id, workspaceId)),
    db.select({ title: posts.title, status: posts.status }).from(posts).where(eq(posts.workspace_id, workspaceId)),
    db.select({ title: pages.title, status: pages.status }).from(pages).where(eq(pages.workspace_id, workspaceId)),
    db
      .select({ summary: activityEvents.summary })
      .from(activityEvents)
      .where(eq(activityEvents.workspace_id, workspaceId))
      .orderBy(desc(activityEvents.created_at))
      .limit(18),
  ]);

  const shipped = taskRows
    .filter((t) => t.status === "done" && !t.archived && new Date(t.updated_at).getTime() >= weekAgo)
    .map((t) => t.title)
    .slice(0, 15);
  const pending = taskRows.filter((t) => t.status === "ready" && !t.archived).map((t) => t.title).slice(0, 15);
  const upcoming = taskRows
    .filter((t) => t.execution_status === "queued" && t.scheduled_at && new Date(t.scheduled_at).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
    .slice(0, 10);
  const contentLive = [
    ...postRows.filter((p) => p.status === "distributed").map((p) => p.title),
    ...pageRows.filter((p) => p.status === "published").map((p) => p.title),
  ].slice(0, 15);

  const lines = [
    `COMPANY: ${brief.company_name || "the company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Audience: ${brief.ideal_customer_profile}` : "",
    "",
    "KPIs:",
    ...kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}${k.hint ? ` — ${k.hint}` : ""}`),
    "",
    "ACTIVE COMPANY GOALS:",
    ...(goals.length ? goals.map((g) => `- ${g.title}${g.target ? ` → ${g.target}` : ""}`) : ["- None set."]),
    "",
    "ACTIVE PROJECTS / CAMPAIGNS:",
    ...(activeProjects.length
      ? activeProjects.map(
          (p) =>
            `- ${p.kind === "growth" ? "Growth campaign" : "Project"} "${p.title}" — ${
              p.kind === "growth" ? "week" : "phase"
            } ${p.current_phase + 1} of ${p.plan.phases.length}`,
        )
      : ["- None active."]),
    "",
    "SHIPPED (completed, last 7 days):",
    ...(shipped.length ? shipped.map((t) => `- ${t}`) : ["- Nothing completed in the last 7 days."]),
    "",
    "CONTENT LIVE:",
    ...(contentLive.length ? contentLive.map((t) => `- ${t}`) : ["- None published yet."]),
    "",
    "AWAITING THE FOUNDER'S APPROVAL:",
    ...(pending.length ? pending.map((t) => `- ${t}`) : ["- Nothing pending."]),
    "",
    "UPCOMING (scheduled to auto-run):",
    ...(upcoming.length
      ? upcoming.map((t) => `- ${t.title}${t.scheduled_at ? ` (${new Date(t.scheduled_at).toISOString()})` : ""}`)
      : ["- Nothing scheduled."]),
    "",
    "RECENT ACTIVITY:",
    ...(activity.length ? activity.map((a) => `- ${a.summary}`) : ["- Quiet lately."]),
    "",
    "WHAT THE EXECUTIVE REMEMBERS:",
    ...(memory.length ? memory.map((m) => `- [${m.kind}] ${m.content}`) : ["- Nothing yet."]),
  ];

  return { dossier: lines.filter((l) => l !== undefined).join("\n"), companyName: brief.company_name };
}

/** Generate + store a fresh daily brief. */
export async function generateDailyBrief(
  workspaceId: string,
): Promise<{ ok: boolean; brief?: ExecBrief; error?: string }> {
  const kpis = await computeKpis(workspaceId);
  const { dossier, companyName } = await gatherBriefDossier(workspaceId, kpis);

  let content;
  try {
    content = await generateBrief(dossier, companyName);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't generate the brief." };
  }

  const id = uid();
  const now = new Date();
  await db.insert(executiveBriefs).values({ id, workspace_id: workspaceId, content, created_at: now });
  return { ok: true, brief: { id, content, created_at: iso(now) } };
}

type BriefRow = typeof executiveBriefs.$inferSelect;

/** Map a stored brief row, tolerating older rows saved before newer fields. */
function toBrief(row: BriefRow): ExecBrief {
  const c = (row.content ?? {}) as Partial<ExecBriefContent>;
  return {
    id: row.id,
    created_at: iso(row.created_at),
    content: {
      headline: c.headline ?? "",
      kpi_review: c.kpi_review ?? "",
      shipped: c.shipped ?? [],
      in_motion: c.in_motion ?? [],
      next: c.next ?? [],
      insights: c.insights ?? [],
      suggestions: c.suggestions ?? [],
    },
  };
}

export async function getLatestBrief(workspaceId: string): Promise<ExecBrief | null> {
  const [row] = await db
    .select()
    .from(executiveBriefs)
    .where(eq(executiveBriefs.workspace_id, workspaceId))
    .orderBy(desc(executiveBriefs.created_at))
    .limit(1);
  return row ? toBrief(row) : null;
}

/** Recent briefs, newest first — the archive. */
export async function listBriefs(workspaceId: string, limit = 30): Promise<ExecBrief[]> {
  const rows = await db
    .select()
    .from(executiveBriefs)
    .where(eq(executiveBriefs.workspace_id, workspaceId))
    .orderBy(desc(executiveBriefs.created_at))
    .limit(limit);
  return rows.map(toBrief);
}

/* --------------------------- brief suggestions -------------------------- */

/** Create a board task from a brief's task suggestion (lands "new" for approval). */
async function createBriefTask(workspaceId: string, s: BriefSuggestion): Promise<void> {
  const category = (s.category ?? "admin") as Category;
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.workspace_id, workspaceId),
        eq(agents.category, category),
        eq(agents.premium, false),
        eq(agents.archived, false),
      ),
    )
    .limit(1);
  const now = new Date();
  await db.insert(tasks).values({
    id: uid(),
    workspace_id: workspaceId,
    category,
    title: s.title.slice(0, 120),
    description: s.goal,
    rationale: `Proposed by the Executive Agent in your daily brief. ${s.rationale}`.trim().slice(0, 300),
    status: "new",
    risk_level: "low",
    priority: "medium",
    due_at: null,
    agent_id: agent?.id ?? null,
    created_by_type: "agent",
    requires_approval: true,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: [],
    proposed_actions: 0,
    impact_score: 45,
    archived: false,
    created_at: now,
    updated_at: now,
  });
}

/** Approve a brief suggestion → create the project/campaign/task; mark it accepted. */
export async function approveBriefSuggestion(
  workspaceId: string,
  briefId: string,
  suggestionId: string,
): Promise<{ ok: boolean; href?: string; error?: string }> {
  const [row] = await db
    .select()
    .from(executiveBriefs)
    .where(and(eq(executiveBriefs.workspace_id, workspaceId), eq(executiveBriefs.id, briefId)))
    .limit(1);
  if (!row) return { ok: false, error: "Brief not found." };
  const content = toBrief(row).content;
  const s = content.suggestions.find((x) => x.id === suggestionId);
  if (!s) return { ok: false, error: "Suggestion not found." };
  if (s.status === "accepted") return { ok: true, href: s.ref_href ?? undefined };

  let href: string;
  try {
    if (s.kind === "project") {
      const res = await createProject(workspaceId, s.goal || s.title, "executive");
      if (!res.ok) return { ok: false, error: res.error };
      href = "/projects";
    } else if (s.kind === "campaign") {
      const res = await createGrowthCampaign(workspaceId, {
        goal: s.goal || s.title,
        weeks: 6,
        followerGoalPerWeek: 100,
      });
      if (!res.ok) return { ok: false, error: res.error };
      href = "/projects";
    } else {
      await createBriefTask(workspaceId, s);
      href = "/approvals";
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't act on that suggestion." };
  }

  const suggestions = content.suggestions.map((x) =>
    x.id === suggestionId ? { ...x, status: "accepted" as const, ref_href: href } : x,
  );
  await db
    .update(executiveBriefs)
    .set({ content: { ...content, suggestions } })
    .where(and(eq(executiveBriefs.workspace_id, workspaceId), eq(executiveBriefs.id, briefId)));
  return { ok: true, href };
}

/** Dismiss a brief suggestion (don't act on it). */
export async function dismissBriefSuggestion(
  workspaceId: string,
  briefId: string,
  suggestionId: string,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .select()
    .from(executiveBriefs)
    .where(and(eq(executiveBriefs.workspace_id, workspaceId), eq(executiveBriefs.id, briefId)))
    .limit(1);
  if (!row) return { ok: false };
  const content = toBrief(row).content;
  const suggestions = content.suggestions.map((x) =>
    x.id === suggestionId ? { ...x, status: "dismissed" as const } : x,
  );
  await db
    .update(executiveBriefs)
    .set({ content: { ...content, suggestions } })
    .where(and(eq(executiveBriefs.workspace_id, workspaceId), eq(executiveBriefs.id, briefId)));
  return { ok: true };
}

/** Cron heartbeat: generate a fresh daily brief for each workspace whose latest
 *  is stale (>20h). Bounded per run; one failure never blocks the rest. */
export async function generateDueBriefs(limit = 8): Promise<{ generated: number }> {
  const STALE_MS = 20 * 60 * 60 * 1000;
  // tenant-scope-exempt: cron scans workspaces that have an Executive agent; each
  // brief is then generated via generateDailyBrief(workspace_id), which is scoped.
  const execAgents = await db
    .select({ workspace_id: agents.workspace_id })
    .from(agents)
    .where(and(eq(agents.tier, "executive"), eq(agents.archived, false)))
    .limit(200);

  const seen = new Set<string>();
  let generated = 0;
  for (const a of execAgents) {
    if (generated >= limit) break;
    if (seen.has(a.workspace_id)) continue;
    seen.add(a.workspace_id);
    try {
      const latest = await getLatestBrief(a.workspace_id);
      if (latest && Date.now() - new Date(latest.created_at).getTime() < STALE_MS) continue;
      const r = await generateDailyBrief(a.workspace_id);
      if (r.ok) generated += 1;
    } catch {
      /* one workspace never blocks the rest */
    }
  }
  return { generated };
}

/* ------------------------------- bundle --------------------------------- */

export async function getExecutiveBundle(workspaceId: string): Promise<ExecutiveBundle> {
  const [[execAgent], messages, memory, goals, kpis, nudges, briefs] = await Promise.all([
    db
      .select({ name: agents.name })
      .from(agents)
      .where(and(eq(agents.workspace_id, workspaceId), eq(agents.tier, "executive")))
      .limit(1),
    db
      .select()
      .from(executiveMessages)
      .where(and(eq(executiveMessages.workspace_id, workspaceId), eq(executiveMessages.archived, false)))
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
    computeNudges(workspaceId),
    listBriefs(workspaceId, 30),
  ]);

  return {
    agentName: execAgent?.name ?? "Executive Agent",
    messages: messages.map(toMsg),
    memory: memory.map(toMem),
    goals: goals.map(toGoal),
    kpis,
    nudges,
    briefs,
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
