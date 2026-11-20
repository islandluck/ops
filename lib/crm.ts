import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmActivities, crmCompanies, crmContacts, crmDeals, crmPipelines, outreachContacts, quoteSuppliers } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { stageOutboundDraft } from "@/lib/agents/outbound";
import { draftFollowupEmail, enrichCompany } from "@/lib/ai/crm";
import { domainFromWebsite, findEmail, hunterConfigured, HUNTER_MIN_SCORE } from "@/lib/integrations/hunter";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { hsDealCompany, hsOpenDeals, hsRecentCompanies, hsRecentContacts } from "@/lib/integrations/hubspot";
import { runWithUsage } from "@/lib/ai/usage";
import type {
  CrmActivity,
  CrmActivitySource,
  CrmActivityType,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmDealStage,
  CrmForecast,
  CrmPipeline,
  CrmRelationshipType,
  CrmStage,
  CrmStageKind,
  OutreachEmailMeta,
} from "@/lib/types";

/**
 * Native CRM engine — companies, contacts, deals, and a timeline, all owned locally
 * (Operator is the system of record; HubSpot is an optional import). The agent and the
 * app write here: emails auto-log, Outreach contacts promote in, and the Executive reads
 * and writes via tools. Server-only.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();
const isoN = (d: Date | null) => (d ? iso(d) : null);

/** The stages a brand-new workspace's default pipeline is seeded with. */
export const DEFAULT_STAGES: CrmStage[] = [
  { key: "new", label: "New", kind: "open" },
  { key: "qualified", label: "Qualified", kind: "open" },
  { key: "proposal", label: "Proposal", kind: "open" },
  { key: "negotiation", label: "Negotiation", kind: "open" },
  { key: "won", label: "Won", kind: "won" },
  { key: "lost", label: "Lost", kind: "lost" },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailMeta(raw: string | null): OutreachEmailMeta | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as OutreachEmailMeta) : null;
  } catch {
    return null;
  }
}

type CompanyRow = typeof crmCompanies.$inferSelect;
type ContactRow = typeof crmContacts.$inferSelect;
type DealRow = typeof crmDeals.$inferSelect;
type ActivityRow = typeof crmActivities.$inferSelect;

function toCompany(r: CompanyRow): CrmCompany {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    domain: r.domain,
    website: r.website,
    industry: r.industry,
    size: r.size,
    relationship_type: r.relationship_type,
    status: r.status,
    note: r.note,
    source: r.source,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function toContact(r: ContactRow): CrmContact {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    company_id: r.company_id,
    name: r.name,
    title: r.title,
    email: r.email,
    phone: r.phone,
    linkedin_url: r.linkedin_url,
    status: r.status,
    tags: Array.isArray(r.tags) ? r.tags : [],
    note: r.note,
    email_meta: parseEmailMeta(r.email_meta),
    last_touch_at: isoN(r.last_touch_at),
    source: r.source,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function toDeal(r: DealRow): CrmDeal {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    company_id: r.company_id,
    primary_contact_id: r.primary_contact_id,
    title: r.title,
    amount: r.amount_cents == null ? null : r.amount_cents / 100,
    currency: r.currency,
    stage: r.stage,
    pipeline_id: r.pipeline_id,
    close_date: isoN(r.close_date),
    probability: r.probability,
    note: r.note,
    source: r.source,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function toActivity(r: ActivityRow): CrmActivity {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    company_id: r.company_id,
    contact_id: r.contact_id,
    deal_id: r.deal_id,
    type: r.type,
    summary: r.summary,
    body: r.body,
    source: r.source,
    link_id: r.link_id,
    occurred_at: iso(r.occurred_at),
    created_at: iso(r.created_at),
  };
}

/* ------------------------------- activities ------------------------------ */

/** Append a timeline entry. Internal + used by actions, hooks, and the agent. */
export async function logActivity(
  workspaceId: string,
  input: {
    type: CrmActivityType;
    summary: string;
    body?: string;
    source?: CrmActivitySource;
    company_id?: string | null;
    contact_id?: string | null;
    deal_id?: string | null;
    link_id?: string | null;
    occurred_at?: Date;
  },
): Promise<CrmActivity> {
  const now = new Date();
  const id = uid();
  await db.insert(crmActivities).values({
    id,
    workspace_id: workspaceId,
    company_id: input.company_id ?? null,
    contact_id: input.contact_id ?? null,
    deal_id: input.deal_id ?? null,
    type: input.type,
    summary: input.summary.slice(0, 300),
    body: (input.body ?? "").slice(0, 8000),
    source: input.source ?? "manual",
    link_id: input.link_id ?? null,
    occurred_at: input.occurred_at ?? now,
    created_at: now,
  });
  const [row] = await db.select().from(crmActivities).where(eq(crmActivities.id, id)).limit(1);
  return toActivity(row);
}

/** Timeline for one entity (contact, deal, or company), newest first. */
export async function listActivities(
  workspaceId: string,
  scope: { contact_id?: string; deal_id?: string; company_id?: string },
  limit = 100,
): Promise<CrmActivity[]> {
  const rows = await db
    .select()
    .from(crmActivities)
    .where(
      and(
        eq(crmActivities.workspace_id, workspaceId),
        ...(scope.contact_id ? [eq(crmActivities.contact_id, scope.contact_id)] : []),
        ...(scope.deal_id ? [eq(crmActivities.deal_id, scope.deal_id)] : []),
        ...(scope.company_id ? [eq(crmActivities.company_id, scope.company_id)] : []),
      ),
    )
    .orderBy(desc(crmActivities.occurred_at))
    .limit(limit);
  return rows.map(toActivity);
}

export async function deleteActivity(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(crmActivities).where(and(eq(crmActivities.workspace_id, workspaceId), eq(crmActivities.id, id)));
  return { ok: true };
}

/** Latest activity timestamp per deal, for staleness + sorting. */
async function lastActivityByDeal(workspaceId: string, dealIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!dealIds.length) return m;
  const rows = await db
    .select({ deal_id: crmActivities.deal_id, last: sql<string>`max(${crmActivities.occurred_at})` })
    .from(crmActivities)
    .where(and(eq(crmActivities.workspace_id, workspaceId), inArray(crmActivities.deal_id, dealIds)))
    .groupBy(crmActivities.deal_id);
  for (const r of rows) if (r.deal_id && r.last) m.set(r.deal_id, iso(new Date(r.last)));
  return m;
}

/* ------------------------------- pipelines ------------------------------- */

function toPipeline(r: typeof crmPipelines.$inferSelect): CrmPipeline {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    stages: Array.isArray(r.stages) ? r.stages : [],
    is_default: r.is_default,
    position: r.position,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function stageKeyFromLabel(label: string, existing: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "stage";
  let key = base;
  let i = 2;
  while (existing.has(key)) key = `${base}_${i++}`;
  return key;
}

/** Clean a stage list from the UI: keep keys stable, ensure kinds, never empty. */
function normalizeStages(stages: { key?: string; label: string; kind?: CrmStageKind }[]): CrmStage[] {
  const keys = new Set<string>();
  const out: CrmStage[] = [];
  for (const s of stages) {
    const label = (s.label ?? "").trim().slice(0, 60);
    if (!label) continue;
    const kind: CrmStageKind = s.kind === "won" || s.kind === "lost" ? s.kind : "open";
    const key = s.key && !keys.has(s.key) ? s.key : stageKeyFromLabel(label, keys);
    keys.add(key);
    out.push({ key, label, kind });
  }
  return out.length ? out : DEFAULT_STAGES;
}

/** All pipelines for the workspace, seeding a "Sales" default on first use. */
export async function ensurePipelines(workspaceId: string): Promise<CrmPipeline[]> {
  const rows = await db
    .select()
    .from(crmPipelines)
    .where(eq(crmPipelines.workspace_id, workspaceId))
    .orderBy(crmPipelines.position);
  if (rows.length) return rows.map(toPipeline);
  const id = uid();
  const now = new Date();
  await db.insert(crmPipelines).values({
    id,
    workspace_id: workspaceId,
    name: "Sales",
    stages: DEFAULT_STAGES,
    is_default: true,
    position: 0,
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(crmPipelines).where(eq(crmPipelines.id, id)).limit(1);
  return [toPipeline(row)];
}

export async function listPipelines(workspaceId: string): Promise<CrmPipeline[]> {
  return ensurePipelines(workspaceId);
}

/** Classifier over a workspace's pipelines — resolve stage kind/label/prob by (pipeline, key). */
async function loadPipelineIndex(workspaceId: string): Promise<{
  defaultId: string | null;
  kindOf: (pipelineId: string | null, stageKey: string) => CrmStageKind;
  labelOf: (pipelineId: string | null, stageKey: string) => string;
  nameOf: (pipelineId: string | null) => string | null;
  defaultProb: (pipelineId: string | null, stageKey: string) => number;
}> {
  const pipelines = await ensurePipelines(workspaceId);
  const def = pipelines.find((p) => p.is_default) ?? pipelines[0] ?? null;
  const byId = new Map(pipelines.map((p) => [p.id, p]));
  const pick = (pid: string | null) => (pid && byId.get(pid)) || def;
  return {
    defaultId: def?.id ?? null,
    kindOf: (pid, key) => pick(pid)?.stages.find((s) => s.key === key)?.kind ?? "open",
    labelOf: (pid, key) => pick(pid)?.stages.find((s) => s.key === key)?.label ?? key,
    nameOf: (pid) => pick(pid)?.name ?? null,
    defaultProb: (pid, key) => {
      const p = pick(pid);
      const st = p?.stages.find((s) => s.key === key);
      if (!st || st.kind === "lost") return 0;
      if (st.kind === "won") return 100;
      const open = p!.stages.filter((s) => s.kind === "open");
      const idx = open.findIndex((s) => s.key === key);
      return Math.round(((idx + 1) / (open.length + 1)) * 100);
    },
  };
}

export async function createPipeline(
  workspaceId: string,
  input: { name: string; stages?: { key?: string; label: string; kind?: CrmStageKind }[] },
): Promise<{ ok: true; pipeline: CrmPipeline } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name the pipeline." };
  const existing = await ensurePipelines(workspaceId);
  const id = uid();
  const now = new Date();
  await db.insert(crmPipelines).values({
    id,
    workspace_id: workspaceId,
    name: name.slice(0, 80),
    stages: input.stages ? normalizeStages(input.stages) : DEFAULT_STAGES,
    is_default: false,
    position: existing.length,
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(crmPipelines).where(eq(crmPipelines.id, id)).limit(1);
  return { ok: true, pipeline: toPipeline(row) };
}

export async function updatePipeline(
  workspaceId: string,
  id: string,
  patch: { name?: string; stages?: { key?: string; label: string; kind?: CrmStageKind }[] },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) set.name = patch.name.slice(0, 80);
  if (patch.stages !== undefined) set.stages = normalizeStages(patch.stages);
  await db.update(crmPipelines).set(set).where(and(eq(crmPipelines.workspace_id, workspaceId), eq(crmPipelines.id, id)));
  return { ok: true };
}

export async function deletePipeline(workspaceId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const pipelines = await ensurePipelines(workspaceId);
  if (pipelines.length <= 1) return { ok: false, error: "Can't delete the only pipeline." };
  if (pipelines.find((p) => p.id === id)?.is_default) return { ok: false, error: "Make another pipeline the default first." };
  await db.delete(crmPipelines).where(and(eq(crmPipelines.workspace_id, workspaceId), eq(crmPipelines.id, id)));
  return { ok: true };
}

/* ------------------------------- companies ------------------------------- */

export async function listCompanies(
  workspaceId: string,
  opts?: { type?: CrmRelationshipType },
): Promise<CrmCompany[]> {
  const rows = await db
    .select()
    .from(crmCompanies)
    .where(
      and(
        eq(crmCompanies.workspace_id, workspaceId),
        ...(opts?.type ? [eq(crmCompanies.relationship_type, opts.type)] : []),
      ),
    )
    .orderBy(desc(crmCompanies.created_at));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [contacts, deals] = await Promise.all([
    db
      .select({ company_id: crmContacts.company_id })
      .from(crmContacts)
      .where(and(eq(crmContacts.workspace_id, workspaceId), inArray(crmContacts.company_id, ids))),
    db
      .select({
        company_id: crmDeals.company_id,
        stage: crmDeals.stage,
        pipeline_id: crmDeals.pipeline_id,
        amount_cents: crmDeals.amount_cents,
      })
      .from(crmDeals)
      .where(and(eq(crmDeals.workspace_id, workspaceId), inArray(crmDeals.company_id, ids))),
  ]);
  const pidx = await loadPipelineIndex(workspaceId);
  const contactCount = new Map<string, number>();
  for (const c of contacts) if (c.company_id) contactCount.set(c.company_id, (contactCount.get(c.company_id) ?? 0) + 1);
  const openCount = new Map<string, number>();
  const openValue = new Map<string, number>();
  for (const d of deals) {
    if (pidx.kindOf(d.pipeline_id, d.stage) !== "open") continue;
    openCount.set(d.company_id, (openCount.get(d.company_id) ?? 0) + 1);
    openValue.set(d.company_id, (openValue.get(d.company_id) ?? 0) + (d.amount_cents ?? 0) / 100);
  }
  return rows.map((r) => ({
    ...toCompany(r),
    contact_count: contactCount.get(r.id) ?? 0,
    open_deal_count: openCount.get(r.id) ?? 0,
    open_value: openValue.get(r.id) ?? 0,
  }));
}

export async function getCompany(workspaceId: string, id: string): Promise<CrmCompany | null> {
  const [r] = await db
    .select()
    .from(crmCompanies)
    .where(and(eq(crmCompanies.workspace_id, workspaceId), eq(crmCompanies.id, id)))
    .limit(1);
  return r ? toCompany(r) : null;
}

export async function createCompany(
  workspaceId: string,
  input: {
    name: string;
    domain?: string | null;
    website?: string | null;
    industry?: string;
    size?: string;
    relationship_type?: CrmRelationshipType;
    note?: string;
    source?: string;
  },
): Promise<{ ok: true; company: CrmCompany } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Add a company name." };
  const id = uid();
  const now = new Date();
  await db.insert(crmCompanies).values({
    id,
    workspace_id: workspaceId,
    name: name.slice(0, 200),
    domain: input.domain?.trim() || null,
    website: input.website?.trim() || null,
    industry: (input.industry ?? "").slice(0, 120),
    size: (input.size ?? "").slice(0, 60),
    relationship_type: input.relationship_type ?? "prospect",
    status: "active",
    note: (input.note ?? "").slice(0, 4000),
    source: input.source ?? "manual",
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, id)).limit(1);
  return { ok: true, company: toCompany(row) };
}

export async function updateCompany(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    domain?: string | null;
    website?: string | null;
    industry?: string;
    size?: string;
    relationship_type?: CrmRelationshipType;
    status?: string;
    note?: string;
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) set.name = patch.name.slice(0, 200);
  if (patch.domain !== undefined) set.domain = patch.domain?.trim() || null;
  if (patch.website !== undefined) set.website = patch.website?.trim() || null;
  if (patch.industry !== undefined) set.industry = patch.industry.slice(0, 120);
  if (patch.size !== undefined) set.size = patch.size.slice(0, 60);
  if (patch.relationship_type !== undefined) set.relationship_type = patch.relationship_type;
  if (patch.status !== undefined) set.status = patch.status.slice(0, 40);
  if (patch.note !== undefined) set.note = patch.note.slice(0, 4000);
  await db.update(crmCompanies).set(set).where(and(eq(crmCompanies.workspace_id, workspaceId), eq(crmCompanies.id, id)));
  return { ok: true };
}

export async function deleteCompany(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(crmCompanies).where(and(eq(crmCompanies.workspace_id, workspaceId), eq(crmCompanies.id, id)));
  return { ok: true };
}

/** Find a company by name (case-insensitive) or domain, else create it. */
export async function findOrCreateCompany(
  workspaceId: string,
  input: { name: string; domain?: string | null; website?: string | null; relationship_type?: CrmRelationshipType; source?: string },
): Promise<CrmCompany> {
  const name = input.name.trim();
  const domain = input.domain?.trim().toLowerCase() || null;
  const existing = await db
    .select()
    .from(crmCompanies)
    .where(eq(crmCompanies.workspace_id, workspaceId));
  const hit = existing.find(
    (c) =>
      (domain && c.domain && c.domain.toLowerCase() === domain) ||
      (name && c.name.trim().toLowerCase() === name.toLowerCase()),
  );
  if (hit) return toCompany(hit);
  const r = await createCompany(workspaceId, {
    name,
    domain: input.domain,
    website: input.website,
    relationship_type: input.relationship_type,
    source: input.source ?? "auto",
  });
  if (!r.ok) throw new Error(r.error);
  return r.company;
}

/* -------------------------------- contacts ------------------------------- */

export async function listContacts(
  workspaceId: string,
  opts?: { companyId?: string },
): Promise<CrmContact[]> {
  const rows = await db
    .select()
    .from(crmContacts)
    .where(
      and(
        eq(crmContacts.workspace_id, workspaceId),
        ...(opts?.companyId ? [eq(crmContacts.company_id, opts.companyId)] : []),
      ),
    )
    .orderBy(desc(crmContacts.created_at));
  if (!rows.length) return [];
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id).filter((x): x is string => Boolean(x))));
  const companies = companyIds.length
    ? await db
        .select({ id: crmCompanies.id, name: crmCompanies.name })
        .from(crmCompanies)
        .where(and(eq(crmCompanies.workspace_id, workspaceId), inArray(crmCompanies.id, companyIds)))
    : [];
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...toContact(r), company_name: r.company_id ? nameById.get(r.company_id) ?? null : null }));
}

export async function getContact(workspaceId: string, id: string): Promise<CrmContact | null> {
  const [r] = await db
    .select()
    .from(crmContacts)
    .where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, id)))
    .limit(1);
  if (!r) return null;
  const contact = toContact(r);
  if (r.company_id) {
    const [c] = await db
      .select({ name: crmCompanies.name })
      .from(crmCompanies)
      .where(and(eq(crmCompanies.workspace_id, workspaceId), eq(crmCompanies.id, r.company_id)))
      .limit(1);
    contact.company_name = c?.name ?? null;
  }
  return contact;
}

export async function createContact(
  workspaceId: string,
  input: {
    name: string;
    company_id?: string | null;
    title?: string;
    email?: string | null;
    phone?: string;
    linkedin_url?: string | null;
    note?: string;
    tags?: string[];
    email_meta?: OutreachEmailMeta | null;
    source?: string;
  },
): Promise<{ ok: true; contact: CrmContact } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name && !input.email?.trim()) return { ok: false, error: "Add a name or an email." };
  const id = uid();
  const now = new Date();
  await db.insert(crmContacts).values({
    id,
    workspace_id: workspaceId,
    company_id: input.company_id ?? null,
    name: name.slice(0, 160) || (input.email ?? "").split("@")[0].slice(0, 160),
    title: (input.title ?? "").slice(0, 160),
    email: input.email?.trim() || null,
    phone: (input.phone ?? "").slice(0, 60),
    linkedin_url: input.linkedin_url?.trim() || null,
    status: "active",
    tags: input.tags ?? null,
    note: (input.note ?? "").slice(0, 4000),
    email_meta: input.email_meta ? JSON.stringify(input.email_meta) : null,
    last_touch_at: null,
    source: input.source ?? "manual",
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(crmContacts).where(eq(crmContacts.id, id)).limit(1);
  return { ok: true, contact: toContact(row) };
}

export async function updateContact(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    company_id?: string | null;
    title?: string;
    email?: string | null;
    phone?: string;
    linkedin_url?: string | null;
    status?: string;
    note?: string;
    tags?: string[];
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) set.name = patch.name.slice(0, 160);
  if (patch.company_id !== undefined) set.company_id = patch.company_id || null;
  if (patch.title !== undefined) set.title = patch.title.slice(0, 160);
  if (patch.email !== undefined) set.email = patch.email?.trim() || null;
  if (patch.phone !== undefined) set.phone = patch.phone.slice(0, 60);
  if (patch.linkedin_url !== undefined) set.linkedin_url = patch.linkedin_url?.trim() || null;
  if (patch.status !== undefined) set.status = patch.status.slice(0, 40);
  if (patch.note !== undefined) set.note = patch.note.slice(0, 4000);
  if (patch.tags !== undefined) set.tags = patch.tags;
  await db.update(crmContacts).set(set).where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, id)));
  return { ok: true };
}

export async function deleteContact(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(crmContacts).where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, id)));
  return { ok: true };
}

/** Find a contact by email (case-insensitive), else create one. For email auto-log. */
export async function upsertContactByEmail(
  workspaceId: string,
  input: { email: string; name?: string | null; source?: string },
): Promise<CrmContact | null> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  const rows = await db
    .select()
    .from(crmContacts)
    .where(eq(crmContacts.workspace_id, workspaceId));
  const hit = rows.find((r) => (r.email ?? "").trim().toLowerCase() === email);
  if (hit) return toContact(hit);
  const r = await createContact(workspaceId, {
    name: input.name?.trim() || email.split("@")[0],
    email,
    source: input.source ?? "email_manager",
  });
  return r.ok ? r.contact : null;
}

/* --------------------------------- deals --------------------------------- */

/** All deals with company + contact joins, newest first. The page groups by stage. */
export async function listDeals(workspaceId: string): Promise<CrmDeal[]> {
  const rows = await db
    .select()
    .from(crmDeals)
    .where(eq(crmDeals.workspace_id, workspaceId))
    .orderBy(desc(crmDeals.created_at));
  if (!rows.length) return [];
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id)));
  const contactIds = Array.from(new Set(rows.map((r) => r.primary_contact_id).filter((x): x is string => Boolean(x))));
  const [companies, contacts, lastAct] = await Promise.all([
    db
      .select({ id: crmCompanies.id, name: crmCompanies.name, type: crmCompanies.relationship_type })
      .from(crmCompanies)
      .where(and(eq(crmCompanies.workspace_id, workspaceId), inArray(crmCompanies.id, companyIds))),
    contactIds.length
      ? db
          .select({ id: crmContacts.id, name: crmContacts.name })
          .from(crmContacts)
          .where(and(eq(crmContacts.workspace_id, workspaceId), inArray(crmContacts.id, contactIds)))
      : Promise.resolve([] as { id: string; name: string }[]),
    lastActivityByDeal(workspaceId, rows.map((r) => r.id)),
  ]);
  const idx = await loadPipelineIndex(workspaceId);
  const company = new Map(companies.map((c) => [c.id, c]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    ...toDeal(r),
    company_name: company.get(r.company_id)?.name ?? null,
    company_type: company.get(r.company_id)?.type ?? null,
    contact_name: r.primary_contact_id ? contactName.get(r.primary_contact_id) ?? null : null,
    last_activity_at: lastAct.get(r.id) ?? null,
    stage_kind: idx.kindOf(r.pipeline_id, r.stage),
    stage_label: idx.labelOf(r.pipeline_id, r.stage),
    pipeline_name: idx.nameOf(r.pipeline_id),
  }));
}

export async function getDeal(workspaceId: string, id: string): Promise<CrmDeal | null> {
  const [r] = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.workspace_id, workspaceId), eq(crmDeals.id, id)))
    .limit(1);
  if (!r) return null;
  const deal = toDeal(r);
  const idx = await loadPipelineIndex(workspaceId);
  deal.stage_kind = idx.kindOf(r.pipeline_id, r.stage);
  deal.stage_label = idx.labelOf(r.pipeline_id, r.stage);
  deal.pipeline_name = idx.nameOf(r.pipeline_id);
  const [c] = await db
    .select({ name: crmCompanies.name, type: crmCompanies.relationship_type })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.workspace_id, workspaceId), eq(crmCompanies.id, r.company_id)))
    .limit(1);
  deal.company_name = c?.name ?? null;
  deal.company_type = c?.type ?? null;
  if (r.primary_contact_id) {
    const [ct] = await db
      .select({ name: crmContacts.name })
      .from(crmContacts)
      .where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, r.primary_contact_id)))
      .limit(1);
    deal.contact_name = ct?.name ?? null;
  }
  return deal;
}

export async function createDeal(
  workspaceId: string,
  input: {
    company_id: string;
    title: string;
    amount?: number | null;
    currency?: string;
    stage?: CrmDealStage;
    pipeline_id?: string | null;
    primary_contact_id?: string | null;
    close_date?: string | null;
    probability?: number | null;
    note?: string;
    source?: string;
  },
): Promise<{ ok: true; deal: CrmDeal } | { ok: false; error: string }> {
  if (!input.company_id) return { ok: false, error: "A deal needs a company." };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the deal a title." };
  // Resolve the pipeline (given or default) and keep the stage valid within it.
  const pipelines = await ensurePipelines(workspaceId);
  const pipeline =
    (input.pipeline_id && pipelines.find((p) => p.id === input.pipeline_id)) ||
    pipelines.find((p) => p.is_default) ||
    pipelines[0];
  const stage =
    input.stage && pipeline.stages.some((s) => s.key === input.stage)
      ? input.stage
      : pipeline.stages.find((s) => s.kind === "open")?.key ?? pipeline.stages[0]?.key ?? "new";
  const id = uid();
  const now = new Date();
  await db.insert(crmDeals).values({
    id,
    workspace_id: workspaceId,
    company_id: input.company_id,
    primary_contact_id: input.primary_contact_id ?? null,
    pipeline_id: pipeline.id,
    title: title.slice(0, 200),
    amount_cents: input.amount == null ? null : Math.round(input.amount * 100),
    currency: (input.currency ?? "USD").slice(0, 8),
    stage,
    close_date: input.close_date ? new Date(input.close_date) : null,
    probability: input.probability ?? null,
    note: (input.note ?? "").slice(0, 4000),
    source: input.source ?? "manual",
    created_at: now,
    updated_at: now,
  });
  await logActivity(workspaceId, {
    type: "note",
    summary: `Deal created: ${title}`,
    source: input.source === "agent" ? "agent" : "manual",
    company_id: input.company_id,
    deal_id: id,
    contact_id: input.primary_contact_id ?? null,
  });
  const deal = await getDeal(workspaceId, id);
  return deal ? { ok: true, deal } : { ok: false, error: "Couldn't create the deal." };
}

export async function updateDeal(
  workspaceId: string,
  id: string,
  patch: {
    title?: string;
    amount?: number | null;
    currency?: string;
    stage?: CrmDealStage;
    pipeline_id?: string | null;
    primary_contact_id?: string | null;
    company_id?: string;
    close_date?: string | null;
    probability?: number | null;
    note?: string;
  },
  opts?: { source?: CrmActivitySource },
): Promise<{ ok: boolean }> {
  const [cur] = await db
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.workspace_id, workspaceId), eq(crmDeals.id, id)))
    .limit(1);
  if (!cur) return { ok: false };
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 200);
  if (patch.amount !== undefined) set.amount_cents = patch.amount == null ? null : Math.round(patch.amount * 100);
  if (patch.currency !== undefined) set.currency = patch.currency.slice(0, 8);
  if (patch.stage !== undefined) set.stage = patch.stage;
  if (patch.pipeline_id !== undefined) set.pipeline_id = patch.pipeline_id || null;
  if (patch.primary_contact_id !== undefined) set.primary_contact_id = patch.primary_contact_id || null;
  if (patch.company_id !== undefined) set.company_id = patch.company_id;
  if (patch.close_date !== undefined) set.close_date = patch.close_date ? new Date(patch.close_date) : null;
  if (patch.probability !== undefined) set.probability = patch.probability;
  if (patch.note !== undefined) set.note = patch.note.slice(0, 4000);
  await db.update(crmDeals).set(set).where(and(eq(crmDeals.workspace_id, workspaceId), eq(crmDeals.id, id)));
  // Log stage moves so the timeline tells the deal's story.
  if (patch.stage !== undefined && patch.stage !== cur.stage) {
    await logActivity(workspaceId, {
      type: "stage_change",
      summary: `Stage: ${cur.stage} → ${patch.stage}`,
      source: opts?.source ?? "manual",
      company_id: cur.company_id,
      deal_id: id,
      contact_id: cur.primary_contact_id,
    });
  }
  return { ok: true };
}

export async function deleteDeal(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(crmDeals).where(and(eq(crmDeals.workspace_id, workspaceId), eq(crmDeals.id, id)));
  return { ok: true };
}

/* ----------------------------- promote / hooks --------------------------- */

/** Promote an Outreach contact into the CRM (find/create its company + the contact). */
export async function promoteOutreachContact(
  workspaceId: string,
  outreachContactId: string,
): Promise<{ ok: true; contactId: string; companyId: string } | { ok: false; error: string }> {
  const [oc] = await db
    .select()
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, outreachContactId)))
    .limit(1);
  if (!oc) return { ok: false, error: "Outreach contact not found." };
  if (oc.crm_contact_id) return { ok: true, contactId: oc.crm_contact_id, companyId: "" };

  const linkOutreach = (crmContactId: string) =>
    db
      .update(outreachContacts)
      .set({ crm_contact_id: crmContactId, updated_at: new Date() })
      .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, outreachContactId)));

  // Dedupe: if a CRM contact already has this email, reuse it.
  if (oc.contact_email) {
    const existing = await db.select().from(crmContacts).where(eq(crmContacts.workspace_id, workspaceId));
    const hit = existing.find((c) => (c.email ?? "").trim().toLowerCase() === oc.contact_email!.trim().toLowerCase());
    if (hit) {
      await linkOutreach(hit.id);
      return { ok: true, contactId: hit.id, companyId: hit.company_id ?? "" };
    }
  }

  const company = await findOrCreateCompany(workspaceId, {
    name: oc.company || "Unknown company",
    website: oc.website,
    relationship_type: "prospect",
    source: "outreach",
  });
  const created = await createContact(workspaceId, {
    name: oc.person_name || oc.company,
    company_id: company.id,
    title: oc.title,
    email: oc.contact_email,
    linkedin_url: oc.contact_method === "profile" ? oc.contact_url : null,
    email_meta: oc.email_meta ? parseEmailMeta(oc.email_meta) : null,
    source: "outreach",
    note: oc.note,
  });
  if (!created.ok) return { ok: false, error: created.error };
  await logActivity(workspaceId, {
    type: "outreach",
    summary: `Promoted from Outreach${oc.person_name ? `: ${oc.person_name}` : ""}`,
    source: "outreach",
    company_id: company.id,
    contact_id: created.contact.id,
  });
  await linkOutreach(created.contact.id);
  return { ok: true, contactId: created.contact.id, companyId: company.id };
}

/** Mirror a Quotes supplier into the shared CRM ledger as a vendor company + contact.
 *  Idempotent (links via quote_suppliers.crm_contact_id). */
export async function linkSupplierToCrm(
  workspaceId: string,
  supplierId: string,
): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(quoteSuppliers)
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, supplierId)))
    .limit(1);
  if (!row) return { ok: false, error: "Supplier not found." };
  if (row.crm_contact_id) return { ok: true, contactId: row.crm_contact_id };

  const company = await findOrCreateCompany(workspaceId, {
    name: row.company || "Supplier",
    website: row.website,
    relationship_type: "vendor",
    source: "quotes",
  });
  const created = await createContact(workspaceId, {
    name: row.company || (row.contact_email ?? "").split("@")[0] || "Supplier contact",
    company_id: company.id,
    email: row.contact_email,
    linkedin_url: row.contact_method === "form" ? row.contact_url : null,
    source: "quotes",
    note: row.note,
  });
  if (!created.ok) return { ok: false, error: created.error };
  await db
    .update(quoteSuppliers)
    .set({ crm_contact_id: created.contact.id, updated_at: new Date() })
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, supplierId)));
  await logActivity(workspaceId, {
    type: "note",
    summary: `Vendor from Quotes: ${row.company}`,
    source: "system",
    company_id: company.id,
    contact_id: created.contact.id,
  });
  return { ok: true, contactId: created.contact.id };
}

/** Email auto-log — when an outbound draft is sent, mirror it onto the CRM timeline. */
export async function logOutboundEmailToCrm(
  workspaceId: string,
  input: { email: string; name?: string | null; subject?: string | null; draftId?: string | null; sentAt?: Date },
): Promise<void> {
  const contact = await upsertContactByEmail(workspaceId, { email: input.email, name: input.name, source: "email_manager" });
  if (!contact) return;
  const now = input.sentAt ?? new Date();
  await logActivity(workspaceId, {
    type: "email",
    summary: `Email sent${input.subject ? `: ${input.subject}` : ""}`,
    source: "email_manager",
    contact_id: contact.id,
    company_id: contact.company_id,
    link_id: input.draftId ?? null,
    occurred_at: now,
  });
  await db
    .update(crmContacts)
    .set({ last_touch_at: now, updated_at: new Date() })
    .where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, contact.id)));
}

/* ------------------------------- rollups --------------------------------- */

/** Open deals with no activity in `days` (going cold) — for the needs-attention strip. */
export async function staleDeals(workspaceId: string, days = 14): Promise<CrmDeal[]> {
  const deals = await listDeals(workspaceId);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return deals
    .filter((d) => d.stage_kind === "open")
    .filter((d) => new Date(d.last_activity_at ?? d.created_at).getTime() < cutoff)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
}

/** CRM metrics for the dashboard. hasData gates whether native KPIs replace HubSpot's. */
export async function getCrmKpis(workspaceId: string): Promise<{
  hasData: boolean;
  pipelineValue: number;
  openDeals: number;
  staleDeals: number;
  newContacts7d: number;
  uncontacted: number;
}> {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const [deals, contacts] = await Promise.all([listDeals(workspaceId), listContacts(workspaceId)]);
  const open = deals.filter((d) => d.stage_kind === "open");
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const stale = open.filter((d) => new Date(d.last_activity_at ?? d.created_at).getTime() < cutoff);
  return {
    hasData: deals.length > 0 || contacts.length > 0,
    pipelineValue: open.reduce((n, d) => n + (d.amount ?? 0), 0),
    openDeals: open.length,
    staleDeals: stale.length,
    newContacts7d: contacts.filter((c) => new Date(c.created_at).getTime() >= weekAgo).length,
    uncontacted: contacts.filter((c) => !c.last_touch_at).length,
  };
}

/* ------------------------------ forecasting ------------------------------ */

/** Probability-weighted pipeline forecast with by-stage + by-close-month breakdowns.
 *  Pipeline-aware: open/won/lost + default probabilities come from each deal's pipeline. */
export async function getForecast(workspaceId: string): Promise<CrmForecast> {
  const [deals, idx] = await Promise.all([listDeals(workspaceId), loadPipelineIndex(workspaceId)]);
  const weightOf = (d: CrmDeal): number => {
    const prob = d.probability != null ? d.probability : idx.defaultProb(d.pipeline_id, d.stage);
    return (d.amount ?? 0) * (Math.max(0, Math.min(prob, 100)) / 100);
  };
  const open = deals.filter((d) => d.stage_kind === "open");
  const now = Date.now();
  const won = deals.filter((d) => d.stage_kind === "won");
  const lost = deals.filter((d) => d.stage_kind === "lost");
  const closed = won.length + lost.length;
  const won90 = won.filter((d) => now - new Date(d.updated_at).getTime() < 90 * 86_400_000);

  // By stage — group open deals by resolved stage label (so it works across pipelines).
  const stageMap = new Map<string, { count: number; value: number; weighted: number }>();
  const stageOrder: string[] = [];
  for (const d of open) {
    const label = d.stage_label ?? d.stage;
    if (!stageMap.has(label)) {
      stageMap.set(label, { count: 0, value: 0, weighted: 0 });
      stageOrder.push(label);
    }
    const s = stageMap.get(label)!;
    s.count += 1;
    s.value += d.amount ?? 0;
    s.weighted += weightOf(d);
  }
  const byStage = stageOrder.map((label) => ({ key: label, label, ...stageMap.get(label)! }));

  // Bucket open deals by close month (plus overdue + unscheduled).
  const buckets = new Map<string, { label: string; count: number; value: number; weighted: number }>();
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  for (const d of open) {
    let key: string;
    let label: string;
    if (!d.close_date) {
      key = "zzz-unscheduled";
      label = "Unscheduled";
    } else {
      const cd = new Date(d.close_date);
      if (cd.getTime() < now) {
        key = "000-overdue";
        label = "Overdue";
      } else {
        key = monthKey(cd);
        label = monthLabel(cd);
      }
    }
    const b = buckets.get(key) ?? { label, count: 0, value: 0, weighted: 0 };
    b.count += 1;
    b.value += d.amount ?? 0;
    b.weighted += weightOf(d);
    buckets.set(key, b);
  }
  const byMonth = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({ month: v.label, label: v.label, count: v.count, value: v.value, weighted: v.weighted }));

  return {
    openCount: open.length,
    openValue: open.reduce((n, d) => n + (d.amount ?? 0), 0),
    weighted: open.reduce((n, d) => n + weightOf(d), 0),
    winRate: closed ? Math.round((won.length / closed) * 100) : null,
    wonValue90d: won90.reduce((n, d) => n + (d.amount ?? 0), 0),
    byStage,
    byMonth,
  };
}

/* ----------------------------- Phase 2: hooks ---------------------------- */

const NOREPLY_RE = /^(no-?reply|notifications?|mailer-daemon|postmaster|do-?not-?reply|bounce|automated)/i;

/** Inbound email → CRM timeline. Only updates a KNOWN contact (outbound creates them),
 *  so the inbox's automated senders never pollute the CRM. Best-effort. */
export async function logInboundEmailToCrm(
  workspaceId: string,
  input: { email: string; name?: string | null; subject?: string | null; occurredAt?: Date },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || NOREPLY_RE.test(email.split("@")[0])) return;
  const rows = await db.select().from(crmContacts).where(eq(crmContacts.workspace_id, workspaceId));
  const hit = rows.find((r) => (r.email ?? "").trim().toLowerCase() === email);
  if (!hit) return;
  const when = input.occurredAt ?? new Date();
  await logActivity(workspaceId, {
    type: "email",
    summary: `Email received${input.subject ? `: ${input.subject}` : ""}`,
    source: "email_manager",
    contact_id: hit.id,
    company_id: hit.company_id,
    occurred_at: when,
  });
  await db
    .update(crmContacts)
    .set({ last_touch_at: when, updated_at: new Date() })
    .where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, hit.id)));
}

/** A scheduled meeting → the attendee's CRM timeline. Upserts the contact (a booked
 *  meeting is a deliberate touch) + bumps last_touch. Best-effort. */
export async function logMeetingToCrm(
  workspaceId: string,
  input: { email: string; name?: string | null; topic: string; when?: Date | string | null },
): Promise<void> {
  const contact = await upsertContactByEmail(workspaceId, { email: input.email, name: input.name, source: "calendar" });
  if (!contact) return;
  const whenLabel = input.when ? new Date(input.when).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  await logActivity(workspaceId, {
    type: "meeting",
    summary: `Meeting scheduled${whenLabel ? ` for ${whenLabel}` : ""}: ${input.topic}`.slice(0, 300),
    source: "calendar",
    contact_id: contact.id,
    company_id: contact.company_id,
  });
  await db
    .update(crmContacts)
    .set({ last_touch_at: new Date(), updated_at: new Date() })
    .where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, contact.id)));
}

/* -------------------------- Phase 2: intelligence ------------------------ */

/** Draft a contextual follow-up for a deal → stage it in the Email Manager. Logs it. */
export async function draftDealFollowup(
  workspaceId: string,
  dealId: string,
  senderName: string,
  scopeUserId: string | null,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const deal = await getDeal(workspaceId, dealId);
  if (!deal) return { ok: false, error: "Deal not found." };
  let contact = deal.primary_contact_id ? await getContact(workspaceId, deal.primary_contact_id) : null;
  if (!contact || !contact.email) {
    const atCompany = await listContacts(workspaceId, { companyId: deal.company_id });
    contact = atCompany.find((c) => c.email) ?? contact;
  }
  if (!contact || !contact.email) return { ok: false, error: "No contact with an email on this deal — add one first." };

  const [activities, ctx] = await Promise.all([
    listActivities(workspaceId, { deal_id: dealId }, 8),
    getPlanningContext(workspaceId),
  ]);
  let draft;
  try {
    draft = await runWithUsage(workspaceId, "crm-followup", () =>
      draftFollowupEmail({
        company: deal.company_name ?? "",
        personName: contact!.name,
        title: contact!.title,
        deal: { title: deal.title, stage: deal.stage, amount: deal.amount },
        recentActivity: activities.map((a) => a.summary),
        brief: ctx.brief,
        senderName,
      }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the follow-up." };
  }

  const staged = await stageOutboundDraft(
    workspaceId,
    { to: contact.email, subject: draft.subject, body: draft.body, recipientName: contact.name, intent: `Follow-up — ${deal.title}` },
    scopeUserId,
  );
  await logActivity(workspaceId, {
    type: "email",
    summary: `Follow-up drafted: ${draft.subject}`,
    source: "agent",
    deal_id: dealId,
    contact_id: contact.id,
    company_id: deal.company_id,
    link_id: staged.draft.id,
  });
  return { ok: true, draftId: staged.draft.id };
}

/** Draft follow-ups for the top going-cold deals (bounded). For the Executive tool. */
export async function draftFollowupsForColdDeals(
  workspaceId: string,
  senderName: string,
  scopeUserId: string | null,
  max = 5,
): Promise<{ drafted: number; total: number }> {
  const stale = await staleDeals(workspaceId, 14);
  let drafted = 0;
  for (const d of stale.slice(0, max)) {
    const r = await draftDealFollowup(workspaceId, d.id, senderName, scopeUserId);
    if (r.ok) drafted++;
  }
  return { drafted, total: stale.length };
}

/** Enrich a company from the live web (fills empty fields, logs what was found). */
export async function enrichCompanyInfo(
  workspaceId: string,
  companyId: string,
): Promise<{ ok: boolean; error?: string }> {
  const company = await getCompany(workspaceId, companyId);
  if (!company) return { ok: false, error: "Company not found." };
  let data;
  try {
    data = await runWithUsage(workspaceId, "crm-enrich", () => enrichCompany({ name: company.name, website: company.website }));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Enrichment failed." };
  }
  if (!data) return { ok: false, error: "Couldn't find anything to enrich." };
  // Fill only empty fields — never clobber the owner's own edits.
  const patch: { industry?: string; size?: string; website?: string | null; domain?: string | null; note?: string } = {};
  if (data.industry && !company.industry) patch.industry = data.industry;
  if (data.size && !company.size) patch.size = data.size;
  if (data.website && !company.website) patch.website = data.website;
  if (data.domain && !company.domain) patch.domain = data.domain;
  if (data.summary && !company.note) patch.note = data.summary;
  if (Object.keys(patch).length) await updateCompany(workspaceId, companyId, patch);
  await logActivity(workspaceId, {
    type: "note",
    summary: `Enriched from the web${data.industry ? `: ${data.industry}` : ""}`,
    body: data.summary,
    source: "agent",
    company_id: companyId,
  });
  return { ok: true };
}

/** Find a CRM contact's real email via Hunter (name + the company's domain). */
export async function findContactEmailForCrm(
  workspaceId: string,
  contactId: string,
): Promise<{ ok: true; email: string | null; score: number | null } | { ok: false; error: string }> {
  if (!hunterConfigured()) return { ok: false, error: "Email finder isn't set up (HUNTER_API_KEY missing)." };
  const contact = await getContact(workspaceId, contactId);
  if (!contact) return { ok: false, error: "Contact not found." };
  if (!contact.name.trim()) return { ok: false, error: "Add the person's name first." };
  let domain: string | null = null;
  if (contact.company_id) {
    const company = await getCompany(workspaceId, contact.company_id);
    domain = domainFromWebsite(company?.website) ?? company?.domain ?? null;
  }
  if (!domain) return { ok: false, error: "Add the company's website first so I can search its domain." };
  const r = await findEmail({ fullName: contact.name, domain });
  if (!r.email || (r.score !== null && r.score < HUNTER_MIN_SCORE)) return { ok: true, email: null, score: r.score };
  const meta: OutreachEmailMeta = { score: r.score, status: r.status, sources: r.sources, found_via: "finder" };
  await db
    .update(crmContacts)
    .set({ email: r.email, email_meta: JSON.stringify(meta), updated_at: new Date() })
    .where(and(eq(crmContacts.workspace_id, workspaceId), eq(crmContacts.id, contactId)));
  await logActivity(workspaceId, {
    type: "note",
    summary: `Email found via Hunter${r.score != null ? ` (${r.score}%)` : ""}`,
    source: "agent",
    contact_id: contactId,
    company_id: contact.company_id,
  });
  return { ok: true, email: r.email, score: r.score };
}

/** Compact "needs attention" summary for the Today hub. */
export async function crmNeedsAttention(workspaceId: string): Promise<{
  staleDeals: number;
  staleValue: number;
  uncontacted: number;
  topStale: { id: string; title: string; company: string | null; amount: number | null; days: number }[];
}> {
  const [stale, contacts] = await Promise.all([staleDeals(workspaceId, 14), listContacts(workspaceId)]);
  return {
    staleDeals: stale.length,
    staleValue: stale.reduce((n, d) => n + (d.amount ?? 0), 0),
    uncontacted: contacts.filter((c) => !c.last_touch_at).length,
    topStale: stale.slice(0, 5).map((d) => ({
      id: d.id,
      title: d.title,
      company: d.company_name ?? null,
      amount: d.amount,
      days: Math.floor((Date.now() - new Date(d.last_activity_at ?? d.created_at).getTime()) / 86400000),
    })),
  };
}

/* --------------------------- Phase 3: HubSpot ---------------------------- */

/** Map a HubSpot deal stage/label to a CRM stage. */
function mapHsStage(labelOrStage: string): CrmDealStage {
  const s = (labelOrStage || "").toLowerCase();
  if (s.includes("won")) return "won";
  if (s.includes("lost")) return "lost";
  if (s.includes("negoti")) return "negotiation";
  if (s.includes("proposal") || s.includes("presentation") || s.includes("contract") || s.includes("decision")) return "proposal";
  if (s.includes("qual")) return "qualified";
  return "new";
}
function mapHsRelType(lifecycle: string): CrmRelationshipType {
  const s = (lifecycle || "").toLowerCase();
  if (s === "customer") return "customer";
  if (s === "partner") return "partner";
  return "prospect";
}

/**
 * Import HubSpot companies, contacts, and open deals into the native CRM. Idempotent —
 * re-running dedupes (companies by domain/name, contacts by email, deals by company+title),
 * so it doubles as a resync. Operator stays the system of record. Needs HubSpot connected.
 */
export async function importFromHubSpot(
  workspaceId: string,
): Promise<{ ok: true; companies: number; contacts: number; deals: number } | { ok: false; error: string }> {
  const token = await getValidAccessToken(workspaceId, "HubSpot");
  if (!token) return { ok: false, error: "HubSpot isn't connected — connect it in Integrations first." };

  let companiesAdded = 0;
  let contactsAdded = 0;
  let dealsAdded = 0;

  // Dedupe maps, seeded from what's already in the CRM.
  const existingCompanies = await db.select().from(crmCompanies).where(eq(crmCompanies.workspace_id, workspaceId));
  const byDomain = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of existingCompanies) {
    if (c.domain) byDomain.set(c.domain.trim().toLowerCase(), c.id);
    if (c.name.trim()) byName.set(c.name.trim().toLowerCase(), c.id);
  }
  const resolveCompany = async (
    name: string,
    domain: string | null,
    industry: string,
    size: string,
    rel: CrmRelationshipType,
  ): Promise<string | null> => {
    const d = domain?.trim().toLowerCase() || null;
    const n = name.trim().toLowerCase();
    if (d && byDomain.has(d)) return byDomain.get(d)!;
    if (n && byName.has(n)) return byName.get(n)!;
    if (!name.trim()) return null;
    const r = await createCompany(workspaceId, { name, domain, industry, size, relationship_type: rel, source: "hubspot" });
    if (!r.ok) return null;
    companiesAdded += 1;
    if (d) byDomain.set(d, r.company.id);
    byName.set(n, r.company.id);
    return r.company.id;
  };

  // Companies
  try {
    for (const hc of await hsRecentCompanies(token, 200)) {
      await resolveCompany(hc.name, hc.domain || null, hc.industry, hc.employees ? `${hc.employees} employees` : "", mapHsRelType(hc.lifecycleStage));
    }
  } catch {
    /* scope may be missing — import what we can */
  }

  // Contacts
  try {
    const existingContacts = await db
      .select({ email: crmContacts.email })
      .from(crmContacts)
      .where(eq(crmContacts.workspace_id, workspaceId));
    const seenEmails = new Set(existingContacts.map((c) => (c.email ?? "").trim().toLowerCase()).filter(Boolean));
    for (const hc of await hsRecentContacts(token, 3650, 200)) {
      const email = (hc.email ?? "").trim().toLowerCase();
      if (email && seenEmails.has(email)) continue;
      if (!email && !hc.name.trim()) continue;
      const companyId = hc.company ? await resolveCompany(hc.company, null, "", "", "prospect") : null;
      const r = await createContact(workspaceId, { name: hc.name || email, email: hc.email || null, company_id: companyId, source: "hubspot" });
      if (r.ok) {
        contactsAdded += 1;
        if (email) seenEmails.add(email);
      }
    }
  } catch {
    /* ignore partial-scope failures */
  }

  // Open deals — attach each to its company via v4 associations (bounded).
  try {
    const existingDeals = await db
      .select({ company_id: crmDeals.company_id, title: crmDeals.title })
      .from(crmDeals)
      .where(eq(crmDeals.workspace_id, workspaceId));
    const dealKeys = new Set(existingDeals.map((d) => `${d.company_id}|${d.title.trim().toLowerCase()}`));
    for (const hd of (await hsOpenDeals(token, 100)).slice(0, 100)) {
      const hsCo = await hsDealCompany(token, hd.id);
      if (!hsCo) continue; // deals need a company; skip unattributable ones
      const companyId = await resolveCompany(
        hsCo.name,
        hsCo.domain || null,
        hsCo.industry,
        hsCo.employees ? `${hsCo.employees} employees` : "",
        mapHsRelType(hsCo.lifecycleStage),
      );
      if (!companyId) continue;
      const key = `${companyId}|${hd.name.trim().toLowerCase()}`;
      if (dealKeys.has(key)) continue;
      const r = await createDeal(workspaceId, {
        company_id: companyId,
        title: hd.name || "Untitled deal",
        amount: hd.amount || null,
        stage: mapHsStage(hd.stageLabel || hd.stage),
        close_date: hd.closeDate,
        source: "hubspot",
      });
      if (r.ok) {
        dealsAdded += 1;
        dealKeys.add(key);
      }
    }
  } catch {
    /* ignore partial-scope failures */
  }

  return { ok: true, companies: companiesAdded, contacts: contactsAdded, deals: dealsAdded };
}
