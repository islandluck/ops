import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fundraiseIntroPaths, fundraiseInvestors, fundraiseRounds } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { runWithUsage } from "@/lib/ai/usage";
import { stageOutboundDraft } from "@/lib/agents/outbound";
import { addContact, createOutreachCampaign, listOutreachCampaigns, markContactDrafted } from "@/lib/outreach";
import { domainFromWebsite, findEmail, hunterConfigured, HUNTER_MIN_SCORE } from "@/lib/integrations/hunter";
import { draftIntroRequest, findPortfolioFounders } from "@/lib/ai/intros";
import type { FundraiseIntroPath, FundraiseIntroStatus } from "@/lib/types";

/**
 * Warm intros — for a target VC (a fundraise investor), find the portfolio companies closest
 * to us + their founders (AI research), scout the founder's email (Hunter), and draft a warm
 * "short call" request into the Email Manager via a dedicated Outreach campaign. Nothing sends.
 * Server-only. Reuses the Outreach + Hunter + research engines.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

type IntroRow = typeof fundraiseIntroPaths.$inferSelect;

function toPath(r: IntroRow): FundraiseIntroPath {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    investor_id: r.investor_id,
    portfolio_company: r.portfolio_company,
    portfolio_domain: r.portfolio_domain,
    founder_name: r.founder_name,
    founder_title: r.founder_title,
    founder_email: r.founder_email,
    relevance: r.relevance,
    relevance_score: r.relevance_score,
    status: r.status,
    outreach_contact_id: r.outreach_contact_id,
    crm_contact_id: r.crm_contact_id,
    source: r.source,
    note: r.note,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

async function getInvestor(workspaceId: string, investorId: string) {
  const [row] = await db
    .select()
    .from(fundraiseInvestors)
    .where(and(eq(fundraiseInvestors.workspace_id, workspaceId), eq(fundraiseInvestors.id, investorId)))
    .limit(1);
  return row ?? null;
}

async function getPath(workspaceId: string, id: string): Promise<IntroRow | null> {
  const [row] = await db
    .select()
    .from(fundraiseIntroPaths)
    .where(and(eq(fundraiseIntroPaths.workspace_id, workspaceId), eq(fundraiseIntroPaths.id, id)))
    .limit(1);
  return row ?? null;
}

/** List the warm-intro paths for one target VC, newest first. */
export async function listIntroPaths(workspaceId: string, investorId: string): Promise<FundraiseIntroPath[]> {
  const rows = await db
    .select()
    .from(fundraiseIntroPaths)
    .where(and(eq(fundraiseIntroPaths.workspace_id, workspaceId), eq(fundraiseIntroPaths.investor_id, investorId)))
    .orderBy(desc(fundraiseIntroPaths.created_at));
  return rows.map(toPath);
}

/**
 * Research the portfolio companies of this VC closest to us + their founders (AI web search),
 * and store them as suggested intro paths. Deduped against paths already on this investor.
 */
export async function researchIntroPaths(
  workspaceId: string,
  investorId: string,
  opts: { count?: number } = {},
): Promise<{ ok: true; added: number; configured: boolean } | { ok: false; error: string }> {
  const investor = await getInvestor(workspaceId, investorId);
  if (!investor) return { ok: false, error: "Investor not found." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, added: 0, configured: false };

  const { brief } = await getPlanningContext(workspaceId);
  const existing = await listIntroPaths(workspaceId, investorId);
  const exclude = Array.from(new Set(existing.map((p) => p.portfolio_company.trim()).filter(Boolean)));

  let founders;
  try {
    founders = await runWithUsage(workspaceId, "fundraise-intro-research", () =>
      findPortfolioFounders({ vcFirm: investor.name, brief, count: opts.count ?? 3, exclude }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Research failed." };
  }

  const seen = new Set(existing.map((p) => p.portfolio_company.trim().toLowerCase()));
  const now = new Date();
  const rows = founders
    .filter((f) => f.company && !seen.has(f.company.trim().toLowerCase()))
    .map((f) => ({
      id: uid(),
      workspace_id: workspaceId,
      investor_id: investorId,
      portfolio_company: f.company.slice(0, 160),
      portfolio_domain: f.website,
      founder_name: f.founder_name.slice(0, 120),
      founder_title: f.founder_title.slice(0, 160),
      founder_email: f.founder_email,
      relevance: f.relevance.slice(0, 400),
      relevance_score: f.relevance_score,
      status: "suggested" as FundraiseIntroStatus,
      source: "ai",
      note: "",
      created_at: now,
      updated_at: now,
    }));
  if (rows.length) await db.insert(fundraiseIntroPaths).values(rows);
  return { ok: true, added: rows.length, configured: true };
}

/** Manually add a warm-intro path (a portfolio company + founder you already know of). */
export async function addIntroPath(
  workspaceId: string,
  investorId: string,
  input: {
    portfolio_company: string;
    portfolio_domain?: string | null;
    founder_name?: string;
    founder_title?: string;
    founder_email?: string | null;
    relevance?: string;
    note?: string;
  },
): Promise<{ ok: true; path: FundraiseIntroPath } | { ok: false; error: string }> {
  const investor = await getInvestor(workspaceId, investorId);
  if (!investor) return { ok: false, error: "Investor not found." };
  const company = input.portfolio_company.trim();
  if (!company) return { ok: false, error: "Add the portfolio company name." };
  const id = uid();
  const now = new Date();
  await db.insert(fundraiseIntroPaths).values({
    id,
    workspace_id: workspaceId,
    investor_id: investorId,
    portfolio_company: company.slice(0, 160),
    portfolio_domain: input.portfolio_domain?.trim() || null,
    founder_name: (input.founder_name ?? "").trim().slice(0, 120),
    founder_title: (input.founder_title ?? "").trim().slice(0, 160),
    founder_email: input.founder_email?.trim() || null,
    relevance: (input.relevance ?? "").slice(0, 400),
    status: "approved",
    source: "manual",
    note: (input.note ?? "").slice(0, 2000),
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(fundraiseIntroPaths).where(eq(fundraiseIntroPaths.id, id)).limit(1);
  return { ok: true, path: toPath(row) };
}

export async function updateIntroPath(
  workspaceId: string,
  id: string,
  patch: {
    portfolio_company?: string;
    portfolio_domain?: string | null;
    founder_name?: string;
    founder_title?: string;
    founder_email?: string | null;
    relevance?: string;
    status?: FundraiseIntroStatus;
    note?: string;
  },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.portfolio_company !== undefined) set.portfolio_company = patch.portfolio_company.slice(0, 160);
  if (patch.portfolio_domain !== undefined) set.portfolio_domain = patch.portfolio_domain?.trim() || null;
  if (patch.founder_name !== undefined) set.founder_name = patch.founder_name.slice(0, 120);
  if (patch.founder_title !== undefined) set.founder_title = patch.founder_title.slice(0, 160);
  if (patch.founder_email !== undefined) set.founder_email = patch.founder_email?.trim() || null;
  if (patch.relevance !== undefined) set.relevance = patch.relevance.slice(0, 400);
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.note !== undefined) set.note = patch.note.slice(0, 2000);
  await db
    .update(fundraiseIntroPaths)
    .set(set)
    .where(and(eq(fundraiseIntroPaths.workspace_id, workspaceId), eq(fundraiseIntroPaths.id, id)));
  return { ok: true };
}

export async function deleteIntroPath(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(fundraiseIntroPaths).where(and(eq(fundraiseIntroPaths.workspace_id, workspaceId), eq(fundraiseIntroPaths.id, id)));
  return { ok: true };
}

/** Resolve the founder's email via Hunter (name + portfolio-company domain), confidence-gated. */
export async function scoutFounderEmail(
  workspaceId: string,
  introPathId: string,
): Promise<{ ok: true; email: string | null; score: number | null } | { ok: false; error: string }> {
  if (!hunterConfigured()) return { ok: false, error: "Email finder isn't set up (HUNTER_API_KEY missing)." };
  const path = await getPath(workspaceId, introPathId);
  if (!path) return { ok: false, error: "Intro path not found." };
  if (!path.founder_name.trim()) return { ok: false, error: "Add the founder's name first." };
  const domain = domainFromWebsite(path.portfolio_domain) ?? (path.portfolio_domain?.trim() || null);
  if (!domain && !path.portfolio_company.trim()) return { ok: false, error: "Add the portfolio company's website so I can search their domain." };
  const r = await findEmail({ fullName: path.founder_name, domain, company: path.portfolio_company });
  if (!r.email || (r.score !== null && r.score < HUNTER_MIN_SCORE)) {
    return { ok: true, email: null, score: r.score };
  }
  const nextStatus: FundraiseIntroStatus = path.status === "suggested" || path.status === "approved" ? "email_found" : path.status;
  await db
    .update(fundraiseIntroPaths)
    .set({ founder_email: r.email, status: nextStatus, updated_at: new Date() })
    .where(and(eq(fundraiseIntroPaths.workspace_id, workspaceId), eq(fundraiseIntroPaths.id, introPathId)));
  return { ok: true, email: r.email, score: r.score };
}

/** Find-or-create the per-round "Warm intros" Outreach campaign so requests group together. */
async function ensureIntroCampaign(workspaceId: string, roundName: string): Promise<string> {
  const title = `Warm intros — ${roundName}`.slice(0, 300);
  const campaigns = await listOutreachCampaigns(workspaceId);
  const hit = campaigns.find((c) => c.title === title);
  if (hit) return hit.id;
  const r = await createOutreachCampaign(workspaceId, {
    title,
    description: "Warm-intro requests to portfolio founders — a short founder-to-founder call to connect, ahead of an intro to the VC.",
    target_roles: "Founder / CEO",
    target_count: 5,
    auto_find_emails: false,
  });
  if (!r.ok) throw new Error(r.error);
  return r.campaign.id;
}

/**
 * Draft the warm-intro "short call" email to a portfolio founder → the Email Manager, via a
 * dedicated Outreach campaign (so it lives in /outreach + the CRM + the bulk scheduler).
 * Never sends.
 */
export async function requestIntro(
  workspaceId: string,
  introPathId: string,
  senderName: string,
  scopeUserId: string | null,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const path = await getPath(workspaceId, introPathId);
  if (!path) return { ok: false, error: "Intro path not found." };
  if (!path.founder_email) return { ok: false, error: "Find the founder's email first (or add it manually)." };

  const investor = await getInvestor(workspaceId, path.investor_id);
  if (!investor) return { ok: false, error: "Target VC not found." };
  const vcFirm = investor.name;
  const [round] = await db
    .select({ name: fundraiseRounds.name })
    .from(fundraiseRounds)
    .where(and(eq(fundraiseRounds.workspace_id, workspaceId), eq(fundraiseRounds.id, investor.round_id)))
    .limit(1);
  const roundName = round?.name || "Raise";

  // Put the founder into the per-round warm-intro Outreach campaign.
  let campaignId: string;
  try {
    campaignId = await ensureIntroCampaign(workspaceId, roundName);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't open the outreach campaign." };
  }
  const added = await addContact(workspaceId, campaignId, {
    company: path.portfolio_company,
    website: path.portfolio_domain,
    person_name: path.founder_name,
    title: path.founder_title,
    contact_email: path.founder_email,
  });
  if (!added.ok) return { ok: false, error: added.error };
  const contactId = added.contact.id;

  // Draft the tailored short-call email.
  const { brief } = await getPlanningContext(workspaceId);
  let draft;
  try {
    draft = await runWithUsage(workspaceId, "fundraise-intro-draft", () =>
      draftIntroRequest({
        founderName: path.founder_name,
        founderTitle: path.founder_title,
        portfolioCompany: path.portfolio_company,
        vcFirm,
        brief,
        senderName,
      }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the intro request." };
  }

  const staged = await stageOutboundDraft(
    workspaceId,
    {
      to: path.founder_email,
      subject: draft.subject,
      body: draft.body,
      recipientName: path.founder_name || path.portfolio_company,
      intent: `Warm intro → ${vcFirm}`,
    },
    scopeUserId,
  );
  await markContactDrafted(workspaceId, contactId, staged.draft.id);
  await db
    .update(fundraiseIntroPaths)
    .set({ outreach_contact_id: contactId, status: "requested", updated_at: new Date() })
    .where(and(eq(fundraiseIntroPaths.workspace_id, workspaceId), eq(fundraiseIntroPaths.id, introPathId)));
  return { ok: true, draftId: staged.draft.id };
}
