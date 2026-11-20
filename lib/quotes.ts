import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { quoteRequests, quoteSuppliers } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { stageOutboundDraft } from "@/lib/agents/outbound";
import { linkSupplierToCrm } from "@/lib/crm";
import { tavilyConfigured, tavilySearch } from "@/lib/integrations/tavily";
import { distillSuppliers, draftRfqEmail, searchSuppliers, type SupplierLead } from "@/lib/ai/sourcing";
import { runWithUsage } from "@/lib/ai/usage";
import type { QuoteRequest, QuoteRequestStatus, QuoteSupplier, SupplierContactMethod, SupplierStatus } from "@/lib/types";

/**
 * Quote sourcing engine — the user (or the Executive's source_quotes tool) opens
 * a request, the agent researches suppliers (Claude native web search, Tavily
 * fallback), derives a contact email (role-based sales@ when none is published),
 * and drafts an RFQ email per supplier into the Email Manager to approve + send.
 * Nothing auto-sends. Server-only.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

type RequestRow = typeof quoteRequests.$inferSelect;
type SupplierRow = typeof quoteSuppliers.$inferSelect;

function toRequest(r: RequestRow): QuoteRequest {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    title: r.title,
    spec: r.spec,
    target_count: r.target_count,
    status: r.status,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
/** Derive how to reach a supplier: a real email wins, else a form URL, else none. */
function methodFor(email: string | null | undefined, url: string | null | undefined): SupplierContactMethod {
  if (email && email.trim()) return "email";
  if (url && url.trim()) return "form";
  return "none";
}
function toSupplier(r: SupplierRow): QuoteSupplier {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    request_id: r.request_id,
    company: r.company,
    website: r.website,
    contact_email: r.contact_email,
    contact_method: r.contact_method,
    contact_url: r.contact_url,
    source: r.source,
    status: r.status,
    outbound_draft_id: r.outbound_draft_id,
    note: r.note,
    quote_price: r.quote_price,
    quote_lead_time: r.quote_lead_time,
    quote_notes: r.quote_notes,
    crm_contact_id: r.crm_contact_id,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/* ------------------------------- requests -------------------------------- */

export async function listQuoteRequests(workspaceId: string): Promise<QuoteRequest[]> {
  const rows = await db
    .select()
    .from(quoteRequests)
    .where(eq(quoteRequests.workspace_id, workspaceId))
    .orderBy(desc(quoteRequests.created_at));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const sup = await db
    .select({ request_id: quoteSuppliers.request_id, status: quoteSuppliers.status })
    .from(quoteSuppliers)
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), inArray(quoteSuppliers.request_id, ids)));
  const total = new Map<string, number>();
  const quoted = new Map<string, number>();
  const sent = new Map<string, number>();
  for (const s of sup) {
    total.set(s.request_id, (total.get(s.request_id) ?? 0) + 1);
    if (s.status === "quoted") quoted.set(s.request_id, (quoted.get(s.request_id) ?? 0) + 1);
    if (s.status === "sent" || s.status === "replied" || s.status === "quoted")
      sent.set(s.request_id, (sent.get(s.request_id) ?? 0) + 1);
  }
  return rows.map((r) => ({
    ...toRequest(r),
    supplier_count: total.get(r.id) ?? 0,
    quoted_count: quoted.get(r.id) ?? 0,
    sent_count: sent.get(r.id) ?? 0,
  }));
}

export async function getQuoteRequest(workspaceId: string, id: string): Promise<QuoteRequest | null> {
  const [r] = await db
    .select()
    .from(quoteRequests)
    .where(and(eq(quoteRequests.workspace_id, workspaceId), eq(quoteRequests.id, id)))
    .limit(1);
  return r ? toRequest(r) : null;
}

export async function createQuoteRequest(
  workspaceId: string,
  input: { title: string; spec?: string; target_count?: number },
): Promise<{ ok: true; request: QuoteRequest } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Describe what you need a quote for." };
  const id = uid();
  const now = new Date();
  await db.insert(quoteRequests).values({
    id,
    workspace_id: workspaceId,
    title: title.slice(0, 300),
    spec: (input.spec ?? "").slice(0, 4000),
    target_count: Math.max(1, Math.min(input.target_count ?? 3, 20)),
    status: "sourcing",
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(quoteRequests).where(eq(quoteRequests.id, id)).limit(1);
  return { ok: true, request: toRequest(row) };
}

export async function updateQuoteRequest(
  workspaceId: string,
  id: string,
  patch: { title?: string; spec?: string; target_count?: number; status?: QuoteRequestStatus },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 300);
  if (patch.spec !== undefined) set.spec = patch.spec.slice(0, 4000);
  if (patch.target_count !== undefined) set.target_count = Math.max(1, Math.min(patch.target_count, 20));
  if (patch.status !== undefined) set.status = patch.status;
  await db.update(quoteRequests).set(set).where(and(eq(quoteRequests.workspace_id, workspaceId), eq(quoteRequests.id, id)));
  return { ok: true };
}

export async function deleteQuoteRequest(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(quoteRequests).where(and(eq(quoteRequests.workspace_id, workspaceId), eq(quoteRequests.id, id)));
  return { ok: true };
}

/* ------------------------------- suppliers ------------------------------- */

export async function listSuppliers(workspaceId: string, requestId: string): Promise<QuoteSupplier[]> {
  const rows = await db
    .select()
    .from(quoteSuppliers)
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.request_id, requestId)))
    .orderBy(desc(quoteSuppliers.created_at));
  return rows.map(toSupplier);
}

export async function addSupplier(
  workspaceId: string,
  requestId: string,
  input: { company: string; website?: string | null; contact_email?: string | null; contact_url?: string | null },
): Promise<{ ok: true; supplier: QuoteSupplier } | { ok: false; error: string }> {
  if (!input.company.trim()) return { ok: false, error: "Add a company name." };
  const id = uid();
  const now = new Date();
  const email = input.contact_email?.trim() || null;
  const url = input.contact_url?.trim() || null;
  await db.insert(quoteSuppliers).values({
    id,
    workspace_id: workspaceId,
    request_id: requestId,
    company: input.company.trim().slice(0, 160),
    website: input.website?.trim() || null,
    contact_email: email,
    contact_method: methodFor(email, url),
    contact_url: url,
    source: "manual",
    status: "found",
    note: "",
    quote_price: "",
    quote_lead_time: "",
    quote_notes: "",
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(quoteSuppliers).where(eq(quoteSuppliers.id, id)).limit(1);
  return { ok: true, supplier: toSupplier(row) };
}

export async function updateSupplier(
  workspaceId: string,
  id: string,
  patch: {
    company?: string;
    website?: string | null;
    contact_email?: string | null;
    contact_url?: string | null;
    contact_method?: SupplierContactMethod;
    status?: SupplierStatus;
    note?: string;
    quote_price?: string;
    quote_lead_time?: string;
    quote_notes?: string;
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.company !== undefined) set.company = patch.company.slice(0, 160);
  if (patch.website !== undefined) set.website = patch.website?.trim() || null;
  if (patch.contact_email !== undefined) set.contact_email = patch.contact_email?.trim() || null;
  if (patch.contact_url !== undefined) set.contact_url = patch.contact_url?.trim() || null;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.note !== undefined) set.note = patch.note.slice(0, 2000);
  if (patch.quote_price !== undefined) set.quote_price = patch.quote_price.slice(0, 200);
  if (patch.quote_lead_time !== undefined) set.quote_lead_time = patch.quote_lead_time.slice(0, 200);
  if (patch.quote_notes !== undefined) set.quote_notes = patch.quote_notes.slice(0, 4000);
  // Keep contact_method consistent: explicit wins, else re-derive when email/url change.
  if (patch.contact_method !== undefined) {
    set.contact_method = patch.contact_method;
  } else if (patch.contact_email !== undefined || patch.contact_url !== undefined) {
    const [cur] = await db
      .select({ contact_email: quoteSuppliers.contact_email, contact_url: quoteSuppliers.contact_url })
      .from(quoteSuppliers)
      .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, id)))
      .limit(1);
    const email = (set.contact_email !== undefined ? set.contact_email : cur?.contact_email) as string | null;
    const url = (set.contact_url !== undefined ? set.contact_url : cur?.contact_url) as string | null;
    set.contact_method = methodFor(email, url);
  }
  await db.update(quoteSuppliers).set(set).where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, id)));
  return { ok: true };
}

export async function deleteSupplier(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(quoteSuppliers).where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, id)));
  return { ok: true };
}

/* ------------------------------- sourcing -------------------------------- */

/** Research suppliers for a request (Claude web search/fetch → Tavily fallback) and
 *  add new ones. Captures a REAL email when published, else a quote-form URL; never
 *  fabricates an address. */
export async function sourceSuppliers(
  workspaceId: string,
  requestId: string,
): Promise<{ ok: true; added: number; configured: boolean } | { ok: false; error: string }> {
  const request = await getQuoteRequest(workspaceId, requestId);
  if (!request) return { ok: false, error: "Request not found." };

  const hasAI = Boolean(process.env.ANTHROPIC_API_KEY);
  const configured = hasAI || tavilyConfigured();
  if (!configured) return { ok: true, added: 0, configured: false };

  const { brief } = await getPlanningContext(workspaceId);

  // Primary: Claude's native web search. Claude drives its own queries with its
  // knowledge of the sector, so it surfaces the recognized market leaders and
  // filters out marketplace/no-name listings a single keyword query drags in.
  let leads: SupplierLead[] = [];
  if (hasAI) {
    try {
      leads = await runWithUsage(workspaceId, "quote-source", () =>
        searchSuppliers({ query: request.title, spec: request.spec, brief }),
      );
    } catch (e) {
      // Web search unavailable (e.g. not enabled on the key) — fall through to Tavily.
      console.warn(`[quotes] web-search sourcing failed, trying Tavily: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Fallback: Tavily keyword search → distill, when web search is off or found nothing.
  if (!leads.length && tavilyConfigured()) {
    const query = `${request.title} manufacturer OR supplier`;
    const results = await tavilySearch(query, { maxResults: 10, searchDepth: "advanced" });
    if (results.length) {
      try {
        leads = await runWithUsage(workspaceId, "quote-source", () =>
          distillSuppliers({ query: request.title, spec: request.spec, brief, results }),
        );
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Sourcing failed." };
      }
    }
  }

  const existing = await db
    .select({ company: quoteSuppliers.company })
    .from(quoteSuppliers)
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.request_id, requestId)));
  const seen = new Set(existing.map((e) => e.company.trim().toLowerCase()));

  const now = new Date();
  const rows = leads
    .filter((l) => l.company && !seen.has(l.company.trim().toLowerCase()))
    .map((l) => ({
      id: uid(),
      workspace_id: workspaceId,
      request_id: requestId,
      company: l.company.slice(0, 160),
      website: l.website,
      contact_email: l.contact_email,
      contact_method: methodFor(l.contact_email, l.contact_url),
      contact_url: l.contact_url,
      source: "research",
      status: "found" as const,
      note: l.note.slice(0, 300),
      quote_price: "",
      quote_lead_time: "",
      quote_notes: "",
      created_at: now,
      updated_at: now,
    }));
  if (rows.length) await db.insert(quoteSuppliers).values(rows);
  if (request.status === "sourcing") await updateQuoteRequest(workspaceId, requestId, { status: "open" });
  return { ok: true, added: rows.length, configured };
}

/* --------------------------------- RFQ ----------------------------------- */

/** Draft an RFQ email for one supplier → stage it in the Email Manager. */
export async function draftRfq(
  workspaceId: string,
  supplierId: string,
  senderName: string,
  scopeUserId: string | null,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(quoteSuppliers)
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, supplierId)))
    .limit(1);
  if (!row) return { ok: false, error: "Supplier not found." };
  if (!row.contact_email) return { ok: false, error: "No contact email for this supplier — add one first." };
  const request = await getQuoteRequest(workspaceId, row.request_id);
  if (!request) return { ok: false, error: "Request not found." };

  const { brief } = await getPlanningContext(workspaceId);
  let draft;
  try {
    draft = await runWithUsage(workspaceId, "quote-rfq", () =>
      draftRfqEmail({ company: row.company, request: { title: request.title, spec: request.spec }, brief, senderName }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the RFQ." };
  }

  const staged = await stageOutboundDraft(
    workspaceId,
    { to: row.contact_email, subject: draft.subject, body: draft.body, recipientName: row.company, intent: `RFQ — ${request.title}` },
    scopeUserId,
  );
  await db
    .update(quoteSuppliers)
    .set({ outbound_draft_id: staged.draft.id, status: "drafted", updated_at: new Date() })
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, supplierId)));
  // Drafting an RFQ = engaging the vendor → mirror into the shared CRM ledger.
  await linkSupplierToCrm(workspaceId, supplierId).catch(() => {});
  return { ok: true, draftId: staged.draft.id };
}

/** Draft RFQs for every email-reachable supplier with no draft yet. Bounded.
 *  Form-only suppliers are skipped (no email) — handle those via composeRfqText. */
export async function draftAllRfqs(
  workspaceId: string,
  requestId: string,
  senderName: string,
  scopeUserId: string | null,
): Promise<{ drafted: number }> {
  const suppliers = await listSuppliers(workspaceId, requestId);
  const targets = suppliers.filter((s) => s.contact_email && s.status === "found" && !s.outbound_draft_id).slice(0, 15);
  let drafted = 0;
  for (const s of targets) {
    const r = await draftRfq(workspaceId, s.id, senderName, scopeUserId);
    if (r.ok) drafted++;
  }
  return { drafted };
}

/**
 * Generate paste-ready RFQ text for a supplier that takes quotes via a web form
 * (no email to send to). Returns the subject + body for the user to paste into the
 * supplier's quote form — nothing is staged or sent.
 */
export async function composeRfqText(
  workspaceId: string,
  supplierId: string,
  senderName: string,
): Promise<{ ok: true; subject: string; body: string; contact_url: string | null } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(quoteSuppliers)
    .where(and(eq(quoteSuppliers.workspace_id, workspaceId), eq(quoteSuppliers.id, supplierId)))
    .limit(1);
  if (!row) return { ok: false, error: "Supplier not found." };
  const request = await getQuoteRequest(workspaceId, row.request_id);
  if (!request) return { ok: false, error: "Request not found." };

  const { brief } = await getPlanningContext(workspaceId);
  try {
    const draft = await runWithUsage(workspaceId, "quote-rfq", () =>
      draftRfqEmail({ company: row.company, request: { title: request.title, spec: request.spec }, brief, senderName }),
    );
    return { ok: true, subject: draft.subject, body: draft.body, contact_url: row.contact_url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't compose the RFQ." };
  }
}
