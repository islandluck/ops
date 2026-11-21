import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmCompanies, crmContacts, fundraiseInvestors, fundraiseRounds } from "@/lib/db/schema";
import { createContact, findOrCreateCompany, updateContact, upsertContactByEmail } from "@/lib/crm";
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
    last_contact_date: isoN(r.last_contact_at),
    needs_followup: r.needs_followup,
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
    last_contact_date?: string | null;
    needs_followup?: boolean;
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
    last_contact_at: input.last_contact_date ? new Date(input.last_contact_date) : null,
    needs_followup: input.needs_followup ?? false,
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
    last_contact_date?: string | null;
    needs_followup?: boolean;
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
  if (patch.last_contact_date !== undefined) set.last_contact_at = patch.last_contact_date ? new Date(patch.last_contact_date) : null;
  if (patch.needs_followup !== undefined) set.needs_followup = patch.needs_followup;
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

/* --------------------------- spreadsheet import -------------------------- */

/**
 * Bulk-import a VC list (parsed to rows of cells, header row first) into a round's
 * pipeline, mirroring each firm+partner into the shared CRM ledger. Re-importing an
 * updated sheet UPDATES matched investors (by contact email, else firm name) rather
 * than duplicating. Pass { dryRun: true } to preview dispositions without writing.
 */

const IMPORT_MAX_ROWS = 2000;

/** A row's resolved shape + what the import will do with it. */
export interface ImportInvestorRow {
  firm: string;
  partner: string | null;
  email: string | null;
  stage: FundraiseStage | null;
  check_amount: number | null;
  is_lead: boolean | null;
  last_contact_date: string | null;
  needs_followup: boolean | null;
  note: string | null;
  disposition: "new" | "update" | "skip";
  reason?: string;
  existing_id?: string;
}

export interface ImportResult {
  ok: boolean;
  dryRun: boolean;
  error?: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  rows: ImportInvestorRow[];
  /** Header cells we didn't recognise (informational). */
  unmapped: string[];
}

/** The template columns, for the downloadable example + the header matcher. */
export const IMPORT_TEMPLATE_HEADERS = [
  "Firm",
  "Partner",
  "Email",
  "Stage",
  "Check Size",
  "Lead",
  "Last Contact",
  "Follow Up",
  "Notes",
] as const;

type ImportField = "firm" | "partner" | "email" | "stage" | "check" | "lead" | "last" | "followup" | "note";

const HEADER_ALIASES: Record<ImportField, string[]> = {
  firm: ["firm", "vcfirm", "fund", "fundname", "firmname", "company", "companyname", "investor", "investorname", "vc", "organization", "org"],
  partner: ["partner", "partnername", "name", "vcname", "contact", "contactname", "person", "poc", "investorcontact", "lead contact"],
  email: ["email", "contactemail", "emailaddress", "workemail", "partneremail", "e mail"],
  stage: ["stage", "status", "pipelinestage", "dealstage"],
  check: ["check", "checksize", "checkamount", "allocation", "targetcheck", "amount", "investment", "ticket", "ticketsize", "commitment", "allocationsize"],
  lead: ["lead", "islead", "leadinvestor", "leadinv"],
  last: ["lastcontact", "lastcontactdate", "lasttouch", "lastcontacted", "lastcontacteddate", "lastactivity", "lastspoke"],
  followup: ["followup", "needsfollowup", "followupornot", "followupyn", "nextstep", "flagforfollowup", "follow"],
  note: ["note", "notes", "comment", "comments", "description", "details", "remarks"],
};

function normHeader(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normEmail(s: string): string | null {
  const t = (s ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null;
}

function parseMoney(s: string): number | null {
  if (!s) return null;
  const t = s.trim().toLowerCase().replace(/[,$\s]/g, "").replace(/usd|eur|gbp|€|£/g, "");
  if (!t) return null;
  const m = t.match(/^([0-9]*\.?[0-9]+)(k|m|mm|bn|b)?$/);
  if (!m) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const num = parseFloat(m[1]);
  const suf = m[2];
  const mult = suf === "k" ? 1e3 : suf === "m" || suf === "mm" ? 1e6 : suf === "b" || suf === "bn" ? 1e9 : 1;
  return Number.isFinite(num) ? Math.round(num * mult) : null;
}

function parseBool(s: string): boolean {
  const t = (s ?? "").trim().toLowerCase();
  if (!t) return false;
  if (["n", "no", "false", "0", "none", "-"].includes(t)) return false;
  return ["y", "yes", "true", "1", "x", "✓", "✔", "followup", "follow up", "follow-up", "flag", "flagged", "needed", "due"].includes(t) || t.startsWith("y");
}

function isoDate(y: number, mo: number, da: number): string | null {
  const d = new Date(Date.UTC(y, mo - 1, da));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDate(s: string): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/); // yyyy-mm-dd (also leading part of ISO)
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/); // mm/dd/yyyy (US, month-first)
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return isoDate(y, +m[1], +m[2]);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const STAGE_ALIASES: Record<string, FundraiseStage> = {
  researching: "researching", research: "researching", prospect: "researching", prospecting: "researching", tocontact: "researching", sourced: "researching", new: "researching", target: "researching", backlog: "researching",
  contacted: "contacted", reachedout: "contacted", outreach: "contacted", emailed: "contacted", intro: "contacted", introduced: "contacted", inconversation: "contacted",
  meeting: "meeting", met: "meeting", call: "meeting", meetingscheduled: "meeting", intromeeting: "meeting", firstmeeting: "meeting",
  pitched: "pitched", pitch: "pitched", presented: "pitched", pitching: "pitched", partnermeeting: "pitched",
  diligence: "diligence", dd: "diligence", duediligence: "diligence", indiligence: "diligence", deepdive: "diligence",
  termsheet: "term_sheet", ts: "term_sheet", offer: "term_sheet", termsheetout: "term_sheet", terms: "term_sheet",
  committed: "committed", commit: "committed", softcommit: "committed", verbal: "committed", verbalcommit: "committed", softcircled: "committed",
  closed: "closed", wired: "closed", funded: "closed", signed: "closed", invested: "closed", done: "closed",
  passed: "passed", pass: "passed", declined: "passed", decline: "passed", no: "passed", lost: "passed", rejected: "passed", notafit: "passed", dead: "passed",
};

function mapStage(s: string): FundraiseStage | null {
  const t = normHeader(s);
  return t ? STAGE_ALIASES[t] ?? null : null;
}

export async function importInvestors(
  workspaceId: string,
  roundId: string,
  cells: string[][],
  opts: { dryRun?: boolean; link_crm?: boolean } = {},
): Promise<ImportResult> {
  const dryRun = opts.dryRun ?? false;
  const base: ImportResult = { ok: true, dryRun, total: 0, created: 0, updated: 0, skipped: 0, rows: [], unmapped: [] };
  if (!roundId) return { ...base, ok: false, error: "Pick a round to import into." };
  const round = await getRound(workspaceId, roundId);
  if (!round) return { ...base, ok: false, error: "That round no longer exists." };
  if (!Array.isArray(cells) || cells.length < 2) return { ...base, ok: false, error: "The file had no data rows under the header." };
  if (cells.length - 1 > IMPORT_MAX_ROWS) return { ...base, ok: false, error: `Too many rows (${cells.length - 1}). Max ${IMPORT_MAX_ROWS} per import.` };

  // Map header → column index.
  const header = (cells[0] ?? []).map((h) => normHeader(String(h ?? "")));
  const findCol = (field: ImportField): number => header.findIndex((h) => HEADER_ALIASES[field].includes(h));
  const idx: Record<ImportField, number> = {
    firm: findCol("firm"), partner: findCol("partner"), email: findCol("email"), stage: findCol("stage"),
    check: findCol("check"), lead: findCol("lead"), last: findCol("last"), followup: findCol("followup"), note: findCol("note"),
  };
  if (idx.firm === -1 && idx.partner === -1 && idx.email === -1) {
    return { ...base, ok: false, error: "No recognisable columns found. Download the template to see the expected headers (Firm, Partner, Email, Stage, …)." };
  }
  const mappedCols = new Set(Object.values(idx).filter((i) => i >= 0));
  const unmapped = (cells[0] ?? []).filter((_, i) => !mappedCols.has(i)).map((h) => String(h ?? "").trim()).filter(Boolean);

  // Load existing investors in this round for upsert matching.
  const existing = await db
    .select()
    .from(fundraiseInvestors)
    .where(and(eq(fundraiseInvestors.workspace_id, workspaceId), eq(fundraiseInvestors.round_id, roundId)));
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const contactIds = existing.map((e) => e.contact_id).filter((x): x is string => Boolean(x));
  const contactEmail = new Map<string, string>();
  if (contactIds.length) {
    const cs = await db
      .select({ id: crmContacts.id, email: crmContacts.email })
      .from(crmContacts)
      .where(and(eq(crmContacts.workspace_id, workspaceId), inArray(crmContacts.id, contactIds)));
    for (const c of cs) if (c.email) contactEmail.set(c.id, c.email.trim().toLowerCase());
  }
  const byEmail = new Map<string, string>();
  const byFirm = new Map<string, string>();
  for (const e of existing) {
    byFirm.set(e.name.trim().toLowerCase(), e.id);
    const em = e.contact_id ? contactEmail.get(e.contact_id) : undefined;
    if (em) byEmail.set(em, e.id);
  }

  const rows: ImportInvestorRow[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let r = 1; r < cells.length; r++) {
    const row = cells[r] ?? [];
    const cell = (i: number): string => (i >= 0 && i < row.length ? String(row[i] ?? "").trim() : "");
    const firmRaw = cell(idx.firm);
    const partner = cell(idx.partner) || null;
    const email = normEmail(cell(idx.email));
    const firm = firmRaw || partner || (email ? email.split("@")[0] : "");
    if (!firm && !partner && !email) continue; // blank row
    if (!firm) {
      rows.push({ firm: "", partner, email, stage: null, check_amount: null, is_lead: null, last_contact_date: null, needs_followup: null, note: null, disposition: "skip", reason: "No firm or name" });
      skipped++;
      continue;
    }

    const stage = idx.stage >= 0 ? mapStage(cell(idx.stage)) : null;
    const check_amount = idx.check >= 0 ? parseMoney(cell(idx.check)) : null;
    const leadCell = idx.lead >= 0 ? cell(idx.lead) : "";
    const is_lead = leadCell ? parseBool(leadCell) : null;
    const last_contact_date = idx.last >= 0 ? parseDate(cell(idx.last)) : null;
    const fuCell = idx.followup >= 0 ? cell(idx.followup) : "";
    const needs_followup = fuCell ? parseBool(fuCell) : null;
    const note = idx.note >= 0 ? cell(idx.note) || null : null;

    const firmLower = firm.trim().toLowerCase();
    const matchId = (email && byEmail.get(email)) || byFirm.get(firmLower) || null;
    const isPending = matchId?.startsWith("__pending__");
    const existingId = matchId && !isPending ? matchId : undefined;
    const disposition: ImportInvestorRow["disposition"] = matchId ? "update" : "new";

    const previewRow: ImportInvestorRow = { firm, partner, email, stage, check_amount, is_lead, last_contact_date, needs_followup, note, disposition, existing_id: existingId };
    rows.push(previewRow);

    if (!dryRun) {
      // Mirror firm → CRM company, and (email/partner) → CRM contact.
      let companyId: string | null = null;
      let contactId: string | null = null;
      if (opts.link_crm !== false) {
        try {
          const company = await findOrCreateCompany(workspaceId, { name: firm, relationship_type: "investor", source: "fundraise_import" });
          companyId = company.id;
        } catch {
          /* non-fatal */
        }
        try {
          if (email) {
            const c = await upsertContactByEmail(workspaceId, { email, name: partner, source: "fundraise_import" });
            if (c) {
              contactId = c.id;
              if (companyId && !c.company_id) await updateContact(workspaceId, c.id, { company_id: companyId });
            }
          } else if (partner && disposition === "new") {
            const c = await createContact(workspaceId, { name: partner, company_id: companyId, source: "fundraise_import" });
            if (c.ok) contactId = c.contact.id;
          }
        } catch {
          /* non-fatal */
        }
      }

      if (existingId) {
        const ex = existingById.get(existingId);
        const patch: Parameters<typeof updateInvestor>[2] = {};
        if (stage) patch.stage = stage;
        if (check_amount != null) patch.check_amount = check_amount;
        if (is_lead != null) patch.is_lead = is_lead;
        if (last_contact_date) patch.last_contact_date = last_contact_date;
        if (needs_followup != null) patch.needs_followup = needs_followup;
        if (note) patch.note = note;
        if (companyId && ex && !ex.company_id) patch.company_id = companyId;
        if (contactId && ex && !ex.contact_id) patch.contact_id = contactId;
        await updateInvestor(workspaceId, existingId, patch);
        updated++;
      } else {
        const res = await createInvestor(workspaceId, {
          round_id: roundId,
          name: firm,
          company_id: companyId,
          contact_id: contactId,
          stage: stage ?? "researching",
          check_amount,
          is_lead: is_lead ?? false,
          last_contact_date,
          needs_followup: needs_followup ?? false,
          note: note ?? "",
          source: "import",
          link_crm: false, // CRM company already resolved above
        });
        if (res.ok) {
          created++;
          byFirm.set(firmLower, res.investor.id);
          if (email) byEmail.set(email, res.investor.id);
        } else {
          previewRow.disposition = "skip";
          previewRow.reason = res.error;
          skipped++;
        }
      }
    } else {
      // Dry run: tally + register a sentinel so later duplicate rows in the same file read as updates.
      if (disposition === "update") updated++;
      else {
        created++;
        byFirm.set(firmLower, "__pending__" + firmLower);
        if (email) byEmail.set(email, "__pending__" + email);
      }
    }
  }

  return { ok: true, dryRun, total: rows.length, created, updated, skipped, rows, unmapped };
}
