import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, followerSnapshots, projects, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext, getXStyleProfile, saveDocument } from "@/lib/db/queries";
import { generateSocialBatch } from "@/lib/ai/social";
import { planGrowthCampaign } from "@/lib/ai/growth";
import { scheduleBulkTweets } from "./social-bulk";
import { approveScheduledPost } from "./schedule";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { getFollowerCount } from "@/lib/integrations/x";
import type { CampaignData, CampaignPost, Project, ProjectPlan } from "@/lib/types";

/**
 * Growth campaign engine — an Executive-run, finite follower-growth campaign.
 * A goal becomes a weekly cadence + theme arc (planGrowthCampaign), stored as a
 * "growth" Project. Each week (phase) is materialized here: the week's tweets are
 * generated + scheduled pending your approval, blogs are drafted, a reply target
 * is set, and follower count is snapshotted for the progress trend.
 */

const uid = () => randomUUID();
const iso = (d: Date | string) => new Date(d).toISOString();

/** Snapshot the connected X account's follower count for a campaign (best-effort). */
export async function snapshotFollowers(workspaceId: string, projectId: string): Promise<number | null> {
  const token = await getValidAccessToken(workspaceId, "X (Twitter)");
  if (!token) return null;
  const n = await getFollowerCount(token);
  if (n == null) return null;
  await db
    .insert(followerSnapshots)
    .values({ id: uid(), workspace_id: workspaceId, project_id: projectId, followers: n });
  return n;
}

export interface CreateGrowthResult {
  ok: boolean;
  projectId?: string;
  error?: string;
}

/** Plan + create a growth campaign (lands in "planning" for plan approval). */
export async function createGrowthCampaign(
  workspaceId: string,
  input: { goal: string; weeks: number; followerGoalPerWeek: number },
): Promise<CreateGrowthResult> {
  const goal = input.goal.trim();
  if (!goal) return { ok: false, error: "Describe the growth goal first." };
  const weeks = Math.max(1, Math.min(Math.round(input.weeks) || 4, 12));
  const followerGoal = Math.max(1, Math.round(input.followerGoalPerWeek) || 50);

  const { brief } = await getPlanningContext(workspaceId);
  const style = await getXStyleProfile(workspaceId);

  let plan;
  try {
    plan = await planGrowthCampaign({ goal, weeks, followerGoalPerWeek: followerGoal }, brief, style);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't plan the campaign." };
  }

  const projectPlan: ProjectPlan = {
    phases: plan.weeks.map((w, i) => ({
      title: `Week ${i + 1} — ${w.theme}`,
      summary: w.focus,
      steps: [],
    })),
    growth: { cadence: plan.cadence, follower_goal_per_week: followerGoal, weeks },
  };

  const [exec] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.tier, "executive")))
    .limit(1);

  const projectId = uid();
  const now = new Date();
  await db.insert(projects).values({
    id: projectId,
    workspace_id: workspaceId,
    goal,
    title: plan.title,
    summary: plan.summary,
    status: "planning",
    owner_kind: "executive",
    owner_agent_id: exec?.id ?? null,
    kind: "growth",
    plan: projectPlan,
    current_phase: 0,
    created_by_type: "human",
    created_at: now,
    updated_at: now,
  });
  await snapshotFollowers(workspaceId, projectId).catch(() => null);

  return { ok: true, projectId };
}

/** Materialize one campaign week: generate + schedule tweets (pending approval),
 *  draft blogs, set the reply target, snapshot followers. */
export async function materializeGrowthPhase(
  workspaceId: string,
  project: Project,
  phaseIndex: number,
): Promise<void> {
  const growth = project.plan.growth;
  if (!growth) return;
  const phase = project.plan.phases[phaseIndex];
  const theme = phase?.title ?? `Week ${phaseIndex + 1}`;
  const focus = phase?.summary ?? "";
  const now = new Date();

  await snapshotFollowers(workspaceId, project.id).catch(() => null);

  const { brief } = await getPlanningContext(workspaceId);
  const style = await getXStyleProfile(workspaceId);

  const tweetCount = Math.min(growth.cadence.tweets_per_day * 7, 35);
  const blogCount = Math.min(growth.cadence.blogs_per_week, 3);

  let pieces: Awaited<ReturnType<typeof generateSocialBatch>> = [];
  try {
    pieces = await generateSocialBatch(
      brief,
      `You're running a follower-growth campaign. This week's theme: ${theme}. Focus: ${focus}. Make the X posts genuinely high-viral-potential — strong hooks, specific, a clear point of view — in the owner's voice.`,
      null,
      { x: tweetCount, blog: blogCount },
      style,
    );
  } catch {
    pieces = [];
  }
  const tweets = pieces.filter((p) => p.channel === "x").map((p) => p.content);
  const blogs = pieces.filter((p) => p.channel === "blog");

  let scheduled = 0;
  if (tweets.length) {
    try {
      const res = await scheduleBulkTweets(
        workspaceId,
        tweets.map((t) => ({ text: t })),
        { perDay: growth.cadence.tweets_per_day },
        { name: "Growth campaign" },
        { requireApproval: true, projectId: project.id, projectPhase: phaseIndex },
      );
      scheduled = res.scheduled;
    } catch {
      /* leave it; the phase still surfaces blogs + the reply target */
    }
  }

  const [contentAgent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(
      and(
        eq(agents.workspace_id, workspaceId),
        eq(agents.category, "content"),
        eq(agents.premium, false),
        eq(agents.archived, false),
      ),
    )
    .limit(1);

  for (const blog of blogs) {
    const taskId = uid();
    await db.insert(tasks).values({
      id: taskId,
      workspace_id: workspaceId,
      category: "content",
      title: `Blog: ${blog.title}`.slice(0, 120),
      description: `Longform for the campaign — ${theme}.`,
      rationale: `${project.title} · ${theme}`.slice(0, 300),
      status: "ready",
      risk_level: "low",
      priority: "medium",
      due_at: null,
      project_id: project.id,
      project_phase: phaseIndex,
      project_step_kind: "deliverable",
      agent_id: contentAgent?.id ?? null,
      created_by_type: "agent",
      requires_approval: true,
      approval_status: "pending",
      execution_status: "none",
      affected_systems: [],
      proposed_actions: 1,
      impact_score: 45,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskAssets).values({
      id: uid(),
      task_id: taskId,
      asset_type: "document",
      title: blog.title.slice(0, 120),
      content: blog.content,
      metadata: null,
    });
    await saveDocument({
      workspaceId,
      agentId: contentAgent?.id ?? null,
      authorName: contentAgent?.name ?? "Operator",
      taskId,
      taskTitle: blog.title,
      name: blog.title,
      content: blog.content,
      folder: "Growth campaign",
      docType: "document",
    });
  }

  // Reply-cadence reminder (informational action task).
  const replyTaskId = uid();
  await db.insert(tasks).values({
    id: replyTaskId,
    workspace_id: workspaceId,
    category: "growth",
    title: `Reply to ~${growth.cadence.replies_per_day} tweets/day — ${theme}`.slice(0, 120),
    description: "The fastest growth lever this week: thoughtful replies to bigger accounts in your niche.",
    rationale: `${project.title} · ${theme}`.slice(0, 300),
    status: "ready",
    risk_level: "low",
    priority: "medium",
    due_at: null,
    project_id: project.id,
    project_phase: phaseIndex,
    project_step_kind: "action",
    agent_id: null,
    created_by_type: "agent",
    requires_approval: false,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: [],
    proposed_actions: 0,
    impact_score: 40,
    created_at: now,
    updated_at: now,
  });
  await db.insert(taskAssets).values({
    id: uid(),
    task_id: replyTaskId,
    asset_type: "checklist",
    title: "Reply cadence",
    content: `Target: ${growth.cadence.replies_per_day} thoughtful, value-add replies/day to bigger accounts in your niche.\n\nOpen Social → Reply Radar for the day's best opportunities — it drafts replies in your voice.`,
    metadata: null,
  });

  await db.insert(activityEvents).values({
    id: uid(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "agent_updated_draft",
    actor_type: "agent",
    actor_id: project.owner_agent_id ?? "sys",
    summary: `Growth campaign — ${theme}: ${scheduled} tweets scheduled (pending approval) + ${blogs.length} blog draft${blogs.length === 1 ? "" : "s"}.`,
    created_at: now,
  });
}

/** Follower trend + the campaign's scheduled X posts, for the campaign drawer. */
export async function getCampaignData(workspaceId: string, projectId: string): Promise<CampaignData> {
  const snaps = await db
    .select({ followers: followerSnapshots.followers, created_at: followerSnapshots.created_at })
    .from(followerSnapshots)
    .where(and(eq(followerSnapshots.workspace_id, workspaceId), eq(followerSnapshots.project_id, projectId)))
    .orderBy(asc(followerSnapshots.created_at));

  const rows = await db
    .select({
      id: tasks.id,
      scheduled_at: tasks.scheduled_at,
      approval_status: tasks.approval_status,
      execution_status: tasks.execution_status,
      phase: tasks.project_phase,
      title: tasks.title,
      text: taskAssets.content,
    })
    .from(tasks)
    .leftJoin(taskAssets, and(eq(taskAssets.task_id, tasks.id), eq(taskAssets.asset_type, "social_post")))
    .where(
      and(
        eq(tasks.workspace_id, workspaceId),
        eq(tasks.project_id, projectId),
        sql`${"X (Twitter)"} = any(${tasks.affected_systems})`,
      ),
    )
    .orderBy(asc(tasks.scheduled_at));

  const posts: CampaignPost[] = rows.map((r) => ({
    id: r.id,
    text: (r.text ?? r.title ?? "").trim(),
    scheduled_at: r.scheduled_at ? iso(r.scheduled_at) : null,
    approval_status: r.approval_status,
    execution_status: r.execution_status,
    phase: r.phase ?? null,
  }));

  return {
    followers: snaps.map((s) => ({ followers: s.followers, created_at: iso(s.created_at) })),
    posts,
  };
}

/** Approve every pending scheduled post in a campaign at once (keeps schedules). */
export async function approveAllCampaignPosts(
  workspaceId: string,
  projectId: string,
  actor: { name: string },
): Promise<{ approved: number }> {
  const pending = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspace_id, workspaceId),
        eq(tasks.project_id, projectId),
        eq(tasks.execution_status, "queued"),
        eq(tasks.approval_status, "pending"),
      ),
    );
  let approved = 0;
  for (const t of pending) {
    const r = await approveScheduledPost(workspaceId, t.id, actor);
    if (r.ok) approved += 1;
  }
  return { approved };
}
