import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import {
  activityEvents,
  agents,
  approvalDecisions,
  businessBriefs,
  executionRuns,
  integrations,
  profiles,
  taskAssets,
  tasks,
  workspaceMembers,
  workspaces,
} from "./schema";
import { buildSeedRows } from "./seed-workspace";
import { hasAnthropicKey } from "@/lib/config";
import { isProviderConfigured, providerForIntegrationName } from "@/lib/integrations/registry";
import type {
  ActivityEvent,
  Agent,
  AppState,
  ApprovalDecision,
  BusinessBrief,
  ExecutionRun,
  Integration,
  Task,
  Workspace,
} from "@/lib/types";

const iso = (d: Date | null | undefined): string => (d ? new Date(d).toISOString() : "");
const isoN = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const uid = () => crypto.randomUUID();

/* ------------------------------------------------------------------ */
/* Provisioning + load                                                 */
/* ------------------------------------------------------------------ */

export async function workspaceIdForUser(userId: string): Promise<string | null> {
  return getWorkspaceId(userId);
}

async function getWorkspaceId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: workspaceMembers.workspace_id })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.user_id, userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Get the user's workspace, creating + seeding it on first visit. A per-user
 * Postgres advisory lock serializes concurrent first-loads so two in-flight
 * requests can't both provision (which would create duplicate workspaces).
 */
async function getOrCreateWorkspace(userId: string): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const existing = await tx
      .select({ id: workspaceMembers.workspace_id })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.user_id, userId))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const wsId = uid();
    await tx.insert(workspaces).values({ id: wsId, name: "Northwind Studio", owner_id: userId });
    await tx.insert(workspaceMembers).values({ workspace_id: wsId, user_id: userId, role: "owner" });
    const rows = buildSeedRows(wsId, "", Date.now());
    await tx.insert(businessBriefs).values(rows.brief);
    if (rows.agents.length) await tx.insert(agents).values(rows.agents);
    if (rows.integrations.length) await tx.insert(integrations).values(rows.integrations);
    if (rows.tasks.length) await tx.insert(tasks).values(rows.tasks);
    if (rows.assets.length) await tx.insert(taskAssets).values(rows.assets);
    if (rows.decisions.length) await tx.insert(approvalDecisions).values(rows.decisions);
    if (rows.runs.length) await tx.insert(executionRuns).values(rows.runs);
    if (rows.activity.length) await tx.insert(activityEvents).values(rows.activity);
    return wsId;
  });
}

async function ensureProfile(userId: string, email: string, fullName: string) {
  await db
    .insert(profiles)
    .values({ id: userId, email, full_name: fullName })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { email, ...(fullName ? { full_name: fullName } : {}) },
    });
}

/** Load (provisioning + seeding on first visit) the full workspace bundle. */
export async function loadBundleForUser(
  userId: string,
  email: string,
  fullName: string,
): Promise<AppState> {
  await ensureProfile(userId, email, fullName);
  const wsId = await getOrCreateWorkspace(userId);
  return readBundle(wsId, fullName, email);
}

async function readBundle(
  wsId: string,
  fullName: string,
  email: string,
): Promise<AppState> {
  const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  const [briefRow] = await db
    .select()
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, wsId))
    .limit(1);
  const agentRows = await db.select().from(agents).where(eq(agents.workspace_id, wsId));
  const integrationRows = await db.select().from(integrations).where(eq(integrations.workspace_id, wsId));
  const taskRows = await db.select().from(tasks).where(eq(tasks.workspace_id, wsId));
  const taskIds = taskRows.map((t) => t.id);
  const taskIdSet = new Set(taskIds);
  const assetRows = taskIds.length
    ? await db.select().from(taskAssets).where(inArray(taskAssets.task_id, taskIds))
    : [];
  const decisionRows = taskIds.length
    ? await db.select().from(approvalDecisions).where(inArray(approvalDecisions.task_id, taskIds))
    : [];
  const runRows = taskIds.length
    ? await db.select().from(executionRuns).where(inArray(executionRuns.task_id, taskIds))
    : [];
  const activityRows = await db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.workspace_id, wsId));

  const assetsByTask = new Map<string, typeof assetRows>();
  for (const a of assetRows) {
    if (!taskIdSet.has(a.task_id)) continue;
    const arr = assetsByTask.get(a.task_id) ?? [];
    arr.push(a);
    assetsByTask.set(a.task_id, arr);
  }

  const workspace: Workspace = {
    id: wsRow.id,
    name: wsRow.name,
    owner_id: wsRow.owner_id,
    plan: wsRow.plan,
    created_at: iso(wsRow.created_at),
    updated_at: iso(wsRow.updated_at),
  };

  const brief: BusinessBrief = {
    id: briefRow.id,
    workspace_id: wsId,
    company_name: briefRow.company_name,
    website_url: briefRow.website_url,
    business_description: briefRow.business_description,
    core_offer: briefRow.core_offer,
    ideal_customer_profile: briefRow.ideal_customer_profile,
    goals: briefRow.goals,
    voice_rules: briefRow.voice_rules,
    restricted_phrases: briefRow.restricted_phrases,
    approval_rules: briefRow.approval_rules,
    budget_limits: briefRow.budget_limits,
    working_hours: briefRow.working_hours,
    timezone: briefRow.timezone,
    connected_systems: briefRow.connected_systems,
    updated_at: iso(briefRow.updated_at),
  };

  const mappedAgents: Agent[] = agentRows.map((a) => ({
    id: a.id,
    workspace_id: wsId,
    name: a.name,
    category: a.category,
    status: a.status,
    permissions_mode: a.permissions_mode,
    description: a.description,
    last_run_at: iso(a.last_run_at),
    tasks_prepared: a.tasks_prepared,
  }));

  const mappedIntegrations: Integration[] = integrationRows.map((i) => {
    const prov = providerForIntegrationName(i.name);
    return {
      id: i.id,
      name: i.name,
      provider: i.provider,
      category: i.category,
      connected: i.connected,
      account: i.account ?? undefined,
      permission_mode: i.permission_mode,
      optional: i.optional,
      // Phase 3 display flags (tokens are never sent to the client).
      oauth_provider: prov?.key,
      configured: prov ? isProviderConfigured(prov) : false,
      action_label: prov?.actionLabel,
    };
  });

  const mappedTasks: Task[] = taskRows.map((t) => ({
    id: t.id,
    workspace_id: wsId,
    category: t.category,
    title: t.title,
    description: t.description,
    rationale: t.rationale,
    status: t.status,
    risk_level: t.risk_level,
    priority: t.priority,
    due_at: isoN(t.due_at),
    agent_id: t.agent_id ?? "",
    created_by_type: t.created_by_type,
    requires_approval: t.requires_approval,
    approval_status: t.approval_status,
    execution_status: t.execution_status,
    affected_systems: t.affected_systems,
    proposed_actions: t.proposed_actions,
    impact_score: t.impact_score,
    created_at: iso(t.created_at),
    updated_at: iso(t.updated_at),
    assets: (assetsByTask.get(t.id) ?? []).map((a) => ({
      id: a.id,
      task_id: a.task_id,
      asset_type: a.asset_type,
      title: a.title,
      content: a.content,
      metadata: a.metadata ?? undefined,
    })),
  }));

  const mappedDecisions: ApprovalDecision[] = decisionRows
    .filter((d) => taskIdSet.has(d.task_id))
    .map((d) => ({
      id: d.id,
      task_id: d.task_id,
      decided_by: d.decided_by,
      decision_type: d.decision_type,
      comment: d.comment ?? undefined,
      created_at: iso(d.created_at),
    }));

  const mappedRuns: ExecutionRun[] = runRows
    .filter((r) => taskIdSet.has(r.task_id))
    .map((r) => ({
      id: r.id,
      task_id: r.task_id,
      started_at: iso(r.started_at),
      completed_at: isoN(r.completed_at) ?? undefined,
      status: r.status,
      error_message: r.error_message ?? undefined,
      affected_systems: r.affected_systems,
      result_summary: r.result_summary ?? undefined,
      steps: r.steps,
    }));

  const mappedActivity: ActivityEvent[] = activityRows
    .map((e) => ({
      id: e.id,
      workspace_id: wsId,
      task_id: e.task_id ?? null,
      event_type: e.event_type,
      actor_type: e.actor_type,
      actor_id: e.actor_id,
      summary: e.summary,
      metadata: e.metadata ?? undefined,
      created_at: iso(e.created_at),
    }))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  return {
    workspace,
    brief,
    agents: mappedAgents,
    tasks: mappedTasks,
    integrations: mappedIntegrations,
    decisions: mappedDecisions,
    runs: mappedRuns,
    activity: mappedActivity,
    session: {
      authenticated: true,
      onboarded: true,
      user_name: fullName || workspace.name,
      user_email: email,
      ai_enabled: hasAnthropicKey(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Save (whole-bundle replace, scoped to the user's workspace)         */
/* ------------------------------------------------------------------ */

export async function saveBundleForUser(userId: string, state: AppState): Promise<void> {
  const wsId = await getWorkspaceId(userId);
  if (!wsId) throw new Error("No workspace for user");

  const d = (s: string | null | undefined) => (s ? new Date(s) : null);

  await db.transaction(async (tx) => {
    await tx
      .update(workspaces)
      .set({ name: state.workspace.name, plan: state.workspace.plan, updated_at: new Date() })
      .where(eq(workspaces.id, wsId));

    // Replace child rows (delete in FK-safe order, then reinsert).
    // NOTE: integrations are intentionally excluded — they hold server-only OAuth
    // tokens + connection state managed by the OAuth callback and dedicated
    // actions, and must never be clobbered by a client-driven bundle save.
    await tx.delete(activityEvents).where(eq(activityEvents.workspace_id, wsId));
    await tx.delete(agents).where(eq(agents.workspace_id, wsId));
    const wsTasks = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.workspace_id, wsId));
    for (const { id } of wsTasks) {
      await tx.delete(executionRuns).where(eq(executionRuns.task_id, id));
      await tx.delete(approvalDecisions).where(eq(approvalDecisions.task_id, id));
      await tx.delete(taskAssets).where(eq(taskAssets.task_id, id));
    }
    await tx.delete(tasks).where(eq(tasks.workspace_id, wsId));

    // Brief (upsert by workspace).
    await tx
      .update(businessBriefs)
      .set({
        company_name: state.brief.company_name,
        website_url: state.brief.website_url,
        business_description: state.brief.business_description,
        core_offer: state.brief.core_offer,
        ideal_customer_profile: state.brief.ideal_customer_profile,
        goals: state.brief.goals,
        voice_rules: state.brief.voice_rules,
        restricted_phrases: state.brief.restricted_phrases,
        approval_rules: state.brief.approval_rules,
        budget_limits: state.brief.budget_limits,
        working_hours: state.brief.working_hours,
        timezone: state.brief.timezone,
        connected_systems: state.brief.connected_systems,
        updated_at: new Date(),
      })
      .where(eq(businessBriefs.workspace_id, wsId));

    if (state.agents.length)
      await tx.insert(agents).values(
        state.agents.map((a) => ({
          id: a.id,
          workspace_id: wsId,
          name: a.name,
          category: a.category,
          status: a.status,
          permissions_mode: a.permissions_mode,
          description: a.description,
          last_run_at: d(a.last_run_at) ?? new Date(),
          tasks_prepared: a.tasks_prepared,
        })),
      );

    // (integrations deliberately not re-inserted here — see note above)

    if (state.tasks.length)
      await tx.insert(tasks).values(
        state.tasks.map((t) => ({
          id: t.id,
          workspace_id: wsId,
          category: t.category,
          title: t.title,
          description: t.description,
          rationale: t.rationale,
          status: t.status,
          risk_level: t.risk_level,
          priority: t.priority,
          due_at: d(t.due_at),
          agent_id: t.agent_id || null,
          created_by_type: t.created_by_type,
          requires_approval: t.requires_approval,
          approval_status: t.approval_status,
          execution_status: t.execution_status,
          affected_systems: t.affected_systems,
          proposed_actions: t.proposed_actions,
          impact_score: t.impact_score,
          created_at: d(t.created_at) ?? new Date(),
          updated_at: new Date(),
        })),
      );

    const assets = state.tasks.flatMap((t) =>
      t.assets.map((a) => ({
        id: a.id,
        task_id: t.id,
        asset_type: a.asset_type,
        title: a.title,
        content: a.content,
        metadata: a.metadata ?? null,
      })),
    );
    if (assets.length) await tx.insert(taskAssets).values(assets);

    if (state.decisions.length)
      await tx.insert(approvalDecisions).values(
        state.decisions.map((dec) => ({
          id: dec.id,
          task_id: dec.task_id,
          decided_by: dec.decided_by,
          decision_type: dec.decision_type,
          comment: dec.comment ?? null,
          created_at: d(dec.created_at) ?? new Date(),
        })),
      );

    if (state.runs.length)
      await tx.insert(executionRuns).values(
        state.runs.map((r) => ({
          id: r.id,
          task_id: r.task_id,
          started_at: d(r.started_at) ?? new Date(),
          completed_at: d(r.completed_at),
          status: r.status,
          error_message: r.error_message ?? null,
          affected_systems: r.affected_systems,
          result_summary: r.result_summary ?? null,
          steps: r.steps,
        })),
      );

    if (state.activity.length)
      await tx.insert(activityEvents).values(
        state.activity.map((e) => ({
          id: e.id,
          workspace_id: wsId,
          task_id: e.task_id,
          event_type: e.event_type,
          actor_type: e.actor_type,
          actor_id: e.actor_id,
          summary: e.summary,
          metadata: e.metadata ?? null,
          created_at: d(e.created_at) ?? new Date(),
        })),
      );
  });
}

/** Wipe the workspace's data and re-seed it fresh. */
export async function resetBundleForUser(
  userId: string,
  email: string,
  fullName: string,
): Promise<AppState> {
  const wsId = await getWorkspaceId(userId);
  if (!wsId) return loadBundleForUser(userId, email, fullName);

  await db.transaction(async (tx) => {
    await tx.delete(activityEvents).where(eq(activityEvents.workspace_id, wsId));
    const wsTasks = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.workspace_id, wsId));
    for (const { id } of wsTasks) {
      await tx.delete(executionRuns).where(eq(executionRuns.task_id, id));
      await tx.delete(approvalDecisions).where(eq(approvalDecisions.task_id, id));
      await tx.delete(taskAssets).where(eq(taskAssets.task_id, id));
    }
    await tx.delete(tasks).where(eq(tasks.workspace_id, wsId));
    await tx.delete(integrations).where(eq(integrations.workspace_id, wsId));
    await tx.delete(agents).where(eq(agents.workspace_id, wsId));
    await tx.delete(businessBriefs).where(eq(businessBriefs.workspace_id, wsId));

    const rows = buildSeedRows(wsId, "", Date.now());
    await tx.insert(businessBriefs).values(rows.brief);
    if (rows.agents.length) await tx.insert(agents).values(rows.agents);
    if (rows.integrations.length) await tx.insert(integrations).values(rows.integrations);
    if (rows.tasks.length) await tx.insert(tasks).values(rows.tasks);
    if (rows.assets.length) await tx.insert(taskAssets).values(rows.assets);
    if (rows.decisions.length) await tx.insert(approvalDecisions).values(rows.decisions);
    if (rows.runs.length) await tx.insert(executionRuns).values(rows.runs);
    if (rows.activity.length) await tx.insert(activityEvents).values(rows.activity);
  });

  return readBundle(wsId, fullName, email);
}
