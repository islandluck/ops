import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lt, lte, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { opportunities, opportunityScanners } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { scanGrants, type ScanResult } from "@/lib/ai/opportunities";
import { createProject } from "@/lib/agents/project";
import { guardUnattendedExecution } from "@/lib/integrations/guardrails";
import type {
  Opportunity,
  OpportunityScanner,
  OpportunityStatus,
  OpportunityType,
  ScannerCadence,
  ScannerMode,
  ScannerScope,
  ScanUsage,
} from "@/lib/types";

/**
 * Opportunities engine — per-workspace scanners that find opportunities on a
 * cadence, rank them for fit (using the brief + Deep Dive Context Pack), and
 * surface them. Modeled on Reply Radar; v1 implements the Grants scanner.
 */

const uid = () => randomUUID();
const iso = (d: Date | string) => new Date(d).toISOString();

// A scan is time-bounded to ~5 min; a lock older than this means the worker
// died mid-scan, so it's safe to reclaim / self-heal.
const LOCK_STALE_MS = 8 * 60 * 1000;
// Upper bound on grants returned per scan; the fit threshold (see scanGrants) is
// what actually decides what surfaces, so keep this generous.
const PER_SCAN_LIMIT = 20;
// scan_draft mode auto-prepares a plan for the single strongest new grant per
// run (never more), and only when the fit is clearly worth the human's time.
const AUTO_DRAFT_MIN_FIT = 65;

const CADENCE_MS: Record<ScannerCadence, number> = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  biweekly: 14 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

type ScannerRow = typeof opportunityScanners.$inferSelect;
type OppRow = typeof opportunities.$inferSelect;

const EMPTY_USAGE: ScanUsage = { input_tokens: 0, output_tokens: 0, searches: 0, est_cost_cents: 0, runs: 0 };

function toScanner(row: ScannerRow): OpportunityScanner {
  return {
    id: row.id,
    type: row.type,
    enabled: row.enabled,
    cadence: row.cadence,
    mode: row.mode,
    scope: row.scope,
    sources: row.sources ?? [],
    status: row.status,
    last_error: row.last_error,
    usage: row.usage ?? EMPTY_USAGE,
    last_run_at: row.last_run_at ? iso(row.last_run_at) : null,
    next_run_at: row.next_run_at ? iso(row.next_run_at) : null,
    created_at: iso(row.created_at),
  };
}

function toOpportunity(row: OppRow): Opportunity {
  return {
    id: row.id,
    scanner_id: row.scanner_id,
    type: row.type,
    title: row.title,
    org: row.org,
    url: row.url,
    summary: row.summary,
    deadline: row.deadline,
    amount: row.amount,
    location: row.location,
    fit_score: row.fit_score,
    fit_rationale: row.fit_rationale,
    requirements: row.requirements,
    status: row.status,
    project_id: row.project_id,
    created_at: iso(row.created_at),
  };
}

/** Fetch (creating if needed) the scanner row id for a workspace × type. */
async function ensureScanner(workspaceId: string, type: OpportunityType): Promise<string> {
  const [existing] = await db
    .select({ id: opportunityScanners.id })
    .from(opportunityScanners)
    .where(and(eq(opportunityScanners.workspace_id, workspaceId), eq(opportunityScanners.type, type)))
    .limit(1);
  if (existing) return existing.id;
  await db
    .insert(opportunityScanners)
    .values({ id: uid(), workspace_id: workspaceId, type, created_at: new Date() })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: opportunityScanners.id })
    .from(opportunityScanners)
    .where(and(eq(opportunityScanners.workspace_id, workspaceId), eq(opportunityScanners.type, type)))
    .limit(1);
  return row?.id ?? "";
}

export async function getOpportunitiesBundle(
  workspaceId: string,
): Promise<{ scanners: OpportunityScanner[]; opportunities: Opportunity[] }> {
  const [scannerRows, oppRows] = await Promise.all([
    db.select().from(opportunityScanners).where(eq(opportunityScanners.workspace_id, workspaceId)),
    db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.workspace_id, workspaceId), ne(opportunities.status, "dismissed")))
      .orderBy(desc(opportunities.fit_score), desc(opportunities.created_at))
      .limit(120),
  ]);

  // Self-heal: a scan whose process died (server restart, crash, or a hang that
  // got killed) leaves status "scanning" with a stale/absent lock. Reset those
  // so the UI never spins forever — the user can just scan again.
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  for (const r of scannerRows) {
    if (r.status === "scanning" && (!r.worker_locked_at || r.worker_locked_at < staleBefore)) {
      r.status = "idle";
      r.worker_locked_at = null;
      await db
        .update(opportunityScanners)
        .set({ status: "idle", worker_locked_at: null })
        .where(and(eq(opportunityScanners.id, r.id), eq(opportunityScanners.workspace_id, workspaceId)));
    }
  }

  return { scanners: scannerRows.map(toScanner), opportunities: oppRows.map(toOpportunity) };
}

export interface ScannerPatch {
  enabled?: boolean;
  cadence?: ScannerCadence;
  mode?: ScannerMode;
  scope?: ScannerScope;
  sources?: string[];
}

/** Upsert a scanner's config; (re)schedules next_run_at when enabled. */
export async function saveScanner(
  workspaceId: string,
  type: OpportunityType,
  patch: ScannerPatch,
): Promise<OpportunityScanner> {
  const id = await ensureScanner(workspaceId, type);
  const [cur] = await db.select().from(opportunityScanners).where(eq(opportunityScanners.id, id)).limit(1);

  const set: Partial<ScannerRow> = {};
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.cadence) set.cadence = patch.cadence;
  if (patch.mode) set.mode = patch.mode;
  if (patch.scope) set.scope = patch.scope;
  if (patch.sources) set.sources = patch.sources.map((s) => s.trim()).filter(Boolean).slice(0, 20);

  const willBeEnabled = patch.enabled ?? cur?.enabled ?? false;
  if (patch.enabled === false) {
    set.next_run_at = null;
  } else if (willBeEnabled && (patch.enabled === true || patch.cadence || !cur?.next_run_at)) {
    const cadence = patch.cadence ?? cur?.cadence ?? "weekly";
    set.next_run_at = new Date(Date.now() + CADENCE_MS[cadence]);
  }

  await db
    .update(opportunityScanners)
    .set(set)
    .where(and(eq(opportunityScanners.id, id), eq(opportunityScanners.workspace_id, workspaceId)));
  const [row] = await db.select().from(opportunityScanners).where(eq(opportunityScanners.id, id)).limit(1);
  return toScanner(row);
}

export async function setOpportunityStatus(
  workspaceId: string,
  id: string,
  status: OpportunityStatus,
): Promise<{ ok: boolean }> {
  await db
    .update(opportunities)
    .set({ status })
    .where(and(eq(opportunities.id, id), eq(opportunities.workspace_id, workspaceId)));
  return { ok: true };
}

/* --------------------------- draft → project ---------------------------- */

/** Compose the project goal for a grant application from the stored listing. */
function grantGoal(o: OppRow): string {
  return [
    `Prepare a grant application for “${o.title}”${o.org ? ` (${o.org})` : ""}.`,
    o.amount ? `Award: ${o.amount}.` : "",
    o.deadline ? `Deadline: ${o.deadline}.` : "",
    o.summary ? `About the grant: ${o.summary}` : "",
    o.requirements ? `Stated requirements: ${o.requirements}` : "",
    o.url ? `Source listing: ${o.url}` : "",
    "Plan the work to assemble a competitive application: confirm eligibility, gather the required materials, draft the narrative and budget, get internal sign-off, and be ready to submit before the deadline.",
    "IMPORTANT: never submit the application automatically — the final submission is always a human action after review.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Turn a found grant into a draft application project (status "planning", no
 * tasks until a human approves). Links the project back to the opportunity and
 * marks it "drafted". Idempotent: returns the existing project if already drafted.
 */
export async function draftGrantPlan(
  workspaceId: string,
  opportunityId: string,
): Promise<{ ok: boolean; projectId?: string; error?: string }> {
  const [opp] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.workspace_id, workspaceId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  if (opp.project_id) return { ok: true, projectId: opp.project_id };
  if (opp.type !== "grant") return { ok: false, error: "Drafting is only available for grants right now." };

  const res = await createProject(workspaceId, grantGoal(opp), "manager");
  if (!res.ok || !res.projectId) return { ok: false, error: res.error ?? "Couldn't draft a plan." };

  await db
    .update(opportunities)
    .set({ project_id: res.projectId, status: "drafted" })
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.workspace_id, workspaceId)));
  return { ok: true, projectId: res.projectId };
}

/** scan_draft autonomy: best-effort draft of the top new grant, if allowed. */
async function maybeAutoDraft(
  workspaceId: string,
  type: OpportunityType,
  mode: ScannerMode,
  fresh: Array<{ id: string; fit: number }>,
): Promise<void> {
  if (mode !== "scan_draft" || type !== "grant" || !fresh.length) return;
  // Unattended path: honor the kill switch + daily automation cap (no owning
  // agent, so the auto-mode check is skipped — drafting ships nothing itself).
  const guard = await guardUnattendedExecution(workspaceId, null);
  if (!guard.allowed) return;
  const best = fresh.filter((f) => f.fit >= AUTO_DRAFT_MIN_FIT).sort((a, b) => b.fit - a.fit)[0];
  if (!best) return;
  try {
    await draftGrantPlan(workspaceId, best.id);
  } catch {
    /* drafting is best-effort — a failure here never fails the scan */
  }
}

/* ------------------------------- scanning ------------------------------- */

/** Run one scanner: find → rank → dedup-store → meter → reschedule. */
async function runScanner(workspaceId: string, scannerId: string): Promise<{ ok: boolean; found: number; error?: string }> {
  const [row] = await db
    .select()
    .from(opportunityScanners)
    .where(and(eq(opportunityScanners.id, scannerId), eq(opportunityScanners.workspace_id, workspaceId)))
    .limit(1);
  if (!row) return { ok: false, found: 0, error: "Scanner not found." };

  await db
    .update(opportunityScanners)
    .set({ status: "scanning", last_error: null })
    .where(eq(opportunityScanners.id, scannerId));

  try {
    const { brief } = await getPlanningContext(workspaceId);
    let result: ScanResult = { opportunities: [], usage: { ...EMPTY_USAGE, runs: 1 } };
    if (row.type === "grant") {
      result = await scanGrants({
        company: {
          name: brief.company_name,
          description: brief.business_description,
          coreOffer: brief.core_offer,
          idealCustomer: brief.ideal_customer_profile,
          goals: [],
          context: brief.company_context,
        },
        location: { city: brief.city, state: brief.state, country: brief.country },
        scope: row.scope,
        sources: row.sources ?? [],
        limit: PER_SCAN_LIMIT,
      });
    }
    // else: conference/event/competition scanners land in a later phase.

    let found = 0;
    const fresh: Array<{ id: string; fit: number }> = [];
    for (const o of result.opportunities) {
      const inserted = await db
        .insert(opportunities)
        .values({
          id: uid(),
          workspace_id: workspaceId,
          scanner_id: scannerId,
          type: row.type,
          title: o.title,
          org: o.org,
          url: o.url,
          summary: o.summary,
          deadline: o.deadline,
          amount: o.amount,
          location: o.location,
          fit_score: o.fit_score,
          fit_rationale: o.fit_rationale,
          requirements: o.requirements,
          status: "new",
          created_at: new Date(),
        })
        .onConflictDoNothing({ target: [opportunities.workspace_id, opportunities.url] })
        .returning({ id: opportunities.id });
      if (inserted.length) {
        found++;
        fresh.push({ id: inserted[0].id, fit: o.fit_score });
      }
    }

    const now = new Date();
    await db
      .update(opportunityScanners)
      .set({
        status: "idle",
        usage: mergeUsage(row.usage ?? EMPTY_USAGE, result.usage),
        last_run_at: now,
        next_run_at: new Date(now.getTime() + CADENCE_MS[row.cadence]),
      })
      .where(eq(opportunityScanners.id, scannerId));

    // In scan_draft mode, prepare a plan for the best new grant. This only ever
    // drafts a "planning" project for review — it never submits an application.
    await maybeAutoDraft(workspaceId, row.type, row.mode, fresh);

    return { ok: true, found };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed.";
    await db
      .update(opportunityScanners)
      .set({ status: "failed", last_error: message.slice(0, 400), last_run_at: new Date() })
      .where(eq(opportunityScanners.id, scannerId));
    return { ok: false, found: 0, error: message };
  }
}

function mergeUsage(a: ScanUsage, b: ScanUsage): ScanUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    searches: a.searches + b.searches,
    est_cost_cents: a.est_cost_cents + b.est_cost_cents,
    runs: a.runs + b.runs,
  };
}

/** Atomically claim a scanner's worker lock, run it, then release. */
async function claimAndRun(workspaceId: string, scannerId: string): Promise<{ ok: boolean; found: number; error?: string }> {
  const now = new Date();
  const stale = new Date(now.getTime() - LOCK_STALE_MS);
  const [claimed] = await db
    .update(opportunityScanners)
    .set({ worker_locked_at: now })
    .where(
      and(
        eq(opportunityScanners.id, scannerId),
        eq(opportunityScanners.workspace_id, workspaceId),
        or(isNull(opportunityScanners.worker_locked_at), lt(opportunityScanners.worker_locked_at, stale)),
      ),
    )
    .returning({ id: opportunityScanners.id });
  if (!claimed) return { ok: false, found: 0, error: "A scan is already running." };
  try {
    return await runScanner(workspaceId, scannerId);
  } finally {
    await db.update(opportunityScanners).set({ worker_locked_at: null }).where(eq(opportunityScanners.id, scannerId));
  }
}

/** Scan a type now (user-triggered), bypassing cadence. */
export async function scanNow(
  workspaceId: string,
  type: OpportunityType,
): Promise<{ ok: boolean; found: number; error?: string }> {
  const id = await ensureScanner(workspaceId, type);
  if (!id) return { ok: false, found: 0, error: "Couldn't open the scanner." };
  return claimAndRun(workspaceId, id);
}

/** Cron entry — run scanners whose next_run_at is due, across all workspaces. */
export async function advanceDueScanners(limit = 3): Promise<{ ran: number; found: number }> {
  const now = new Date();
  const stale = new Date(now.getTime() - LOCK_STALE_MS);
  // tenant-scope-exempt: scheduled scan sweep runs across every workspace.
  const due = await db
    .select({ id: opportunityScanners.id, workspace_id: opportunityScanners.workspace_id })
    .from(opportunityScanners)
    .where(
      and(
        eq(opportunityScanners.enabled, true),
        // "approve" is manual-only — the user runs each scan themselves.
        ne(opportunityScanners.mode, "approve"),
        lte(opportunityScanners.next_run_at, now),
        or(isNull(opportunityScanners.worker_locked_at), lt(opportunityScanners.worker_locked_at, stale)),
      ),
    )
    .orderBy(asc(opportunityScanners.next_run_at))
    .limit(limit);

  let ran = 0;
  let found = 0;
  for (const s of due) {
    try {
      const r = await claimAndRun(s.workspace_id, s.id);
      if (r.ok) {
        ran++;
        found += r.found;
      }
    } catch {
      /* isolate — one bad scan can't block the rest */
    }
  }
  return { ran, found };
}
