import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { outreachCampaigns, outreachContacts } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { stageOutboundDraft } from "@/lib/agents/outbound";
import { promoteOutreachContact } from "@/lib/crm";
import { draftOutreachEmail, searchContacts, type OutreachLead } from "@/lib/ai/outreach";
import {
  accountCredits,
  domainFromWebsite,
  domainSearch,
  findEmail,
  hunterConfigured,
  HUNTER_MIN_SCORE,
  verifyEmail,
} from "@/lib/integrations/hunter";
import { runWithUsage } from "@/lib/ai/usage";
import type {
  HunterCredits,
  OutreachCampaign,
  OutreachCampaignStatus,
  OutreachContact,
  OutreachContactMethod,
  OutreachDomainPerson,
  OutreachEmailMeta,
  OutreachStatus,
} from "@/lib/types";

/**
 * Outreach engine — the user (or the Executive's run_outreach tool) opens a campaign
 * (an idea + the roles to reach), the agent researches real companies and the right
 * decision-maker at each (Claude native web search/fetch), finds a real email (or a
 * LinkedIn/contact URL fallback), and drafts a personalized outreach email per contact
 * into the Email Manager to review + send. Nothing auto-sends. Server-only.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

/** Parse the stored email_meta JSON back into a typed object (null when absent/bad). */
function parseEmailMeta(raw: string | null): OutreachEmailMeta | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as OutreachEmailMeta) : null;
  } catch {
    return null;
  }
}

/** Contacts already engaged — never re-surfaced in a later campaign (don't-contact-twice). */
const ENGAGED: OutreachStatus[] = ["drafted", "sent", "replied", "meeting"];
/** How many drafts one "draft all" run will stage (volume cap for cold outreach). */
const DRAFT_CAP = 15;

type CampaignRow = typeof outreachCampaigns.$inferSelect;
type ContactRow = typeof outreachContacts.$inferSelect;

function toCampaign(r: CampaignRow): OutreachCampaign {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    title: r.title,
    description: r.description,
    target_roles: r.target_roles,
    target_count: r.target_count,
    auto_find_emails: r.auto_find_emails,
    status: r.status,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/** Derive how to reach a contact: a real email wins, else a profile/contact URL, else none. */
function methodFor(email: string | null | undefined, url: string | null | undefined): OutreachContactMethod {
  if (email && email.trim()) return "email";
  if (url && url.trim()) return "profile";
  return "none";
}

function toContact(r: ContactRow): OutreachContact {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    campaign_id: r.campaign_id,
    company: r.company,
    website: r.website,
    person_name: r.person_name,
    title: r.title,
    contact_email: r.contact_email,
    contact_method: r.contact_method,
    contact_url: r.contact_url,
    source: r.source,
    status: r.status,
    outbound_draft_id: r.outbound_draft_id,
    note: r.note,
    email_meta: parseEmailMeta(r.email_meta),
    crm_contact_id: r.crm_contact_id,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/* ------------------------------- campaigns ------------------------------- */

export async function listOutreachCampaigns(workspaceId: string): Promise<OutreachCampaign[]> {
  const rows = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.workspace_id, workspaceId))
    .orderBy(desc(outreachCampaigns.created_at));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const contacts = await db
    .select({ campaign_id: outreachContacts.campaign_id, status: outreachContacts.status })
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), inArray(outreachContacts.campaign_id, ids)));
  const total = new Map<string, number>();
  const sent = new Map<string, number>();
  const replied = new Map<string, number>();
  for (const c of contacts) {
    total.set(c.campaign_id, (total.get(c.campaign_id) ?? 0) + 1);
    if (c.status === "sent" || c.status === "replied" || c.status === "meeting")
      sent.set(c.campaign_id, (sent.get(c.campaign_id) ?? 0) + 1);
    if (c.status === "replied" || c.status === "meeting")
      replied.set(c.campaign_id, (replied.get(c.campaign_id) ?? 0) + 1);
  }
  return rows.map((r) => ({
    ...toCampaign(r),
    contact_count: total.get(r.id) ?? 0,
    sent_count: sent.get(r.id) ?? 0,
    replied_count: replied.get(r.id) ?? 0,
  }));
}

export async function getOutreachCampaign(workspaceId: string, id: string): Promise<OutreachCampaign | null> {
  const [r] = await db
    .select()
    .from(outreachCampaigns)
    .where(and(eq(outreachCampaigns.workspace_id, workspaceId), eq(outreachCampaigns.id, id)))
    .limit(1);
  return r ? toCampaign(r) : null;
}

export async function createOutreachCampaign(
  workspaceId: string,
  input: { title: string; description?: string; target_roles?: string; target_count?: number; auto_find_emails?: boolean },
): Promise<{ ok: true; campaign: OutreachCampaign } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Describe who you want to reach and why." };
  const id = uid();
  const now = new Date();
  await db.insert(outreachCampaigns).values({
    id,
    workspace_id: workspaceId,
    title: title.slice(0, 300),
    description: (input.description ?? "").slice(0, 4000),
    target_roles: (input.target_roles ?? "").slice(0, 400),
    target_count: Math.max(1, Math.min(input.target_count ?? 5, 15)),
    auto_find_emails: input.auto_find_emails ?? false,
    status: "sourcing",
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, id)).limit(1);
  return { ok: true, campaign: toCampaign(row) };
}

export async function updateOutreachCampaign(
  workspaceId: string,
  id: string,
  patch: {
    title?: string;
    description?: string;
    target_roles?: string;
    target_count?: number;
    auto_find_emails?: boolean;
    status?: OutreachCampaignStatus;
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 300);
  if (patch.description !== undefined) set.description = patch.description.slice(0, 4000);
  if (patch.target_roles !== undefined) set.target_roles = patch.target_roles.slice(0, 400);
  if (patch.target_count !== undefined) set.target_count = Math.max(1, Math.min(patch.target_count, 15));
  if (patch.auto_find_emails !== undefined) set.auto_find_emails = patch.auto_find_emails;
  if (patch.status !== undefined) set.status = patch.status;
  await db
    .update(outreachCampaigns)
    .set(set)
    .where(and(eq(outreachCampaigns.workspace_id, workspaceId), eq(outreachCampaigns.id, id)));
  return { ok: true };
}

export async function deleteOutreachCampaign(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(outreachCampaigns).where(and(eq(outreachCampaigns.workspace_id, workspaceId), eq(outreachCampaigns.id, id)));
  return { ok: true };
}

/* -------------------------------- contacts ------------------------------- */

export async function listContacts(workspaceId: string, campaignId: string): Promise<OutreachContact[]> {
  const rows = await db
    .select()
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.campaign_id, campaignId)))
    .orderBy(desc(outreachContacts.created_at));
  return rows.map(toContact);
}

export async function addContact(
  workspaceId: string,
  campaignId: string,
  input: {
    company: string;
    website?: string | null;
    person_name?: string | null;
    title?: string | null;
    contact_email?: string | null;
    contact_url?: string | null;
  },
): Promise<{ ok: true; contact: OutreachContact } | { ok: false; error: string }> {
  if (!input.company.trim()) return { ok: false, error: "Add a company name." };
  const id = uid();
  const now = new Date();
  const email = input.contact_email?.trim() || null;
  const url = input.contact_url?.trim() || null;
  await db.insert(outreachContacts).values({
    id,
    workspace_id: workspaceId,
    campaign_id: campaignId,
    company: input.company.trim().slice(0, 160),
    website: input.website?.trim() || null,
    person_name: input.person_name?.trim().slice(0, 120) || "",
    title: input.title?.trim().slice(0, 160) || "",
    contact_email: email,
    contact_method: methodFor(email, url),
    contact_url: url,
    source: "manual",
    status: "found",
    note: "",
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(outreachContacts).where(eq(outreachContacts.id, id)).limit(1);
  return { ok: true, contact: toContact(row) };
}

export async function updateContact(
  workspaceId: string,
  id: string,
  patch: {
    company?: string;
    website?: string | null;
    person_name?: string;
    title?: string;
    contact_email?: string | null;
    contact_url?: string | null;
    contact_method?: OutreachContactMethod;
    status?: OutreachStatus;
    note?: string;
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.company !== undefined) set.company = patch.company.slice(0, 160);
  if (patch.website !== undefined) set.website = patch.website?.trim() || null;
  if (patch.person_name !== undefined) set.person_name = patch.person_name.slice(0, 120);
  if (patch.title !== undefined) set.title = patch.title.slice(0, 160);
  if (patch.contact_email !== undefined) set.contact_email = patch.contact_email?.trim() || null;
  if (patch.contact_url !== undefined) set.contact_url = patch.contact_url?.trim() || null;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.note !== undefined) set.note = patch.note.slice(0, 2000);
  // Keep contact_method consistent: explicit wins, else re-derive when email/url change.
  if (patch.contact_method !== undefined) {
    set.contact_method = patch.contact_method;
  } else if (patch.contact_email !== undefined || patch.contact_url !== undefined) {
    const [cur] = await db
      .select({ contact_email: outreachContacts.contact_email, contact_url: outreachContacts.contact_url })
      .from(outreachContacts)
      .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, id)))
      .limit(1);
    const email = (set.contact_email !== undefined ? set.contact_email : cur?.contact_email) as string | null;
    const url = (set.contact_url !== undefined ? set.contact_url : cur?.contact_url) as string | null;
    set.contact_method = methodFor(email, url);
  }
  await db.update(outreachContacts).set(set).where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, id)));
  return { ok: true };
}

export async function deleteContact(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(outreachContacts).where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, id)));
  return { ok: true };
}

/* -------------------------------- sourcing ------------------------------- */

/** Research companies + decision-makers for a campaign (Claude web search/fetch) and
 *  add new contacts. Captures a REAL email when published, else a profile/contact URL;
 *  never fabricates an address. Skips companies already in the campaign and anyone
 *  already engaged in another campaign (don't-contact-twice). */
export async function sourceContacts(
  workspaceId: string,
  campaignId: string,
): Promise<{ ok: true; added: number; configured: boolean } | { ok: false; error: string }> {
  const campaign = await getOutreachCampaign(workspaceId, campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!configured) return { ok: true, added: 0, configured: false };

  const { brief } = await getPlanningContext(workspaceId);

  // Companies already in THIS campaign — hand them to the researcher to avoid re-finding.
  const inCampaign = await db
    .select({ company: outreachContacts.company, person_name: outreachContacts.person_name })
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.campaign_id, campaignId)));
  const exclude = Array.from(new Set(inCampaign.map((e) => e.company.trim()).filter(Boolean)));

  let leads: OutreachLead[] = [];
  try {
    leads = await runWithUsage(workspaceId, "outreach-source", () =>
      searchContacts({
        idea: campaign.title,
        description: campaign.description,
        targetRoles: campaign.target_roles,
        count: campaign.target_count,
        brief,
        exclude,
      }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sourcing failed." };
  }

  // Enrich via Hunter ONLY when the campaign opts in (auto_find_emails) — otherwise
  // sourcing spends no credits and the user resolves emails per-contact on demand. When
  // on, a found-but-unpublished email is resolved from name + domain, gated by confidence
  // so we don't draft to a guessed address that bounces.
  const metaByLead = new Map<OutreachLead, OutreachEmailMeta>();
  if (hunterConfigured() && campaign.auto_find_emails) {
    for (const l of leads) {
      if (l.contact_email || !l.person_name) continue;
      const domain = domainFromWebsite(l.website);
      if (!domain && !l.company) continue;
      const r = await findEmail({ fullName: l.person_name, domain, company: l.company });
      if (r.email && (r.score === null || r.score >= HUNTER_MIN_SCORE)) {
        l.contact_email = r.email;
        metaByLead.set(l, { score: r.score, status: r.status, sources: r.sources, found_via: "finder" });
      }
    }
  }

  // Dedupe set for this campaign: company + person.
  const seen = new Set(inCampaign.map((e) => `${e.company.trim().toLowerCase()}|${e.person_name.trim().toLowerCase()}`));
  // Don't-contact-twice: emails already engaged in ANY campaign in this workspace.
  const engaged = await db
    .select({ email: outreachContacts.contact_email })
    .from(outreachContacts)
    .where(
      and(
        eq(outreachContacts.workspace_id, workspaceId),
        isNotNull(outreachContacts.contact_email),
        inArray(outreachContacts.status, ENGAGED),
      ),
    );
  const engagedEmails = new Set(engaged.map((e) => (e.email ?? "").trim().toLowerCase()).filter(Boolean));

  const now = new Date();
  const rows = leads
    .filter((l) => l.company)
    .filter((l) => !seen.has(`${l.company.trim().toLowerCase()}|${l.person_name.trim().toLowerCase()}`))
    .filter((l) => !(l.contact_email && engagedEmails.has(l.contact_email.trim().toLowerCase())))
    .map((l) => ({
      id: uid(),
      workspace_id: workspaceId,
      campaign_id: campaignId,
      company: l.company.slice(0, 160),
      website: l.website,
      person_name: l.person_name.slice(0, 120),
      title: l.title.slice(0, 160),
      contact_email: l.contact_email,
      contact_method: methodFor(l.contact_email, l.contact_url),
      contact_url: l.contact_url,
      source: "research",
      status: "found" as const,
      note: l.note.slice(0, 300),
      email_meta: metaByLead.has(l) ? JSON.stringify(metaByLead.get(l)) : null,
      created_at: now,
      updated_at: now,
    }));
  if (rows.length) await db.insert(outreachContacts).values(rows);
  if (campaign.status === "sourcing") await updateOutreachCampaign(workspaceId, campaignId, { status: "open" });
  return { ok: true, added: rows.length, configured };
}

/** Resolve a real email for an existing contact via Hunter (name + company domain),
 *  gated by confidence. On a confident hit, persists it on the contact. */
export async function findContactEmail(
  workspaceId: string,
  contactId: string,
): Promise<{ ok: true; email: string | null; score: number | null } | { ok: false; error: string }> {
  if (!hunterConfigured()) return { ok: false, error: "Email finder isn't set up (HUNTER_API_KEY missing)." };
  const [row] = await db
    .select()
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, contactId)))
    .limit(1);
  if (!row) return { ok: false, error: "Contact not found." };
  if (!row.person_name.trim()) return { ok: false, error: "Add the person's name first." };
  const domain = domainFromWebsite(row.website);
  if (!domain && !row.company.trim()) return { ok: false, error: "Add a website or company so I can search their domain." };
  const r = await findEmail({ fullName: row.person_name, domain, company: row.company });
  if (!r.email || (r.score !== null && r.score < HUNTER_MIN_SCORE)) {
    return { ok: true, email: null, score: r.score };
  }
  const meta: OutreachEmailMeta = { score: r.score, status: r.status, sources: r.sources, found_via: "finder" };
  await db
    .update(outreachContacts)
    .set({ contact_email: r.email, contact_method: "email", email_meta: JSON.stringify(meta), updated_at: new Date() })
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, contactId)));
  return { ok: true, email: r.email, score: r.score };
}

/** Hunter credit snapshot for the spend chip (searches + verifications remaining). */
export async function getHunterCredits(): Promise<HunterCredits> {
  if (!hunterConfigured()) {
    return { configured: false, searches_used: null, searches_available: null, verifications_used: null, verifications_available: null };
  }
  const a = await accountCredits();
  return {
    configured: true,
    searches_used: a?.searches_used ?? null,
    searches_available: a?.searches_available ?? null,
    verifications_used: a?.verifications_used ?? null,
    verifications_available: a?.verifications_available ?? null,
  };
}

/** Direct lookup — list the real people + emails Hunter has for a company/domain, for the
 *  user to review and pick from. Nothing is stored until addContactsFromDomain. */
export async function searchDomainPeople(input: {
  domain?: string | null;
  company?: string | null;
  department?: string | null;
  seniority?: string | null;
}): Promise<{ ok: true; people: OutreachDomainPerson[] } | { ok: false; error: string }> {
  if (!hunterConfigured()) return { ok: false, error: "Email finder isn't set up (HUNTER_API_KEY missing)." };
  const domain = domainFromWebsite(input.domain) ?? (input.domain?.trim() || null);
  const company = input.company?.trim() || null;
  if (!domain && !company) return { ok: false, error: "Enter a company website or domain." };
  const people = await domainSearch({
    domain,
    company,
    limit: 15,
    department: input.department,
    seniority: input.seniority,
  });
  return { ok: true, people };
}

/** Add selected Domain-Search people as campaign contacts (dedup by person + email). */
export async function addContactsFromDomain(
  workspaceId: string,
  campaignId: string,
  input: { company: string; website: string | null; people: OutreachDomainPerson[] },
): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const campaign = await getOutreachCampaign(workspaceId, campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  const company = input.company.trim();
  if (!company) return { ok: false, error: "Company is required." };

  const existing = await db
    .select({ company: outreachContacts.company, person_name: outreachContacts.person_name, email: outreachContacts.contact_email })
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.campaign_id, campaignId)));
  const seen = new Set(existing.map((e) => `${e.company.trim().toLowerCase()}|${e.person_name.trim().toLowerCase()}`));
  const seenEmail = new Set(existing.map((e) => (e.email ?? "").trim().toLowerCase()).filter(Boolean));

  const now = new Date();
  const rows = input.people
    .filter((p) => p.email && p.email.trim())
    .map((p) => ({ p, name: `${p.first_name} ${p.last_name}`.trim() }))
    .filter(
      ({ p, name }) =>
        !seen.has(`${company.toLowerCase()}|${name.toLowerCase()}`) && !seenEmail.has(p.email.trim().toLowerCase()),
    )
    .map(({ p, name }) => ({
      id: uid(),
      workspace_id: workspaceId,
      campaign_id: campaignId,
      company: company.slice(0, 160),
      website: input.website?.trim() || null,
      person_name: name.slice(0, 120),
      title: p.position.slice(0, 160),
      contact_email: p.email.trim(),
      contact_method: "email" as const,
      contact_url: null,
      source: "research",
      status: "found" as const,
      note: "",
      email_meta: JSON.stringify({
        score: p.confidence,
        status: null,
        sources: p.sources,
        found_via: "domain-search",
      } satisfies OutreachEmailMeta),
      created_at: now,
      updated_at: now,
    }));
  if (rows.length) await db.insert(outreachContacts).values(rows);
  if (campaign.status === "sourcing") await updateOutreachCampaign(workspaceId, campaignId, { status: "open" });
  return { ok: true, added: rows.length };
}

/** Verify a contact's email deliverability on demand (Hunter Email Verifier). */
export async function verifyContactEmail(
  workspaceId: string,
  contactId: string,
): Promise<{ ok: true; status: string | null; score: number | null } | { ok: false; error: string }> {
  if (!hunterConfigured()) return { ok: false, error: "Email finder isn't set up (HUNTER_API_KEY missing)." };
  const [row] = await db
    .select()
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, contactId)))
    .limit(1);
  if (!row) return { ok: false, error: "Contact not found." };
  if (!row.contact_email) return { ok: false, error: "No email to verify." };
  const v = await verifyEmail(row.contact_email);
  const prev = parseEmailMeta(row.email_meta) ?? { score: null, status: null, sources: [] };
  const meta: OutreachEmailMeta = { ...prev, verify_status: v.status, verify_score: v.score, verified_at: new Date().toISOString() };
  await db
    .update(outreachContacts)
    .set({ email_meta: JSON.stringify(meta), updated_at: new Date() })
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, contactId)));
  return { ok: true, status: v.status, score: v.score };
}

/* -------------------------------- drafting ------------------------------- */

/** Draft an outreach email for one contact → stage it in the Email Manager. */
export async function draftOutreach(
  workspaceId: string,
  contactId: string,
  senderName: string,
  scopeUserId: string | null,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, contactId)))
    .limit(1);
  if (!row) return { ok: false, error: "Contact not found." };
  if (!row.contact_email) return { ok: false, error: "No email for this contact — add one, or use the profile link to reach them." };
  const campaign = await getOutreachCampaign(workspaceId, row.campaign_id);
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const { brief } = await getPlanningContext(workspaceId);
  let draft;
  try {
    draft = await runWithUsage(workspaceId, "outreach-draft", () =>
      draftOutreachEmail({
        company: row.company,
        personName: row.person_name,
        title: row.title,
        campaign: { idea: campaign.title, description: campaign.description },
        brief,
        senderName,
      }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the outreach email." };
  }

  const staged = await stageOutboundDraft(
    workspaceId,
    {
      to: row.contact_email,
      subject: draft.subject,
      body: draft.body,
      recipientName: row.person_name || row.company,
      intent: `Outreach — ${campaign.title}`,
    },
    scopeUserId,
  );
  await db
    .update(outreachContacts)
    .set({ outbound_draft_id: staged.draft.id, status: "drafted", updated_at: new Date() })
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, contactId)));
  // Drafting = real engagement → mirror this contact into the shared CRM ledger.
  await promoteOutreachContact(workspaceId, contactId).catch(() => {});
  return { ok: true, draftId: staged.draft.id };
}

/** Draft outreach for every email-reachable contact with no draft yet. Bounded.
 *  Profile-only contacts are skipped (no email) — handle those via composeOutreachText. */
export async function draftAllOutreach(
  workspaceId: string,
  campaignId: string,
  senderName: string,
  scopeUserId: string | null,
): Promise<{ drafted: number }> {
  const contacts = await listContacts(workspaceId, campaignId);
  const targets = contacts.filter((c) => c.contact_email && c.status === "found" && !c.outbound_draft_id).slice(0, DRAFT_CAP);
  let drafted = 0;
  for (const c of targets) {
    const r = await draftOutreach(workspaceId, c.id, senderName, scopeUserId);
    if (r.ok) drafted++;
  }
  return { drafted };
}

/**
 * Generate paste-ready outreach text for a contact with no email (reachable only via
 * a LinkedIn profile or contact page). Returns the subject + body for the user to send
 * manually — nothing is staged or sent.
 */
export async function composeOutreachText(
  workspaceId: string,
  contactId: string,
  senderName: string,
): Promise<{ ok: true; subject: string; body: string; contact_url: string | null } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(outreachContacts)
    .where(and(eq(outreachContacts.workspace_id, workspaceId), eq(outreachContacts.id, contactId)))
    .limit(1);
  if (!row) return { ok: false, error: "Contact not found." };
  const campaign = await getOutreachCampaign(workspaceId, row.campaign_id);
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const { brief } = await getPlanningContext(workspaceId);
  try {
    const draft = await runWithUsage(workspaceId, "outreach-draft", () =>
      draftOutreachEmail({
        company: row.company,
        personName: row.person_name,
        title: row.title,
        campaign: { idea: campaign.title, description: campaign.description },
        brief,
        senderName,
      }),
    );
    return { ok: true, subject: draft.subject, body: draft.body, contact_url: row.contact_url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't compose the outreach message." };
  }
}
