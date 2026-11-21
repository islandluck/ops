import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmCompanies, crmContacts, fundraiseInvestors, fundraiseRounds } from "@/lib/db/schema";
import { findOrCreateCompany } from "@/lib/crm";
import type { FundraiseInvestor, FundraiseRound, FundraiseRoundStatus, FundraiseStage } from "@/lib/types";

/**
 * Fundraising OS — a round (the target) + a pipeline of investors moving through it.
 * Investors link into the shared CRM ledger (an "investor" company), so a raise lives
 * alongside the rest of the business. Server-only.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();
const isoN = (d: Date | null) => (d ? iso(d) : null);

/** Stages whose checks count as money raised (committed or wired). */
const COMMITTED_STAGES: FundraiseStage[] = ["committed", "closed"];
/** Active pipeline stages (in play, not yet committed, not passed). */
const ACTIVE_STAGES: FundraiseStage[] = ["researching", "contacted", "meeting", "pitched", "diligence", "term_sheet"];

type RoundRow = typeof fundraiseRounds.$inferSelect;
type InvestorRow = typeof fundraiseInvestors.$inferSelect;

function toRound(r: RoundRow): FundraiseRound {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    target_amount: r.target_amount_cents == null ? null : r.target_amount_cents / 100,
    valuation: r.valuation_cents == null ? null : r.valuation_cents / 100,
    status: r.status,
    close_date: isoN(r.close_date),
    note: r.note,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function toInvestor(r: InvestorRow): FundraiseInvestor {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    round_id: r.round_id,
    company_id: r.company_id,
    contact_id: r.contact_id,
    name: r.name,
    stage: r.stage,
    check_amount: r.check_amount_cents == null ? null : r.check_amount_cents / 100,
    is_lead: r.is_lead,
    note: r.note,
    source: r.source,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/* -------------------------------- rounds --------------------------------- */

export async function listRounds(workspaceId: string): Promise<FundraiseRound[]> {
  const rows = await db
    .select()
    .from(fundraiseRounds)
    .where(eq(fundraiseRounds.workspace_id, workspaceId))
    .orderBy(desc(fundraiseRounds.created_at));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const investors = await db
    .select({ round_id: fundraiseInvestors.round_id, stage: fundraiseInvestors.stage, cents: fundraiseInvestors.check_amount_cents })
    .from(fundraiseInvestors)
    .where(and(eq(fundraiseInvestors.workspace_id, workspaceId), inArray(fundraiseInvestors.round_id, ids)));
  const committed = new Map<string, number>();
  const closed = new Map<string, number>();
  const inPipe = new Map<string, number>();
  const count = new Map<string, number>();
  const committedCount = new Map<string, number>();
  for (const v of investors) {
    const dollars = (v.cents ?? 0) / 100;
    if (v.stage !== "passed") count.set(v.round_id, (count.get(v.round_id) ?? 0) + 1);
    if (COMMITTED_STAGES.includes(v.stage)) {
      committed.set(v.round_id, (committed.get(v.round_id) ?? 0) + dollars);
      committedCount.set(v.round_id, (committedCount.get(v.round_id) ?? 0) + 1);
    }
    if (v.stage === "closed") closed.set(v.round_id, (closed.get(v.round_id) ?? 0) + dollars);
    if (ACTIVE_STAGES.includes(v.stage)) inPipe.set(v.round_id, (inPipe.get(v.round_id) ?? 0) + dollars);
  }
  return rows.map((r) => ({
    ...toRound(r),
    committed: committed.get(r.id) ?? 0,
    closed: closed.get(r.id) ?? 0,
    in_pipeline: inPipe.get(r.id) ?? 0,
    investor_count: count.get(r.id) ?? 0,
    committed_count: committedCount.get(r.id) ?? 0,
  }));
}

export async function getRound(workspaceId: string, id: string): Promise<FundraiseRound | null> {
  const [r] = await db
    .select()
    .from(fundraiseRounds)
    .where(and(eq(fundraiseRounds.workspace_id, workspaceId), eq(fundraiseRounds.id, id)))
    .limit(1);
  return r ? toRound(r) : null;
}

export async function createRound(
  workspaceId: string,
  input: { name: string; target_amount?: number | null; valuation?: number | null; close_date?: string | null; note?: string },
): Promise<{ ok: true; round: FundraiseRound } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name the round (e.g. Seed)." };
  const id = uid();
  const now = new Date();
  await db.insert(fundraiseRounds).values({
    id,
    workspace_id: workspaceId,
    name: name.slice(0, 120),
    target_amount_cents: input.target_amount == null ? null : Math.round(input.target_amount * 100),
    valuation_cents: input.valuation == null ? null : Math.round(input.valuation * 100),
    status: "open",
    close_date: input.close_date ? new Date(input.close_date) : null,
    note: (input.note ?? "").slice(0, 4000),
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(fundraiseRounds).where(eq(fundraiseRounds.id, id)).limit(1);
  return { ok: true, round: toRound(row) };
}

export async function updateRound(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    target_amount?: number | null;
    valuation?: number | null;
    status?: FundraiseRoundStatus;
    close_date?: string | null;
    note?: string;
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) set.name = patch.name.slice(0, 120);
  if (patch.target_amount !== undefined) set.target_amount_cents = patch.target_amount == null ? null : Math.round(patch.target_amount * 100);
  if (patch.valuation !== undefined) set.valuation_cents = patch.valuation == null ? null : Math.round(patch.valuation * 100);
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.close_date !== undefined) set.close_date = patch.close_date ? new Date(patch.close_date) : null;
  if (patch.note !== undefined) set.note = patch.note.slice(0, 4000);
  await db.update(fundraiseRounds).set(set).where(and(eq(fundraiseRounds.workspace_id, workspaceId), eq(fundraiseRounds.id, id)));
  return { ok: true };
}

export async function deleteRound(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(fundraiseRounds).where(and(eq(fundraiseRounds.workspace_id, workspaceId), eq(fundraiseRounds.id, id)));
  return { ok: true };
}

/* ------------------------------- investors ------------------------------- */

export async function listInvestors(workspaceId: string, roundId: string): Promise<FundraiseInvestor[]> {
  const rows = await db
    .select()
    .from(fundraiseInvestors)
    .where(and(eq(fundraiseInvestors.workspace_id, workspaceId), eq(fundraiseInvestors.round_id, roundId)))
    .orderBy(desc(fundraiseInvestors.created_at));
  if (!rows.length) return [];
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id).filter((x): x is string => Boolean(x))));
  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter((x): x is string => Boolean(x))));
  const [companies, contacts] = await Promise.all([
    companyIds.length
      ? db
          .select({ id: crmCompanies.id, name: crmCompanies.name })
          .from(crmCompanies)
          .where(and(eq(crmCompanies.workspace_id, workspaceId), inArray(crmCompanies.id, companyIds)))
      : Promise.resolve([] as { id: string; name: string }[]),
    contactIds.length
      ? db
          .select({ id: crmContacts.id, name: crmContacts.name })
          .from(crmContacts)
          .where(and(eq(crmContacts.workspace_id, workspaceId), inArray(crmContacts.id, contactIds)))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    ...toInvestor(r),
    company_name: r.company_id ? companyName.get(r.company_id) ?? null : null,
    contact_name: r.contact_id ? contactName.get(r.contact_id) ?? null : null,
  }));
}

export async function createInvestor(
  workspaceId: string,
  input: {
    round_id: string;
    name: string;
    company_id?: string | null;
    contact_id?: string | null;
    stage?: FundraiseStage;
    check_amount?: number | null;
    is_lead?: boolean;
    note?: string;
    source?: string;
    link_crm?: boolean;
  },
): Promise<{ ok: true; investor: FundraiseInvestor } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Add the investor or firm name." };
  if (!input.round_id) return { ok: false, error: "A round is required." };
  // Mirror the firm into the shared CRM ledger as an "investor" company (unless told not to).
  let companyId = input.company_id ?? null;
  if (!companyId && input.link_crm !== false) {
    try {
      const company = await findOrCreateCompany(workspaceId, { name, relationship_type: "investor", source: "fundraise" });
      companyId = company.id;
    } catch {
      /* non-fatal — the investor still lands in the raise pipeline */
    }
  }
  const id = uid();
  const now = new Date();
  await db.insert(fundraiseInvestors).values({
    id,
    workspace_id: workspaceId,
    round_id: input.round_id,
    company_id: companyId,
    contact_id: input.contact_id ?? null,
    name: name.slice(0, 160),
    stage: input.stage ?? "researching",
    check_amount_cents: input.check_amount == null ? null : Math.round(input.check_amount * 100),
    is_lead: input.is_lead ?? false,
    note: (input.note ?? "").slice(0, 4000),
    source: input.source ?? "manual",
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(fundraiseInvestors).where(eq(fundraiseInvestors.id, id)).limit(1);
  return { ok: true, investor: toInvestor(row) };
}

export async function updateInvestor(
  workspaceId: string,
  id: string,
  patch: {
    name?: string;
    company_id?: string | null;
    contact_id?: string | null;
    stage?: FundraiseStage;
    check_amount?: number | null;
    is_lead?: boolean;
    note?: string;
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) set.name = patch.name.slice(0, 160);
  if (patch.company_id !== undefined) set.company_id = patch.company_id || null;
  if (patch.contact_id !== undefined) set.contact_id = patch.contact_id || null;
  if (patch.stage !== undefined) set.stage = patch.stage;
  if (patch.check_amount !== undefined) set.check_amount_cents = patch.check_amount == null ? null : Math.round(patch.check_amount * 100);
  if (patch.is_lead !== undefined) set.is_lead = patch.is_lead;
  if (patch.note !== undefined) set.note = patch.note.slice(0, 4000);
  await db
    .update(fundraiseInvestors)
    .set(set)
    .where(and(eq(fundraiseInvestors.workspace_id, workspaceId), eq(fundraiseInvestors.id, id)));
  return { ok: true };
}

export async function deleteInvestor(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(fundraiseInvestors).where(and(eq(fundraiseInvestors.workspace_id, workspaceId), eq(fundraiseInvestors.id, id)));
  return { ok: true };
}

/** Compact raise status for the Executive / Today. */
export async function raiseStatus(workspaceId: string): Promise<{
  round: FundraiseRound | null;
  committed: number;
  target: number | null;
  pct: number | null;
  committedCount: number;
  openInvestors: number;
}> {
  const rounds = await listRounds(workspaceId);
  const round = rounds.find((r) => r.status === "open") ?? rounds[0] ?? null;
  if (!round) return { round: null, committed: 0, target: null, pct: null, committedCount: 0, openInvestors: 0 };
  const committed = round.committed ?? 0;
  const target = round.target_amount;
  return {
    round,
    committed,
    target,
    pct: target ? Math.round((committed / target) * 100) : null,
    committedCount: round.committed_count ?? 0,
    openInvestors: (round.investor_count ?? 0) - (round.committed_count ?? 0),
  };
}
