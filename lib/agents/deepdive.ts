import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessBriefs, companyContext, deepDives, deepDiveSources, executiveMemory } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { distillSource, synthesizeContextPack, type AiUsage } from "@/lib/ai/deepdive";
import type {
  CompanyContext,
  CompanyContextPack,
  DeepDive,
  DeepDiveSource,
  DeepDiveSourceKind,
  DeepDiveStatus,
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
    .where(eq(deepDives.workspace_id, workspaceId))
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
