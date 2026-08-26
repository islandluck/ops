import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { runWithUsage } from "@/lib/ai/usage";
import { db } from "@/lib/db";
import {
  activityEvents,
  agents,
  businessBriefs,
  companyGoals,
  executiveBriefs,
  executiveMemory,
  executiveMessages,
  investorUpdates,
  pages,
  posts,
  projects,
  tasks,
} from "@/lib/db/schema";
import { getConnectedIntegrationNames, getPlanningContext } from "@/lib/db/queries";
import { getTeamContext } from "@/lib/agents/team";
import { inferAffectedSystems } from "@/lib/agents/infer-systems";
import {
  getCalendarSnapshot,
  formatEventWhen,
  getMessageMeta,
  listInboxMessages,
} from "@/lib/integrations/google";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { resolveRecipientCandidates } from "@/lib/agents/recipient";
import { composeOutboundDrafts } from "@/lib/agents/outbound";
import { researchTopics } from "@/lib/ai/research";
import { computeKpis, computeMetricValues } from "@/lib/executive/kpis";
import { computeNudges } from "@/lib/executive/nudges";
import { executiveReply, generateBrief, writeInvestorUpdate, type ExecTool } from "@/lib/ai/executive";
import { createProject } from "./project";
import { createGrowthCampaign } from "./growth";
import type {
  BriefKind,
  BriefSuggestion,
  Category,
  CompanyGoal,
  ExecBrief,
  ExecBriefContent,
  ExecKpi,
  ExecMemory,
  ExecMessage,
  ExecutiveBundle,
  GoalHorizon,
  GoalMetric,
  GoalStatus,
  InvestorUpdate,
  InvestorUpdateContent,
  MemoryKind,
  UpdateAudience,
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
const HORIZONS: GoalHorizon[] = ["month", "quarter", "ongoing"];
const horizonOf = (v: unknown): GoalHorizon => (HORIZONS.includes(v as GoalHorizon) ? (v as GoalHorizon) : "ongoing");
const GOAL_METRICS: GoalMetric[] = ["revenue", "followers"];
const metricOf = (v: unknown): GoalMetric | null => (GOAL_METRICS.includes(v as GoalMetric) ? (v as GoalMetric) : null);
const numOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

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
function goalProgress(r: GoalRow, mv: Record<GoalMetric, number> | null) {
  if (!r.metric_key || r.target_number == null || !mv) return null;
  const current = mv[r.metric_key] ?? 0;
  const target = r.target_number;
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;
  return { current, target, pct };
}

const toGoal = (r: GoalRow, mv: Record<GoalMetric, number> | null = null): CompanyGoal => ({
  id: r.id,
  title: r.title,
  detail: r.detail,
  metric: r.metric,
  target: r.target,
  status: r.status,
  horizon: r.horizon,
  metric_key: r.metric_key,
  target_number: r.target_number,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
  progress: goalProgress(r, mv),
});

/* --------------------------- context assembler --------------------------- */

/** Split active goals into the time-boxed "north star" set and everything else,
 *  each line carrying live progress where a metric is linked. */
function goalLines(goals: GoalRow[], mv: Record<GoalMetric, number>): { focus: string[]; ongoing: string[] } {
  const fmt = (g: GoalRow) => {
    const p = goalProgress(g, mv);
    const prog = p ? ` [progress ${p.current.toLocaleString()}/${p.target.toLocaleString()} = ${p.pct}%]` : "";
    const hz = g.horizon === "month" ? " (this month)" : g.horizon === "quarter" ? " (this quarter)" : "";
    return `- ${g.title}${hz}${g.target ? ` → ${g.target}` : ""}${prog}${g.detail ? `: ${g.detail}` : ""}`;
  };
  return {
    focus: goals.filter((g) => g.horizon === "month" || g.horizon === "quarter").map(fmt),
    ongoing: goals.filter((g) => g.horizon === "ongoing").map(fmt),
  };
}

async function buildSystemPrompt(workspaceId: string, kpis: ExecKpi[]): Promise<string> {
  const { brief } = await getPlanningContext(workspaceId);

  const [goals, memory, activeProjects, taskRows, mv, teamContext] = await Promise.all([
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
    computeMetricValues(workspaceId),
    getTeamContext(workspaceId),
  ]);
  const gl = goalLines(goals, mv);

  const readyCount = taskRows.filter((t) => t.status === "ready" && !t.archived).length;
  const workingCount = taskRows.filter((t) => t.status === "agent_working" && !t.archived).length;

  const lines: string[] = [
    `You are the Executive Agent — the founder's Chief of Staff and COO for ${brief.company_name || "their company"}.`,
    [brief.business_description, brief.core_offer].filter(Boolean).join(" "),
    brief.ideal_customer_profile ? `Who they serve: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Company voice: ${brief.voice_rules.join("; ")}` : "",
    brief.company_context
      ? `\nCOMPANY CONTEXT (what you learned from a Deep Dive of the company's own material — background you already know, don't re-derive):\n${brief.company_context}`
      : "",
    brief.crm_context ? `\nLIVE CRM: ${brief.crm_context}` : "",
    brief.calendar_context ? `\nSCHEDULE: ${brief.calendar_context}` : "",
    teamContext
      ? `\nTEAM (the people you can hand work to — factor their roles, skills, and current handoffs into any plan or delegation):\n${teamContext}`
      : "",
    "",
    "You have a complete, live view of the business. Ground EVERY claim in the data below — never invent numbers.",
    "",
    "CURRENT KPIs:",
    ...kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}${k.hint ? ` — ${k.hint}` : ""}`),
    "",
    "THIS MONTH'S FOCUS (the north star — everything should ladder up to this):",
    ...(gl.focus.length ? gl.focus : ["- (none set — help the founder pick a clear focus for the month/quarter)"]),
    ...(gl.ongoing.length ? ["", "OTHER ACTIVE GOALS:", ...gl.ongoing] : []),
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
    "- Keep everything laddered to THIS MONTH'S FOCUS. When the founder is deciding what to do, connect it to whether it moves the month's goal; if they're drifting off-pace, name it and propose the single highest-leverage next move. Help them set a clear monthly focus if none exists.",
    "- Keep replies tight — a few short paragraphs at most. Lead with the answer.",
    "- Use your tools proactively but sensibly: when the founder sets a goal or ambition, log_company_goal. When you learn something durable about the business, their strategy, or their preferences, remember it. When they decide to kick off an initiative, create_project (or create_growth_campaign for audience growth) — these become draft plans they approve, so it's safe to start them.",
    "- EMAIL + PEOPLE: you have HubSpot + Gmail access. When a task names someone (e.g. 'Tim K'), use lookup_person to figure out who they are and their email — don't ask the founder to tell you. When something calls for an email, use draft_email: it lands in the Email Manager as a DRAFT the founder reviews and sends — you NEVER send email yourself. Use search_inbox (read-only) to ground a reply in the real thread.",
    "- When the founder HANDS you a task (e.g. from their daily plan), ACT on it: resolve the people, draft the email, kick off the project — take the obvious next step and report what you did. Only ask a question when you're genuinely blocked on something you can't look up yourself.",
    "- You CAN access the live internet with the `research` tool — use it for anything current (competitor moves, market news, a company or person, recent events). Never say you don't have internet access; look it up and cite what you find.",
    "- PLANNING THE DAY: when the founder asks you to plan their day (or triage/sequence their tasks), call list_open_tasks FIRST to see what's actually open, then give a tight, decisive plan — group similar work into batches (e.g. all the emails together), order by priority + logical sequence, call out the quick wins, note what should be handed to an agent, and give a rough timeline. Keep it scannable (short groups + a one-line 'start here'), never a wall of text.",
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
          "Record a company-wide goal the founder wants to pursue. Use when they state a goal, target, or ambition worth tracking. Set horizon to 'month' or 'quarter' for a time-boxed north star (which the daily brief + weekly review will cascade from), or 'ongoing'. If it maps to revenue or followers, set metric_key + target_number so it tracks live progress.",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short goal statement" },
            detail: { type: "string", description: "Any specifics or context" },
            metric: { type: "string", description: "What to measure, e.g. MRR, signups (free text)" },
            target: { type: "string", description: "The target, e.g. $10k, +100/week, 5,000 (free text)" },
            horizon: { type: "string", enum: ["month", "quarter", "ongoing"] },
            metric_key: { type: "string", enum: ["revenue", "followers"], description: "Link for live progress (optional)" },
            target_number: { type: "number", description: "Numeric target for metric_key (e.g. 10000 for $10k revenue)" },
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
          horizon: horizonOf(input.horizon),
          metric_key: metricOf(input.metric_key),
          target_number: numOrNull(input.target_number),
          created_at: now,
          updated_at: now,
        });
        const hz = horizonOf(input.horizon);
        return {
          summary: `Logged ${hz === "ongoing" ? "" : `${hz === "month" ? "this month's" : "this quarter's"} `}goal: "${str(input.title).slice(0, 80)}".`,
        };
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
    {
      silent: true,
      definition: {
        name: "lookup_person",
        description:
          "Figure out WHO a person is and their email, from the CRM (HubSpot) then the founder's Gmail history. Use this whenever a task names someone (e.g. 'Tim K') before drafting an email or planning outreach — resolve them first, don't ask the founder.",
        input_schema: {
          type: "object",
          properties: { name: { type: "string", description: "The person's name as written in the task" } },
          required: ["name"],
        },
      },
      run: async (input) => {
        const name = str(input.name).trim();
        if (!name) return { summary: "No name given to look up." };
        try {
          const { candidates } = await resolveRecipientCandidates(workspaceId, name);
          if (!candidates.length) return { summary: `Couldn't find "${name}" in HubSpot or recent email.` };
          const lines = candidates
            .slice(0, 4)
            .map((c) => `${c.name || name} <${c.email}>${c.context ? ` — ${c.context}` : ""} (via ${c.source})`);
          return { summary: `Found for "${name}": ${lines.join("; ")}.` };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : `Couldn't look up "${name}".` };
        }
      },
    },
    {
      silent: true,
      definition: {
        name: "search_inbox",
        description:
          "Read-only search of the founder's Gmail to ground your thinking in real threads (e.g. find the last message from a client before drafting a reply). Returns sender, subject, and date only. Use Gmail search syntax in the query (from:, subject:, newer_than:2w, etc.).",
        input_schema: {
          type: "object",
          properties: { query: { type: "string", description: "Gmail search query" } },
          required: ["query"],
        },
      },
      run: async (input) => {
        const query = str(input.query).trim();
        if (!query) return { summary: "No search query given." };
        try {
          const token = await getValidAccessToken(workspaceId, "Gmail");
          if (!token) return { summary: "Gmail isn't connected, so I can't read the inbox." };
          const ids = await listInboxMessages(token, { query, max: 5 });
          if (!ids.length) return { summary: `No emails matched "${query}".` };
          const metas = await Promise.all(ids.map((m) => getMessageMeta(token, m.id).catch(() => null)));
          const lines = metas
            .filter((m): m is NonNullable<typeof m> => Boolean(m))
            .map((m) => `• ${m.from} — "${m.subject}" (${m.date})`);
          return { summary: `Top matches for "${query}":\n${lines.join("\n")}` };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't search the inbox." };
        }
      },
    },
    {
      definition: {
        name: "draft_email",
        description:
          "Draft an email for the founder to review — it lands in the Email Manager as a DRAFT and is NEVER sent automatically. Always use this instead of claiming to email someone: resolve the recipient (lookup_person if unsure), then draft. The founder reviews + sends from the Email Manager.",
        input_schema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient name or email (e.g. 'Tim K' or tim@acme.com)" },
            about: { type: "string", description: "What the email should say / accomplish" },
          },
          required: ["to", "about"],
        },
      },
      run: async (input) => {
        const to = str(input.to).trim();
        const about = str(input.about).trim();
        if (!to || !about) return { summary: "I need both who it's to and what it's about to draft an email." };
        try {
          const res = await composeOutboundDrafts(workspaceId, [`Email ${to} — ${about}`]);
          if (!res.ok) return { summary: `Couldn't draft the email: ${res.error}` };
          return {
            summary: `Drafted an email to ${to}. It's in the Email Manager as a draft — review and send it there.`,
            href: "/email",
          };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't draft the email." };
        }
      },
    },
    {
      silent: true,
      definition: {
        name: "research",
        description:
          "Look something up on the live internet (recent news + web) when you need current information you don't already have — competitors, market moves, a person/company, prices, what happened recently. Returns a synthesized answer with sources. Use it instead of guessing or saying you can't access the internet.",
        input_schema: {
          type: "object",
          properties: { query: { type: "string", description: "What to research, phrased as a search query or question" } },
          required: ["query"],
        },
      },
      run: async (input) => {
        const query = str(input.query).trim();
        if (!query) return { summary: "No research query given." };
        try {
          const res = await researchTopics(query);
          if (!res) return { summary: "Live web research isn't set up yet (no search key configured)." };
          if (!res.answer && !res.sources.length) return { summary: `Nothing solid came back for "${query}".` };
          const cites = res.sources
            .slice(0, 4)
            .map((s) => `- ${s.title || s.url} (${s.url})`)
            .join("\n");
          return {
            summary: `${res.answer || "Here's what I found."}${cites ? `\n\nSources:\n${cites}` : ""}`.slice(0, 2000),
          };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't complete the research." };
        }
      },
    },
    {
      silent: true,
      definition: {
        name: "list_open_tasks",
        description:
          "List the founder's OPEN tasks in the Approval Center (not done or archived). Use this to plan their day, sequence work, batch similar tasks, or decide what to hand to agents. Returns each task's title, category, status, risk, and priority.",
        input_schema: { type: "object", properties: {}, required: [] },
      },
      run: async () => {
        try {
          const rows = await db
            .select({
              title: tasks.title,
              category: tasks.category,
              status: tasks.status,
              risk_level: tasks.risk_level,
              priority: tasks.priority,
            })
            .from(tasks)
            .where(
              and(
                eq(tasks.workspace_id, workspaceId),
                eq(tasks.archived, false),
                inArray(tasks.status, ["new", "ready", "changes_requested"]),
              ),
            )
            .orderBy(desc(tasks.created_at))
            .limit(60);
          if (!rows.length) return { summary: "There are no open tasks in the Approval Center right now." };
          const lines = rows.map(
            (t) => `- [${t.status}] (${t.category}) ${t.title} — risk ${t.risk_level}, priority ${t.priority}`,
          );
          return { summary: `Open Approval Center tasks (${rows.length}):\n${lines.join("\n")}` };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't read the open tasks." };
        }
      },
    },
  ];
}

/* ------------------------------- chat ----------------------------------- */

export async function sendExecutiveMessage(
  workspaceId: string,
  text: string,
): Promise<{ ok: boolean; reply?: ExecMessage; error?: string }> {
  return runWithUsage(workspaceId, "executive-chat", () => _sendExecutiveMessage(workspaceId, text));
}
async function _sendExecutiveMessage(
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

  const [goals, memory, activeProjects, taskRows, postRows, pageRows, activity, mv, cal] = await Promise.all([
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
    computeMetricValues(workspaceId),
    getCalendarSnapshot(workspaceId, brief.timezone || undefined),
  ]);
  const gl = goalLines(goals, mv);

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
    brief.company_context ? `\nCOMPANY CONTEXT (from the Deep Dive):\n${brief.company_context}` : "",
    brief.crm_context ? `\nLIVE CRM: ${brief.crm_context}` : "",
    ...(cal
      ? [
          "",
          "YOUR SCHEDULE (next 7 days) — open the brief with what's on today, and flag deadlines/prep:",
          ...(cal.events.length
            ? cal.events
                .slice(0, 12)
                .map(
                  (e) =>
                    `- ${formatEventWhen(e.start, e.allDay, brief.timezone)} — ${e.title}${
                      e.attendees ? ` (${e.attendees} attendee${e.attendees === 1 ? "" : "s"})` : ""
                    }`,
                )
            : ["- No events on the calendar in the next 7 days."]),
        ]
      : []),
    "",
    "KPIs:",
    ...kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}${k.hint ? ` — ${k.hint}` : ""}`),
    "",
    "THIS MONTH'S FOCUS (the north star — frame this brief as progress toward it, and flag drift):",
    ...(gl.focus.length ? gl.focus : ["- None set yet."]),
    ...(gl.ongoing.length ? ["", "OTHER ACTIVE GOALS:", ...gl.ongoing] : []),
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
  kind: BriefKind = "daily",
): Promise<{ ok: boolean; brief?: ExecBrief; error?: string }> {
  return runWithUsage(workspaceId, "executive-brief", () => _generateDailyBrief(workspaceId, kind));
}
async function _generateDailyBrief(
  workspaceId: string,
  kind: BriefKind = "daily",
): Promise<{ ok: boolean; brief?: ExecBrief; error?: string }> {
  const kpis = await computeKpis(workspaceId);
  const { dossier, companyName } = await gatherBriefDossier(workspaceId, kpis);

  let content;
  try {
    content = await generateBrief(dossier, companyName, kind);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't generate the brief." };
  }

  const id = uid();
  const now = new Date();
  await db.insert(executiveBriefs).values({ id, workspace_id: workspaceId, kind, content, created_at: now });
  return { ok: true, brief: { id, kind, content, created_at: iso(now) } };
}

type BriefRow = typeof executiveBriefs.$inferSelect;

/** Map a stored brief row, tolerating older rows saved before newer fields. */
function toBrief(row: BriefRow): ExecBrief {
  const c = (row.content ?? {}) as Partial<ExecBriefContent>;
  return {
    id: row.id,
    kind: row.kind,
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

export async function getLatestBrief(workspaceId: string, kind?: BriefKind): Promise<ExecBrief | null> {
  const [row] = await db
    .select()
    .from(executiveBriefs)
    .where(
      kind
        ? and(eq(executiveBriefs.workspace_id, workspaceId), eq(executiveBriefs.kind, kind))
        : eq(executiveBriefs.workspace_id, workspaceId),
    )
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
  const connected = await getConnectedIntegrationNames(workspaceId).catch(() => []);
  const systems = inferAffectedSystems(`${s.title} ${s.goal} ${s.rationale}`, connected);
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

  const WEEKLY_MS = 6.5 * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  let generated = 0;
  for (const a of execAgents) {
    if (generated >= limit) break;
    if (seen.has(a.workspace_id)) continue;
    seen.add(a.workspace_id);
    try {
      const daily = await getLatestBrief(a.workspace_id, "daily");
      if (!daily || Date.now() - new Date(daily.created_at).getTime() >= STALE_MS) {
        const r = await generateDailyBrief(a.workspace_id, "daily");
        if (r.ok) generated += 1;
      }
      if (generated >= limit) break;
      const weekly = await getLatestBrief(a.workspace_id, "weekly");
      if (!weekly || Date.now() - new Date(weekly.created_at).getTime() >= WEEKLY_MS) {
        const r = await generateDailyBrief(a.workspace_id, "weekly");
        if (r.ok) generated += 1;
      }
    } catch {
      /* one workspace never blocks the rest */
    }
  }
  return { generated };
}

/* -------------------------- investor updates ---------------------------- */

function monthLabel(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
}

type InvestorRow = typeof investorUpdates.$inferSelect;

function toInvestorUpdate(row: InvestorRow): InvestorUpdate {
  const c = (row.content ?? {}) as Partial<InvestorUpdateContent>;
  return {
    id: row.id,
    audience: (row.audience ?? "investor") as UpdateAudience,
    archived: row.archived,
    created_at: iso(row.created_at),
    content: {
      period: c.period ?? "",
      tldr: c.tldr ?? "",
      highlights: c.highlights ?? [],
      metrics: c.metrics ?? [],
      lowlights: c.lowlights ?? [],
      whats_next: c.whats_next ?? [],
      asks: c.asks ?? [],
      closing: c.closing ?? "",
      image_url: c.image_url,
    },
  };
}

/** Normalize arbitrary edited content into a well-formed InvestorUpdateContent. */
function normalizeInvestorContent(input: Partial<InvestorUpdateContent>): InvestorUpdateContent {
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  return {
    period: String(input.period ?? "").trim(),
    tldr: String(input.tldr ?? "").trim(),
    highlights: strList(input.highlights),
    metrics: Array.isArray(input.metrics)
      ? input.metrics
          .map((m) => ({
            label: String(m?.label ?? "").trim(),
            value: String(m?.value ?? "").trim(),
            note: m?.note ? String(m.note).trim() : undefined,
          }))
          .filter((m) => m.label || m.value)
      : [],
    lowlights: strList(input.lowlights),
    whats_next: strList(input.whats_next),
    asks: strList(input.asks),
    closing: String(input.closing ?? "").trim(),
    image_url: input.image_url ? String(input.image_url) : undefined,
  };
}

/** Dossier for a stakeholder update. For investors it stays outward-safe;
 *  for team/advisor it also surfaces the internal work in flight (so the update
 *  can speak to what needs work and where help is wanted). */
async function gatherInvestorDossier(
  workspaceId: string,
  audience: UpdateAudience = "investor",
): Promise<{ dossier: string; companyName: string }> {
  const { brief } = await getPlanningContext(workspaceId);
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const internal = audience === "team" || audience === "advisor";

  const [kpis, mv, goals, taskRows, postRows, pageRows, activeProjects] = await Promise.all([
    computeKpis(workspaceId),
    computeMetricValues(workspaceId),
    db
      .select()
      .from(companyGoals)
      .where(and(eq(companyGoals.workspace_id, workspaceId), eq(companyGoals.status, "active"))),
    db
      .select({ title: tasks.title, status: tasks.status, archived: tasks.archived, updated_at: tasks.updated_at })
      .from(tasks)
      .where(eq(tasks.workspace_id, workspaceId)),
    db.select({ title: posts.title, status: posts.status }).from(posts).where(eq(posts.workspace_id, workspaceId)),
    db.select({ title: pages.title, status: pages.status }).from(pages).where(eq(pages.workspace_id, workspaceId)),
    db
      .select({ title: projects.title, kind: projects.kind })
      .from(projects)
      .where(and(eq(projects.workspace_id, workspaceId), eq(projects.status, "active"))),
  ]);

  const gl = goalLines(goals, mv);
  const shipped = taskRows
    .filter((t) => t.status === "done" && !t.archived && new Date(t.updated_at).getTime() >= monthAgo)
    .map((t) => t.title)
    .slice(0, 25);
  const contentLive = [
    ...postRows.filter((p) => p.status === "distributed").map((p) => p.title),
    ...pageRows.filter((p) => p.status === "published").map((p) => p.title),
  ].slice(0, 20);
  // Internal view (team / advisor only): what's still open, so the update can
  // speak to what needs work and where help is wanted.
  const inFlight = internal
    ? taskRows
        .filter((t) => t.status !== "done" && !t.archived)
        .map((t) => t.title)
        .slice(0, 15)
    : [];

  const lines = [
    `COMPANY: ${brief.company_name || "the company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Market / customers: ${brief.ideal_customer_profile}` : "",
    "",
    "METRICS (current):",
    ...kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}${k.hint ? ` — ${k.hint}` : ""}`),
    "",
    "GOALS / FOCUS:",
    ...(gl.focus.length || gl.ongoing.length ? [...gl.focus, ...gl.ongoing] : ["- None set."]),
    "",
    "PROGRESS — SHIPPED (last 30 days):",
    ...(shipped.length ? shipped.map((t) => `- ${t}`) : ["- Nothing formally completed in the last 30 days."]),
    "",
    "CONTENT / MARKET PRESENCE:",
    ...(contentLive.length ? contentLive.map((t) => `- ${t}`) : ["- None live yet."]),
    "",
    "INITIATIVES UNDERWAY:",
    ...(activeProjects.length
      ? activeProjects.map((p) => `- ${p.kind === "growth" ? "Growth campaign" : "Project"}: ${p.title}`)
      : ["- None active."]),
    ...(internal
      ? [
          "",
          "WORK IN FLIGHT (internal — not yet shipped):",
          ...(inFlight.length ? inFlight.map((t) => `- ${t}`) : ["- Nothing open."]),
        ]
      : []),
  ];
  return { dossier: lines.join("\n"), companyName: brief.company_name };
}

/** Generate + store a monthly stakeholder update for an audience (on-demand only). */
export async function generateInvestorUpdate(
  workspaceId: string,
  audience: UpdateAudience = "investor",
): Promise<{ ok: boolean; update?: InvestorUpdate; error?: string }> {
  const period = monthLabel();
  const { dossier, companyName } = await gatherInvestorDossier(workspaceId, audience);
  let content;
  try {
    content = await writeInvestorUpdate(dossier, companyName, period, audience);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't generate the update." };
  }
  const id = uid();
  const now = new Date();
  await db.insert(investorUpdates).values({ id, workspace_id: workspaceId, audience, content, created_at: now });
  return { ok: true, update: { id, audience, content, archived: false, created_at: iso(now) } };
}

export async function listInvestorUpdates(workspaceId: string, limit = 120): Promise<InvestorUpdate[]> {
  const rows = await db
    .select()
    .from(investorUpdates)
    .where(eq(investorUpdates.workspace_id, workspaceId))
    .orderBy(desc(investorUpdates.created_at))
    .limit(limit);
  return rows.map(toInvestorUpdate);
}

/** Archive or unarchive an investor update (soft-hide from the default list). */
export async function setInvestorUpdateArchived(
  workspaceId: string,
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; update?: InvestorUpdate; error?: string }> {
  try {
    const [row] = await db
      .update(investorUpdates)
      .set({ archived })
      .where(and(eq(investorUpdates.id, id), eq(investorUpdates.workspace_id, workspaceId)))
      .returning();
    if (!row) return { ok: false, error: "Update not found." };
    return { ok: true, update: toInvestorUpdate(row) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't archive the update." };
  }
}

/** Permanently delete an investor update. */
export async function deleteInvestorUpdate(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(investorUpdates)
    .where(and(eq(investorUpdates.id, id), eq(investorUpdates.workspace_id, workspaceId)));
  return { ok: true };
}

/** Save founder edits to an investor update (content + optional hero image). */
export async function updateInvestorUpdate(
  workspaceId: string,
  id: string,
  content: Partial<InvestorUpdateContent>,
): Promise<{ ok: boolean; update?: InvestorUpdate; error?: string }> {
  try {
    const clean = normalizeInvestorContent(content);
    const [row] = await db
      .update(investorUpdates)
      .set({ content: clean })
      .where(and(eq(investorUpdates.id, id), eq(investorUpdates.workspace_id, workspaceId)))
      .returning();
    if (!row) return { ok: false, error: "Update not found." };
    return { ok: true, update: toInvestorUpdate(row) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the update." };
  }
}

/* ------------------------------- bundle --------------------------------- */

export async function getExecutiveBundle(workspaceId: string): Promise<ExecutiveBundle> {
  // prettier-ignore
  const [[execAgent], messages, memory, goals, kpis, nudges, briefs, metricValues, invUpdates, [brief]] = await Promise.all([
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
    computeMetricValues(workspaceId),
    listInvestorUpdates(workspaceId, 120),
    // Just the company name — a cheap 1-row read. (Do NOT pull getPlanningContext
    // here: it fires live HubSpot + Google Calendar API calls the page doesn't need,
    // which dominated the Executive page's load time.)
    db
      .select({ company_name: businessBriefs.company_name })
      .from(businessBriefs)
      .where(eq(businessBriefs.workspace_id, workspaceId))
      .limit(1),
  ]);

  return {
    agentName: execAgent?.name ?? "Executive Agent",
    companyName: brief?.company_name ?? "",
    messages: messages.map(toMsg),
    memory: memory.map(toMem),
    goals: goals.map((g) => toGoal(g, metricValues)),
    kpis,
    nudges,
    briefs,
    investorUpdates: invUpdates,
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
  input: {
    title: string;
    detail?: string;
    metric?: string;
    target?: string;
    horizon?: GoalHorizon;
    metric_key?: GoalMetric | null;
    target_number?: number | null;
  },
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
    horizon: horizonOf(input.horizon),
    metric_key: metricOf(input.metric_key),
    target_number: input.target_number != null ? numOrNull(input.target_number) : null,
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
