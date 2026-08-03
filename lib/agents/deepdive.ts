import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companyContext, deepDives, deepDiveSources } from "@/lib/db/schema";
import type {
  CompanyContext,
  CompanyContextPack,
  DeepDive,
  DeepDiveSource,
  DeepDiveSourceKind,
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
