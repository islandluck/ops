import "server-only";

import { createSeedState } from "@/lib/seed";
import {
  agents as agentsT,
  approvalDecisions as decisionsT,
  activityEvents as activityT,
  businessBriefs as briefsT,
  executionRuns as runsT,
  integrations as integrationsT,
  taskAssets as assetsT,
  tasks as tasksT,
} from "./schema";

type InsertBrief = typeof briefsT.$inferInsert;
type InsertAgent = typeof agentsT.$inferInsert;
type InsertIntegration = typeof integrationsT.$inferInsert;
type InsertTask = typeof tasksT.$inferInsert;
type InsertAsset = typeof assetsT.$inferInsert;
type InsertDecision = typeof decisionsT.$inferInsert;
type InsertRun = typeof runsT.$inferInsert;
type InsertActivity = typeof activityT.$inferInsert;

export interface SeedRows {
  brief: InsertBrief;
  agents: InsertAgent[];
  integrations: InsertIntegration[];
  tasks: InsertTask[];
  assets: InsertAsset[];
  decisions: InsertDecision[];
  runs: InsertRun[];
  activity: InsertActivity[];
}

const uid = () => crypto.randomUUID();
const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/**
 * Build a fresh, alive workspace from the rich demo seed — re-keyed to real
 * UUIDs and scoped to the given workspace. Reused for every new sign-up so the
 * board feels immediately real, then personalised during onboarding.
 */
export function buildSeedRows(
  workspaceId: string,
  companyName: string,
  now: number,
): SeedRows {
  const seed = createSeedState(now);

  const agentIds = new Map(seed.agents.map((a) => [a.id, uid()]));
  const taskIds = new Map(seed.tasks.map((t) => [t.id, uid()]));

  const brief: InsertBrief = {
    id: uid(),
    workspace_id: workspaceId,
    company_name: companyName || seed.brief.company_name,
    website_url: seed.brief.website_url,
    business_description: seed.brief.business_description,
    core_offer: seed.brief.core_offer,
    ideal_customer_profile: seed.brief.ideal_customer_profile,
    goals: seed.brief.goals,
    voice_rules: seed.brief.voice_rules,
    restricted_phrases: seed.brief.restricted_phrases,
    approval_rules: seed.brief.approval_rules,
    budget_limits: seed.brief.budget_limits,
    working_hours: seed.brief.working_hours,
    timezone: seed.brief.timezone,
    connected_systems: seed.brief.connected_systems,
    updated_at: new Date(now),
  };

  const agents: InsertAgent[] = seed.agents.map((a) => ({
    id: agentIds.get(a.id)!,
    workspace_id: workspaceId,
    name: a.name,
    category: a.category,
    status: a.status,
    permissions_mode: a.permissions_mode,
    description: a.description,
    last_run_at: new Date(a.last_run_at),
    tasks_prepared: a.tasks_prepared,
  }));

  const integrations: InsertIntegration[] = seed.integrations.map((i) => ({
    id: uid(),
    workspace_id: workspaceId,
    name: i.name,
    provider: i.provider,
    category: i.category,
    connected: i.connected,
    account: i.account ?? null,
    permission_mode: i.permission_mode,
    optional: i.optional,
  }));

  const tasks: InsertTask[] = seed.tasks.map((t) => ({
    id: taskIds.get(t.id)!,
    workspace_id: workspaceId,
    category: t.category,
    title: t.title,
    description: t.description,
    rationale: t.rationale,
    status: t.status,
    risk_level: t.risk_level,
    priority: t.priority,
    due_at: date(t.due_at),
    agent_id: agentIds.get(t.agent_id) ?? null,
    created_by_type: t.created_by_type,
    requires_approval: t.requires_approval,
    approval_status: t.approval_status,
    execution_status: t.execution_status,
    affected_systems: t.affected_systems,
    proposed_actions: t.proposed_actions,
    impact_score: t.impact_score,
    created_at: new Date(t.created_at),
    updated_at: new Date(t.updated_at),
  }));

  const assets: InsertAsset[] = seed.tasks.flatMap((t) =>
    t.assets.map((a) => ({
      id: uid(),
      task_id: taskIds.get(t.id)!,
      asset_type: a.asset_type,
      title: a.title,
      content: a.content,
      metadata: a.metadata ?? null,
    })),
  );

  const decisions: InsertDecision[] = seed.decisions.map((d) => ({
    id: uid(),
    task_id: taskIds.get(d.task_id)!,
    decided_by: d.decided_by,
    decision_type: d.decision_type,
    comment: d.comment ?? null,
    created_at: new Date(d.created_at),
  }));

  const runs: InsertRun[] = seed.runs.map((r) => ({
    id: uid(),
    task_id: taskIds.get(r.task_id)!,
    started_at: new Date(r.started_at),
    completed_at: date(r.completed_at),
    status: r.status,
    error_message: r.error_message ?? null,
    affected_systems: r.affected_systems,
    result_summary: r.result_summary ?? null,
    steps: r.steps,
  }));

  const activity: InsertActivity[] = seed.activity.map((e) => ({
    id: uid(),
    workspace_id: workspaceId,
    task_id: e.task_id ? (taskIds.get(e.task_id) ?? null) : null,
    event_type: e.event_type,
    actor_type: e.actor_type,
    actor_id: agentIds.get(e.actor_id) ?? e.actor_id,
    summary: e.summary,
    metadata: e.metadata ?? null,
    created_at: new Date(e.created_at),
  }));

  return { brief, agents, integrations, tasks, assets, decisions, runs, activity };
}
