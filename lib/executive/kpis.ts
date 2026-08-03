import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { followerSnapshots, orders, pages, posts, projects, tasks } from "@/lib/db/schema";
import type { ExecKpi, GoalMetric } from "@/lib/types";

/**
 * Live business KPIs for the Executive Office — computed from real workspace data
 * (paid orders, follower snapshots, shipped tasks, published content, active
 * work). Shared by the KPI strip and (later) the daily brief.
 */

const WEEK = 7 * 24 * 60 * 60 * 1000;

function money(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${Math.round(dollars).toLocaleString()}`
    : `$${dollars.toFixed(dollars % 1 === 0 ? 0 : 2)}`;
}

function tone(delta: number): "up" | "down" | "neutral" {
  return delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
}

/** Current numeric values for goal-linkable metrics (for live goal progress). */
export async function computeMetricValues(workspaceId: string): Promise<Record<GoalMetric, number>> {
  const [orderRows, snapRows] = await Promise.all([
    db
      .select({ amount: orders.amount_cents, status: orders.status })
      .from(orders)
      .where(eq(orders.workspace_id, workspaceId)),
    db
      .select({ followers: followerSnapshots.followers })
      .from(followerSnapshots)
      .where(eq(followerSnapshots.workspace_id, workspaceId))
      .orderBy(desc(followerSnapshots.created_at))
      .limit(1),
  ]);
  return {
    revenue: Math.round(orderRows.filter((o) => o.status === "paid").reduce((n, o) => n + o.amount, 0) / 100),
    followers: snapRows[0]?.followers ?? 0,
  };
}

export async function computeKpis(workspaceId: string): Promise<ExecKpi[]> {
  const now = Date.now();
  const weekAgo = now - WEEK;

  const [orderRows, snapRows, taskRows, postRows, pageRows, projectRows] = await Promise.all([
    db
      .select({ amount: orders.amount_cents, status: orders.status, created_at: orders.created_at })
      .from(orders)
      .where(eq(orders.workspace_id, workspaceId)),
    db
      .select({ followers: followerSnapshots.followers, created_at: followerSnapshots.created_at })
      .from(followerSnapshots)
      .where(eq(followerSnapshots.workspace_id, workspaceId))
      .orderBy(desc(followerSnapshots.created_at)),
    db
      .select({ status: tasks.status, archived: tasks.archived, updated_at: tasks.updated_at })
      .from(tasks)
      .where(eq(tasks.workspace_id, workspaceId)),
    db.select({ status: posts.status }).from(posts).where(eq(posts.workspace_id, workspaceId)),
    db.select({ status: pages.status }).from(pages).where(eq(pages.workspace_id, workspaceId)),
    db
      .select({ status: projects.status, kind: projects.kind })
      .from(projects)
      .where(eq(projects.workspace_id, workspaceId)),
  ]);

  const kpis: ExecKpi[] = [];

  // Revenue (paid orders) — total + this week.
  const paid = orderRows.filter((o) => o.status === "paid");
  const revenue = paid.reduce((n, o) => n + o.amount, 0);
  const revenueWeek = paid
    .filter((o) => new Date(o.created_at).getTime() >= weekAgo)
    .reduce((n, o) => n + o.amount, 0);
  kpis.push({
    key: "revenue",
    label: "Revenue",
    value: money(revenue),
    delta: revenueWeek > 0 ? `+${money(revenueWeek)} wk` : undefined,
    tone: revenueWeek > 0 ? "up" : "neutral",
    hint: `${paid.length} paid order${paid.length === 1 ? "" : "s"}`,
  });

  // Followers — latest snapshot + week-over-week.
  if (snapRows.length) {
    const latest = snapRows[0].followers;
    const prior = snapRows.find((s) => new Date(s.created_at).getTime() <= weekAgo)?.followers;
    const delta = prior != null ? latest - prior : null;
    kpis.push({
      key: "followers",
      label: "Followers",
      value: latest.toLocaleString(),
      delta: delta != null ? `${delta >= 0 ? "+" : ""}${delta.toLocaleString()} wk` : undefined,
      tone: delta != null ? tone(delta) : "neutral",
    });
  }

  // Shipped this week — completed, non-archived tasks updated in the last 7 days.
  const shippedWeek = taskRows.filter(
    (t) => t.status === "done" && !t.archived && new Date(t.updated_at).getTime() >= weekAgo,
  ).length;
  kpis.push({
    key: "shipped",
    label: "Shipped this week",
    value: String(shippedWeek),
    tone: shippedWeek > 0 ? "up" : "neutral",
    hint: "tasks completed",
  });

  // Content live — distributed posts + published pages.
  const contentLive =
    postRows.filter((p) => p.status === "distributed").length +
    pageRows.filter((p) => p.status === "published").length;
  kpis.push({ key: "content", label: "Content live", value: String(contentLive), tone: "neutral" });

  // Active initiatives — running projects + growth campaigns.
  const active = projectRows.filter((p) => p.status === "active");
  kpis.push({
    key: "initiatives",
    label: "Active initiatives",
    value: String(active.length),
    tone: "neutral",
    hint: `${active.filter((p) => p.kind === "growth").length} campaign${
      active.filter((p) => p.kind === "growth").length === 1 ? "" : "s"
    }`,
  });

  // Needs you — tasks ready for approval.
  const ready = taskRows.filter((t) => t.status === "ready" && !t.archived).length;
  kpis.push({
    key: "needs_you",
    label: "Awaiting you",
    value: String(ready),
    tone: ready > 0 ? "down" : "neutral",
    hint: "ready to approve",
  });

  return kpis;
}
