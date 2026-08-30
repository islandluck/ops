import "server-only";

import { and, asc, desc, eq, isNotNull, lt, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardAlerts, emailTriage, opportunities, tasks } from "@/lib/db/schema";
import { computeKpis } from "@/lib/executive/kpis";
import { computeNudges } from "@/lib/executive/nudges";
import { listBriefs } from "@/lib/agents/executive";
import { getTeamCalendar } from "@/lib/agents/team";
import type { TodayData, TodayItem } from "@/lib/types";

/**
 * The owner's "Today" hub — a single read that pulls everything needing them into
 * one prioritized surface: approvals + agent nudges + board alerts + overdue work +
 * drafted emails, plus the day's schedule, fresh opportunities, and the latest brief.
 * Pure aggregation of existing data (nudges/KPIs are rule-computed, no AI tokens).
 */
export async function getTodayData(workspaceId: string, name: string): Promise<TodayData> {
  const now = new Date();
  const [kpis, nudges, alertRows, oppRows, briefs, calendar, overdueRows, emailRows] = await Promise.all([
    computeKpis(workspaceId),
    computeNudges(workspaceId),
    db
      .select({ id: boardAlerts.id, title: boardAlerts.title, detail: boardAlerts.detail, severity: boardAlerts.severity })
      .from(boardAlerts)
      .where(and(eq(boardAlerts.workspace_id, workspaceId), eq(boardAlerts.status, "new")))
      .orderBy(desc(boardAlerts.created_at))
      .limit(6),
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        org: opportunities.org,
        type: opportunities.type,
        fit_score: opportunities.fit_score,
        url: opportunities.url,
      })
      .from(opportunities)
      .where(and(eq(opportunities.workspace_id, workspaceId), eq(opportunities.status, "new")))
      .orderBy(desc(opportunities.fit_score))
      .limit(3),
    listBriefs(workspaceId, 5),
    getTeamCalendar(workspaceId),
    db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspace_id, workspaceId),
          eq(tasks.archived, false),
          ne(tasks.status, "done"),
          isNotNull(tasks.due_at),
          lt(tasks.due_at, now),
        ),
      )
      .orderBy(asc(tasks.due_at))
      .limit(20),
    db
      .select({ id: emailTriage.id })
      .from(emailTriage)
      .where(and(eq(emailTriage.workspace_id, workspaceId), eq(emailTriage.status, "triaged"), ne(emailTriage.draft_reply, "")))
      .limit(50),
  ]);

  const needsYou: TodayItem[] = [];

  if (overdueRows.length) {
    needsYou.push({
      id: "overdue",
      kind: "deadline",
      title: `${overdueRows.length} task${overdueRows.length === 1 ? "" : "s"} overdue`,
      detail: overdueRows.slice(0, 3).map((t) => t.title).join(" · "),
      href: "/approvals",
      tone: "urgent",
    });
  }
  for (const a of alertRows) {
    needsYou.push({
      id: `board-${a.id}`,
      kind: "board",
      title: a.title || "The board flagged something",
      detail: a.detail,
      href: "/boardroom",
      tone: a.severity === "urgent" ? "urgent" : "attention",
    });
  }
  for (const n of nudges) {
    needsYou.push({
      id: `nudge-${n.id}`,
      kind: "nudge",
      title: n.title,
      detail: n.detail,
      href: n.href ?? "/executive",
      tone: n.severity === "attention" ? "attention" : n.severity === "positive" ? "positive" : "normal",
    });
  }
  if (emailRows.length) {
    needsYou.push({
      id: "email-drafts",
      kind: "email",
      title: `${emailRows.length} email repl${emailRows.length === 1 ? "y" : "ies"} drafted`,
      detail: "Reviewed and ready for you to send or edit.",
      href: "/email",
      tone: "normal",
    });
  }

  const rank: Record<TodayItem["tone"], number> = { urgent: 0, attention: 1, normal: 2, positive: 3 };
  needsYou.sort((a, b) => rank[a.tone] - rank[b.tone]);

  const cutoff = now.getTime() + 3 * 86_400_000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const schedule = calendar
    .filter((i) => {
      const t = new Date(i.when).getTime();
      return t >= startOfToday && t < cutoff;
    })
    .slice(0, 6);

  const daily = briefs.find((b) => b.kind === "daily") ?? briefs[0] ?? null;
  const brief = daily ? { id: daily.id, headline: daily.content.headline, created_at: daily.created_at } : null;

  return { name, kpis, needsYou, schedule, opportunities: oppRows, brief };
}
