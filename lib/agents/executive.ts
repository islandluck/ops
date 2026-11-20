import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull } from "drizzle-orm";
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
  executiveSavedMessages,
  executiveThreads,
  investorUpdates,
  pages,
  posts,
  projects,
  tasks,
  teamNotifications,
} from "@/lib/db/schema";
import { createPlannedTask, getConnectedIntegrationNames, getPlanningContext } from "@/lib/db/queries";
import { createAssignment, getTeamContext, listTeamMembers } from "@/lib/agents/team";
import { inferAffectedSystems } from "@/lib/agents/infer-systems";
import {
  createCalendarEvent,
  getCalendarSnapshot,
  formatEventWhen,
  getMessageMeta,
  listInboxMessages,
} from "@/lib/integrations/google";
import { createZoomMeeting } from "@/lib/integrations/zoom";
import { notifySlack } from "@/lib/integrations/slack";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { resolveRecipientCandidates } from "@/lib/agents/recipient";
import { composeOutboundDrafts } from "@/lib/agents/outbound";
import { researchTopics } from "@/lib/ai/research";
import { createQuoteRequest, draftAllRfqs, sourceSuppliers } from "@/lib/quotes";
import { createOutreachCampaign, draftAllOutreach, sourceContacts } from "@/lib/outreach";
import {
  createContact as crmCreateContact,
  createDeal as crmCreateDeal,
  findOrCreateCompany as crmFindOrCreateCompany,
  listCompanies as crmListCompanies,
  listContacts as crmListContacts,
  listDeals as crmListDeals,
  logActivity as crmLogActivity,
  updateDeal as crmUpdateDeal,
} from "@/lib/crm";
import { computeKpis, computeMetricValues } from "@/lib/executive/kpis";
import { computeNudges } from "@/lib/executive/nudges";
import { executiveReply, generateBrief, organizeSaved, writeInvestorUpdate, type ExecImage, type ExecTool } from "@/lib/ai/executive";
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
  ExecSavedMessage,
  ExecThread,
  ExecThreadHit,
  ExecutiveBundle,
  GoalHorizon,
  GoalMetric,
  GoalStatus,
  InvestorUpdate,
  InvestorUpdateContent,
  MemoryKind,
  Priority,
  UpdateAudience,
  CrmDealStage,
  CrmRelationshipType,
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
      ? `\nTEAM (your people — their roles, reporting lines, skills, birthdays, timezones, and open handoffs. Use this for any plan or delegation AND to answer questions about the team, including whose birthday is coming up and who reports to whom):\n${teamContext}`
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
    "- SCHEDULING: when the founder wants to meet someone, use schedule_meeting — it books the Zoom, adds it to their calendar, and drafts the invite in the Email Manager (never sends). Compute start_time as a full ISO 8601 timestamp from their words + today's date, and pass their timezone.",
    "- SLACK: when the founder wants to share an update, announcement, or note with their team, use post_to_slack — it posts to their connected Slack. Only post what they clearly want shared; don't send routine chatter or your own commentary there.",
    "- DELEGATING: when the founder wants a teammate to own or handle something (e.g. 'have Sarah take the pricing page'), use delegate_to_teammate — it assigns the task to that person in the Team Room and notifies them. Resolve the person by the name the founder uses (a first name is fine). If the name doesn't match anyone, say who's on the team rather than guessing.",
    "- CAPTURING TASKS: when the founder wants to add a to-do for THEMSELVES (e.g. 'add a task to follow up with Acme Friday', 'remind me to review the deck'), use create_task — a single discrete to-do that lands on their Approval Center board. Use create_project instead only for genuinely multi-step initiatives.",
    "- SEEING IMAGES: the founder can attach an image (a screenshot, a photo, a chart, a page of a doc) to their message and you can SEE it. Read what's actually in the image and respond to it directly — describe a bug, pull the numbers off a chart, react to a design, transcribe text. Never say you can't view images.",
    "- Only act via tools when it genuinely helps; most turns are just good conversation and advice.",
  ];

  return lines.filter((l) => l !== "").join("\n");
}

/* -------------------------------- tools --------------------------------- */

/** Resolve a teammate by the loose name the founder used (exact → first-name → unique substring). */
function matchMember<T extends { name: string }>(members: T[], query: string): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = members.find((m) => m.name.toLowerCase() === q);
  if (exact) return exact;
  const byFirst = members.find((m) => m.name.toLowerCase().split(/\s+/)[0] === q);
  if (byFirst) return byFirst;
  const contains = members.filter((m) => m.name.toLowerCase().includes(q));
  return contains.length === 1 ? contains[0] : null;
}

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
      definition: {
        name: "source_quotes",
        description:
          "Source price quotes for a product or service the founder needs. Researches real suppliers on the live web, then drafts a request-for-quote (RFQ) email to each in the Email Manager for the founder to review + send. Use when the founder wants quotes/pricing from vendors (e.g. 'find me quotes for a 100 kW electrolyzer'). Returns a link to the Quotes page to track suppliers + collected quotes.",
        input_schema: {
          type: "object",
          properties: {
            what: {
              type: "string",
              description: "The product/service to get quotes for (e.g. '100 kW electrolyzer for hydrogen production')",
            },
            details: { type: "string", description: "Any specs, requirements, or quantities to include in the RFQ" },
            count: { type: "number", description: "How many quotes the founder wants (default 3)" },
          },
          required: ["what"],
        },
      },
      run: async (input) => {
        const what = str(input.what).trim();
        if (!what) return { summary: "Tell me what you need a quote for." };
        const details = str(input.details).trim();
        const count = typeof input.count === "number" ? input.count : Number(input.count) || 3;
        try {
          const created = await createQuoteRequest(workspaceId, { title: what, spec: details, target_count: count });
          if (!created.ok) return { summary: `Couldn't start the quote request: ${created.error}` };
          const reqId = created.request.id;
          const sourced = await sourceSuppliers(workspaceId, reqId);
          if (!sourced.ok) return { summary: `Couldn't research suppliers: ${sourced.error}`, href: `/quotes?open=${reqId}` };
          if (!sourced.configured) {
            return {
              summary:
                "I created the quote request, but live web research isn't set up (no TAVILY_API_KEY) — add suppliers manually on the Quotes page.",
              href: `/quotes?open=${reqId}`,
            };
          }
          const drafted = await draftAllRfqs(workspaceId, reqId, "", null);
          return {
            summary: `Sourced ${sourced.added} supplier${sourced.added === 1 ? "" : "s"} for "${what}" and drafted ${drafted.drafted} request-for-quote email${drafted.drafted === 1 ? "" : "s"} in the Email Manager — review and send them there. Track replies + quotes on the Quotes page.`,
            href: `/quotes?open=${reqId}`,
          };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't source quotes." };
        }
      },
    },
    {
      definition: {
        name: "run_outreach",
        description:
          "Run a cold-outreach campaign. Describe who to reach and why; this finds real companies that fit, identifies the right decision-maker at each on the live web, then drafts a personalized outreach email to each in the Email Manager for the founder to review + send. Use when the founder wants to reach out to a type of company/person (e.g. 'reach out to potential pilot customers to gauge interest'). Never sends automatically. Returns a link to the Outreach page to track contacts + replies.",
        input_schema: {
          type: "object",
          properties: {
            idea: {
              type: "string",
              description: "Who to reach and why (e.g. 'companies that could pilot our product — gauge their interest')",
            },
            context: { type: "string", description: "The pitch / context used to personalize each email (what we offer, the ask)" },
            roles: { type: "string", description: "Target decision-maker roles (e.g. 'VP Business Development, Head of Procurement')" },
            count: { type: "number", description: "How many companies/contacts to find (default 5)" },
          },
          required: ["idea"],
        },
      },
      run: async (input) => {
        const idea = str(input.idea).trim();
        if (!idea) return { summary: "Tell me who you want to reach, and why." };
        const context = str(input.context).trim();
        const roles = str(input.roles).trim();
        const count = typeof input.count === "number" ? input.count : Number(input.count) || 5;
        try {
          const created = await createOutreachCampaign(workspaceId, {
            title: idea,
            description: context,
            target_roles: roles,
            target_count: count,
          });
          if (!created.ok) return { summary: `Couldn't start the outreach campaign: ${created.error}` };
          const campId = created.campaign.id;
          const sourced = await sourceContacts(workspaceId, campId);
          if (!sourced.ok) return { summary: `Couldn't research contacts: ${sourced.error}`, href: `/outreach?open=${campId}` };
          if (!sourced.configured) {
            return {
              summary:
                "I created the outreach campaign, but live web research isn't set up (no ANTHROPIC_API_KEY) — add contacts manually on the Outreach page.",
              href: `/outreach?open=${campId}`,
            };
          }
          const drafted = await draftAllOutreach(workspaceId, campId, "", null);
          return {
            summary: `Found ${sourced.added} contact${sourced.added === 1 ? "" : "s"} for "${idea}" and drafted ${drafted.drafted} outreach email${drafted.drafted === 1 ? "" : "s"} in the Email Manager — review and send them there. Track replies on the Outreach page.`,
            href: `/outreach?open=${campId}`,
          };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't run outreach." };
        }
      },
    },
    {
      definition: {
        name: "crm_add",
        description:
          "Add a company (and optionally a person and/or a deal) to the CRM. Use when the founder mentions a new company, lead, partner, investor, or vendor to track (e.g. 'add Acme Corp as a prospect', 'add John Smith at Beta'). Operator's CRM is the system of record.",
        input_schema: {
          type: "object",
          properties: {
            company: { type: "string", description: "Company / account name" },
            relationship_type: {
              type: "string",
              description: "customer | prospect | partner | investor | vendor | other (default prospect)",
            },
            person: { type: "string", description: "A contact's full name at the company (optional)" },
            title: { type: "string", description: "The contact's title (optional)" },
            email: { type: "string", description: "The contact's email (optional)" },
            deal: { type: "string", description: "A deal title to open for this company (optional)" },
            deal_amount: { type: "number", description: "The deal's value in dollars (optional)" },
          },
          required: ["company"],
        },
      },
      run: async (input) => {
        const companyName = str(input.company).trim();
        if (!companyName) return { summary: "Which company should I add?" };
        try {
          const relRaw = str(input.relationship_type).trim().toLowerCase();
          const REL = ["customer", "prospect", "partner", "investor", "vendor", "other"];
          const rel = REL.includes(relRaw) ? (relRaw as CrmRelationshipType) : undefined;
          const company = await crmFindOrCreateCompany(workspaceId, { name: companyName, relationship_type: rel, source: "agent" });
          const parts = [`${company.name} is in the CRM`];
          let contactId: string | null = null;
          const person = str(input.person).trim();
          const email = str(input.email).trim();
          if (person || email) {
            const c = await crmCreateContact(workspaceId, {
              name: person,
              company_id: company.id,
              title: str(input.title),
              email: email || null,
              source: "agent",
            });
            if (c.ok) {
              contactId = c.contact.id;
              parts.push(`with ${c.contact.name}`);
            }
          }
          const dealTitle = str(input.deal).trim();
          if (dealTitle) {
            const amt = typeof input.deal_amount === "number" ? input.deal_amount : Number(input.deal_amount) || null;
            const d = await crmCreateDeal(workspaceId, {
              company_id: company.id,
              title: dealTitle,
              amount: amt,
              primary_contact_id: contactId,
              source: "agent",
            });
            if (d.ok) parts.push(`and the deal "${dealTitle}"`);
          }
          return { summary: parts.join(" ") + ".", href: "/crm" };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't add to the CRM." };
        }
      },
    },
    {
      definition: {
        name: "crm_log",
        description:
          "Log a note to someone in the CRM — a call, a reply, context to remember (e.g. 'log that John wants a demo next week'). Finds the contact or company by name and appends to their timeline.",
        input_schema: {
          type: "object",
          properties: {
            about: { type: "string", description: "The person or company the note is about" },
            note: { type: "string", description: "What to log" },
          },
          required: ["about", "note"],
        },
      },
      run: async (input) => {
        const about = str(input.about).trim();
        const note = str(input.note).trim();
        if (!about || !note) return { summary: "Tell me who it's about and what to log." };
        try {
          const al = about.toLowerCase();
          const contacts = await crmListContacts(workspaceId);
          const contact = contacts.find((c) => c.name.toLowerCase().includes(al));
          if (contact) {
            await crmLogActivity(workspaceId, {
              type: "note",
              summary: note.slice(0, 140),
              body: note,
              source: "agent",
              contact_id: contact.id,
              company_id: contact.company_id,
            });
            return { summary: `Logged a note on ${contact.name}.`, href: "/crm" };
          }
          const companies = await crmListCompanies(workspaceId);
          const company = companies.find((c) => c.name.toLowerCase().includes(al));
          if (company) {
            await crmLogActivity(workspaceId, {
              type: "note",
              summary: note.slice(0, 140),
              body: note,
              source: "agent",
              company_id: company.id,
            });
            return { summary: `Logged a note on ${company.name}.`, href: "/crm" };
          }
          return { summary: `I couldn't find "${about}" in the CRM — want me to add them?` };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't log the note." };
        }
      },
    },
    {
      definition: {
        name: "crm_update_deal",
        description:
          "Move a deal's stage or change its value in the CRM (e.g. 'move the Acme deal to negotiation', 'mark Beta won'). Finds the deal by title.",
        input_schema: {
          type: "object",
          properties: {
            deal: { type: "string", description: "The deal's title (or part of it)" },
            stage: { type: "string", description: "new | qualified | proposal | negotiation | won | lost" },
            value: { type: "number", description: "New deal value in dollars (optional)" },
          },
          required: ["deal"],
        },
      },
      run: async (input) => {
        const title = str(input.deal).trim();
        if (!title) return { summary: "Which deal?" };
        try {
          const deals = await crmListDeals(workspaceId);
          const deal = deals.find((d) => d.title.toLowerCase().includes(title.toLowerCase()));
          if (!deal) return { summary: `No deal matching "${title}" in the CRM.` };
          const STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"];
          const patch: { stage?: CrmDealStage; amount?: number | null } = {};
          const stage = str(input.stage).trim().toLowerCase();
          if (stage && STAGES.includes(stage)) patch.stage = stage as CrmDealStage;
          const val = input.value;
          if (val != null && val !== "") patch.amount = typeof val === "number" ? val : Number(val) || null;
          if (patch.stage === undefined && patch.amount === undefined) return { summary: "Tell me the new stage or value." };
          await crmUpdateDeal(workspaceId, deal.id, patch, { source: "agent" });
          return {
            summary: `Updated "${deal.title}"${patch.stage ? ` → ${patch.stage}` : ""}${patch.amount != null ? ` ($${patch.amount.toLocaleString()})` : ""}.`,
            href: "/crm",
          };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't update the deal." };
        }
      },
    },
    {
      silent: true,
      definition: {
        name: "crm_lookup",
        description:
          "Look up a company, contact, or deal in the CRM and return its status — open deals, value, last touch. Use to answer 'what's the status of the Acme deal?' or 'when did we last talk to John?'.",
        input_schema: {
          type: "object",
          properties: { query: { type: "string", description: "A company, person, or deal name" } },
          required: ["query"],
        },
      },
      run: async (input) => {
        const q = str(input.query).trim();
        if (!q) return { summary: "Who or what should I look up?" };
        try {
          const ql = q.toLowerCase();
          const [companies, contacts, deals] = await Promise.all([
            crmListCompanies(workspaceId),
            crmListContacts(workspaceId),
            crmListDeals(workspaceId),
          ]);
          const company = companies.find((c) => c.name.toLowerCase().includes(ql));
          const deal = deals.find((d) => d.title.toLowerCase().includes(ql));
          const contact = contacts.find((c) => c.name.toLowerCase().includes(ql));
          if (company) {
            const cDeals = deals.filter((d) => d.company_id === company.id);
            const open = cDeals.filter((d) => d.stage !== "won" && d.stage !== "lost");
            const val = open.reduce((n, d) => n + (d.amount ?? 0), 0);
            return {
              summary: `${company.name} (${company.relationship_type}): ${company.contact_count ?? 0} contact(s), ${open.length} open deal(s)${val ? ` worth $${val.toLocaleString()}` : ""}.`,
              href: "/crm",
            };
          }
          if (deal) {
            return {
              summary: `Deal "${deal.title}" (${deal.company_name ?? "—"}): ${deal.stage}${deal.amount != null ? `, $${deal.amount.toLocaleString()}` : ""}, last activity ${deal.last_activity_at ? new Date(deal.last_activity_at).toLocaleDateString() : "none"}.`,
              href: "/crm",
            };
          }
          if (contact) {
            return {
              summary: `${contact.name}${contact.title ? `, ${contact.title}` : ""}${contact.company_name ? ` at ${contact.company_name}` : ""} — last touch ${contact.last_touch_at ? new Date(contact.last_touch_at).toLocaleDateString() : "never"}.`,
              href: "/crm",
            };
          }
          return { summary: `Nothing in the CRM matches "${q}".` };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't look that up." };
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
    {
      definition: {
        name: "delegate_to_teammate",
        description:
          "Hand a task off to a specific teammate — assigns it to them in the Team Room and notifies them. Use when the founder wants someone to own/handle/take something. Resolve the person by the name the founder uses (a first name is fine).",
        input_schema: {
          type: "object",
          properties: {
            to: { type: "string", description: "The teammate's name (a first name is fine)" },
            task: { type: "string", description: "What they should do — a clear, self-contained task title" },
            note: { type: "string", description: "Optional context or instructions for them" },
          },
          required: ["to", "task"],
        },
      },
      run: async (input) => {
        const toName = str(input.to).trim();
        const task = str(input.task).trim();
        if (!toName || !task) return { summary: "I need who to assign it to and what the task is." };
        const members = await listTeamMembers(workspaceId);
        if (!members.length) {
          return { summary: "You haven't added any teammates yet — add them in Team and I can delegate.", href: "/team" };
        }
        const member = matchMember(members, toName);
        if (!member) {
          return {
            summary: `I couldn't pin down "${toName}" on your team. Your teammates: ${members.map((m) => m.name).join(", ")}.`,
            href: "/team",
          };
        }
        const note = str(input.note).trim();
        const res = await createAssignment(workspaceId, { member_id: member.id, title: task, handoff_note: note });
        if (!res.ok) return { summary: `Couldn't assign that: ${res.error}` };
        // In-app notification for the member (best-effort) + a Slack ping.
        try {
          await db.insert(teamNotifications).values({
            id: uid(),
            workspace_id: workspaceId,
            member_id: member.id,
            kind: "assignment",
            title: `New task: ${task.slice(0, 80)}`,
            body: note.slice(0, 500) || `You've been assigned "${task.slice(0, 200)}".`,
            ref_type: "assignment",
            ref_id: res.assignment.id,
            created_at: new Date(),
          });
        } catch {
          /* best-effort — the assignment still stands */
        }
        await notifySlack(workspaceId, `📌 New task for *${member.name}*: ${task}`).catch(() => {});
        return {
          summary: `Assigned to ${member.name}: "${task}". They'll see it in their portal and get a notification.`,
          href: "/team",
        };
      },
    },
    {
      definition: {
        name: "create_task",
        description:
          "Add a single to-do to the founder's OWN Approval Center board — a discrete task, not a multi-step project and not for a teammate. Use when the founder wants to capture a task or reminder for themselves.",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The task, phrased as a clear to-do" },
            category: {
              type: "string",
              enum: ["growth", "admin", "content", "research", "finance"],
              description: "Best-fit category (default admin)",
            },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Urgency (default medium)" },
            notes: { type: "string", description: "Optional extra detail / context" },
          },
          required: ["title"],
        },
      },
      run: async (input) => {
        const title = str(input.title).trim();
        if (!title) return { summary: "What's the task?" };
        const cat = str(input.category) as Category;
        const category: Category = (["growth", "admin", "content", "research", "finance"] as Category[]).includes(cat)
          ? cat
          : "admin";
        const pri = str(input.priority) as Priority;
        const priority: Priority = (["low", "medium", "high", "urgent"] as Priority[]).includes(pri) ? pri : "medium";
        try {
          await createPlannedTask(
            workspaceId,
            {
              title: title.slice(0, 140),
              category,
              affected_systems: [],
              risk_level: "low",
              priority,
              requires_approval: false,
              rationale: str(input.notes).trim() || "Captured from your Executive chat.",
              draft: "",
              needs_connection: [],
            },
            { name: "You" },
          );
          return { summary: `Added a task: "${title.slice(0, 80)}" — it's on your Approval Center board.`, href: "/approvals" };
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't add the task." };
        }
      },
    },
    {
      definition: {
        name: "schedule_meeting",
        description:
          "Schedule a Zoom meeting with someone. Resolves who they are, creates the Zoom meeting, adds it to the founder's Google Calendar, and DRAFTS the invite email (with the join link) in the Email Manager for review — it never sends. Give start_time as a full ISO 8601 timestamp you compute from the founder's words + today's date, plus their timezone.",
        input_schema: {
          type: "object",
          properties: {
            with: { type: "string", description: "Who to meet — a name (resolved via CRM/Gmail) or an email address" },
            topic: { type: "string", description: "Meeting topic / title" },
            start_time: { type: "string", description: "ISO 8601 start, e.g. 2026-08-27T14:00:00-04:00" },
            duration_min: { type: "number", description: "Length in minutes (default 30)" },
            timezone: { type: "string", description: "IANA timezone, e.g. America/New_York" },
          },
          required: ["with", "topic", "start_time"],
        },
      },
      run: async (input) => {
        const withWho = str(input.with).trim();
        const topic = str(input.topic).trim() || "Meeting";
        const startStr = str(input.start_time).trim();
        const dur = num(input.duration_min, 30);
        const tz = str(input.timezone).trim() || undefined;
        if (!withWho || !startStr) return { summary: "I need who to meet and a start time to schedule." };
        const start = new Date(startStr);
        if (Number.isNaN(start.getTime())) return { summary: `I couldn't read the start time "${startStr}".` };
        const startISO = start.toISOString();
        const endISO = new Date(start.getTime() + dur * 60000).toISOString();

        const zoomToken = await getValidAccessToken(workspaceId, "Zoom");
        if (!zoomToken) {
          return { summary: "Zoom isn't connected yet — connect it in Integrations to schedule meetings.", href: "/integrations" };
        }
        let meeting;
        try {
          meeting = await createZoomMeeting(zoomToken, { topic, startTime: startISO, durationMin: dur, timezone: tz });
        } catch (e) {
          return { summary: e instanceof Error ? e.message : "Couldn't create the Zoom meeting." };
        }

        // Resolve the attendee's email (best-effort — for the calendar invite + email).
        let attendeeEmail = "";
        try {
          const { primary } = await resolveRecipientCandidates(workspaceId, withWho);
          attendeeEmail = primary.email || "";
        } catch {
          /* ignore */
        }

        // Add to Google Calendar (best-effort; same Google connection as Gmail).
        let calAdded = false;
        const gToken = await getValidAccessToken(workspaceId, "Google Calendar");
        if (gToken) {
          try {
            await createCalendarEvent(gToken, {
              summary: topic,
              description: `Zoom meeting.\nJoin: ${meeting.join_url}${meeting.password ? `\nPasscode: ${meeting.password}` : ""}`,
              startISO,
              endISO,
              attendees: attendeeEmail ? [attendeeEmail] : undefined,
            });
            calAdded = true;
          } catch {
            /* ignore — the meeting + draft still stand */
          }
        }

        // Draft the invite email in the Email Manager (never sends).
        let drafted = false;
        try {
          const whenText = tz ? `${startISO} (${tz})` : startISO;
          await composeOutboundDrafts(workspaceId, [
            `Email ${withWho} to invite them to a Zoom meeting "${topic}" at ${whenText}. Include the join link ${meeting.join_url}${meeting.password ? ` (passcode ${meeting.password})` : ""}.`,
          ]);
          drafted = true;
        } catch {
          /* ignore */
        }

        const bits = ["Zoom created"];
        if (calAdded) bits.push("added to your calendar");
        if (drafted) bits.push("invite drafted in the Email Manager");
        return {
          summary: `Scheduled "${topic}" with ${withWho} — ${bits.join(", ")}. Join: ${meeting.join_url}`,
          href: drafted ? "/email" : "/integrations",
        };
      },
    },
    {
      definition: {
        name: "post_to_slack",
        description:
          "Post a message to the founder's connected Slack. Use when they want to share an update, announcement, or note with the team (e.g. 'tell the team we hit 20 customers', 'post this to Slack'). Posts to the workspace's default channel unless they name a specific one.",
        input_schema: {
          type: "object",
          properties: {
            message: { type: "string", description: "The message text to post" },
            channel: {
              type: "string",
              description: "Channel name or ID to post to (optional; defaults to the workspace channel)",
            },
          },
          required: ["message"],
        },
      },
      run: async (input) => {
        const message = str(input.message).trim();
        if (!message) return { summary: "Nothing to post — give me the message." };
        const channel = str(input.channel).trim() || undefined;
        const res = await notifySlack(workspaceId, message, channel);
        if (res.skipped) {
          return {
            summary: "Slack isn't connected yet — connect it in Integrations to post messages.",
            href: "/integrations",
          };
        }
        if (!res.ok) {
          return { summary: `Couldn't post to Slack: ${res.error ?? "unknown error"}.`, href: "/integrations" };
        }
        const preview = message.length > 80 ? `${message.slice(0, 80)}…` : message;
        return { summary: `Posted to Slack${channel ? ` (#${channel.replace(/^#/, "")})` : ""}: "${preview}"` };
      },
    },
  ];
}

/* ------------------------------- chat ----------------------------------- */

/* ---------------------------- threads ----------------------------------- */

function toThread(r: typeof executiveThreads.$inferSelect, messageCount: number): ExecThread {
  return {
    id: r.id,
    title: r.title,
    message_count: messageCount,
    updated_at: iso(r.updated_at),
    created_at: iso(r.created_at),
  };
}

/** The active thread (most recently updated); creates the first one and adopts
 *  any legacy un-threaded messages into it. */
async function ensureActiveThread(workspaceId: string): Promise<string> {
  const [t] = await db
    .select({ id: executiveThreads.id })
    .from(executiveThreads)
    .where(eq(executiveThreads.workspace_id, workspaceId))
    .orderBy(desc(executiveThreads.updated_at))
    .limit(1);
  if (t) return t.id;
  const id = uid();
  const now = new Date();
  await db.insert(executiveThreads).values({ id, workspace_id: workspaceId, title: "", created_at: now, updated_at: now });
  await db
    .update(executiveMessages)
    .set({ thread_id: id })
    .where(
      and(
        eq(executiveMessages.workspace_id, workspaceId),
        isNull(executiveMessages.thread_id),
        eq(executiveMessages.archived, false),
      ),
    );
  return id;
}

/** All conversation threads, most-recently-active first, with message counts. */
export async function listThreads(workspaceId: string): Promise<ExecThread[]> {
  const rows = await db
    .select()
    .from(executiveThreads)
    .where(eq(executiveThreads.workspace_id, workspaceId))
    .orderBy(desc(executiveThreads.updated_at))
    .limit(100);
  if (!rows.length) return [];
  const countRows = await db
    .select({ thread_id: executiveMessages.thread_id, c: count() })
    .from(executiveMessages)
    .where(
      and(
        eq(executiveMessages.workspace_id, workspaceId),
        inArray(
          executiveMessages.thread_id,
          rows.map((r) => r.id),
        ),
      ),
    )
    .groupBy(executiveMessages.thread_id);
  const cById = new Map(countRows.map((r) => [r.thread_id, Number(r.c)]));
  return rows.map((r) => toThread(r, cById.get(r.id) ?? 0));
}

/** A short excerpt of `content` around the first case-insensitive match of `q`. */
function makeSnippet(content: string, q: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  const ci = clean.toLowerCase().indexOf(q.toLowerCase());
  if (ci < 0) return clean.slice(0, 120);
  const start = Math.max(0, ci - 40);
  const end = Math.min(clean.length, ci + q.length + 90);
  return (start > 0 ? "…" : "") + clean.slice(start, end).trim() + (end < clean.length ? "…" : "");
}

/** Search threads by title AND message content; returns matches with a snippet. */
export async function searchThreads(workspaceId: string, query: string): Promise<ExecThreadHit[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const [msgRows, titleRows] = await Promise.all([
    db
      .select({ thread_id: executiveMessages.thread_id, content: executiveMessages.content })
      .from(executiveMessages)
      .where(
        and(
          eq(executiveMessages.workspace_id, workspaceId),
          isNotNull(executiveMessages.thread_id),
          ilike(executiveMessages.content, like),
        ),
      )
      .orderBy(desc(executiveMessages.created_at))
      .limit(300),
    db
      .select({ id: executiveThreads.id })
      .from(executiveThreads)
      .where(and(eq(executiveThreads.workspace_id, workspaceId), ilike(executiveThreads.title, like)))
      .limit(100),
  ]);
  const snippetByThread = new Map<string, string>();
  for (const m of msgRows) {
    if (m.thread_id && !snippetByThread.has(m.thread_id)) snippetByThread.set(m.thread_id, makeSnippet(m.content, q));
  }
  const ids = new Set<string>([...snippetByThread.keys(), ...titleRows.map((r) => r.id)]);
  if (!ids.size) return [];
  const idList = [...ids];
  const threadRows = await db
    .select()
    .from(executiveThreads)
    .where(and(eq(executiveThreads.workspace_id, workspaceId), inArray(executiveThreads.id, idList)))
    .orderBy(desc(executiveThreads.updated_at))
    .limit(60);
  const countRows = await db
    .select({ thread_id: executiveMessages.thread_id, c: count() })
    .from(executiveMessages)
    .where(
      and(
        eq(executiveMessages.workspace_id, workspaceId),
        inArray(
          executiveMessages.thread_id,
          threadRows.map((t) => t.id),
        ),
      ),
    )
    .groupBy(executiveMessages.thread_id);
  const cById = new Map(countRows.map((r) => [r.thread_id, Number(r.c)]));
  return threadRows.map((r) => ({ ...toThread(r, cById.get(r.id) ?? 0), snippet: snippetByThread.get(r.id) ?? "" }));
}

/** A thread's full message list (oldest → newest) — for reopening it. */
export async function getThreadMessages(workspaceId: string, threadId: string): Promise<ExecMessage[]> {
  const rows = await db
    .select()
    .from(executiveMessages)
    .where(and(eq(executiveMessages.workspace_id, workspaceId), eq(executiveMessages.thread_id, threadId)))
    .orderBy(asc(executiveMessages.created_at))
    .limit(500);
  return rows.map(toMsg);
}

export async function newExecutiveThread(workspaceId: string): Promise<{ id: string }> {
  const id = uid();
  const now = new Date();
  await db.insert(executiveThreads).values({ id, workspace_id: workspaceId, title: "", created_at: now, updated_at: now });
  return { id };
}

export async function renameThread(workspaceId: string, id: string, title: string): Promise<{ ok: boolean }> {
  await db
    .update(executiveThreads)
    .set({ title: title.trim().slice(0, 120) })
    .where(and(eq(executiveThreads.workspace_id, workspaceId), eq(executiveThreads.id, id)));
  return { ok: true };
}

export async function deleteThread(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(executiveMessages)
    .where(and(eq(executiveMessages.workspace_id, workspaceId), eq(executiveMessages.thread_id, id)));
  await db
    .delete(executiveThreads)
    .where(and(eq(executiveThreads.workspace_id, workspaceId), eq(executiveThreads.id, id)));
  return { ok: true };
}

/* ---------------------------- chat -------------------------------------- */

export async function sendExecutiveMessage(
  workspaceId: string,
  text: string,
  threadId?: string,
  images?: ExecImage[],
): Promise<{ ok: boolean; reply?: ExecMessage; threadId?: string; error?: string }> {
  return runWithUsage(workspaceId, "executive-chat", () => _sendExecutiveMessage(workspaceId, text, threadId, images));
}
async function _sendExecutiveMessage(
  workspaceId: string,
  text: string,
  threadId?: string,
  images?: ExecImage[],
): Promise<{ ok: boolean; reply?: ExecMessage; threadId?: string; error?: string }> {
  const clean = text.trim();
  const hasImages = !!(images && images.length);
  if (!clean && !hasImages) return { ok: false, error: "Type a message first." };
  // What we PERSIST for the thread: the text plus a marker when an image rode
  // along (the bytes themselves aren't stored — the image informs this turn).
  const storedUserContent = hasImages ? (clean ? `${clean}\n\n[Attached image]` : "[Attached image]") : clean;
  const tid = threadId || (await ensureActiveThread(workspaceId));

  // Prior turns in THIS thread (oldest→newest) before recording this one.
  const historyRows = await db
    .select()
    .from(executiveMessages)
    .where(and(eq(executiveMessages.workspace_id, workspaceId), eq(executiveMessages.thread_id, tid)))
    .orderBy(desc(executiveMessages.created_at))
    .limit(20);
  const history = historyRows.reverse().map((m) => ({ role: m.role, content: m.content }));

  const now = new Date();
  await db.insert(executiveMessages).values({
    id: uid(),
    workspace_id: workspaceId,
    thread_id: tid,
    role: "user",
    content: storedUserContent.slice(0, 4000),
    actions: [],
    created_at: now,
  });

  const kpis = await computeKpis(workspaceId);
  const system = await buildSystemPrompt(workspaceId, kpis);
  const tools = buildTools(workspaceId);

  let result;
  try {
    result = await executiveReply({ system, history, userMessage: clean, images, tools });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The Executive Agent couldn't respond." };
  }

  const asstAt = new Date();
  const asstId = uid();
  await db.insert(executiveMessages).values({
    id: asstId,
    workspace_id: workspaceId,
    thread_id: tid,
    role: "assistant",
    content: result.text,
    actions: result.actions,
    created_at: asstAt,
  });

  // Move the thread to the top + auto-title it from its first message.
  const [thread] = await db
    .select({ title: executiveThreads.title })
    .from(executiveThreads)
    .where(and(eq(executiveThreads.workspace_id, workspaceId), eq(executiveThreads.id, tid)))
    .limit(1);
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (thread && !thread.title.trim()) set.title = clean.replace(/\s+/g, " ").trim().slice(0, 80);
  await db.update(executiveThreads).set(set).where(and(eq(executiveThreads.workspace_id, workspaceId), eq(executiveThreads.id, tid)));

  return {
    ok: true,
    threadId: tid,
    reply: { id: asstId, role: "assistant", content: result.text, actions: result.actions, created_at: iso(asstAt) },
  };
}

/** Start a fresh conversation — creates a new thread and returns its id. Past
 *  threads stay in the history column, so nothing is lost. The agent's memory is
 *  separate and unaffected, so it still knows the business. */
export async function startNewExecutiveChat(workspaceId: string): Promise<{ ok: boolean; threadId: string }> {
  const { id } = await newExecutiveThread(workspaceId);
  return { ok: true, threadId: id };
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
  // Best-effort Slack ping that the brief landed (no-op if Slack isn't connected).
  const nextUp = content.next.slice(0, 3).map((n) => `• ${n}`).join("\n");
  const slackText = [
    `📋 *Your ${kind} brief is ready.*`,
    content.headline,
    nextUp ? `\n*What needs you:*\n${nextUp}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);
  await notifySlack(workspaceId, slackText);
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
  const activeThreadId = await ensureActiveThread(workspaceId);
  // prettier-ignore
  const [[execAgent], messages, memory, goals, kpis, nudges, briefs, metricValues, invUpdates, [brief], threads] = await Promise.all([
    db
      .select({ name: agents.name })
      .from(agents)
      .where(and(eq(agents.workspace_id, workspaceId), eq(agents.tier, "executive")))
      .limit(1),
    db
      .select()
      .from(executiveMessages)
      .where(and(eq(executiveMessages.workspace_id, workspaceId), eq(executiveMessages.thread_id, activeThreadId)))
      .orderBy(asc(executiveMessages.created_at))
      .limit(500),
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
    listThreads(workspaceId),
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
    threads,
    activeThreadId,
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

/* --------------------------- saved messages ----------------------------- */

function toSaved(r: typeof executiveSavedMessages.$inferSelect): ExecSavedMessage {
  return {
    id: r.id,
    message_id: r.message_id ?? null,
    role: r.role,
    content: r.content,
    title: r.title,
    category: r.category,
    pinned: r.pinned,
    created_at: iso(r.created_at),
  };
}

/** Save a chat message to revisit later (idempotent per source message). */
export async function saveExecutiveMessage(
  workspaceId: string,
  input: { messageId?: string | null; role: "user" | "assistant"; content: string },
): Promise<{ ok: boolean; error?: string }> {
  const content = (input.content ?? "").trim();
  if (!content) return { ok: false, error: "Nothing to save." };
  if (input.messageId) {
    const [existing] = await db
      .select({ id: executiveSavedMessages.id })
      .from(executiveSavedMessages)
      .where(
        and(
          eq(executiveSavedMessages.workspace_id, workspaceId),
          eq(executiveSavedMessages.message_id, input.messageId),
        ),
      )
      .limit(1);
    if (existing) return { ok: true }; // already saved — no-op
  }
  await db.insert(executiveSavedMessages).values({
    id: uid(),
    workspace_id: workspaceId,
    message_id: input.messageId ?? null,
    role: input.role === "user" ? "user" : "assistant",
    content: content.slice(0, 12000),
    title: "",
    category: "",
    pinned: false,
    created_at: new Date(),
  });
  return { ok: true };
}

export async function listSavedMessages(workspaceId: string): Promise<ExecSavedMessage[]> {
  const rows = await db
    .select()
    .from(executiveSavedMessages)
    .where(eq(executiveSavedMessages.workspace_id, workspaceId))
    .orderBy(desc(executiveSavedMessages.pinned), desc(executiveSavedMessages.created_at))
    .limit(200);
  return rows.map(toSaved);
}

export async function deleteSavedMessage(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(executiveSavedMessages)
    .where(and(eq(executiveSavedMessages.workspace_id, workspaceId), eq(executiveSavedMessages.id, id)));
  return { ok: true };
}

export async function togglePinSaved(workspaceId: string, id: string, pinned: boolean): Promise<{ ok: boolean }> {
  await db
    .update(executiveSavedMessages)
    .set({ pinned })
    .where(and(eq(executiveSavedMessages.workspace_id, workspaceId), eq(executiveSavedMessages.id, id)));
  return { ok: true };
}

/** Have the Executive title + categorize the saved messages so they group cleanly. */
export async function organizeSavedMessages(workspaceId: string): Promise<{ ok: boolean; organized: number }> {
  return runWithUsage(workspaceId, "executive-organize-saved", async () => {
    const rows = await db
      .select({ id: executiveSavedMessages.id, content: executiveSavedMessages.content })
      .from(executiveSavedMessages)
      .where(eq(executiveSavedMessages.workspace_id, workspaceId))
      .limit(200);
    if (!rows.length) return { ok: true, organized: 0 };
    const result = await organizeSaved(rows.map((r) => ({ id: r.id, content: r.content })));
    let organized = 0;
    for (const r of result) {
      await db
        .update(executiveSavedMessages)
        .set({ title: r.title, category: r.category })
        .where(and(eq(executiveSavedMessages.workspace_id, workspaceId), eq(executiveSavedMessages.id, r.id)));
      organized++;
    }
    return { ok: true, organized };
  });
}

/** Promote a saved message into the Executive's durable memory. */
export async function promoteSavedToMemory(workspaceId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select()
    .from(executiveSavedMessages)
    .where(and(eq(executiveSavedMessages.workspace_id, workspaceId), eq(executiveSavedMessages.id, id)))
    .limit(1);
  if (!row) return { ok: false, error: "That saved item no longer exists." };
  const content = (row.title ? `${row.title}: ` : "") + row.content;
  return addMemory(workspaceId, content, "fact");
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
