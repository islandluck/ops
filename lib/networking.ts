import "server-only";

import { and, asc, count, desc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessBriefs, networkingGoals, networkingTargets, opportunities } from "@/lib/db/schema";
import { listCompanies, listContacts } from "@/lib/crm";
import { stageOutboundDraft } from "@/lib/agents/outbound";
import { stageDraftTweet } from "@/lib/agents/social-bulk";
import { HUNTER_MIN_SCORE, domainSearch, findEmail, hunterConfigured } from "@/lib/integrations/hunter";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/integrations/google";
import { findGoalPeople, planNetworking } from "@/lib/ai/networking";
import type {
  NetworkingBackground,
  NetworkingChannel,
  NetworkingGoal,
  NetworkingGoalCadence,
  NetworkingGoalStatus,
  NetworkingPlan,
  NetworkingStatus,
  NetworkingTarget,
} from "@/lib/types";

/**
 * Networking (Intelligence → Networking), guided mode (v1). The founder points the agent
 * at a person/outcome ("help me network my way to X") + their angle; the agent researches,
 * maps warm paths through the founder's own network, finds events + direct channels, and
 * drafts friendly intros. "Begin" stages those intros into the Email Manager to approve +
 * send. It NEVER sends and NEVER connects on the founder's behalf. See [[outreach-track]].
 */

type Row = typeof networkingTargets.$inferSelect;

function iso(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString() : "";
}

function toTarget(row: Row): NetworkingTarget {
  return {
    id: row.id,
    who: row.who,
    context: row.context,
    status: row.status as NetworkingStatus,
    plan: (row.plan ?? null) as NetworkingPlan | null,
    goal_id: row.goal_id ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function listNetworkingTargets(workspaceId: string): Promise<NetworkingTarget[]> {
  const rows = await db
    .select()
    .from(networkingTargets)
    .where(eq(networkingTargets.workspace_id, workspaceId))
    .orderBy(desc(networkingTargets.updated_at))
    .limit(60);
  return rows.map(toTarget);
}

export async function getNetworkingTarget(workspaceId: string, id: string): Promise<NetworkingTarget | null> {
  const [row] = await db
    .select()
    .from(networkingTargets)
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
    .limit(1);
  return row ? toTarget(row) : null;
}

/** Create a target from the guided intake (who + the founder's angle/context), or from a
 *  background goal when `goalId` is set. */
export async function createNetworkingTarget(
  workspaceId: string,
  input: { who: string; context: string },
  goalId?: string | null,
): Promise<{ ok: true; target: NetworkingTarget } | { ok: false; error: string }> {
  const who = input.who.trim().slice(0, 200);
  if (!who) return { ok: false, error: "Who do you want to reach?" };
  const [row] = await db
    .insert(networkingTargets)
    .values({
      workspace_id: workspaceId,
      who,
      context: input.context.trim().slice(0, 2000),
      status: "planning",
      goal_id: goalId ?? null,
    })
    .returning();
  return { ok: true, target: toTarget(row) };
}

export async function deleteNetworkingTarget(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(networkingTargets).where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)));
  return { ok: true };
}

export async function closeNetworkingTarget(
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; target?: NetworkingTarget; error?: string }> {
  const [row] = await db
    .update(networkingTargets)
    .set({ status: "closed", updated_at: new Date() })
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
    .returning();
  if (!row) return { ok: false, error: "Target not found." };
  return { ok: true, target: toTarget(row) };
}

/** Compact "your existing network" dossier (CRM people + companies) for warm-path reasoning. */
async function gatherNetwork(workspaceId: string): Promise<string> {
  try {
    const [contacts, companies] = await Promise.all([listContacts(workspaceId), listCompanies(workspaceId)]);
    const nameById = new Map(companies.map((c) => [c.id, c.name]));
    const people = contacts
      .slice(0, 60)
      .map((c) => {
        const co = c.company_id ? nameById.get(c.company_id) : "";
        return `- ${c.name}${c.title ? `, ${c.title}` : ""}${co ? ` @ ${co}` : ""}${c.email ? ` <${c.email}>` : ""}`;
      })
      .join("\n");
    const cos = companies.slice(0, 40).map((c) => `- ${c.name}`).join("\n");
    return [people && `People you know:\n${people}`, cos && `Companies you deal with:\n${cos}`].filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}

/** Compact list of events/opportunities already on the founder's radar. */
async function gatherOpportunities(workspaceId: string): Promise<string> {
  try {
    const rows = await db
      .select({ title: opportunities.title, org: opportunities.org, summary: opportunities.summary })
      .from(opportunities)
      .where(eq(opportunities.workspace_id, workspaceId))
      .orderBy(desc(opportunities.created_at))
      .limit(15);
    return rows
      .map((r) => `- ${r.title}${r.org ? ` (${r.org})` : ""}${r.summary ? ` — ${r.summary.slice(0, 160)}` : ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * Do real Hunter.io work on a freshly drafted plan (when HUNTER_API_KEY is set): probe
 * the target's org for a few reachable contacts, and resolve each email draft's recipient
 * to a REAL address by name + company — so intros don't go to the Email Manager with a
 * blank/guessed recipient. Best-effort + budgeted (protects Hunter credits); records what
 * it found (or "no match") on each draft so the founder can see the work.
 */
async function hunterEnrich(plan: NetworkingPlan): Promise<NetworkingPlan> {
  if (!hunterConfigured()) return plan;
  const MAX_CALLS = 6;
  let calls = 0;
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // 1) Probe the target's org for reachable execs/contacts → add as channels.
  const channels: NetworkingChannel[] = [...plan.channels];
  if ((plan.target_domain || plan.target_company) && calls < MAX_CALLS) {
    calls++;
    try {
      const people = await domainSearch({
        domain: plan.target_domain || null,
        company: plan.target_company || null,
        limit: 5,
        seniority: "executive",
      });
      for (const p of people.slice(0, 3)) {
        if (!p.email || channels.some((c) => c.value.toLowerCase() === p.email.toLowerCase())) continue;
        const who = [p.first_name, p.last_name].filter(Boolean).join(" ");
        channels.push({
          kind: "email",
          label: "Email",
          value: p.email,
          note: `Hunter · ${who || "contact"}${p.position ? `, ${p.position}` : ""}${p.confidence != null ? ` · ${p.confidence}%` : ""}`,
        });
      }
    } catch {
      /* best effort */
    }
  }

  // 2) Resolve each email draft's recipient when we don't already have a real address.
  const drafts = await Promise.all(
    plan.drafts.map(async (d) => {
      if (d.channel !== "email" || emailRe.test(d.to_email) || !d.to_name.trim()) return d;
      const company = (d.to_company || plan.target_company).trim();
      const domain = plan.target_domain.trim();
      if (!company && !domain) return d;
      if (calls >= MAX_CALLS) return { ...d, note: d.note || "Hunter lookup skipped (budget reached) — add an email." };
      calls++;
      try {
        const hit = await findEmail({ fullName: d.to_name, company: company || null, domain: company ? null : domain || null });
        if (hit.email && (hit.score == null || hit.score >= HUNTER_MIN_SCORE)) {
          return { ...d, to_email: hit.email, note: `Hunter found ${hit.email}${hit.score != null ? ` (${hit.score}% confidence)` : ""}.` };
        }
        if (hit.email) {
          return { ...d, note: `Hunter: low-confidence ${hit.email} (${hit.score ?? "?"}%) — verify before sending.` };
        }
        return { ...d, note: `Hunter: no confident email for ${d.to_name}${company ? ` at ${company}` : ""}.` };
      } catch {
        return d;
      }
    }),
  );

  return { ...plan, channels, drafts };
}

/** Research the target and draft (or redraft) the networking plan. `direction` lets the
 *  founder steer a regenerate ("focus on the warm path via X", "skip cold email"). */
export async function buildNetworkingPlan(
  workspaceId: string,
  id: string,
  direction?: string,
): Promise<{ ok: boolean; target?: NetworkingTarget; error?: string }> {
  const target = await getNetworkingTarget(workspaceId, id);
  if (!target) return { ok: false, error: "Target not found." };

  await db
    .update(networkingTargets)
    .set({ status: "planning", updated_at: new Date() })
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)));

  try {
    const [[brief], network, opps] = await Promise.all([
      db
        .select({ company: businessBriefs.company_name, desc: businessBriefs.business_description })
        .from(businessBriefs)
        .where(eq(businessBriefs.workspace_id, workspaceId))
        .limit(1),
      gatherNetwork(workspaceId),
      gatherOpportunities(workspaceId),
    ]);
    const plan = await planNetworking({
      who: target.who,
      context: target.context,
      company: brief?.company ?? "",
      companyDescription: brief?.desc ?? "",
      network,
      opportunities: opps,
      direction,
    });
    // Do real Hunter work: resolve recipients + probe the target's org (best-effort, budgeted).
    const enriched = await hunterEnrich(plan);
    const [row] = await db
      .update(networkingTargets)
      .set({ plan: enriched, status: "planned", updated_at: new Date() })
      .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
      .returning();
    return { ok: true, target: toTarget(row) };
  } catch (e) {
    // Revert the status so a failed build doesn't leave the target stuck "planning".
    await db
      .update(networkingTargets)
      .set({ status: target.plan ? "planned" : "planning", updated_at: new Date() })
      .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)));
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the plan." };
  }
}

/** Begin the plan: stage its friendly intro drafts into the Email Manager outbound queue
 *  (owner plane) to approve + send. Never sends. Social profiles stay a manual connect. */
export async function beginNetworkingPlan(
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; target?: NetworkingTarget; staged?: number; error?: string }> {
  const target = await getNetworkingTarget(workspaceId, id);
  if (!target) return { ok: false, error: "Target not found." };
  if (!target.plan) return { ok: false, error: "Draft a plan first." };
  const plan = target.plan;
  if (!plan.drafts.length) return { ok: false, error: "This plan has no intro emails to stage." };

  let staged = 0;
  const intent = (d: NetworkingPlan["drafts"][number]) =>
    `Networking: ${target.who}${d.purpose ? ` — ${d.purpose}` : ""}`;
  const drafts = await Promise.all(
    plan.drafts.map(async (d) => {
      if (d.draft_id) return d; // already staged — don't duplicate
      if (!d.body.trim()) return d;
      try {
        // A TWEET goes to the social agent's queue — NEVER the Email Manager.
        if (d.channel === "x") {
          const res = await stageDraftTweet(workspaceId, { text: d.body }, { name: "Networking" });
          if (res.ok) {
            staged++;
            return { ...d, draft_id: res.taskId };
          }
          return d;
        }
        // LinkedIn has no API — leave it for the founder to send manually from the plan.
        if (d.channel === "linkedin") return d;
        // Email → the Email Manager outbound queue.
        const res = await stageOutboundDraft(
          workspaceId,
          {
            to: d.to_email || undefined,
            subject: d.subject || "Quick hello",
            body: d.body,
            recipientName: d.to_name,
            intent: intent(d),
          },
          null,
        );
        staged++;
        return { ...d, draft_id: res.draft.id };
      } catch {
        return d;
      }
    }),
  );

  const [row] = await db
    .update(networkingTargets)
    .set({ plan: { ...plan, drafts }, status: "active", updated_at: new Date() })
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
    .returning();
  return { ok: true, target: toTarget(row), staged };
}

/** Clip a founder-edited plan to safe sizes before saving (owner-edited, so trusted —
 *  this just guards storage). Preserves channels + any draft_id already set. */
function normalizePlan(plan: NetworkingPlan): NetworkingPlan {
  const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const list = (v: unknown, n: number, each: number) =>
    Array.isArray(v) ? v.map((x) => s(x, each)).filter(Boolean).slice(0, n) : [];
  return {
    summary: s(plan.summary, 1500),
    target_research: s(plan.target_research, 2000),
    target_company: s(plan.target_company, 120),
    target_domain: s(plan.target_domain, 120),
    events: (plan.events ?? []).slice(0, 10).map((e) => ({
      name: s(e.name, 200),
      when: s(e.when, 80),
      where: s(e.where, 120),
      why: s(e.why, 400),
      url: e.url && /^https?:\/\//i.test(e.url) ? e.url.slice(0, 600) : null,
    })),
    warm_paths: (plan.warm_paths ?? []).slice(0, 12).map((p) => ({
      name: s(p.name, 120),
      role: s(p.role, 120),
      company: s(p.company, 120),
      relation: "warm_path" as const,
      note: s(p.note, 400),
      connection: s(p.connection, 400),
    })),
    channels: (plan.channels ?? []).slice(0, 10).map((c) => ({
      kind: c.kind === "email" || c.kind === "x" || c.kind === "linkedin" ? c.kind : "web",
      label: s(c.label, 40),
      value: s(c.value, 600),
      note: s(c.note, 300),
    })),
    drafts: (plan.drafts ?? []).slice(0, 6).map((d) => ({
      channel: d.channel === "x" || d.channel === "linkedin" ? d.channel : "email",
      to_name: s(d.to_name, 120),
      to_email: s(d.to_email, 200),
      to_company: s(d.to_company, 120),
      purpose: s(d.purpose, 200),
      subject: s(d.subject, 200),
      body: s(d.body, 4000),
      note: s(d.note, 300),
      draft_id: d.draft_id ?? null,
    })),
    steps: list(plan.steps, 10, 300),
  };
}

/** Save founder edits to a plan (editable drafts / tweaks) before it's begun. */
export async function updateNetworkingPlan(
  workspaceId: string,
  id: string,
  plan: NetworkingPlan,
): Promise<{ ok: boolean; target?: NetworkingTarget; error?: string }> {
  const [row] = await db
    .update(networkingTargets)
    .set({ plan: normalizePlan(plan), updated_at: new Date() })
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
    .returning();
  if (!row) return { ok: false, error: "Target not found." };
  return { ok: true, target: toTarget(row) };
}

/* ------------------------- background: standing goals ------------------------- */

type GoalRow = typeof networkingGoals.$inferSelect;

function cadenceMs(c: string): number {
  return c === "daily" ? 24 * 3600_000 : 7 * 24 * 3600_000;
}
function normGoalCadence(c: string): NetworkingGoalCadence {
  return c === "daily" ? "daily" : "weekly";
}
function normGoalStatus(s: string): NetworkingGoalStatus {
  return s === "paused" || s === "done" ? s : "active";
}
function toGoal(row: GoalRow, targetCount: number): NetworkingGoal {
  return {
    id: row.id,
    goal: row.goal,
    cadence: normGoalCadence(row.cadence),
    status: normGoalStatus(row.status),
    last_run_at: row.last_run_at ? iso(row.last_run_at) : null,
    next_run_at: row.next_run_at ? iso(row.next_run_at) : null,
    target_count: targetCount,
    created_at: iso(row.created_at),
  };
}

export async function listNetworkingGoals(workspaceId: string): Promise<NetworkingGoal[]> {
  const rows = await db
    .select()
    .from(networkingGoals)
    .where(eq(networkingGoals.workspace_id, workspaceId))
    .orderBy(desc(networkingGoals.created_at))
    .limit(40);
  if (!rows.length) return [];
  const counts = await db
    .select({ goal_id: networkingTargets.goal_id, n: count() })
    .from(networkingTargets)
    .where(eq(networkingTargets.workspace_id, workspaceId))
    .groupBy(networkingTargets.goal_id);
  const byGoal = new Map(counts.map((c) => [c.goal_id, Number(c.n)]));
  return rows.map((r) => toGoal(r, byGoal.get(r.id) ?? 0));
}

export async function createNetworkingGoal(
  workspaceId: string,
  input: { goal: string; cadence: NetworkingGoalCadence },
): Promise<{ ok: boolean; error?: string }> {
  const goal = input.goal.trim().slice(0, 300);
  if (!goal) return { ok: false, error: "Describe the goal (e.g. get us on the cover of Forbes)." };
  // next_run_at = now so the first pass happens on the next cadence tick (or Run now).
  await db
    .insert(networkingGoals)
    .values({ workspace_id: workspaceId, goal, cadence: normGoalCadence(input.cadence), status: "active", next_run_at: new Date() });
  return { ok: true };
}

export async function updateNetworkingGoal(
  workspaceId: string,
  id: string,
  patch: { status?: NetworkingGoalStatus; cadence?: NetworkingGoalCadence },
): Promise<{ ok: boolean; error?: string }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.status) set.status = normGoalStatus(patch.status);
  if (patch.cadence) set.cadence = normGoalCadence(patch.cadence);
  const [row] = await db
    .update(networkingGoals)
    .set(set)
    .where(and(eq(networkingGoals.workspace_id, workspaceId), eq(networkingGoals.id, id)))
    .returning();
  return row ? { ok: true } : { ok: false, error: "Goal not found." };
}

export async function deleteNetworkingGoal(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(networkingGoals).where(and(eq(networkingGoals.workspace_id, workspaceId), eq(networkingGoals.id, id)));
  return { ok: true };
}

/** Work a goal once: find the next 1-2 people and spawn a researched + Hunter-resolved
 *  target/plan for each (approve-first — the founder reviews + begins). */
export async function runNetworkingGoal(
  workspaceId: string,
  goalId: string,
): Promise<{ ok: boolean; created: number; error?: string }> {
  const [goal] = await db
    .select()
    .from(networkingGoals)
    .where(and(eq(networkingGoals.workspace_id, workspaceId), eq(networkingGoals.id, goalId)))
    .limit(1);
  if (!goal) return { ok: false, created: 0, error: "Goal not found." };
  // Claim the slot up front (bump last/next run) so overlapping cron ticks never double-run.
  const now = new Date();
  await db
    .update(networkingGoals)
    .set({ last_run_at: now, next_run_at: new Date(now.getTime() + cadenceMs(goal.cadence)), updated_at: now })
    .where(eq(networkingGoals.id, goalId));
  try {
    const [[brief], network, existing] = await Promise.all([
      db
        .select({ company: businessBriefs.company_name, desc: businessBriefs.business_description })
        .from(businessBriefs)
        .where(eq(businessBriefs.workspace_id, workspaceId))
        .limit(1),
      gatherNetwork(workspaceId),
      db
        .select({ who: networkingTargets.who })
        .from(networkingTargets)
        .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.goal_id, goalId))),
    ]);
    const avoid = existing.map((e) => e.who).filter(Boolean).slice(0, 40);
    const people = await findGoalPeople({
      goal: goal.goal,
      company: brief?.company ?? "",
      companyDescription: brief?.desc ?? "",
      network,
      avoid,
    });
    let created = 0;
    for (const p of people) {
      if (avoid.some((a) => a.toLowerCase() === p.who.toLowerCase())) continue;
      const res = await createNetworkingTarget(workspaceId, { who: p.who, context: `${p.why}\n\n(Goal: ${goal.goal})` }, goalId);
      if (res.ok) {
        await buildNetworkingPlan(workspaceId, res.target.id); // research + Hunter, approve-first
        created += 1;
      }
    }
    return { ok: true, created };
  } catch (e) {
    return { ok: false, created: 0, error: e instanceof Error ? e.message : "Couldn't work the goal." };
  }
}

/** Cron sweep — work active goals whose cadence is due, across all workspaces. */
export async function advanceDueNetworkingGoals(limit = 3): Promise<{ ran: number; created: number }> {
  const now = new Date();
  // tenant-scope-exempt: cron flushing DUE goals across ALL workspaces; each goal row
  // carries its own workspace_id and runNetworkingGoal re-scopes every read/write to it.
  const due = await db
    .select({ id: networkingGoals.id, workspace_id: networkingGoals.workspace_id })
    .from(networkingGoals)
    .where(and(eq(networkingGoals.status, "active"), or(isNull(networkingGoals.next_run_at), lte(networkingGoals.next_run_at, now))))
    .orderBy(asc(networkingGoals.next_run_at))
    .limit(limit);
  let ran = 0;
  let created = 0;
  for (const g of due) {
    const r = await runNetworkingGoal(g.workspace_id, g.id);
    ran += 1;
    created += r.created;
  }
  return { ran, created };
}

/* --------------------- background: the daily calendar hour --------------------- */

/** Today's date (YYYY-MM-DD) as it reads in the given IANA timezone. */
function localDateInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Book the recurring daily 1-hour "Network expansion" block on the owner's Google Calendar. */
export async function bookNetworkingBlock(workspaceId: string, hour = 9): Promise<{ ok: boolean; error?: string }> {
  const [brief] = await db
    .select({ tz: businessBriefs.timezone, existing: businessBriefs.networking_block_event_id })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  if (brief?.existing) return { ok: true }; // already booked
  const token = await getValidAccessToken(workspaceId, "Google Calendar", null);
  if (!token) return { ok: false, error: "Connect Google Calendar first (Integrations), then try again." };
  const tz = brief?.tz || "America/New_York";
  const h = Math.min(Math.max(Math.round(hour), 0), 22);
  const date = localDateInTz(tz);
  const startISO = `${date}T${String(h).padStart(2, "0")}:00:00`;
  const endISO = `${date}T${String(h + 1).padStart(2, "0")}:00:00`;
  try {
    const ev = await createCalendarEvent(token, {
      summary: "Network expansion",
      description:
        "Your daily hour to expand your network: review the networking plans the agent prepped and send the intros you like. (Operator · Networking)",
      startISO,
      endISO,
      timeZone: tz,
      recurrence: ["RRULE:FREQ=DAILY"],
    });
    await db
      .update(businessBriefs)
      .set({ networking_block_event_id: ev.id, updated_at: new Date() })
      .where(eq(businessBriefs.workspace_id, workspaceId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't book the calendar block." };
  }
}

/** Cancel the recurring block (deletes the Google event + clears the stored id). */
export async function cancelNetworkingBlock(workspaceId: string): Promise<{ ok: boolean }> {
  const [brief] = await db
    .select({ id: businessBriefs.networking_block_event_id })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  if (brief?.id) {
    const token = await getValidAccessToken(workspaceId, "Google Calendar", null);
    if (token) {
      try {
        await deleteCalendarEvent(token, brief.id);
      } catch {
        /* event may already be gone — clear our pointer regardless */
      }
    }
    await db
      .update(businessBriefs)
      .set({ networking_block_event_id: null, updated_at: new Date() })
      .where(eq(businessBriefs.workspace_id, workspaceId));
  }
  return { ok: true };
}

/** The background panel's data: standing goals + whether the daily hour is booked. */
export async function getNetworkingBackground(workspaceId: string): Promise<NetworkingBackground> {
  const [goals, [brief]] = await Promise.all([
    listNetworkingGoals(workspaceId),
    db
      .select({ id: businessBriefs.networking_block_event_id })
      .from(businessBriefs)
      .where(eq(businessBriefs.workspace_id, workspaceId))
      .limit(1),
  ]);
  return { goals, blockBooked: Boolean(brief?.id) };
}
