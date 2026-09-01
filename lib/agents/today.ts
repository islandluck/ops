import "server-only";

import { and, asc, desc, eq, isNotNull, lt, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardAlerts, businessBriefs, emailTriage, opportunities, profiles, tasks, workspaces } from "@/lib/db/schema";
import { computeKpis } from "@/lib/executive/kpis";
import { computeNudges } from "@/lib/executive/nudges";
import { listBriefs } from "@/lib/agents/executive";
import { getTeamCalendar } from "@/lib/agents/team";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { scopeFilter } from "@/lib/access/scope";
import { notifySlack } from "@/lib/integrations/slack";
import { sendGmail } from "@/lib/integrations/google";
import type { TodayData, TodayItem } from "@/lib/types";

/**
 * The owner's "Today" hub — a single read that pulls everything needing them into
 * one prioritized surface: approvals + agent nudges + board alerts + overdue work +
 * drafted emails, plus the day's schedule, fresh opportunities, and the latest brief.
 * Pure aggregation of existing data (nudges/KPIs are rule-computed, no AI tokens).
 */
export async function getTodayData(
  workspaceId: string,
  name: string,
  scopeUserId: string | null = null,
): Promise<TodayData> {
  const now = new Date();

  // Operator Lite: a member's Today is THEIR own plane — their overdue tasks + their
  // drafted email replies + the shared calendar. Owner-only aggregates (business
  // KPIs, board alerts, Executive nudges/brief, opportunities) never reach a member.
  if (scopeUserId) {
    const [overdueRows, emailRows, calendar] = await Promise.all([
      db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspace_id, workspaceId),
            scopeFilter(tasks.member_user_id, scopeUserId),
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
        .where(
          and(
            eq(emailTriage.workspace_id, workspaceId),
            scopeFilter(emailTriage.member_user_id, scopeUserId),
            eq(emailTriage.status, "triaged"),
            ne(emailTriage.draft_reply, ""),
          ),
        )
        .limit(50),
      getTeamCalendar(workspaceId),
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
    const cutoff = now.getTime() + 3 * 86_400_000;
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const schedule = calendar
      .filter((i) => {
        const t = new Date(i.when).getTime();
        return t >= startOfToday && t < cutoff;
      })
      .slice(0, 6);
    return { name, kpis: [], needsYou, schedule, opportunities: [], brief: null, digestOn: false };
  }

  const [kpis, nudges, alertRows, oppRows, briefs, calendar, overdueRows, emailRows, cfgRows] = await Promise.all([
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
    db
      .select({ digest_cadence: businessBriefs.digest_cadence })
      .from(businessBriefs)
      .where(eq(businessBriefs.workspace_id, workspaceId))
      .limit(1),
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

  return {
    name,
    kpis,
    needsYou,
    schedule,
    opportunities: oppRows,
    brief,
    digestOn: (cfgRows[0]?.digest_cadence ?? "off") === "daily",
  };
}

/* ------------------------------ morning digest -------------------------- */

export async function setDigestCadence(workspaceId: string, cadence: "off" | "daily"): Promise<{ ok: boolean }> {
  await db
    .update(businessBriefs)
    .set({ digest_cadence: cadence === "daily" ? "daily" : "off" })
    .where(eq(businessBriefs.workspace_id, workspaceId));
  return { ok: true };
}

/** Plain-text digest body used for both Slack and email. */
function composeDigest(data: TodayData): string {
  const lines: string[] = ["☀️ Your morning brief"];
  if (data.brief?.headline) lines.push(data.brief.headline);
  lines.push("");
  if (data.needsYou.length) {
    lines.push(`Needs you (${data.needsYou.length}):`);
    for (const it of data.needsYou.slice(0, 6)) lines.push(`• ${it.title}`);
  } else {
    lines.push("Nothing needs you right now — you're clear.");
  }
  if (data.schedule.length) {
    lines.push("", "Coming up:");
    for (const s of data.schedule.slice(0, 4)) {
      const when =
        s.kind === "deadline"
          ? ""
          : ` at ${new Date(s.when).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
      lines.push(`• ${s.title}${when}`);
    }
  }
  if (data.opportunities.length) {
    lines.push(
      "",
      `${data.opportunities.length} fresh opportunit${data.opportunities.length === 1 ? "y" : "ies"} — top: ${data.opportunities[0].title}`,
    );
  }
  return lines.join("\n");
}

const DIGEST_TONE_HEX: Record<TodayItem["tone"], string> = {
  urgent: "#ef4444",
  attention: "#f59e0b",
  normal: "#0ea5e9",
  positive: "#10b981",
};
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function dayShort(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tom = new Date(today.getTime() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tom.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** A rich HTML version of the digest, with a motivational CTA back to the Today hub. */
function composeDigestHtml(data: TodayData): string {
  const url = `${(process.env.NEXT_PUBLIC_APP_URL || "https://ops-ai-launch.vercel.app").replace(/\/$/, "")}/today`;
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const needs = data.needsYou.slice(0, 8);
  const needsHtml = needs.length
    ? needs
        .map(
          (it) => `
          <div style="padding:10px 0;border-top:1px solid #f1f5f9;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${DIGEST_TONE_HEX[it.tone]};margin-right:9px;vertical-align:middle;"></span>
            <span style="font-size:14px;font-weight:600;color:#0f172a;">${escHtml(it.title)}</span>
            ${it.detail ? `<div style="margin:3px 0 0 17px;font-size:13px;line-height:1.45;color:#64748b;">${escHtml(it.detail)}</div>` : ""}
          </div>`,
        )
        .join("")
    : `<div style="padding:12px 0 4px;font-size:14px;color:#334155;">You're all caught up — nothing needs you right now.</div>`;

  const scheduleHtml = data.schedule.length
    ? `
      <div style="padding:18px 26px 2px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8;">Coming up</div>
      </div>
      <div style="padding:0 26px;">
        ${data.schedule
          .slice(0, 5)
          .map((s) => {
            const when =
              s.kind === "deadline"
                ? "Deadline"
                : new Date(s.when).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return `<div style="padding:6px 0;font-size:13px;color:#334155;"><span style="color:#94a3b8;">${dayShort(s.when)} · ${when}</span>&nbsp;&nbsp;${escHtml(s.title)}</div>`;
          })
          .join("")}
      </div>`
    : "";

  const oppHtml = data.opportunities.length
    ? `<div style="padding:16px 26px 0;font-size:13px;line-height:1.5;color:#334155;"><strong>${data.opportunities.length} fresh opportunit${data.opportunities.length === 1 ? "y" : "ies"}</strong> — top: ${escHtml(data.opportunities[0].title)}</div>`
    : "";

  return `
  <div style="background:#f6f7f9;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
      <div style="padding:22px 26px 6px;">
        <div style="font-size:20px;font-weight:700;color:#0f172a;">☀️ Your morning brief</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:2px;">${dateLabel}</div>
      </div>
      ${data.brief?.headline ? `<div style="padding:2px 26px 4px;font-size:15px;line-height:1.55;color:#334155;">${escHtml(data.brief.headline)}</div>` : ""}
      <div style="padding:16px 26px 2px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8;">Needs you${needs.length ? ` · ${data.needsYou.length}` : ""}</div>
      </div>
      <div style="padding:0 26px;">${needsHtml}</div>
      ${scheduleHtml}
      ${oppHtml}
      <div style="padding:24px 26px 26px;">
        <a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">Let&apos;s tackle this together →</a>
      </div>
      <div style="padding:14px 26px;border-top:1px solid #eef0f3;font-size:11px;color:#94a3b8;">Sent by your Operator — Chief of Staff. You can turn this off on the Today page.</div>
    </div>
  </div>`;
}

/** Send the morning digest to Slack + the owner's email (best-effort); records the send. */
export async function sendMorningDigest(workspaceId: string): Promise<{ ok: boolean; slack: boolean; email: boolean }> {
  const data = await getTodayData(workspaceId, "");
  const body = composeDigest(data);

  const slack = await notifySlack(workspaceId, body).catch(() => ({ ok: false }));
  const slackOk = !!slack.ok;

  let emailOk = false;
  try {
    const token = await getValidAccessToken(workspaceId, "Gmail");
    if (token) {
      const [owner] = await db
        .select({ email: profiles.email })
        .from(workspaces)
        .innerJoin(profiles, eq(workspaces.owner_id, profiles.id))
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (owner?.email) {
        const subject = `Your morning brief — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;
        await sendGmail(token, { to: owner.email, subject, body, html: composeDigestHtml(data) });
        emailOk = true;
      }
    }
  } catch {
    /* email is best-effort */
  }

  await db
    .update(businessBriefs)
    .set({ digest_last_sent_at: new Date() })
    .where(eq(businessBriefs.workspace_id, workspaceId));
  return { ok: slackOk || emailOk, slack: slackOk, email: emailOk };
}

/** Cron: send the digest to each opted-in workspace, at most once per calendar day. */
export async function sendDueDigests(limit = 20): Promise<{ sent: number }> {
  // tenant-scope-exempt: cron scans opted-in workspaces; each digest is then sent
  // via sendMorningDigest(workspace_id), which is workspace-scoped.
  const rows = await db
    .select({ workspace_id: businessBriefs.workspace_id, last: businessBriefs.digest_last_sent_at })
    .from(businessBriefs)
    .where(eq(businessBriefs.digest_cadence, "daily"))
    .limit(200);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let sent = 0;
  for (const r of rows) {
    if (sent >= limit) break;
    if (r.last && new Date(r.last).getTime() >= startOfToday) continue; // already sent today
    try {
      const res = await sendMorningDigest(r.workspace_id);
      if (res.ok) sent += 1;
    } catch {
      /* one workspace never blocks the rest */
    }
  }
  return { sent };
}
