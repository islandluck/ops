import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sourcingRequests, sourcingSources } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { sourceProduct } from "@/lib/ai/product-sourcing";
import type { SourcingRequest, SourcingSource } from "@/lib/types";

/**
 * Sourcing — a purchasing-manager tool. The owner manages preferred avenues
 * (sourcing_sources) and fires "source me a ___" requests; each runs the native
 * web-search engine (lib/ai/product-sourcing) and stores the reasoned recommendation.
 * Read-only on the web; it NEVER buys. Server-only.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

type SourceRow = typeof sourcingSources.$inferSelect;
type RequestRow = typeof sourcingRequests.$inferSelect;

function toSource(r: SourceRow): SourcingSource {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    label: r.label,
    site: r.site,
    note: r.note,
    enabled: r.enabled,
    created_at: iso(r.created_at),
  };
}

function toRequest(r: RequestRow): SourcingRequest {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    query: r.query,
    status: r.status,
    result: r.result ?? null,
    error: r.error,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/* ------------------------------ preferred sources ------------------------------ */

export async function listSourcingSources(workspaceId: string): Promise<SourcingSource[]> {
  const rows = await db
    .select()
    .from(sourcingSources)
    .where(eq(sourcingSources.workspace_id, workspaceId))
    .orderBy(desc(sourcingSources.created_at));
  return rows.map(toSource);
}

export async function addSourcingSource(
  workspaceId: string,
  input: { label: string; site: string; note?: string },
): Promise<{ ok: true; source: SourcingSource } | { ok: false; error: string }> {
  const site = input.site.trim();
  if (!site) return { ok: false, error: "Add a site or domain (e.g. ebay.com)." };
  const id = uid();
  const now = new Date();
  await db.insert(sourcingSources).values({
    id,
    workspace_id: workspaceId,
    label: (input.label.trim() || site).slice(0, 120),
    site: site.slice(0, 200),
    note: (input.note ?? "").slice(0, 300),
    enabled: true,
    created_at: now,
  });
  const [row] = await db
    .select()
    .from(sourcingSources)
    .where(and(eq(sourcingSources.workspace_id, workspaceId), eq(sourcingSources.id, id)))
    .limit(1);
  return { ok: true, source: toSource(row) };
}

export async function updateSourcingSource(
  workspaceId: string,
  id: string,
  patch: { label?: string; site?: string; note?: string; enabled?: boolean },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = {};
  if (patch.label !== undefined) set.label = patch.label.slice(0, 120);
  if (patch.site !== undefined) set.site = patch.site.slice(0, 200);
  if (patch.note !== undefined) set.note = patch.note.slice(0, 300);
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (Object.keys(set).length === 0) return { ok: true };
  await db
    .update(sourcingSources)
    .set(set)
    .where(and(eq(sourcingSources.workspace_id, workspaceId), eq(sourcingSources.id, id)));
  return { ok: true };
}

export async function deleteSourcingSource(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(sourcingSources)
    .where(and(eq(sourcingSources.workspace_id, workspaceId), eq(sourcingSources.id, id)));
  return { ok: true };
}

/* -------------------------------- requests -------------------------------- */

export async function listSourcingRequests(workspaceId: string, limit = 20): Promise<SourcingRequest[]> {
  const rows = await db
    .select()
    .from(sourcingRequests)
    .where(eq(sourcingRequests.workspace_id, workspaceId))
    .orderBy(desc(sourcingRequests.created_at))
    .limit(Math.max(1, Math.min(limit, 50)));
  return rows.map(toRequest);
}

export async function getSourcingRequest(workspaceId: string, id: string): Promise<SourcingRequest | null> {
  const [row] = await db
    .select()
    .from(sourcingRequests)
    .where(and(eq(sourcingRequests.workspace_id, workspaceId), eq(sourcingRequests.id, id)))
    .limit(1);
  return row ? toRequest(row) : null;
}

export async function deleteSourcingRequest(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(sourcingRequests)
    .where(and(eq(sourcingRequests.workspace_id, workspaceId), eq(sourcingRequests.id, id)));
  return { ok: true };
}

/**
 * Run a sourcing request end-to-end (synchronous): record it, shop the web via the
 * purchasing-manager engine (reputable retailers + the owner's enabled avenues), and
 * store the reasoned recommendation. Never buys.
 */
export async function runSourcing(
  workspaceId: string,
  query: string,
): Promise<{ ok: true; request: SourcingRequest } | { ok: false; error: string }> {
  const q = query.trim();
  if (!q) return { ok: false, error: "Tell me what to source (e.g. 'a 2-slice stainless toaster under $40')." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "Sourcing needs the AI key (ANTHROPIC_API_KEY) configured." };

  const id = uid();
  const now = new Date();
  await db.insert(sourcingRequests).values({
    id,
    workspace_id: workspaceId,
    query: q.slice(0, 500),
    status: "searching",
    error: "",
    created_at: now,
    updated_at: now,
  });

  try {
    const sources = (await listSourcingSources(workspaceId)).filter((s) => s.enabled);
    const { brief } = await getPlanningContext(workspaceId);
    const result = await sourceProduct({
      query: q,
      sources: sources.map((s) => ({ label: s.label, site: s.site, note: s.note })),
      brief: { company_name: brief.company_name, business_description: brief.business_description },
    });
    await db
      .update(sourcingRequests)
      .set({ status: "complete", result, updated_at: new Date() })
      .where(and(eq(sourcingRequests.workspace_id, workspaceId), eq(sourcingRequests.id, id)));
  } catch (e) {
    await db
      .update(sourcingRequests)
      .set({ status: "failed", error: e instanceof Error ? e.message : "Couldn't complete the search.", updated_at: new Date() })
      .where(and(eq(sourcingRequests.workspace_id, workspaceId), eq(sourcingRequests.id, id)));
  }

  const request = await getSourcingRequest(workspaceId, id);
  return request ? { ok: true, request } : { ok: false, error: "Couldn't load the sourcing result." };
}
