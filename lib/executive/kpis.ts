import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { followerSnapshots, orders, pages, posts, projects, tasks } from "@/lib/db/schema";
import { getHubSpotSnapshot } from "@/lib/integrations/hubspot";
import { getCrmKpis } from "@/lib/crm";
import type { ExecKpi, GoalMetric, KpiTrendSeries } from "@/lib/types";

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

/** Short label for a week bucket ending at `ms` (e.g. "8/24"). */
function weekLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * KPI history over the last `weeks` weeks, for sparklines. Cumulative metrics
 * (revenue, followers) are area charts; per-week counts (shipped) are bars. A
 * series is omitted when it has no signal, so early workspaces don't show flat
 * zero charts. All derived from real timestamped data (no snapshot table needed).
 */
export async function computeKpiTrends(workspaceId: string, weeks = 8): Promise<KpiTrendSeries[]> {
  const now = Date.now();
  const buckets: { start: number; end: number; label: string }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * WEEK;
    buckets.push({ start: end - WEEK, end, label: weekLabel(end) });
  }

  const [orderRows, snapRows, taskRows] = await Promise.all([
    db
      .select({ amount: orders.amount_cents, status: orders.status, created_at: orders.created_at })
      .from(orders)
      .where(eq(orders.workspace_id, workspaceId)),
    db
      .select({ followers: followerSnapshots.followers, created_at: followerSnapshots.created_at })
      .from(followerSnapshots)
      .where(eq(followerSnapshots.workspace_id, workspaceId)),
    db
      .select({ status: tasks.status, archived: tasks.archived, updated_at: tasks.updated_at })
      .from(tasks)
      .where(eq(tasks.workspace_id, workspaceId)),
  ]);

  const series: KpiTrendSeries[] = [];
  const pctChange = (pts: number[]): number | null => {
    const first = pts[0];
    const last = pts[pts.length - 1];
    return first > 0 ? Math.round(((last - first) / first) * 100) : null;
  };

  // Revenue — cumulative paid revenue (dollars) at each week's end.
  const paid = orderRows
    .filter((o) => o.status === "paid")
    .map((o) => ({ t: new Date(o.created_at).getTime(), a: o.amount }));
  if (paid.length) {
    const points = buckets.map((b) => ({
      label: b.label,
      value: Math.round(paid.filter((p) => p.t <= b.end).reduce((n, p) => n + p.a, 0) / 100),
    }));
    series.push({
      key: "revenue",
      label: "Revenue",
      points,
      current: money(points[points.length - 1].value * 100),
      changePct: pctChange(points.map((p) => p.value)),
      chart: "area",
    });
  }

  // Followers — latest snapshot at or before each week's end (carry forward).
  const snaps = snapRows
    .map((s) => ({ t: new Date(s.created_at).getTime(), v: s.followers }))
    .sort((a, b) => a.t - b.t);
  if (snaps.length) {
    const points = buckets.map((b) => {
      const upto = snaps.filter((s) => s.t <= b.end);
      return { label: b.label, value: upto.length ? upto[upto.length - 1].v : 0 };
    });
    series.push({
      key: "followers",
      label: "Followers",
      points,
      current: points[points.length - 1].value.toLocaleString(),
      changePct: pctChange(points.map((p) => p.value)),
      chart: "area",
    });
  }

  // Shipped — tasks completed within each week (per-week counts, not cumulative).
  const doneAt = taskRows
    .filter((t) => t.status === "done" && !t.archived)
    .map((t) => new Date(t.updated_at).getTime());
  if (doneAt.length) {
    const points = buckets.map((b) => ({
      label: b.label,
      value: doneAt.filter((t) => t >= b.start && t < b.end).length,
    }));
    series.push({
      key: "shipped",
      label: "Shipped / week",
      points,
      current: String(points[points.length - 1].value),
      changePct: null, // per-week counts read better without a % badge
      chart: "bars",
    });
  }

  return series;
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

  // CRM pipeline KPIs. The NATIVE CRM is the system of record (Operator-primary), so it
  // wins whenever it has any data; HubSpot is the fallback only for an empty native CRM.
  let crmShown = false;
  try {
    const native = await getCrmKpis(workspaceId);
    if (native.hasData) {
      crmShown = true;
      kpis.push({
        key: "pipeline",
        label: "Pipeline",
        value: money(Math.round(native.pipelineValue * 100)),
        tone: native.staleDeals > 0 ? "down" : "neutral",
        hint: `${native.openDeals} open deal${native.openDeals === 1 ? "" : "s"}${
          native.staleDeals ? `, ${native.staleDeals} going cold` : ""
        }`,
      });
      kpis.push({
        key: "new_contacts",
        label: "New contacts",
        value: String(native.newContacts7d),
        delta: native.newContacts7d > 0 ? "this week" : undefined,
        tone: native.newContacts7d > 0 ? "up" : "neutral",
        hint: native.uncontacted ? `${native.uncontacted} not yet contacted` : undefined,
      });
    }
  } catch {
    /* native CRM KPIs are additive — never break the dashboard */
  }

  // HubSpot fallback — real numbers, cached 10 min, only when the native CRM is empty.
  if (!crmShown) {
    try {
      const crm = await getHubSpotSnapshot(workspaceId);
      if (crm?.connected && crm.dealsAvailable) {
        kpis.push({
          key: "pipeline",
          label: "Pipeline",
          value: money(Math.round(crm.pipelineValue * 100)),
          tone: crm.staleDeals.length > 0 ? "down" : "neutral",
          hint: `${crm.openDeals.length} open deal${crm.openDeals.length === 1 ? "" : "s"}${
            crm.staleDeals.length ? `, ${crm.staleDeals.length} going cold` : ""
          }`,
        });
      }
      if (crm?.connected && crm.contactsAvailable) {
        kpis.push({
          key: "new_contacts",
          label: "New contacts",
          value: String(crm.newContacts7d),
          delta: crm.newContacts7d > 0 ? "this week" : undefined,
          tone: crm.newContacts7d > 0 ? "up" : "neutral",
          hint: crm.uncontacted.length ? `${crm.uncontacted.length} not yet contacted` : undefined,
        });
      }
    } catch {
      /* CRM KPIs are additive — never break the dashboard on an API hiccup */
    }
  }

  return kpis;
}
