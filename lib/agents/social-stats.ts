import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionRuns, followerSnapshots, taskAssets, tasks } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { getFollowerCount } from "@/lib/integrations/x";
import type { SocialStats } from "@/lib/types";

/**
 * Account stats for the Social page's right rail: the live follower count (snapshotted
 * for a growth trend), account-growth-over-time, tweets sent per day, and the last 20
 * tweets that actually went out. All workspace-scoped (the X account is the workspace's).
 */

const uid = () => randomUUID();
const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const X_URL = /https?:\/\/(?:twitter\.com|x\.com)\/[^\s"')]+/i;

export async function getSocialStats(workspaceId: string): Promise<SocialStats> {
  // 1. Live follower count (+ snapshot it, at most ~twice a day, for the trend).
  const token = await getValidAccessToken(workspaceId, "X (Twitter)");
  const connected = Boolean(token);
  let followers: number | null = null;
  if (token) {
    followers = await getFollowerCount(token).catch(() => null);
    if (followers != null) {
      const [recent] = await db
        .select({ at: followerSnapshots.created_at })
        .from(followerSnapshots)
        .where(eq(followerSnapshots.workspace_id, workspaceId))
        .orderBy(desc(followerSnapshots.created_at))
        .limit(1);
      const stale = !recent || Date.now() - new Date(recent.at).getTime() > 12 * 3600 * 1000;
      if (stale) {
        await db
          .insert(followerSnapshots)
          .values({ id: uid(), workspace_id: workspaceId, project_id: null, followers })
          .catch(() => {});
      }
    }
  }

  // 2. Follower trend — latest snapshot per day (last 30 days shown).
  const snaps = await db
    .select({ at: followerSnapshots.created_at, n: followerSnapshots.followers })
    .from(followerSnapshots)
    .where(eq(followerSnapshots.workspace_id, workspaceId))
    .orderBy(asc(followerSnapshots.created_at));
  const trendByDay = new Map<string, number>();
  for (const s of snaps) trendByDay.set(dayKey(s.at), s.n);
  if (followers != null) trendByDay.set(dayKey(new Date()), followers); // keep today current
  const followerTrend = [...trendByDay.entries()]
    .map(([date, f]) => ({ date, followers: f }))
    .slice(-30);

  // 3. Tweets that actually went out (completed X tasks), newest first.
  const sentTaskRows = await db
    .select({ id: tasks.id, updated: tasks.updated_at })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspace_id, workspaceId),
        eq(tasks.execution_status, "completed"),
        sql`${"X (Twitter)"} = any(${tasks.affected_systems})`,
      ),
    )
    .orderBy(desc(tasks.updated_at))
    .limit(80);
  const ids = sentTaskRows.map((r) => r.id);

  const [assetRows, runRows] = ids.length
    ? await Promise.all([
        db
          .select({ task_id: taskAssets.task_id, content: taskAssets.content })
          .from(taskAssets)
          .where(and(inArray(taskAssets.task_id, ids), eq(taskAssets.asset_type, "social_post"))),
        db
          .select({
            task_id: executionRuns.task_id,
            completed_at: executionRuns.completed_at,
            summary: executionRuns.result_summary,
            steps: executionRuns.steps,
          })
          .from(executionRuns)
          .where(inArray(executionRuns.task_id, ids)),
      ])
    : [[], []];
  const textByTask = new Map<string, string>();
  for (const a of assetRows) if (!textByTask.has(a.task_id)) textByTask.set(a.task_id, a.content);
  const runByTask = new Map<string, { at: Date | null; url: string | null }>();
  for (const r of runRows) {
    if (runByTask.has(r.task_id)) continue;
    const blob = `${r.summary ?? ""}\n${JSON.stringify(r.steps ?? [])}`;
    runByTask.set(r.task_id, { at: r.completed_at, url: blob.match(X_URL)?.[0] ?? null });
  }

  const sent = sentTaskRows
    .map((t) => {
      const run = runByTask.get(t.id);
      const at = (run?.at ? new Date(run.at) : new Date(t.updated)).toISOString();
      return { id: t.id, text: textByTask.get(t.id) ?? "", at, url: run?.url ?? null };
    })
    .filter((s) => s.text)
    .slice(0, 20);

  // 4. Tweets per day over the last 14 days (zero-filled for a steady axis).
  const perDay = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    perDay.set(dayKey(d), 0);
  }
  for (const t of sentTaskRows) {
    const run = runByTask.get(t.id);
    const k = dayKey(run?.at ?? t.updated);
    if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const tweetsPerDay = [...perDay.entries()].map(([date, count]) => ({ date, count }));

  return { connected, followers, followerTrend, tweetsPerDay, sent };
}
