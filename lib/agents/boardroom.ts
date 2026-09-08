import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  boardAlerts,
  boardContributions,
  boardDirectives,
  boardDiscussion,
  boardMembers,
  boardSessions,
  boardSettings,
  businessBriefs,
  executiveMemory,
} from "@/lib/db/schema";
import { createPlannedTask, getPlanningContext } from "@/lib/db/queries";
import { getTeamContext } from "@/lib/agents/team";
import { createProject } from "@/lib/agents/project";
import { computeKpis } from "@/lib/executive/kpis";
import { researchTopics } from "@/lib/ai/research";
import { runWithUsage } from "@/lib/ai/usage";
import { boardDiscuss, boardOpening, boardRebuttal, boardScan, boardVerdict, buildMission } from "@/lib/ai/board";
import { DEFAULT_BOARD_MEMBERS } from "@/lib/constants";
import type {
  BoardAlert,
  BoardAlertStatus,
  BoardCadence,
  BoardContribution,
  BoardDirective,
  BoardDirectiveStatus,
  BoardDiscussionTurn,
  BoardMember,
  BoardRecommendation,
  BoardRole,
  BoardSession,
  BoardSessionStatus,
  BoardSessionSummary,
  BoardSettings,
  BoardroomView,
  Category,
} from "@/lib/types";

/**
 * The Boardroom engine. A standing board of VC-caliber AI advisors convenes on a
 * matter, deliberates in three stepped stages (openings → rebuttal round → the
 * Chair's verdict), and holds the founder accountable to one mission: $10B, fast,
 * biased to action. Each stage is a bounded pass so the UI can reveal the debate
 * as it unfolds.
 */

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
  const seed = DEFAULT_BOARD_MEMBERS.map((m, i) => ({
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

/** Seed the board during onboarding with the founder's chosen names + goal (idempotent). */
export async function seedBoardFromOnboarding(
  workspaceId: string,
  goal: string,
  members: { role: string; name: string; emoji: string }[],
): Promise<void> {
  await getBoardSettings(workspaceId); // ensure a settings row exists
  if (goal.trim()) {
    await db
      .update(boardSettings)
      .set({ mission: goal.trim().slice(0, 500), updated_at: new Date() })
      .where(eq(boardSettings.workspace_id, workspaceId));
  }
  const existing = await db
    .select({ id: boardMembers.id })
    .from(boardMembers)
    .where(eq(boardMembers.workspace_id, workspaceId))
    .limit(1);
  if (existing.length) return; // board already seeded — don't duplicate
  const now = new Date();
  const rows = DEFAULT_BOARD_MEMBERS.map((seed, i) => {
    const custom = members.find((m) => m.role === seed.role);
    return {
      id: randomUUID(),
      workspace_id: workspaceId,
      role: seed.role,
      name: (custom?.name?.trim() || seed.name).slice(0, 80),
      mandate: seed.mandate,
      emoji: (custom?.emoji?.trim() || seed.emoji).slice(0, 8),
      accent: seed.accent,
      seat: i,
      active: true,
      created_at: now,
      updated_at: now,
    };
  });
  await db.insert(boardMembers).values(rows);
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
  const teamContext = await getTeamContext(workspaceId).catch(() => "");
  if (teamContext) parts.push(`The team (capacity + who owns what):\n${teamContext}`);

  if (kpis.length) {
    parts.push(
      "Current KPIs:\n" +
        kpis.map((k) => `- ${k.label}: ${k.value}${k.delta ? ` (${k.delta})` : ""}`).join("\n"),
    );
  }

  // Prior commitments the board is tracking → so it follows up on what got done.
  const directives = await db
    .select({ title: boardDirectives.title, status: boardDirectives.status, created_at: boardDirectives.created_at })
    .from(boardDirectives)
    .where(and(eq(boardDirectives.workspace_id, workspaceId), inArray(boardDirectives.status, ["open", "in_motion"])))
    .orderBy(desc(boardDirectives.created_at))
    .limit(15);
  if (directives.length) {
    const ageDays = (d: Date) => Math.floor((Date.now() - new Date(d).getTime()) / (24 * 3600 * 1000));
    parts.push(
      "COMMITMENTS THE BOARD IS TRACKING (follow up hard on anything ignored or overdue):\n" +
        directives.map((d) => `- [${d.status}, ${ageDays(d.created_at)}d ago] ${d.title}`).join("\n"),
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
  // awaiting_founder is a deliberate pause — it advances only via respondToBoard.
  if (s.status === "complete" || s.status === "failed" || s.status === "awaiting_founder") {
    return { ok: true, session: await getBoardSession(workspaceId, sessionId) };
  }

  return runWithUsage(workspaceId, "boardroom", async () => {
    try {
      const members = (await getBoardMembers(workspaceId)).filter((m) => m.active);
      const company = await companyName(workspaceId);
      const mission = buildMission((await getBoardSettings(workspaceId)).mission);
      const now = new Date();

      if (s.status === "opening_pending") {
        const results = await Promise.allSettled(
          members.map((m) =>
            boardOpening({ member: { name: m.name, role: ROLE_LABEL[m.role] ?? m.role, mandate: m.mandate }, company, context: s.context, question: s.title, mission }),
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
              mission,
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
        // Pause for the founder to respond / correct before the board rules.
        await db.update(boardSessions).set({ status: "awaiting_founder" }).where(eq(boardSessions.id, sessionId));
      } else if (s.status === "verdict_pending") {
        const openings = await contributionsFor(workspaceId, sessionId,"opening");
        const rebuttals = await contributionsFor(workspaceId, sessionId,"rebuttal");
        const v = await boardVerdict({
          company,
          context: s.context,
          question: s.title,
          openings,
          rebuttals,
          founderInput: s.founder_input || undefined,
          mission,
        });
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

/** The founder's response to the debate — captured before the board rules so it
 *  can correct assumptions. Advances the paused session to the verdict stage. */
export async function respondToBoard(
  workspaceId: string,
  sessionId: string,
  text: string,
): Promise<{ ok: true; session: BoardSession } | { ok: false; error: string }> {
  const [s] = await db
    .select({ status: boardSessions.status })
    .from(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)))
    .limit(1);
  if (!s) return { ok: false, error: "Session not found." };
  if (s.status !== "awaiting_founder") return { ok: false, error: "The board isn't waiting on you right now." };
  await db
    .update(boardSessions)
    .set({ founder_input: text.trim().slice(0, 2000), status: "verdict_pending" })
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)));
  return { ok: true, session: await getBoardSession(workspaceId, sessionId) };
}

/** Delete a deliberation and its transcript (directives it spawned survive). */
export async function deleteBoardSession(workspaceId: string, sessionId: string): Promise<{ ok: true }> {
  await db
    .delete(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)));
  return { ok: true };
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

function toDiscussion(r: typeof boardDiscussion.$inferSelect): BoardDiscussionTurn {
  return {
    id: r.id,
    role: (r.role as BoardDiscussionTurn["role"]) ?? "founder",
    author: r.author,
    content: r.content,
    revised: r.revised,
    seq: r.seq,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function getBoardSession(workspaceId: string, sessionId: string): Promise<BoardSession> {
  const [s] = await db
    .select()
    .from(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)))
    .limit(1);
  const [contributions, discussion] = s
    ? await Promise.all([
        db
          .select()
          .from(boardContributions)
          .where(and(eq(boardContributions.workspace_id, workspaceId), eq(boardContributions.session_id, sessionId)))
          .orderBy(asc(boardContributions.seq)),
        db
          .select()
          .from(boardDiscussion)
          .where(and(eq(boardDiscussion.workspace_id, workspaceId), eq(boardDiscussion.session_id, sessionId)))
          .orderBy(asc(boardDiscussion.seq)),
      ])
    : [[], []];
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  return {
    id: s?.id ?? sessionId,
    title: s?.title ?? "",
    trigger: (s?.trigger as BoardSession["trigger"]) ?? "user",
    status: (s?.status as BoardSessionStatus) ?? "failed",
    founder_input: s?.founder_input ?? "",
    verdict: s?.verdict ?? "",
    disagreements: (s?.disagreements ?? []) as string[],
    recommendations: (s?.recommendations ?? []) as BoardRecommendation[],
    accountability: s?.accountability ?? "",
    project_id: s?.project_id ?? null,
    contributions: contributions.map(toContribution),
    discussion: discussion.map(toDiscussion),
    accepted_at: iso(s?.accepted_at),
    error: s?.error ?? "",
    created_at: iso(s?.created_at) ?? new Date().toISOString(),
    completed_at: iso(s?.completed_at),
  };
}

/**
 * Post-verdict discussion: the founder pushes back / corrects / questions the
 * verdict; the Chair responds for the board and, when the founder has surfaced a
 * genuine error or new information, revises the verdict in place. Only allowed once
 * the board has ruled and before the founder accepts (locks) it.
 */
export async function discussWithBoard(
  workspaceId: string,
  sessionId: string,
  message: string,
): Promise<{ ok: true; session: BoardSession } | { ok: false; error: string }> {
  const text = message.trim();
  if (!text) return { ok: false, error: "Write something to the board first." };
  const [s] = await db
    .select()
    .from(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)))
    .limit(1);
  if (!s) return { ok: false, error: "Session not found." };
  if (s.status !== "complete") return { ok: false, error: "The board hasn't ruled yet." };
  if (s.accepted_at) return { ok: false, error: "You've already accepted this verdict — it's final." };

  return runWithUsage(workspaceId, "boardroom", async () => {
    try {
      const [openings, rebuttals, priorThread] = await Promise.all([
        contributionsFor(workspaceId, sessionId, "opening"),
        contributionsFor(workspaceId, sessionId, "rebuttal"),
        db
          .select()
          .from(boardDiscussion)
          .where(and(eq(boardDiscussion.workspace_id, workspaceId), eq(boardDiscussion.session_id, sessionId)))
          .orderBy(asc(boardDiscussion.seq)),
      ]);
      const company = await companyName(workspaceId);
      const mission = buildMission((await getBoardSettings(workspaceId)).mission);
      const now = new Date();
      const nextSeq = priorThread.length;

      // Record the founder's turn first (so it isn't lost if the AI call fails).
      await db.insert(boardDiscussion).values({
        id: randomUUID(),
        session_id: sessionId,
        workspace_id: workspaceId,
        role: "founder",
        author: "You",
        content: text.slice(0, 4000),
        revised: false,
        seq: nextSeq,
        created_at: now,
      });

      const reply = await boardDiscuss({
        company,
        context: s.context,
        question: s.title,
        openings,
        rebuttals,
        verdict: s.verdict,
        disagreements: (s.disagreements ?? []) as string[],
        recommendations: (s.recommendations ?? []) as BoardRecommendation[],
        accountability: s.accountability,
        thread: priorThread.map((t) => ({ role: t.role as "founder" | "board", content: t.content })),
        message: text,
        mission,
      });

      await db.insert(boardDiscussion).values({
        id: randomUUID(),
        session_id: sessionId,
        workspace_id: workspaceId,
        role: "board",
        author: "The Chair",
        content: reply.reply,
        revised: reply.revised,
        seq: nextSeq + 1,
        created_at: new Date(),
      });

      // Apply a revision to the live verdict when the board changed its call.
      if (reply.revised && reply.verdict) {
        await db
          .update(boardSessions)
          .set({
            verdict: reply.verdict,
            disagreements: reply.disagreements ?? [],
            recommendations: reply.recommendations ?? [],
            accountability: reply.accountability ?? s.accountability,
          })
          .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)));
      }

      return { ok: true as const, session: await getBoardSession(workspaceId, sessionId) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "The board couldn't respond — try again." };
    }
  });
}

/** Accept the verdict as final — locks the discussion and enables the handoff. */
export async function acceptBoardVerdict(
  workspaceId: string,
  sessionId: string,
): Promise<{ ok: true; session: BoardSession } | { ok: false; error: string }> {
  const [s] = await db
    .select({ status: boardSessions.status, accepted_at: boardSessions.accepted_at })
    .from(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)))
    .limit(1);
  if (!s) return { ok: false, error: "Session not found." };
  if (s.status !== "complete") return { ok: false, error: "The board hasn't ruled yet." };
  if (!s.accepted_at) {
    await db
      .update(boardSessions)
      .set({ accepted_at: new Date() })
      .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)));
  }
  return { ok: true, session: await getBoardSession(workspaceId, sessionId) };
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
      mission: row.mission ?? "",
    };
  }
  const now = new Date();
  await db
    .insert(boardSettings)
    .values({ id: randomUUID(), workspace_id: workspaceId, cadence: "daily", created_at: now, updated_at: now });
  return { cadence: "daily", last_scan_at: null, mission: "" };
}

export async function setBoardCadence(workspaceId: string, cadence: BoardCadence): Promise<{ ok: true }> {
  await getBoardSettings(workspaceId);
  await db
    .update(boardSettings)
    .set({ cadence, updated_at: new Date() })
    .where(eq(boardSettings.workspace_id, workspaceId));
  return { ok: true };
}

/** Set the board's mission/goal (empty restores the default). */
export async function setBoardMission(workspaceId: string, mission: string): Promise<{ ok: true }> {
  await getBoardSettings(workspaceId);
  await db
    .update(boardSettings)
    .set({ mission: mission.trim().slice(0, 500), updated_at: new Date() })
    .where(eq(boardSettings.workspace_id, workspaceId));
  return { ok: true };
}

/** Edit a board member's name / emoji / mandate (persona). Role/seat stay fixed. */
export async function updateBoardMember(
  workspaceId: string,
  memberId: string,
  patch: { name?: string; emoji?: string; mandate?: string },
): Promise<{ ok: true }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.name === "string") set.name = patch.name.trim().slice(0, 80) || "Advisor";
  if (typeof patch.emoji === "string") set.emoji = patch.emoji.trim().slice(0, 8) || "🧑‍⚖️";
  if (typeof patch.mandate === "string") set.mandate = patch.mandate.trim().slice(0, 1200);
  await db
    .update(boardMembers)
    .set(set)
    .where(and(eq(boardMembers.workspace_id, workspaceId), eq(boardMembers.id, memberId)));
  return { ok: true };
}

/** Restore a member to its suggested archetype (name/emoji/mandate for its role). */
export async function resetBoardMember(
  workspaceId: string,
  memberId: string,
): Promise<{ ok: true; member: BoardMember } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.workspace_id, workspaceId), eq(boardMembers.id, memberId)))
    .limit(1);
  if (!row) return { ok: false, error: "Member not found." };
  const seed = DEFAULT_BOARD_MEMBERS.find((m) => m.role === row.role);
  if (!seed) return { ok: false, error: "No archetype for this seat." };
  await db
    .update(boardMembers)
    .set({ name: seed.name, emoji: seed.emoji, mandate: seed.mandate, accent: seed.accent, updated_at: new Date() })
    .where(and(eq(boardMembers.workspace_id, workspaceId), eq(boardMembers.id, memberId)));
  return { ok: true, member: { ...toMember(row), name: seed.name, emoji: seed.emoji, mandate: seed.mandate, accent: seed.accent } };
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
    const settings = await getBoardSettings(workspaceId); // ensures a settings row exists
    const mission = buildMission(settings.mission);
    const members = (await getBoardMembers(workspaceId)).filter((m) => m.active);
    const company = await companyName(workspaceId);
    const context = await buildBoardContext(
      workspaceId,
      "Standing market scan — what is material right now for the mission?",
    );
    let scanned: Awaited<ReturnType<typeof boardScan>> = [];
    try {
      scanned = await boardScan({ company, context, roles: members.map((m) => m.role), mission });
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

/* -------------------------- action & accountability ----------------------- */

const ROLE_CATEGORY: Record<string, Category> = {
  finance: "finance",
  marketing: "growth",
  product: "content",
  strategy: "research",
  technology: "research",
  chair: "admin",
  custom: "admin",
};

/** Hand a completed verdict to the Executive — spins up a project it will plan +
 *  execute — and records the recommendations as tracked directives. */
export async function handVerdictToExecutive(
  workspaceId: string,
  sessionId: string,
): Promise<{ ok: boolean; projectId?: string; error?: string }> {
  const [s] = await db
    .select()
    .from(boardSessions)
    .where(and(eq(boardSessions.workspace_id, workspaceId), eq(boardSessions.id, sessionId)))
    .limit(1);
  if (!s) return { ok: false, error: "Session not found." };
  if (s.status !== "complete") return { ok: false, error: "Wait for the board's verdict first." };
  if (s.project_id) return { ok: true, projectId: s.project_id };

  const recs = (s.recommendations ?? []) as BoardRecommendation[];
  const goal = [
    `Board directive: ${s.title}`,
    s.verdict ? `\n\nThe board's verdict:\n${s.verdict}` : "",
    recs.length
      ? `\n\nExecute these moves:\n${recs.map((r, i) => `${i + 1}. ${r.title}${r.detail ? ` — ${r.detail}` : ""}`).join("\n")}`
      : "",
  ]
    .join("")
    .slice(0, 6000);

  const res = await createProject(workspaceId, goal, "executive");
  if (!res.ok || !res.projectId) return { ok: false, error: res.error ?? "Couldn't start the project." };

  const now = new Date();
  await db.update(boardSessions).set({ project_id: res.projectId }).where(eq(boardSessions.id, sessionId));
  if (recs.length) {
    await db.insert(boardDirectives).values(
      recs.map((r) => ({
        id: randomUUID(),
        workspace_id: workspaceId,
        session_id: sessionId,
        title: r.title.slice(0, 200),
        detail: r.detail.slice(0, 800),
        status: "in_motion",
        project_id: res.projectId,
        created_at: now,
      })),
    );
  }
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "output_created",
    actor_type: "agent",
    actor_id: "board",
    summary: `The board's verdict on “${s.title}” was handed to the Executive as a project.`.slice(0, 300),
    created_at: now,
  });
  return { ok: true, projectId: res.projectId };
}

/** Turn a board alert into a task on the Approval Center (routes to a worker agent). */
export async function alertToTask(workspaceId: string, alertId: string): Promise<{ ok: boolean; error?: string }> {
  const [a] = await db
    .select()
    .from(boardAlerts)
    .where(and(eq(boardAlerts.workspace_id, workspaceId), eq(boardAlerts.id, alertId)))
    .limit(1);
  if (!a) return { ok: false, error: "Alert not found." };
  await createPlannedTask(
    workspaceId,
    {
      title: a.title.slice(0, 120),
      category: ROLE_CATEGORY[a.member_role] ?? "admin",
      affected_systems: [],
      risk_level: "low",
      requires_approval: true,
      rationale: `From the board (${a.member_name}): ${a.detail}`.slice(0, 1000),
      draft: a.suggested_action || a.detail,
      needs_connection: [],
    },
    { name: "The Board" },
  );
  await db.update(boardAlerts).set({ status: "actioned" }).where(eq(boardAlerts.id, alertId));
  return { ok: true };
}

function toDirective(r: typeof boardDirectives.$inferSelect): BoardDirective {
  return {
    id: r.id,
    session_id: r.session_id,
    title: r.title,
    detail: r.detail,
    status: r.status as BoardDirectiveStatus,
    project_id: r.project_id,
    created_at: new Date(r.created_at).toISOString(),
  };
}

/** The open commitments the board is tracking (for the ledger + follow-up context). */
export async function listBoardDirectives(workspaceId: string, limit = 30): Promise<BoardDirective[]> {
  const rows = await db
    .select()
    .from(boardDirectives)
    .where(and(eq(boardDirectives.workspace_id, workspaceId), inArray(boardDirectives.status, ["open", "in_motion"])))
    .orderBy(desc(boardDirectives.created_at))
    .limit(limit);
  return rows.map(toDirective);
}

export async function setDirectiveStatus(
  workspaceId: string,
  id: string,
  status: BoardDirectiveStatus,
): Promise<{ ok: true }> {
  await db
    .update(boardDirectives)
    .set({ status, ...(status === "done" || status === "dropped" ? { resolved_at: new Date() } : {}) })
    .where(and(eq(boardDirectives.workspace_id, workspaceId), eq(boardDirectives.id, id)));
  return { ok: true };
}

export async function getBoardroom(workspaceId: string): Promise<BoardroomView> {
  const [members, sessions, alerts, directives, settings] = await Promise.all([
    getBoardMembers(workspaceId),
    listBoardSessions(workspaceId),
    listBoardAlerts(workspaceId),
    listBoardDirectives(workspaceId),
    getBoardSettings(workspaceId),
  ]);
  return { members, sessions, alerts, directives, settings };
}
