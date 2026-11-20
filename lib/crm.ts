import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmActivities, crmCompanies, crmContacts, crmDeals, outreachContacts } from "@/lib/db/schema";
import type {
  CrmActivity,
  CrmActivitySource,
  CrmActivityType,
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmDealStage,
  CrmRelationshipType,
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

/** Non-terminal pipeline stages (everything but won/lost). */
export const OPEN_STAGES: CrmDealStage[] = ["new", "qualified", "proposal", "negotiation"];
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
      .select({ company_id: crmDeals.company_id, stage: crmDeals.stage, amount_cents: crmDeals.amount_cents })
      .from(crmDeals)
      .where(and(eq(crmDeals.workspace_id, workspaceId), inArray(crmDeals.company_id, ids))),
  ]);
  const contactCount = new Map<string, number>();
  for (const c of contacts) if (c.company_id) contactCount.set(c.company_id, (contactCount.get(c.company_id) ?? 0) + 1);
  const openCount = new Map<string, number>();
  const openValue = new Map<string, number>();
  for (const d of deals) {
    if (!OPEN_STAGES.includes(d.stage)) continue;
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
  const company = new Map(companies.map((c) => [c.id, c]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    ...toDeal(r),
    company_name: company.get(r.company_id)?.name ?? null,
    company_type: company.get(r.company_id)?.type ?? null,
    contact_name: r.primary_contact_id ? contactName.get(r.primary_contact_id) ?? null : null,
    last_activity_at: lastAct.get(r.id) ?? null,
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
  const id = uid();
  const now = new Date();
  await db.insert(crmDeals).values({
    id,
    workspace_id: workspaceId,
    company_id: input.company_id,
    primary_contact_id: input.primary_contact_id ?? null,
    title: title.slice(0, 200),
    amount_cents: input.amount == null ? null : Math.round(input.amount * 100),
    currency: (input.currency ?? "USD").slice(0, 8),
    stage: input.stage ?? "new",
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

  // Dedupe: if a CRM contact already has this email, reuse it.
  if (oc.contact_email) {
    const existing = await db.select().from(crmContacts).where(eq(crmContacts.workspace_id, workspaceId));
    const hit = existing.find((c) => (c.email ?? "").trim().toLowerCase() === oc.contact_email!.trim().toLowerCase());
    if (hit) return { ok: true, contactId: hit.id, companyId: hit.company_id ?? "" };
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
  return { ok: true, contactId: created.contact.id, companyId: company.id };
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
    .filter((d) => OPEN_STAGES.includes(d.stage))
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
  const open = deals.filter((d) => OPEN_STAGES.includes(d.stage));
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
