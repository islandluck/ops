import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companyGoals, followerSnapshots, orders, projects, tasks } from "@/lib/db/schema";
import type { ExecNudge } from "@/lib/types";

/**
 * Proactive nudges — real-time signals the Executive Agent surfaces without being
 * asked (stale approvals, a fresh sale, stalled growth, a shipping lull, goals with
 * nothing in motion, work publishing soon). Rule-computed from live data (no AI, no
 * tokens), so they're accurate and disappear on their own once the condition clears.
 */

const DAY = 24 * 60 * 60 * 1000;

function money(cents: number): string {
  const d = cents / 100;
  return d >= 1000 ? `$${Math.round(d).toLocaleString()}` : `$${d.toFixed(d % 1 === 0 ? 0 : 2)}`;
}

export async function computeNudges(workspaceId: string): Promise<ExecNudge[]> {
  const now = Date.now();
  const weekAgo = now - 7 * DAY;

  const [taskRows, orderRows, snapRows, activeProjects, activeGoals] = await Promise.all([
    db
      .select({
        status: tasks.status,
        archived: tasks.archived,
        created_at: tasks.created_at,
        updated_at: tasks.updated_at,
        execution_status: tasks.execution_status,
        scheduled_at: tasks.scheduled_at,
      })
      .from(tasks)
      .where(eq(tasks.workspace_id, workspaceId)),
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
      .select({ kind: projects.kind })
      .from(projects)
      .where(and(eq(projects.workspace_id, workspaceId), eq(projects.status, "active"))),
    db
      .select({ id: companyGoals.id })
      .from(companyGoals)
      .where(and(eq(companyGoals.workspace_id, workspaceId), eq(companyGoals.status, "active"))),
  ]);

  const nudges: ExecNudge[] = [];
  const live = taskRows.filter((t) => !t.archived);

  // A fresh sale — the best kind of alert.
  const paidWeek = orderRows.filter((o) => o.status === "paid" && new Date(o.created_at).getTime() >= weekAgo);
  if (paidWeek.length) {
    const sum = paidWeek.reduce((n, o) => n + o.amount, 0);
    nudges.push({
      id: "sale",
      severity: "positive",
      title: `${paidWeek.length} sale${paidWeek.length === 1 ? "" : "s"} this week — ${money(sum)}`,
      detail: "Money's coming in. Worth understanding what drove it so you can do more of it.",
    });
  }

  // Approvals waiting — and especially ones that have gone stale.
  const ready = live.filter((t) => t.status === "ready");
  const stale = ready.filter((t) => now - new Date(t.created_at).getTime() > 3 * DAY);
  if (stale.length) {
    nudges.push({
      id: "stale-approvals",
      severity: "attention",
      title: `${stale.length} approval${stale.length === 1 ? "" : "s"} waiting 3+ days`,
      detail: "Work is drafted and blocked on you. Clearing these unblocks the agents.",
      href: "/approvals",
    });
  } else if (ready.length >= 3) {
    nudges.push({
      id: "approvals",
      severity: "info",
      title: `${ready.length} items ready for approval`,
      detail: "A batch is waiting for your review on the Approval Center.",
      href: "/approvals",
    });
  }

  // Follower growth stalled while a campaign is supposedly running.
  const hasGrowthCampaign = activeProjects.some((p) => p.kind === "growth");
  if (hasGrowthCampaign && snapRows.length >= 2) {
    const latest = snapRows[0].followers;
    const prior = snapRows.find((s) => new Date(s.created_at).getTime() <= weekAgo)?.followers ?? snapRows[snapRows.length - 1].followers;
    if (latest - prior <= 0) {
      nudges.push({
        id: "follower-stall",
        severity: "attention",
        title: "Follower growth has stalled",
        detail: "A growth campaign is active but the needle isn't moving. Time to rethink the cadence or content.",
        href: "/projects",
      });
    }
  }

  // Goals set, but nothing actually in motion toward them.
  if (activeGoals.length > 0 && activeProjects.length === 0) {
    nudges.push({
      id: "goals-no-motion",
      severity: "attention",
      title: "Goals set, but nothing's in motion",
      detail: `You have ${activeGoals.length} active goal${activeGoals.length === 1 ? "" : "s"} and no projects or campaigns running toward them. Ask me to spin one up.`,
    });
  }

  // A shipping lull.
  const shippedWeek = live.filter((t) => t.status === "done" && new Date(t.updated_at).getTime() >= weekAgo).length;
  if (shippedWeek === 0 && live.length > 0) {
    nudges.push({
      id: "shipping-lull",
      severity: "info",
      title: "Nothing shipped in the last 7 days",
      detail: "Momentum matters. Consider what one thing you could get out the door this week.",
    });
  }

  // Work auto-publishing soon.
  const soon = live.filter(
    (t) => t.execution_status === "queued" && t.scheduled_at && new Date(t.scheduled_at).getTime() > now && new Date(t.scheduled_at).getTime() < now + DAY,
  ).length;
  if (soon > 0) {
    nudges.push({
      id: "publishing-soon",
      severity: "info",
      title: `${soon} post${soon === 1 ? "" : "s"} auto-publish in the next 24h`,
      detail: "Scheduled work is about to go live. Cancel any from the board if plans changed.",
      href: "/social",
    });
  }

  // Sort: attention first, then positive, then info.
  const rank: Record<ExecNudge["severity"], number> = { attention: 0, positive: 1, info: 2 };
  return nudges.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Count of items that actually need action (for the sidebar badge). */
export async function countAttention(workspaceId: string): Promise<number> {
  const nudges = await computeNudges(workspaceId);
  return nudges.filter((n) => n.severity === "attention").length;
}
