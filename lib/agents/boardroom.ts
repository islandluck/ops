import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  boardAlerts,
  boardContributions,
  boardMembers,
  boardSessions,
  boardSettings,
  businessBriefs,
  executiveMemory,
} from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { computeKpis } from "@/lib/executive/kpis";
import { researchTopics } from "@/lib/ai/research";
import { runWithUsage } from "@/lib/ai/usage";
import { boardOpening, boardRebuttal, boardScan, boardVerdict } from "@/lib/ai/board";
import type {
  BoardAlert,
  BoardAlertStatus,
  BoardCadence,
  BoardContribution,
  BoardMember,
  BoardRecommendation,
  BoardRole,
  BoardSession,
  BoardSessionStatus,
  BoardSessionSummary,
  BoardSettings,
  BoardroomView,
} from "@/lib/types";

/**
 * The Boardroom engine. A standing board of VC-caliber AI advisors convenes on a
 * matter, deliberates in three stepped stages (openings → rebuttal round → the
 * Chair's verdict), and holds the founder accountable to one mission: $10B, fast,
 * biased to action. Each stage is a bounded pass so the UI can reveal the debate
 * as it unfolds.
 */

interface SeedMember {
  role: BoardRole;
  name: string;
  emoji: string;
  accent: string;
  mandate: string;
}

/** The default 5-seat board. Each mandate encodes a blue-chip VC domain lens. */
const DEFAULT_MEMBERS: SeedMember[] = [
  {
    role: "finance",
    name: "Diana Osei",
    emoji: "💰",
    accent: "emerald",
    mandate:
      "You are a top-tier venture CFO and capital allocator. You own unit economics, burn, runway, capital efficiency, the concrete milestone-and-valuation math to $10B, and fundraising strategy. You are ruthless about the numbers and allergic to vanity metrics. If the model doesn't math to $10B, you say so plainly.",
  },
  {
    role: "marketing",
    name: "Marcus Vale",
    emoji: "📣",
    accent: "amber",
    mandate:
      "You are a legendary growth and go-to-market partner. You own distribution as the real moat, CAC:LTV, channel economics, category creation, and demand. You believe most startups die of no distribution, not bad product, and you push relentlessly on how this company actually reaches $10B worth of customers.",
  },
  {
    role: "product",
    name: "Priya Rao",
    emoji: "🧩",
    accent: "violet",
    mandate:
      "You are a revered product partner. You own product-market fit, activation and retention, the wedge, and ruthless focus. You kill features, chase the one thing customers can't live without, and do things that don't scale before scaling. Retention is your religion.",
  },
  {
    role: "strategy",
    name: "Elena Voss",
    emoji: "♟️",
    accent: "sky",
    mandate:
      "You are a sharp strategy partner. You own moats, timing and 'why now', TAM, competitive positioning, and the sequence of markets to own. You think three moves ahead and force clarity on what makes this a $10B company versus a merely nice business.",
  },
  {
    role: "technology",
    name: "Kenji Tan",
    emoji: "⚙️",
    accent: "rose",
    mandate:
      "You are a battle-tested technical partner. You own technical moat and leverage, AI as an unfair advantage, scalability, engineering velocity, and build-vs-buy. You judge whether the tech compounds into defensibility or is just table stakes — and whether the team ships fast enough to win.",
  },
];

const ROLE_LABEL: Record<string, string> = {
  finance: "Finance",
  marketing: "Marketing",
  product: "Product",
  strategy: "Strategy",
  technology: "Technology",
  chair: "Chair",
  custom: "Advisor",
};

/* -------------------------------- members --------------------------------- */

function toMember(r: typeof boardMembers.$inferSelect): BoardMember {
  return {
    id: r.id,
    role: r.role as BoardRole,
    name: r.name,
    mandate: r.mandate,
    emoji: r.emoji,
    accent: r.accent,
    seat: r.seat,
    active: r.active,
  };
}

/** The workspace's board — lazily seeded with the default 5 seats on first use. */
export async function getBoardMembers(workspaceId: string): Promise<BoardMember[]> {
  const rows = await db
    .select()
    .from(boardMembers)
    .where(eq(boardMembers.workspace_id, workspaceId))
    .orderBy(asc(boardMembers.seat));
  if (rows.length) return rows.map(toMember);

  const now = new Date();
  const seed = DEFAULT_MEMBERS.map((m, i) => ({
    id: randomUUID(),
    workspace_id: workspaceId,
    role: m.role,
    name: m.name,
    mandate: m.mandate,
    emoji: m.emoji,
    accent: m.accent,
    seat: i,
    active: true,
    created_at: now,
    updated_at: now,
  }));
  await db.insert(boardMembers).values(seed);
  return seed.map(toMember);
}

/* -------------------------------- context --------------------------------- */

async function companyName(workspaceId: string): Promise<string> {
  const [b] = await db
    .select({ name: businessBriefs.company_name })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  return b?.name ?? "";
}

/** Assemble the company + market picture the whole board reasons over. */
async function buildBoardContext(workspaceId: string, question: string): Promise<string> {
  const { brief } = await getPlanningContext(workspaceId);
  const kpis = await computeKpis(workspaceId).catch(() => []);

  const parts: string[] = [];
  parts.push(`Company: ${brief.company_name || "(unnamed)"}`);
  if (brief.business_description) parts.push(`What we do: ${brief.business_description}`);
  if (brief.core_offer) parts.push(`Core offer: ${brief.core_offer}`);
  if (brief.ideal_customer_profile) parts.push(`Ideal customer: ${brief.ideal_customer_profile}`);
  if (brief.company_context) parts.push(`Company understanding (Deep Dive): ${brief.company_context.slice(0, 1500)}`);
  if (brief.crm_context) parts.push(`Pipeline / CRM: ${brief.crm_context.slice(0, 800)}`);

  if (kpis.length) {
    parts.push(
      "Current KPIs:\n" +
        kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}`).join("\n"),
    );
  }

  // Live market intel so the board reasons about today's landscape, not a guess.
  const query =
    `${brief.business_description || brief.company_name} — competitors, market size, funding, valuations, recent moves`.slice(
      0,
      380,
    );
  const research = await researchTopics(query).catch(() => null);
  if (research?.answer) {
    const srcs = research.sources
      .slice(0, 5)
      .map((s) => `• ${s.title}`)
      .join("\n");
    parts.push(`Market intel (today):\n${research.answer.slice(0, 1500)}${srcs ? `\nSources:\n${srcs}` : ""}`);
  }

  return parts.join("\n\n").slice(0, 9000);
}

/* ------------------------------ deliberation ------------------------------ */

/** Convene the board on a matter — assemble context, create the session. The
 *  client then drives advanceBoard() through the stages. */
export async function conveneBoard(
  workspaceId: string,
  question: string,
  trigger: "user" | "assessment" | "research" = "user",
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const q = question.trim();
  if (!q) return { ok: false, error: "Put a matter before the board." };
  await getBoardMembers(workspaceId); // ensure the board exists
  const context = await buildBoardContext(workspaceId, q);
  const id = randomUUID();
  await db.insert(boardSessions).values({
    id,
    workspace_id: workspaceId,
    title: q.slice(0, 200),
    trigger,
    status: "opening_pending",
    context,
    created_at: new Date(),
  });
  return { ok: true, id };
}

async function contributionsFor(
  workspaceId: string,
  sessionId: string,
  round: string,
): Promise<{ name: string; role: string; content: string }[]> {
  const rows = await db
    .select()
    .from(boardContributions)
    .where(
      and(
        eq(boardContributions.workspace_id, workspaceId),
        eq(boardContributions.session_id, sessionId),
        eq(boardContributions.round, round),
      ),
    )
    .orderBy(asc(boardContributions.seq));
  return rows.map((r) => ({ name: r.member_name, role: ROLE_LABEL[r.member_role] ?? r.member_role, content: r.content }));
}

async function fail(sessionId: string, error: string): Promise<void> {
  await db.update(boardSessions).set({ status: "failed", error }).where(eq(boardSessions.id, sessionId));
}

/** Run the session's CURRENT stage and advance the status. Returns the session. */
export async function advanceBoard(
  workspaceId: string,
  sessionId: string,
): Promise<{ ok: true; session: BoardSession } | { ok: false; error: string }> {
  const [s] = await db
    .select()
    .from(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)))
    .limit(1);
  if (!s) return { ok: false, error: "Session not found." };
  if (s.status === "complete" || s.status === "failed") {
    return { ok: true, session: await getBoardSession(workspaceId, sessionId) };
  }

  return runWithUsage(workspaceId, "boardroom", async () => {
    try {
      const members = (await getBoardMembers(workspaceId)).filter((m) => m.active);
      const company = await companyName(workspaceId);
      const now = new Date();

      if (s.status === "opening_pending") {
        const results = await Promise.allSettled(
          members.map((m) =>
            boardOpening({ member: { name: m.name, role: ROLE_LABEL[m.role] ?? m.role, mandate: m.mandate }, company, context: s.context, question: s.title }),
          ),
        );
        const rows = members
          .map((m, i) => ({ m, r: results[i] }))
          .filter((x) => x.r.status === "fulfilled" && (x.r as PromiseFulfilledResult<string>).value.trim())
          .map((x) => ({
            id: randomUUID(),
            session_id: sessionId,
            workspace_id: workspaceId,
            member_id: x.m.id,
            member_name: x.m.name,
            member_role: x.m.role,
            member_emoji: x.m.emoji,
            round: "opening",
            content: (x.r as PromiseFulfilledResult<string>).value.trim(),
            seq: x.m.seat,
            created_at: now,
          }));
        if (!rows.length) {
          await fail(sessionId, "The board couldn't open — try again.");
          return { ok: false as const, error: "The board couldn't open — try again." };
        }
        await db.insert(boardContributions).values(rows);
        await db.update(boardSessions).set({ status: "rebuttal_pending" }).where(eq(boardSessions.id, sessionId));
      } else if (s.status === "rebuttal_pending") {
        const openings = await contributionsFor(workspaceId, sessionId,"opening");
        const results = await Promise.allSettled(
          members.map((m) =>
            boardRebuttal({
              member: { name: m.name, role: ROLE_LABEL[m.role] ?? m.role, mandate: m.mandate },
              company,
              context: s.context,
              question: s.title,
              openings,
            }),
          ),
        );
        const rows = members
          .map((m, i) => ({ m, r: results[i] }))
          .filter((x) => x.r.status === "fulfilled" && (x.r as PromiseFulfilledResult<string>).value.trim())
          .map((x) => ({
            id: randomUUID(),
            session_id: sessionId,
            workspace_id: workspaceId,
            member_id: x.m.id,
            member_name: x.m.name,
            member_role: x.m.role,
            member_emoji: x.m.emoji,
            round: "rebuttal",
            content: (x.r as PromiseFulfilledResult<string>).value.trim(),
            seq: x.m.seat,
            created_at: now,
          }));
        if (rows.length) await db.insert(boardContributions).values(rows);
        await db.update(boardSessions).set({ status: "verdict_pending" }).where(eq(boardSessions.id, sessionId));
      } else if (s.status === "verdict_pending") {
        const openings = await contributionsFor(workspaceId, sessionId,"opening");
        const rebuttals = await contributionsFor(workspaceId, sessionId,"rebuttal");
        const v = await boardVerdict({ company, context: s.context, question: s.title, openings, rebuttals });
        await db
          .update(boardSessions)
          .set({
            status: "complete",
            verdict: v.verdict,
            disagreements: v.disagreements,
            recommendations: v.recommendations,
            accountability: v.accountability,
            completed_at: new Date(),
          })
          .where(eq(boardSessions.id, sessionId));
      }

      return { ok: true as const, session: await getBoardSession(workspaceId, sessionId) };
    } catch (e) {
      const error = e instanceof Error ? e.message : "The board hit a snag.";
      await fail(sessionId, error);
      return { ok: false as const, error };
    }
  });
}

/* --------------------------------- reads ---------------------------------- */

function toContribution(r: typeof boardContributions.$inferSelect): BoardContribution {
  return {
    id: r.id,
    member_id: r.member_id,
    member_name: r.member_name,
    member_role: r.member_role as BoardRole,
    member_emoji: r.member_emoji,
    round: r.round as BoardContribution["round"],
    content: r.content,
    seq: r.seq,
  };
}

export async function getBoardSession(workspaceId: string, sessionId: string): Promise<BoardSession> {
  const [s] = await db
    .select()
    .from(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)))
    .limit(1);
  const contributions = s
    ? (
        await db
          .select()
          .from(boardContributions)
          .where(
            and(eq(boardContributions.workspace_id, workspaceId), eq(boardContributions.session_id, sessionId)),
          )
          .orderBy(asc(boardContributions.seq))
      ).map(toContribution)
    : [];
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  return {
    id: s?.id ?? sessionId,
    title: s?.title ?? "",
    trigger: (s?.trigger as BoardSession["trigger"]) ?? "user",
    status: (s?.status as BoardSessionStatus) ?? "failed",
    verdict: s?.verdict ?? "",
    disagreements: (s?.disagreements ?? []) as string[],
    recommendations: (s?.recommendations ?? []) as BoardRecommendation[],
    accountability: s?.accountability ?? "",
    contributions,
    error: s?.error ?? "",
    created_at: iso(s?.created_at) ?? new Date().toISOString(),
    completed_at: iso(s?.completed_at),
  };
}

export async function listBoardSessions(workspaceId: string, limit = 20): Promise<BoardSessionSummary[]> {
  const rows = await db
    .select({
      id: boardSessions.id,
      title: boardSessions.title,
      status: boardSessions.status,
      created_at: boardSessions.created_at,
    })
    .from(boardSessions)
    .where(eq(boardSessions.workspace_id, workspaceId))
    .orderBy(desc(boardSessions.created_at))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as BoardSessionStatus,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

/* -------------------------------- settings -------------------------------- */

const CADENCE_MS: Record<BoardCadence, number> = {
  off: Infinity,
  daily: 24 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
};

/** The workspace's autonomous-scan settings — lazily created (default daily). */
export async function getBoardSettings(workspaceId: string): Promise<BoardSettings> {
  const [row] = await db
    .select()
    .from(boardSettings)
    .where(eq(boardSettings.workspace_id, workspaceId))
    .limit(1);
  if (row) {
    return {
      cadence: row.cadence as BoardCadence,
      last_scan_at: row.last_scan_at ? new Date(row.last_scan_at).toISOString() : null,
    };
  }
  const now = new Date();
  await db
    .insert(boardSettings)
    .values({ id: randomUUID(), workspace_id: workspaceId, cadence: "daily", created_at: now, updated_at: now });
  return { cadence: "daily", last_scan_at: null };
}

export async function setBoardCadence(workspaceId: string, cadence: BoardCadence): Promise<{ ok: true }> {
  await getBoardSettings(workspaceId);
  await db
    .update(boardSettings)
    .set({ cadence, updated_at: new Date() })
    .where(eq(boardSettings.workspace_id, workspaceId));
  return { ok: true };
}

/* --------------------------------- alerts --------------------------------- */

function toAlert(r: typeof boardAlerts.$inferSelect): BoardAlert {
  return {
    id: r.id,
    member_id: r.member_id,
    member_name: r.member_name,
    member_role: r.member_role as BoardRole,
    member_emoji: r.member_emoji,
    severity: r.severity as BoardAlert["severity"],
    title: r.title,
    detail: r.detail,
    suggested_action: r.suggested_action,
    status: r.status as BoardAlertStatus,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listBoardAlerts(workspaceId: string, limit = 20): Promise<BoardAlert[]> {
  const rows = await db
    .select()
    .from(boardAlerts)
    .where(and(eq(boardAlerts.workspace_id, workspaceId), inArray(boardAlerts.status, ["new", "read", "actioned"])))
    .orderBy(desc(boardAlerts.created_at))
    .limit(limit);
  return rows.map(toAlert);
}

export async function unreadBoardAlertCount(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ id: boardAlerts.id })
    .from(boardAlerts)
    .where(and(eq(boardAlerts.workspace_id, workspaceId), eq(boardAlerts.status, "new")));
  return rows.length;
}

export async function setAlertStatus(
  workspaceId: string,
  id: string,
  status: BoardAlertStatus,
): Promise<{ ok: true }> {
  await db
    .update(boardAlerts)
    .set({ status, ...(status === "read" ? { read_at: new Date() } : {}) })
    .where(and(eq(boardAlerts.workspace_id, workspaceId), eq(boardAlerts.id, id)));
  return { ok: true };
}

export async function markAllAlertsRead(workspaceId: string): Promise<{ ok: true }> {
  await db
    .update(boardAlerts)
    .set({ status: "read", read_at: new Date() })
    .where(and(eq(boardAlerts.workspace_id, workspaceId), eq(boardAlerts.status, "new")));
  return { ok: true };
}

/* ------------------------------- autonomous ------------------------------- */

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** One autonomous scan: research + reason → dedup'd alerts → brief the Executive. */
export async function runBoardScan(workspaceId: string): Promise<{ created: number }> {
  return runWithUsage(workspaceId, "boardroom-scan", async () => {
    await getBoardSettings(workspaceId); // ensure a settings row exists
    const members = (await getBoardMembers(workspaceId)).filter((m) => m.active);
    const company = await companyName(workspaceId);
    const context = await buildBoardContext(
      workspaceId,
      "Standing market scan — what is material right now on the path to $10B?",
    );
    let scanned: Awaited<ReturnType<typeof boardScan>> = [];
    try {
      scanned = await boardScan({ company, context, roles: members.map((m) => m.role) });
    } catch {
      scanned = [];
    }
    // Always stamp the scan time (even a 0-alert scan) so cadence advances.
    const now = new Date();
    await db
      .update(boardSettings)
      .set({ last_scan_at: now, updated_at: now })
      .where(eq(boardSettings.workspace_id, workspaceId));
    if (!scanned.length) return { created: 0 };

    // Dedup against recent alerts (last 14 days) by normalized title.
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const recent = await db
      .select({ title: boardAlerts.title })
      .from(boardAlerts)
      .where(and(eq(boardAlerts.workspace_id, workspaceId), gte(boardAlerts.created_at, since)));
    const seen = new Set(recent.map((r) => normTitle(r.title)));

    const byRole = new Map(members.map((m) => [m.role, m] as const));
    const rows = scanned
      .filter((a) => !seen.has(normTitle(a.title)))
      .map((a) => {
        const m = byRole.get(a.member_role as BoardRole) ?? members[0];
        return {
          id: randomUUID(),
          workspace_id: workspaceId,
          member_id: m?.id ?? null,
          member_name: m?.name ?? "The board",
          member_role: a.member_role,
          member_emoji: m?.emoji ?? "🧑‍⚖️",
          severity: a.severity,
          title: a.title,
          detail: a.detail,
          suggested_action: a.action,
          status: "new",
          created_at: now,
        };
      });
    if (!rows.length) return { created: 0 };
    await db.insert(boardAlerts).values(rows);

    // Brief the Executive so board findings also reach the founder via the daily
    // brief + Executive chat — an unprompted hand-off to the chief of staff.
    const summary =
      `📋 The board raised ${rows.length} alert${rows.length === 1 ? "" : "s"} from its market scan:\n` +
      rows.map((r) => `• [${r.severity}] ${r.title} — ${r.detail}`).join("\n");
    await db.insert(executiveMemory).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      content: summary.slice(0, 4000),
      kind: "insight",
      source: "agent",
      pinned: false,
      created_at: now,
      updated_at: now,
    });
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: null,
      event_type: "output_created",
      actor_type: "agent",
      actor_id: "board",
      summary: `The board raised ${rows.length} alert${rows.length === 1 ? "" : "s"} from its market scan.`,
      created_at: now,
    });
    return { created: rows.length };
  });
}

/** Run a scan only if the cadence is due (used by the page-load poke + the cron). */
export async function runBoardScanIfDue(workspaceId: string): Promise<{ ran: boolean; created: number }> {
  const s = await getBoardSettings(workspaceId);
  if (s.cadence === "off") return { ran: false, created: 0 };
  const last = s.last_scan_at ? new Date(s.last_scan_at).getTime() : 0;
  if (Date.now() - last < CADENCE_MS[s.cadence]) return { ran: false, created: 0 };
  const r = await runBoardScan(workspaceId);
  return { ran: true, created: r.created };
}

/** Cron: run due autonomous scans across every workspace with a board configured. */
export async function runDueBoardScans(limit = 20): Promise<{ scanned: number; alerts: number }> {
  // tenant-scope-exempt: the scheduler sweeps board_settings across ALL workspaces;
  // each scan then runs scoped to its own workspace_id.
  const rows = await db
    .select({ ws: boardSettings.workspace_id, cadence: boardSettings.cadence, last: boardSettings.last_scan_at })
    .from(boardSettings)
    .where(ne(boardSettings.cadence, "off"))
    .limit(limit);
  let scanned = 0;
  let alerts = 0;
  for (const r of rows) {
    const last = r.last ? new Date(r.last).getTime() : 0;
    const cad = CADENCE_MS[r.cadence as BoardCadence] ?? CADENCE_MS.daily;
    if (Date.now() - last < cad) continue;
    try {
      const res = await runBoardScan(r.ws);
      scanned += 1;
      alerts += res.created;
    } catch {
      /* skip a failing workspace */
    }
  }
  return { scanned, alerts };
}

export async function getBoardroom(workspaceId: string): Promise<BoardroomView> {
  const [members, sessions, alerts, settings] = await Promise.all([
    getBoardMembers(workspaceId),
    listBoardSessions(workspaceId),
    listBoardAlerts(workspaceId),
    getBoardSettings(workspaceId),
  ]);
  return { members, sessions, alerts, settings };
}
