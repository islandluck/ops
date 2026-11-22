import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  agents,
  businessBriefs,
  companyContext,
  companyGoals,
  deepDives,
  deepDiveSources,
  emailTriage,
  executiveMemory,
  operatingReviews,
  opportunities,
  projects,
  tasks,
} from "@/lib/db/schema";
import { getConnectedIntegrationNames, getPlanningContext } from "@/lib/db/queries";
import { computeKpis } from "@/lib/executive/kpis";
import { inferAffectedSystems } from "@/lib/agents/infer-systems";
import {
  distillSource,
  synthesizeContextPack,
  synthesizeOperatingReview,
  type AiUsage,
} from "@/lib/ai/deepdive";
import type {
  Category,
  CompanyContext,
  CompanyContextPack,
  DeepDive,
  DeepDiveCadence,
  DeepDiveSource,
  DeepDiveSourceKind,
  DeepDiveStatus,
  OperatingReview,
  OperatingReviewContent,
  ReviewAction,
  SourceDistillation,
} from "@/lib/types";

/**
 * Deep Dive engine — ingests company material (docs/text now; email/Notion later)
 * and synthesizes a cumulative Company Context Pack that informs every agent.
 * Runnable anytime, not just at onboarding. Everything is workspace-scoped.
 */

const uid = () => randomUUID();
const iso = (d: Date | string) => new Date(d).toISOString();

export const EMPTY_PACK: CompanyContextPack = {
  people: [],
  timeline: [],
  themes: [],
  decisions: [],
  open_threads: [],
  risks: [],
  products: [],
};

/** Max sources accepted per run — a cost/scope guardrail. */
export const MAX_SOURCES = 25;

type DiveRow = typeof deepDives.$inferSelect;
type SourceRow = typeof deepDiveSources.$inferSelect;
type ContextRow = typeof companyContext.$inferSelect;

function toDeepDive(row: DiveRow): DeepDive {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title,
    status: row.status,
    stage_detail: row.stage_detail,
    progress: row.progress ?? { done: 0, total: 0 },
    usage: row.usage ?? { input_tokens: 0, output_tokens: 0, est_cost_cents: 0, calls: 0 },
    error: row.error,
    started_at: row.started_at ? iso(row.started_at) : null,
    completed_at: row.completed_at ? iso(row.completed_at) : null,
    created_at: iso(row.created_at),
  };
}

function toSource(row: SourceRow): DeepDiveSource {
  return {
    id: row.id,
    deep_dive_id: row.deep_dive_id,
    kind: row.kind,
    title: row.title,
    char_count: row.char_count,
    status: row.status,
    created_at: iso(row.created_at),
  };
}

function toContext(row: ContextRow): CompanyContext {
  return {
    id: row.id,
    version: row.version,
    summary: row.summary,
    pack: row.pack ?? EMPTY_PACK,
    created_at: iso(row.created_at),
  };
}

export interface NewDeepDiveSource {
  kind: DeepDiveSourceKind;
  title: string;
  text: string;
}

/** Create a Deep Dive run from already-extracted sources. The worker processes it. */
export async function startDeepDive(
  workspaceId: string,
  title: string,
  sources: NewDeepDiveSource[],
): Promise<{ ok: boolean; deepDive?: DeepDive; error?: string }> {
  const clean = sources
    .map((s) => ({ kind: s.kind, title: (s.title || "Untitled").slice(0, 200), text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
    .slice(0, MAX_SOURCES);
  if (!clean.length) return { ok: false, error: "Add at least one document or some text to dive into." };

  const id = uid();
  const now = new Date();
  const fallbackTitle = `Deep Dive — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  await db.insert(deepDives).values({
    id,
    workspace_id: workspaceId,
    title: title.trim().slice(0, 200) || fallbackTitle,
    status: "queued",
    stage_detail: "Queued",
    progress: { done: 0, total: clean.length },
    created_at: now,
  });
  await db.insert(deepDiveSources).values(
    clean.map((s) => ({
      id: uid(),
      deep_dive_id: id,
      workspace_id: workspaceId,
      kind: s.kind,
      title: s.title,
      raw_text: s.text,
      char_count: s.text.length,
      status: "pending" as const,
      created_at: now,
    })),
  );
  const [row] = await db.select().from(deepDives).where(eq(deepDives.id, id)).limit(1);
  return { ok: true, deepDive: row ? toDeepDive(row) : undefined };
}

export async function listDeepDives(workspaceId: string, limit = 20): Promise<DeepDive[]> {
  const rows = await db
    .select()
    .from(deepDives)
    .where(and(eq(deepDives.workspace_id, workspaceId), eq(deepDives.mode, "context")))
    .orderBy(desc(deepDives.created_at))
    .limit(limit);
  return rows.map(toDeepDive);
}

export async function getDeepDive(
  workspaceId: string,
  id: string,
): Promise<{ deepDive: DeepDive; sources: DeepDiveSource[] } | null> {
  const [row] = await db
    .select()
    .from(deepDives)
    .where(and(eq(deepDives.id, id), eq(deepDives.workspace_id, workspaceId)))
    .limit(1);
  if (!row) return null;
  const srcs = await db
    .select()
    .from(deepDiveSources)
    .where(and(eq(deepDiveSources.deep_dive_id, id), eq(deepDiveSources.workspace_id, workspaceId)))
    .orderBy(desc(deepDiveSources.created_at));
  return { deepDive: toDeepDive(row), sources: srcs.map(toSource) };
}

/** The workspace's current Context Pack, if a Deep Dive has completed. */
export async function getCurrentContext(workspaceId: string): Promise<CompanyContext | null> {
  const [row] = await db
    .select()
    .from(companyContext)
    .where(and(eq(companyContext.workspace_id, workspaceId), eq(companyContext.is_current, true)))
    .orderBy(desc(companyContext.version))
    .limit(1);
  return row ? toContext(row) : null;
}

/* ------------------------------- worker --------------------------------- */

const ADVANCEABLE: DeepDiveStatus[] = ["queued", "distilling", "synthesizing"];
const DISTILL_BATCH = 3; // sources distilled per tick — keep a tick well within serverless limits
const LOCK_STALE_MS = 10 * 60 * 1000; // reclaim a lock held this long (a crashed tick)

/** Cron entry — advance in-progress Deep Dives across ALL workspaces, one bounded step each. */
export async function advanceDeepDives(limit = 3): Promise<{ advanced: number }> {
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  // tenant-scope-exempt: background worker sweeps every workspace, like advanceActiveProjects.
  const candidates = await db
    .select({ id: deepDives.id })
    .from(deepDives)
    .where(
      and(
        inArray(deepDives.status, ADVANCEABLE),
        or(isNull(deepDives.worker_locked_at), lt(deepDives.worker_locked_at, stale)),
      ),
    )
    .orderBy(asc(deepDives.created_at))
    .limit(limit);
  let advanced = 0;
  for (const c of candidates) {
    try {
      if (await advanceDeepDiveTick(c.id)) advanced++;
    } catch {
      /* isolate failures — one bad run can't block the rest */
    }
  }
  return { advanced };
}

/** Advance only the caller's workspace (used by the UI while a run is in progress). */
export async function advanceWorkspaceDeepDives(workspaceId: string, limit = 2): Promise<void> {
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  const candidates = await db
    .select({ id: deepDives.id })
    .from(deepDives)
    .where(
      and(
        eq(deepDives.workspace_id, workspaceId),
        inArray(deepDives.status, ADVANCEABLE),
        or(isNull(deepDives.worker_locked_at), lt(deepDives.worker_locked_at, stale)),
      ),
    )
    .limit(limit);
  for (const c of candidates) {
    try {
      await advanceDeepDiveTick(c.id);
    } catch {
      /* isolate */
    }
  }
}

/** One bounded unit of work for a single run, guarded by an atomic worker lock. */
async function advanceDeepDiveTick(id: string): Promise<boolean> {
  const now = new Date();
  const stale = new Date(now.getTime() - LOCK_STALE_MS);
  // Atomic claim — only one tick can hold the lock at a time.
  const [dive] = await db
    .update(deepDives)
    .set({ worker_locked_at: now })
    .where(
      and(
        eq(deepDives.id, id),
        inArray(deepDives.status, ADVANCEABLE),
        or(isNull(deepDives.worker_locked_at), lt(deepDives.worker_locked_at, stale)),
      ),
    )
    .returning();
  if (!dive) return false; // already claimed elsewhere, or finished

  try {
    // Review runs are a single synthesis tick over a live-node dossier (no distill stage).
    if (dive.mode === "review") {
      await runReviewTick(dive.workspace_id, id);
      return true;
    }
    if (dive.status === "queued") {
      await db
        .update(deepDives)
        .set({ status: "distilling", started_at: dive.started_at ?? now, stage_detail: "Reading your material" })
        .where(eq(deepDives.id, id));
      await distillBatch(dive.workspace_id, id);
    } else if (dive.status === "distilling") {
      await distillBatch(dive.workspace_id, id);
    } else if (dive.status === "synthesizing") {
      await synthesizeStep(dive.workspace_id, id);
    }
    return true;
  } catch (e) {
    await db
      .update(deepDives)
      .set({
        status: "failed",
        stage_detail: "Failed",
        error: e instanceof Error ? e.message.slice(0, 400) : "Deep Dive failed.",
      })
      .where(eq(deepDives.id, id));
    return false;
  } finally {
    await db.update(deepDives).set({ worker_locked_at: null }).where(eq(deepDives.id, id));
  }
}

/** Distill up to DISTILL_BATCH pending sources; when none remain, move to synthesis. */
async function distillBatch(workspaceId: string, diveId: string): Promise<void> {
  const { brief } = await getPlanningContext(workspaceId);
  const pending = await db
    .select()
    .from(deepDiveSources)
    .where(
      and(
        eq(deepDiveSources.deep_dive_id, diveId),
        eq(deepDiveSources.workspace_id, workspaceId),
        eq(deepDiveSources.status, "pending"),
      ),
    )
    .orderBy(asc(deepDiveSources.created_at))
    .limit(DISTILL_BATCH);

  for (const src of pending) {
    try {
      const { distilled, usage } = await distillSource(
        { title: src.title, text: src.raw_text ?? "" },
        brief.company_name,
      );
      await db.update(deepDiveSources).set({ distilled, status: "distilled" }).where(eq(deepDiveSources.id, src.id));
      await bumpUsage(diveId, usage);
    } catch (e) {
      // A single unreadable doc shouldn't stall the run — mark it failed and move on.
      await db
        .update(deepDiveSources)
        .set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "distill failed" })
        .where(eq(deepDiveSources.id, src.id));
    }
  }

  const total = await countSources(diveId, workspaceId, false);
  const left = await countSources(diveId, workspaceId, true);
  const done = total - left;
  await db
    .update(deepDives)
    .set({ progress: { done, total }, stage_detail: `Read ${done} of ${total}` })
    .where(eq(deepDives.id, diveId));
  if (left === 0) {
    await db
      .update(deepDives)
      .set({ status: "synthesizing", stage_detail: "Connecting the dots" })
      .where(eq(deepDives.id, diveId));
  }
}

/** Synthesize the cumulative Context Pack, persist it, purge raw text, complete. */
async function synthesizeStep(workspaceId: string, diveId: string): Promise<void> {
  const { brief } = await getPlanningContext(workspaceId);
  const rows = await db
    .select()
    .from(deepDiveSources)
    .where(
      and(
        eq(deepDiveSources.deep_dive_id, diveId),
        eq(deepDiveSources.workspace_id, workspaceId),
        eq(deepDiveSources.status, "distilled"),
      ),
    );
  const distillations = rows
    .filter((r) => r.distilled)
    .map((r) => ({ title: r.title, distilled: r.distilled as SourceDistillation }));

  if (!distillations.length) {
    await db
      .update(deepDives)
      .set({ status: "failed", stage_detail: "Failed", error: "Couldn't read any of the provided material." })
      .where(eq(deepDives.id, diveId));
    return;
  }

  const prior = await getCurrentContext(workspaceId);
  const result = await synthesizeContextPack({
    companyName: brief.company_name,
    priorSummary: prior?.summary ?? "",
    priorPack: prior?.pack ?? null,
    distillations,
  });
  await bumpUsage(diveId, result.usage);

  // Publish the new current Context Pack (cumulative — supersedes the prior one).
  await db
    .update(companyContext)
    .set({ is_current: false })
    .where(and(eq(companyContext.workspace_id, workspaceId), eq(companyContext.is_current, true)));
  await db.insert(companyContext).values({
    id: uid(),
    workspace_id: workspaceId,
    deep_dive_id: diveId,
    version: (prior?.version ?? 0) + 1,
    is_current: true,
    summary: result.summary,
    pack: result.pack,
    created_at: new Date(),
  });

  // Fold findings into the brief (only where the founder left a field blank) and
  // seed the Executive's durable memory with what we learned.
  await enrichBrief(workspaceId, result.brief);
  if (result.memories.length) {
    await db.insert(executiveMemory).values(
      result.memories.map((m) => ({
        id: uid(),
        workspace_id: workspaceId,
        content: m.content,
        kind: m.kind,
        source: "agent" as const,
        pinned: false,
      })),
    );
  }

  // Privacy: keep only the distillation — drop the raw source text.
  await db
    .update(deepDiveSources)
    .set({ raw_text: null })
    .where(and(eq(deepDiveSources.deep_dive_id, diveId), eq(deepDiveSources.workspace_id, workspaceId)));

  await db
    .update(deepDives)
    .set({ status: "complete", completed_at: new Date(), stage_detail: "Complete" })
    .where(eq(deepDives.id, diveId));
}

async function countSources(diveId: string, workspaceId: string, onlyPending: boolean): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deepDiveSources)
    .where(
      onlyPending
        ? and(
            eq(deepDiveSources.deep_dive_id, diveId),
            eq(deepDiveSources.workspace_id, workspaceId),
            eq(deepDiveSources.status, "pending"),
          )
        : and(eq(deepDiveSources.deep_dive_id, diveId), eq(deepDiveSources.workspace_id, workspaceId)),
    );
  return row?.n ?? 0;
}

async function bumpUsage(diveId: string, u: AiUsage): Promise<void> {
  const [row] = await db.select({ usage: deepDives.usage }).from(deepDives).where(eq(deepDives.id, diveId)).limit(1);
  const cur = row?.usage ?? { input_tokens: 0, output_tokens: 0, est_cost_cents: 0, calls: 0 };
  await db
    .update(deepDives)
    .set({
      usage: {
        input_tokens: cur.input_tokens + u.input_tokens,
        output_tokens: cur.output_tokens + u.output_tokens,
        est_cost_cents: cur.est_cost_cents + u.est_cost_cents,
        calls: cur.calls + 1,
      },
    })
    .where(eq(deepDives.id, diveId));
}

/** Fill core_offer / description / ICP from synthesis — but only where the founder left it blank. */
async function enrichBrief(
  workspaceId: string,
  brief: { core_offer: string; business_description: string; ideal_customer_profile: string },
): Promise<void> {
  const [row] = await db
    .select({
      core_offer: businessBriefs.core_offer,
      business_description: businessBriefs.business_description,
      ideal_customer_profile: businessBriefs.ideal_customer_profile,
    })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  if (!row) return;
  const patch: Partial<{ core_offer: string; business_description: string; ideal_customer_profile: string }> = {};
  if (brief.core_offer && row.core_offer.trim().length < 5) patch.core_offer = brief.core_offer;
  if (brief.business_description && row.business_description.trim().length < 20) {
    patch.business_description = brief.business_description;
  }
  if (brief.ideal_customer_profile && row.ideal_customer_profile.trim().length < 10) {
    patch.ideal_customer_profile = brief.ideal_customer_profile;
  }
  if (Object.keys(patch).length) {
    await db
      .update(businessBriefs)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(businessBriefs.workspace_id, workspaceId));
  }
}

/* ===================== weekly Operating Review (cofounder) ================ */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-run the weekly review once the last one is older than this (cron cadence guard). */
const REVIEW_STALE_MS = 6.5 * 24 * 60 * 60 * 1000;

type ReviewRow = typeof operatingReviews.$inferSelect;

function toReview(row: ReviewRow): OperatingReview {
  return { id: row.id, version: row.version, content: row.content, created_at: iso(row.created_at) };
}

/** The workspace's current (latest) Operating Review, if one has completed. */
export async function getCurrentOperatingReview(workspaceId: string): Promise<OperatingReview | null> {
  const [row] = await db
    .select()
    .from(operatingReviews)
    .where(and(eq(operatingReviews.workspace_id, workspaceId), eq(operatingReviews.is_current, true)))
    .orderBy(desc(operatingReviews.version))
    .limit(1);
  return row ? toReview(row) : null;
}

/** Recent Operating Reviews, newest first — the archive. */
export async function listOperatingReviews(workspaceId: string, limit = 20): Promise<OperatingReview[]> {
  const rows = await db
    .select()
    .from(operatingReviews)
    .where(eq(operatingReviews.workspace_id, workspaceId))
    .orderBy(desc(operatingReviews.created_at))
    .limit(limit);
  return rows.map(toReview);
}

/** The most recent review RUN (for live progress while one is generating). */
export async function getLatestReviewRun(workspaceId: string): Promise<DeepDive | null> {
  const [row] = await db
    .select()
    .from(deepDives)
    .where(and(eq(deepDives.workspace_id, workspaceId), eq(deepDives.mode, "review")))
    .orderBy(desc(deepDives.created_at))
    .limit(1);
  return row ? toDeepDive(row) : null;
}

/** Everything the Reviews tab needs in one read. */
export async function getReviewState(workspaceId: string): Promise<{
  latestRun: DeepDive | null;
  reviews: OperatingReview[];
  cadence: DeepDiveCadence;
}> {
  const [latestRun, reviews, cfg] = await Promise.all([
    getLatestReviewRun(workspaceId),
    listOperatingReviews(workspaceId),
    db
      .select({ cadence: businessBriefs.deep_dive_cadence })
      .from(businessBriefs)
      .where(eq(businessBriefs.workspace_id, workspaceId))
      .limit(1),
  ]);
  const cadence = (cfg[0]?.cadence ?? "off") === "weekly" ? "weekly" : "off";
  return { latestRun, reviews, cadence };
}

/** Assemble the cross-node dossier the review reasons over. Owner-plane only. */
async function gatherReviewDossier(
  workspaceId: string,
): Promise<{ dossier: string; companyName: string; priorReview: OperatingReviewContent | null }> {
  const now = Date.now();
  const weekAgo = now - WEEK_MS;
  const { brief } = await getPlanningContext(workspaceId);

  const [kpis, goals, activeProjects, taskRows, emailRows, oppRows, activity, prior] = await Promise.all([
    computeKpis(workspaceId),
    db
      .select({
        title: companyGoals.title,
        detail: companyGoals.detail,
        target: companyGoals.target,
        horizon: companyGoals.horizon,
      })
      .from(companyGoals)
      .where(and(eq(companyGoals.workspace_id, workspaceId), eq(companyGoals.status, "active"))),
    db
      .select({
        title: projects.title,
        kind: projects.kind,
        current_phase: projects.current_phase,
        plan: projects.plan,
      })
      .from(projects)
      .where(and(eq(projects.workspace_id, workspaceId), eq(projects.status, "active"))),
    db
      .select({
        title: tasks.title,
        status: tasks.status,
        archived: tasks.archived,
        updated_at: tasks.updated_at,
        due_at: tasks.due_at,
      })
      .from(tasks)
      .where(eq(tasks.workspace_id, workspaceId)),
    db
      .select({
        from_name: emailTriage.from_name,
        subject: emailTriage.subject,
        urgency: emailTriage.urgency,
        summary: emailTriage.summary,
        draft_reply: emailTriage.draft_reply,
        status: emailTriage.status,
      })
      .from(emailTriage)
      .where(and(eq(emailTriage.workspace_id, workspaceId), isNull(emailTriage.member_user_id)))
      .orderBy(desc(emailTriage.triaged_at))
      .limit(40),
    db
      .select({
        title: opportunities.title,
        org: opportunities.org,
        type: opportunities.type,
        fit_score: opportunities.fit_score,
        deadline: opportunities.deadline,
      })
      .from(opportunities)
      .where(and(eq(opportunities.workspace_id, workspaceId), eq(opportunities.status, "new")))
      .orderBy(desc(opportunities.fit_score))
      .limit(10),
    db
      .select({ summary: activityEvents.summary })
      .from(activityEvents)
      .where(eq(activityEvents.workspace_id, workspaceId))
      .orderBy(desc(activityEvents.created_at))
      .limit(25),
    getCurrentOperatingReview(workspaceId),
  ]);

  const shipped = taskRows
    .filter((t) => t.status === "done" && !t.archived && new Date(t.updated_at).getTime() >= weekAgo)
    .map((t) => t.title)
    .slice(0, 20);
  const pending = taskRows
    .filter((t) => (t.status === "ready" || t.status === "new") && !t.archived)
    .map((t) => t.title)
    .slice(0, 15);
  const overdue = taskRows
    .filter((t) => t.status !== "done" && !t.archived && t.due_at && new Date(t.due_at).getTime() < now)
    .map((t) => t.title)
    .slice(0, 15);
  const activeEmail = emailRows.filter((e) => e.status === "triaged");

  const lines = [
    `COMPANY: ${brief.company_name || "the company"}. ${[brief.business_description, brief.core_offer]
      .filter(Boolean)
      .join(" ")}`.trim(),
    brief.ideal_customer_profile ? `Customers: ${brief.ideal_customer_profile}` : "",
    brief.company_context ? `\nCOMPANY CONTEXT (from the Deep Dive):\n${brief.company_context}` : "",
    brief.crm_context ? `\nLIVE CRM: ${brief.crm_context}` : "",
    brief.calendar_context ? `\nSCHEDULE: ${brief.calendar_context}` : "",
    "",
    "KPIs (current):",
    ...(kpis.length
      ? kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}${k.hint ? ` — ${k.hint}` : ""}`)
      : ["- None computed."]),
    "",
    "GOALS / FOCUS (the north star — judge the week against these, flag drift):",
    ...(goals.length
      ? goals.map(
          (g) =>
            `- ${g.horizon ? `[${g.horizon}] ` : ""}${g.title}${g.target ? ` → target: ${g.target}` : ""}${
              g.detail ? ` (${g.detail})` : ""
            }`,
        )
      : ["- None set yet."]),
    "",
    "ACTIVE PROJECTS / CAMPAIGNS:",
    ...(activeProjects.length
      ? activeProjects.map(
          (p) =>
            `- ${p.kind === "growth" ? "Growth campaign" : "Project"} "${p.title}" — ${
              p.kind === "growth" ? "week" : "phase"
            } ${p.current_phase + 1} of ${p.plan?.phases?.length ?? "?"}`,
        )
      : ["- None active."]),
    "",
    "SHIPPED (completed, last 7 days):",
    ...(shipped.length ? shipped.map((t) => `- ${t}`) : ["- Nothing completed in the last 7 days."]),
    "",
    "OVERDUE / SLIPPING:",
    ...(overdue.length ? overdue.map((t) => `- ${t}`) : ["- Nothing overdue."]),
    "",
    "AWAITING APPROVAL:",
    ...(pending.length ? pending.map((t) => `- ${t}`) : ["- Nothing pending."]),
    "",
    `INBOX (recent triaged mail, ${activeEmail.length} active):`,
    ...(activeEmail.length
      ? activeEmail
          .slice(0, 12)
          .map(
            (e) =>
              `- ${e.urgency ? `[${e.urgency}] ` : ""}${e.from_name || "Someone"} — "${
                e.subject || "(no subject)"
              }"${e.summary ? `: ${e.summary}` : ""}${e.draft_reply ? " (reply drafted, awaiting send)" : ""}`,
          )
      : ["- Inbox quiet or not connected."]),
    "",
    "OPPORTUNITIES (new, ranked by fit):",
    ...(oppRows.length
      ? oppRows.map(
          (o) =>
            `- ${o.type}: ${o.title}${o.org ? ` — ${o.org}` : ""}${
              o.deadline ? ` (deadline ${o.deadline})` : ""
            } [fit ${o.fit_score}]`,
        )
      : ["- None surfaced."]),
    "",
    "RECENT AGENT ACTIVITY:",
    ...(activity.length ? activity.map((a) => `- ${a.summary}`) : ["- Quiet lately."]),
  ];

  return {
    dossier: lines.filter((l) => l !== undefined).join("\n"),
    companyName: brief.company_name,
    priorReview: prior?.content ?? null,
  };
}

/** The whole review in one locked tick: gather → synthesize → publish → complete. */
async function runReviewTick(workspaceId: string, diveId: string): Promise<void> {
  await db
    .update(deepDives)
    .set({ status: "synthesizing", started_at: new Date(), stage_detail: "Reading your week" })
    .where(eq(deepDives.id, diveId));

  const { dossier, companyName, priorReview } = await gatherReviewDossier(workspaceId);
  const result = await synthesizeOperatingReview({ companyName, dossier, priorReview });
  await bumpUsage(diveId, result.usage);

  // Publish the new current review (versioned — supersedes the prior one).
  const [priorRow] = await db
    .select({ version: operatingReviews.version })
    .from(operatingReviews)
    .where(and(eq(operatingReviews.workspace_id, workspaceId), eq(operatingReviews.is_current, true)))
    .orderBy(desc(operatingReviews.version))
    .limit(1);
  await db
    .update(operatingReviews)
    .set({ is_current: false })
    .where(and(eq(operatingReviews.workspace_id, workspaceId), eq(operatingReviews.is_current, true)));
  await db.insert(operatingReviews).values({
    id: uid(),
    workspace_id: workspaceId,
    deep_dive_id: diveId,
    version: (priorRow?.version ?? 0) + 1,
    is_current: true,
    content: result.content,
    created_at: new Date(),
  });

  // Seed durable memory with what we learned (the compounding understanding).
  if (result.memories.length) {
    await db.insert(executiveMemory).values(
      result.memories.map((m) => ({
        id: uid(),
        workspace_id: workspaceId,
        content: m.content,
        kind: m.kind,
        source: "agent" as const,
        pinned: false,
      })),
    );
  }

  // Stamp the cadence cursor (also marks the last completed review).
  await db
    .update(businessBriefs)
    .set({ deep_dive_last_review_at: new Date() })
    .where(eq(businessBriefs.workspace_id, workspaceId));

  await db
    .update(deepDives)
    .set({ status: "complete", completed_at: new Date(), stage_detail: "Complete", progress: { done: 1, total: 1 } })
    .where(eq(deepDives.id, diveId));
}

/**
 * Start a weekly Operating Review NOW (the "Run review now" button and the weekly cron
 * both call this). If one is already in flight, returns it instead of stacking a second.
 * The existing Deep Dive worker (advanceDeepDives / advanceWorkspaceDeepDives) processes it.
 */
export async function startReview(
  workspaceId: string,
): Promise<{ ok: boolean; deepDive?: DeepDive; error?: string }> {
  const [inflight] = await db
    .select()
    .from(deepDives)
    .where(
      and(
        eq(deepDives.workspace_id, workspaceId),
        eq(deepDives.mode, "review"),
        inArray(deepDives.status, ADVANCEABLE),
      ),
    )
    .orderBy(desc(deepDives.created_at))
    .limit(1);
  if (inflight) return { ok: true, deepDive: toDeepDive(inflight) };

  const id = uid();
  const now = new Date();
  const title = `Operating Review — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  await db.insert(deepDives).values({
    id,
    workspace_id: workspaceId,
    mode: "review",
    title,
    status: "queued",
    stage_detail: "Queued",
    progress: { done: 0, total: 1 },
    created_at: now,
  });
  const [row] = await db.select().from(deepDives).where(eq(deepDives.id, id)).limit(1);
  return { ok: true, deepDive: row ? toDeepDive(row) : undefined };
}

/** Map a review action's kind to the department a resulting task belongs to. */
function reviewTaskCategory(a: ReviewAction): Category {
  switch (a.kind) {
    case "outreach":
    case "crm":
      return "growth";
    case "email":
    case "meeting":
    case "task":
    default:
      return (a.category as Category) ?? "admin";
  }
}

/** Create an approval-gated task from a review action (mirrors the brief's createBriefTask). */
async function createReviewTask(workspaceId: string, a: ReviewAction): Promise<void> {
  const category = reviewTaskCategory(a);
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
  const systems = inferAffectedSystems(`${a.title} ${a.goal} ${a.rationale}`, connected);
  const now = new Date();
  await db.insert(tasks).values({
    id: uid(),
    workspace_id: workspaceId,
    category,
    title: a.title.slice(0, 120),
    description: a.goal,
    rationale: `Proposed by your weekly Deep Dive. ${a.rationale}`.trim().slice(0, 300),
    status: "new",
    risk_level: "low",
    priority: a.impact === "high" ? "high" : "medium",
    due_at: systems.includes("Google Calendar") ? new Date(now.getTime() + 24 * 3600 * 1000) : null,
    agent_id: agent?.id ?? null,
    created_by_type: "agent",
    requires_approval: true,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: systems,
    proposed_actions: systems.length,
    impact_score: a.impact === "high" ? 65 : 45,
    archived: false,
    created_at: now,
    updated_at: now,
  });
}

/** Approve a review action → create the project/task; mark it accepted. Never auto-executes. */
export async function approveReviewAction(
  workspaceId: string,
  reviewId: string,
  actionId: string,
): Promise<{ ok: boolean; href?: string; error?: string }> {
  const [row] = await db
    .select()
    .from(operatingReviews)
    .where(and(eq(operatingReviews.workspace_id, workspaceId), eq(operatingReviews.id, reviewId)))
    .limit(1);
  if (!row) return { ok: false, error: "Review not found." };
  const content = row.content;
  const a = content.actions.find((x) => x.id === actionId);
  if (!a) return { ok: false, error: "Action not found." };
  if (a.status === "accepted") return { ok: true, href: a.ref_href ?? undefined };

  let href: string;
  try {
    if (a.kind === "project") {
      const { createProject } = await import("@/lib/agents/project");
      const res = await createProject(workspaceId, a.goal || a.title, "executive");
      if (!res.ok) return { ok: false, error: res.error };
      href = "/projects";
    } else {
      await createReviewTask(workspaceId, a);
      href = "/approvals";
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't act on that action." };
  }

  const actions = content.actions.map((x) =>
    x.id === actionId ? { ...x, status: "accepted" as const, ref_href: href } : x,
  );
  await db
    .update(operatingReviews)
    .set({ content: { ...content, actions } })
    .where(and(eq(operatingReviews.workspace_id, workspaceId), eq(operatingReviews.id, reviewId)));
  return { ok: true, href };
}

/** Dismiss a review action (don't act on it). Feeds the next review's learning. */
export async function dismissReviewAction(
  workspaceId: string,
  reviewId: string,
  actionId: string,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .select()
    .from(operatingReviews)
    .where(and(eq(operatingReviews.workspace_id, workspaceId), eq(operatingReviews.id, reviewId)))
    .limit(1);
  if (!row) return { ok: false };
  const content = row.content;
  const actions = content.actions.map((x) =>
    x.id === actionId ? { ...x, status: "dismissed" as const } : x,
  );
  await db
    .update(operatingReviews)
    .set({ content: { ...content, actions } })
    .where(and(eq(operatingReviews.workspace_id, workspaceId), eq(operatingReviews.id, reviewId)));
  return { ok: true };
}

/** Set the weekly review cadence (off | weekly). */
export async function setDeepDiveCadence(
  workspaceId: string,
  cadence: DeepDiveCadence,
): Promise<{ ok: boolean }> {
  await db
    .update(businessBriefs)
    .set({ deep_dive_cadence: cadence === "weekly" ? "weekly" : "off" })
    .where(eq(businessBriefs.workspace_id, workspaceId));
  return { ok: true };
}

/** Cron: queue a weekly review for each opted-in workspace whose last is stale (>~6.5d).
 *  The Deep Dive worker (/api/deep-dive/run) then processes the queued runs. */
export async function generateDueReviews(limit = 10): Promise<{ queued: number }> {
  // tenant-scope-exempt: cron scans opted-in workspaces; startReview is workspace-scoped.
  const rows = await db
    .select({ workspace_id: businessBriefs.workspace_id, last: businessBriefs.deep_dive_last_review_at })
    .from(businessBriefs)
    .where(eq(businessBriefs.deep_dive_cadence, "weekly"))
    .limit(200);
  const now = Date.now();
  let queued = 0;
  for (const r of rows) {
    if (queued >= limit) break;
    if (r.last && now - new Date(r.last).getTime() < REVIEW_STALE_MS) continue;
    try {
      const [inflight] = await db
        .select({ id: deepDives.id })
        .from(deepDives)
        .where(
          and(
            eq(deepDives.workspace_id, r.workspace_id),
            eq(deepDives.mode, "review"),
            inArray(deepDives.status, ADVANCEABLE),
          ),
        )
        .limit(1);
      if (inflight) continue;
      const res = await startReview(r.workspace_id);
      if (res.ok) queued += 1;
    } catch {
      /* one workspace never blocks the rest */
    }
  }
  return { queued };
}
