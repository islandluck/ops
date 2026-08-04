import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import {
  activityEvents,
  agents,
  approvalDecisions,
  businessBriefs,
  companyContext,
  documents,
  executionRuns,
  integrations,
  media,
  profiles,
  replyOpportunities,
  taskAssets,
  tasks,
  workspaceMembers,
  workspaces,
  xTargets,
} from "./schema";
import { buildCleanSlateRows } from "./seed-workspace";
import { hasAnthropicKey } from "@/lib/config";
import { isProviderConfigured, providerForIntegrationName } from "@/lib/integrations/registry";
import type {
  ActivityEvent,
  Agent,
  AppState,
  ApprovalDecision,
  AssetType,
  BusinessBrief,
  Document,
  ExecutionRun,
  Integration,
  OnboardingInput,
  PlannedTask,
  PostImage,
  ReplyOpportunity,
  Task,
  Workspace,
  XTarget,
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
  // tenant-scope-exempt: resolves the caller's OWN workspace by their auth user_id.
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

    // tenant-scope-exempt: resolves the caller's OWN workspace by their auth user_id.
    const existing = await tx
      .select({ id: workspaceMembers.workspace_id })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.user_id, userId))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const wsId = uid();
    // Brand-new real workspaces start clean + neutrally named; guided onboarding
    // personalises the name + brief. (The rich demo seed is demo-mode only.)
    await tx.insert(workspaces).values({ id: wsId, name: "My workspace", owner_id: userId });
    await tx.insert(workspaceMembers).values({ workspace_id: wsId, user_id: userId, role: "owner" });
    const rows = buildCleanSlateRows(wsId, Date.now());
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

/** Ensure the user has a profile row + a provisioned workspace. Idempotent —
 *  safe to call from onboarding so it never dead-ends if the initial load didn't
 *  provision (e.g. the session cookie wasn't ready right after signup). */
export async function ensureProvisioned(
  userId: string,
  email: string,
  fullName: string,
): Promise<string> {
  await ensureProfile(userId, email, fullName);
  return getOrCreateWorkspace(userId);
}

/** Load (provisioning + seeding on first visit) the full workspace bundle. */
export async function loadBundleForUser(
  userId: string,
  email: string,
  fullName: string,
  onboarded: boolean,
): Promise<AppState> {
  await ensureProfile(userId, email, fullName);
  const wsId = await getOrCreateWorkspace(userId);
  return readBundle(wsId, fullName, email, onboarded);
}

async function readBundle(
  wsId: string,
  fullName: string,
  email: string,
  onboarded: boolean,
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
  const documentRows = await db
    .select()
    .from(documents)
    .where(eq(documents.workspace_id, wsId))
    .orderBy(desc(documents.created_at))
    .limit(300);

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
    city: briefRow.city,
    state: briefRow.state,
    country: briefRow.country,
    connected_systems: briefRow.connected_systems,
    updated_at: iso(briefRow.updated_at),
  };

  const mappedAgents: Agent[] = agentRows
    .filter((a) => !a.archived)
    .map((a) => ({
      id: a.id,
      workspace_id: wsId,
      name: a.name,
      category: a.category,
      status: a.status,
      permissions_mode: a.permissions_mode,
      description: a.description,
      last_run_at: iso(a.last_run_at),
      tasks_prepared: a.tasks_prepared,
      instructions: a.instructions,
      folder: a.folder,
      background_enabled: a.background_enabled,
      allowed_integrations: a.allowed_integrations,
      log_activity: a.log_activity,
      tier: a.tier,
      premium: a.premium,
      created_by_type: a.created_by_type,
      emoji: a.emoji,
      accent: a.accent,
      archived: a.archived,
      kind: a.kind,
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
    scheduled_at: isoN(t.scheduled_at),
    project_id: t.project_id,
    project_phase: t.project_phase,
    project_step_kind: t.project_step_kind,
    agent_id: t.agent_id ?? "",
    created_by_type: t.created_by_type,
    requires_approval: t.requires_approval,
    approval_status: t.approval_status,
    execution_status: t.execution_status,
    affected_systems: t.affected_systems,
    proposed_actions: t.proposed_actions,
    impact_score: t.impact_score,
    archived: t.archived,
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

  const mappedDocuments: Document[] = documentRows.map((d) => ({
    id: d.id,
    workspace_id: wsId,
    agent_id: d.agent_id,
    author_name: d.author_name,
    task_id: d.task_id,
    task_title: d.task_title,
    name: d.name,
    content: d.content,
    folder: d.folder,
    doc_type: d.doc_type,
    notion_url: d.notion_url,
    created_at: iso(d.created_at),
    updated_at: iso(d.updated_at),
  }));

  return {
    workspace,
    brief,
    agents: mappedAgents,
    tasks: mappedTasks,
    integrations: mappedIntegrations,
    decisions: mappedDecisions,
    runs: mappedRuns,
    activity: mappedActivity,
    documents: mappedDocuments,
    session: {
      authenticated: true,
      onboarded,
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

    // Preserve server-managed agent fields the client bundle doesn't carry (the
    // learned X style profile), so a client-driven save can never wipe them.
    const priorStyle = await tx
      .select({ id: agents.id, style_profile: agents.style_profile })
      .from(agents)
      .where(eq(agents.workspace_id, wsId));
    const styleById = new Map(priorStyle.map((r) => [r.id, r.style_profile] as const));

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
          instructions: a.instructions,
          folder: a.folder,
          background_enabled: a.background_enabled,
          allowed_integrations: a.allowed_integrations,
          log_activity: a.log_activity,
          tier: a.tier,
          premium: a.premium,
          created_by_type: a.created_by_type,
          emoji: a.emoji,
          accent: a.accent,
          archived: a.archived,
          kind: a.kind ?? null,
        })),
      );

    // Re-apply the preserved style profiles (server-authoritative, not in the bundle).
    for (const a of state.agents) {
      const s = styleById.get(a.id);
      if (s) await tx.update(agents).set({ style_profile: s }).where(eq(agents.id, a.id));
    }

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
          scheduled_at: d(t.scheduled_at ?? null),
          project_id: t.project_id ?? null,
          project_phase: t.project_phase ?? null,
          project_step_kind: t.project_step_kind ?? null,
          agent_id: t.agent_id || null,
          created_by_type: t.created_by_type,
          requires_approval: t.requires_approval,
          approval_status: t.approval_status,
          execution_status: t.execution_status,
          affected_systems: t.affected_systems,
          proposed_actions: t.proposed_actions,
          impact_score: t.impact_score,
          archived: t.archived ?? false,
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
  onboarded: boolean,
): Promise<AppState> {
  const wsId = await getWorkspaceId(userId);
  if (!wsId) return loadBundleForUser(userId, email, fullName, onboarded);

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

    const rows = buildCleanSlateRows(wsId, Date.now());
    await tx.insert(businessBriefs).values(rows.brief);
    if (rows.agents.length) await tx.insert(agents).values(rows.agents);
    if (rows.integrations.length) await tx.insert(integrations).values(rows.integrations);
    if (rows.tasks.length) await tx.insert(tasks).values(rows.tasks);
    if (rows.assets.length) await tx.insert(taskAssets).values(rows.assets);
    if (rows.decisions.length) await tx.insert(approvalDecisions).values(rows.decisions);
    if (rows.runs.length) await tx.insert(executionRuns).values(rows.runs);
    if (rows.activity.length) await tx.insert(activityEvents).values(rows.activity);
  });

  return readBundle(wsId, fullName, email, onboarded);
}

/**
 * Persist guided-onboarding answers: set the brief + workspace name, apply the
 * chosen default permission mode to all agents, and clear any lingering seed
 * content so the board starts genuinely empty.
 */
export async function applyOnboardingForUser(
  userId: string,
  input: OnboardingInput,
): Promise<void> {
  // Provision on the spot if an earlier load didn't — onboarding must never
  // dead-end with "No workspace for user".
  const wsId = await getOrCreateWorkspace(userId);

  await db.transaction(async (tx) => {
    // Clear any seed/demo board content (FK children first).
    const wsTasks = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.workspace_id, wsId));
    for (const { id } of wsTasks) {
      await tx.delete(executionRuns).where(eq(executionRuns.task_id, id));
      await tx.delete(approvalDecisions).where(eq(approvalDecisions.task_id, id));
      await tx.delete(taskAssets).where(eq(taskAssets.task_id, id));
    }
    await tx.delete(tasks).where(eq(tasks.workspace_id, wsId));
    await tx.delete(activityEvents).where(eq(activityEvents.workspace_id, wsId));

    if (input.company_name) {
      await tx
        .update(workspaces)
        .set({ name: input.company_name, updated_at: new Date() })
        .where(eq(workspaces.id, wsId));
    }

    await tx
      .update(businessBriefs)
      .set({
        company_name: input.company_name,
        website_url: input.website_url,
        business_description: input.business_description,
        ideal_customer_profile: input.ideal_customer_profile,
        goals: input.goals,
        voice_rules: input.voice_rules,
        updated_at: new Date(),
      })
      .where(eq(businessBriefs.workspace_id, wsId));

    await tx
      .update(agents)
      .set({ permissions_mode: input.approvalDefault })
      .where(eq(agents.workspace_id, wsId));
  });
}

/* ------------------------------------------------------------------ */
/* Task planning (manual task creation → Operator plans + drafts)      */
/* ------------------------------------------------------------------ */

/** Context Operator needs to plan a task: brief fields + integrations. */
export async function getPlanningContext(wsId: string): Promise<{
  brief: {
    company_name: string;
    business_description: string;
    core_offer: string;
    ideal_customer_profile: string;
    voice_rules: string[];
    restricted_phrases: string[];
    timezone: string;
    city: string;
    state: string;
    country: string;
    /** Synthesized Deep Dive understanding of the company; "" until a Deep Dive completes. */
    company_context: string;
  };
  integrations: { name: string; connected: boolean }[];
}> {
  const [briefRow] = await db
    .select()
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, wsId))
    .limit(1);
  const integ = await db
    .select({ name: integrations.name, connected: integrations.connected })
    .from(integrations)
    .where(eq(integrations.workspace_id, wsId));
  const [context] = await db
    .select({ summary: companyContext.summary })
    .from(companyContext)
    .where(and(eq(companyContext.workspace_id, wsId), eq(companyContext.is_current, true)))
    .orderBy(desc(companyContext.version))
    .limit(1);
  return {
    brief: {
      company_name: briefRow?.company_name ?? "",
      business_description: briefRow?.business_description ?? "",
      core_offer: briefRow?.core_offer ?? "",
      ideal_customer_profile: briefRow?.ideal_customer_profile ?? "",
      voice_rules: briefRow?.voice_rules ?? [],
      restricted_phrases: briefRow?.restricted_phrases ?? [],
      timezone: briefRow?.timezone ?? "",
      city: briefRow?.city ?? "",
      state: briefRow?.state ?? "",
      country: briefRow?.country ?? "",
      company_context: context?.summary ?? "",
    },
    integrations: integ,
  };
}

/** The company location the Opportunities scanners search around. */
export async function getBriefLocation(
  wsId: string,
): Promise<{ city: string; state: string; country: string }> {
  const [row] = await db
    .select({ city: businessBriefs.city, state: businessBriefs.state, country: businessBriefs.country })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, wsId))
    .limit(1);
  return { city: row?.city ?? "", state: row?.state ?? "", country: row?.country ?? "" };
}

/** Persist the company location used to geo-target opportunity scans. */
export async function saveBriefLocation(
  wsId: string,
  loc: { city: string; state: string; country: string },
): Promise<void> {
  await db
    .update(businessBriefs)
    .set({
      city: loc.city.trim().slice(0, 120),
      state: loc.state.trim().slice(0, 120),
      country: loc.country.trim().slice(0, 120),
      updated_at: new Date(),
    })
    .where(eq(businessBriefs.workspace_id, wsId));
}

/** Edit a task's deliverable content (the drafted document). Workspace-scoped
 *  via the owning task, so a user can only edit their own deliverables. */
export async function updateTaskAssetContent(
  wsId: string,
  assetId: string,
  content: string,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .select({ taskWs: tasks.workspace_id })
    .from(taskAssets)
    .innerJoin(tasks, eq(tasks.id, taskAssets.task_id))
    .where(eq(taskAssets.id, assetId))
    .limit(1);
  if (!row || row.taskWs !== wsId) return { ok: false };
  await db
    .update(taskAssets)
    .set({ content: content.slice(0, 100_000) })
    .where(eq(taskAssets.id, assetId));
  return { ok: true };
}

/* -------------------------------- media --------------------------------- */

function toPostImage(m: typeof media.$inferSelect): PostImage {
  return {
    id: m.id,
    task_id: m.task_id,
    source: m.source,
    url: m.public_url,
    mime_type: m.mime_type,
    alt_text: m.alt_text,
    width: m.width,
    height: m.height,
    attribution: m.attribution,
    created_at: iso(m.created_at),
  };
}

export async function insertMedia(row: {
  workspaceId: string;
  taskId: string | null;
  source: "upload" | "stock" | "ai";
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  altText?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  attribution?: string | null;
}): Promise<PostImage> {
  const [inserted] = await db
    .insert(media)
    .values({
      id: uid(),
      workspace_id: row.workspaceId,
      task_id: row.taskId,
      source: row.source,
      storage_path: row.storagePath,
      public_url: row.publicUrl,
      mime_type: row.mimeType,
      alt_text: row.altText ?? "",
      width: row.width ?? 0,
      height: row.height ?? 0,
      byte_size: row.byteSize ?? 0,
      attribution: row.attribution ?? null,
    })
    .returning();
  return toPostImage(inserted);
}

/** Attach an orphan media row (task_id null) to a task, scoped to the workspace. */
export async function linkMediaToTask(
  workspaceId: string,
  mediaId: string,
  taskId: string,
): Promise<void> {
  await db
    .update(media)
    .set({ task_id: taskId })
    .where(and(eq(media.workspace_id, workspaceId), eq(media.id, mediaId)));
}

/** Images attached to a task, oldest first (public URLs only — no storage paths). */
export async function listMediaForTask(workspaceId: string, taskId: string): Promise<PostImage[]> {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.workspace_id, workspaceId), eq(media.task_id, taskId)))
    .orderBy(media.created_at);
  return rows.map(toPostImage);
}

/** Raw rows (incl. storage_path) — used by the publish path to fetch binaries. */
export async function listMediaRowsForTask(workspaceId: string, taskId: string) {
  return db
    .select()
    .from(media)
    .where(and(eq(media.workspace_id, workspaceId), eq(media.task_id, taskId)))
    .orderBy(media.created_at);
}

export async function getMediaRow(workspaceId: string, mediaId: string) {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.workspace_id, workspaceId), eq(media.id, mediaId)))
    .limit(1);
  return row ?? null;
}

export async function deleteMediaRow(mediaId: string): Promise<void> {
  await db.delete(media).where(eq(media.id, mediaId));
}

function plannedAssetType(affected: string[]): AssetType {
  if (affected.includes("Gmail")) return "email";
  if (affected.includes("Notion")) return "document";
  if (affected.includes("Google Sheets")) return "summary";
  return "document";
}

/** Record an agent-authored document for the file manager. No-op on empty content. */
export async function saveDocument(input: {
  workspaceId: string;
  agentId: string | null;
  authorName: string;
  taskId: string | null;
  taskTitle: string;
  name: string;
  content: string;
  folder: string;
  docType: AssetType;
}): Promise<void> {
  if (!input.content.trim()) return;
  await db.insert(documents).values({
    id: uid(),
    workspace_id: input.workspaceId,
    agent_id: input.agentId,
    author_name: input.authorName || "Operator",
    task_id: input.taskId,
    task_title: input.taskTitle,
    name: input.name.slice(0, 200) || "Untitled",
    content: input.content,
    folder: input.folder,
    doc_type: input.docType,
  });
}

/** Load a single document's exportable fields (scoped to the workspace). */
export async function getDocumentById(
  workspaceId: string,
  documentId: string,
): Promise<{ name: string; content: string; notion_url: string | null } | null> {
  const [row] = await db
    .select({ name: documents.name, content: documents.content, notion_url: documents.notion_url })
    .from(documents)
    .where(and(eq(documents.workspace_id, workspaceId), eq(documents.id, documentId)))
    .limit(1);
  return row ?? null;
}

/** Record the Notion page URL a document was exported to. */
export async function setDocumentNotionUrl(
  workspaceId: string,
  documentId: string,
  url: string,
): Promise<void> {
  await db
    .update(documents)
    .set({ notion_url: url, updated_at: new Date() })
    .where(and(eq(documents.workspace_id, workspaceId), eq(documents.id, documentId)));
}

/* --------------------------- X voice (style) ----------------------------- */

/** The learned X writing-voice profile for the workspace (held on the Social agent). */
export async function getXStyleProfile(workspaceId: string): Promise<string | null> {
  const [a] = await db
    .select({ style_profile: agents.style_profile })
    .from(agents)
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.kind, "social")))
    .limit(1);
  return a?.style_profile ?? null;
}

/** Save (or clear) the learned X writing-voice profile on the Social agent. */
export async function setXStyleProfile(workspaceId: string, profile: string | null): Promise<void> {
  await db
    .update(agents)
    .set({ style_profile: profile })
    .where(and(eq(agents.workspace_id, workspaceId), eq(agents.kind, "social")));
}

/* ----------------------------- reply radar ------------------------------ */

function toXTarget(t: typeof xTargets.$inferSelect): XTarget {
  return {
    id: t.id,
    workspace_id: t.workspace_id,
    handle: t.handle,
    x_user_id: t.x_user_id,
    note: t.note,
    active: t.active,
    last_checked_at: t.last_checked_at ? iso(t.last_checked_at) : null,
    created_at: iso(t.created_at),
  };
}

function toReplyOpportunity(o: typeof replyOpportunities.$inferSelect): ReplyOpportunity {
  return {
    id: o.id,
    workspace_id: o.workspace_id,
    target_id: o.target_id,
    tweet_id: o.tweet_id,
    tweet_url: o.tweet_url,
    author_handle: o.author_handle,
    tweet_text: o.tweet_text,
    score: o.score,
    reason: o.reason,
    suggested_replies: o.suggested_replies,
    status: o.status,
    reply_url: o.reply_url,
    created_at: iso(o.created_at),
  };
}

export async function listXTargets(workspaceId: string): Promise<XTarget[]> {
  const rows = await db
    .select()
    .from(xTargets)
    .where(eq(xTargets.workspace_id, workspaceId))
    .orderBy(desc(xTargets.created_at));
  return rows.map(toXTarget);
}

export async function addXTarget(
  workspaceId: string,
  handle: string,
  note: string,
  xUserId?: string | null,
): Promise<XTarget> {
  const clean = handle.replace(/^@/, "").trim().toLowerCase().slice(0, 40);
  const [row] = await db
    .insert(xTargets)
    .values({
      id: uid(),
      workspace_id: workspaceId,
      handle: clean,
      note: note.slice(0, 200),
      x_user_id: xUserId ?? null,
    })
    .onConflictDoUpdate({
      target: [xTargets.workspace_id, xTargets.handle],
      set: { active: true, note: note.slice(0, 200), ...(xUserId ? { x_user_id: xUserId } : {}) },
    })
    .returning();
  return toXTarget(row);
}

export async function removeXTarget(workspaceId: string, id: string): Promise<void> {
  await db.delete(xTargets).where(and(eq(xTargets.workspace_id, workspaceId), eq(xTargets.id, id)));
}

export async function setTargetUserId(workspaceId: string, id: string, xUserId: string): Promise<void> {
  await db
    .update(xTargets)
    .set({ x_user_id: xUserId })
    .where(and(eq(xTargets.workspace_id, workspaceId), eq(xTargets.id, id)));
}

export async function markTargetChecked(
  workspaceId: string,
  id: string,
  lastSeenTweetId: string | null,
): Promise<void> {
  await db
    .update(xTargets)
    .set({ last_checked_at: new Date(), ...(lastSeenTweetId ? { last_seen_tweet_id: lastSeenTweetId } : {}) })
    .where(and(eq(xTargets.workspace_id, workspaceId), eq(xTargets.id, id)));
}

/** Active targets for a refresh pass, least-recently-checked first (raw rows). */
export async function activeTargetsForRefresh(workspaceId: string, limit: number) {
  return db
    .select()
    .from(xTargets)
    .where(and(eq(xTargets.workspace_id, workspaceId), eq(xTargets.active, true)))
    .orderBy(sql`${xTargets.last_checked_at} asc nulls first`)
    .limit(limit);
}

/** Insert a new opportunity; returns false if this tweet is already tracked. */
export async function insertOpportunity(
  workspaceId: string,
  o: {
    targetId: string | null;
    tweetId: string;
    tweetUrl: string;
    authorHandle: string;
    tweetText: string;
    score: number;
    reason: string;
    suggestedReplies: { reply: string; note: string }[];
  },
): Promise<boolean> {
  const inserted = await db
    .insert(replyOpportunities)
    .values({
      id: uid(),
      workspace_id: workspaceId,
      target_id: o.targetId,
      tweet_id: o.tweetId,
      tweet_url: o.tweetUrl,
      author_handle: o.authorHandle,
      tweet_text: o.tweetText.slice(0, 2000),
      score: o.score,
      reason: o.reason.slice(0, 300),
      suggested_replies: o.suggestedReplies,
    })
    .onConflictDoNothing({ target: [replyOpportunities.workspace_id, replyOpportunities.tweet_id] })
    .returning({ id: replyOpportunities.id });
  return inserted.length > 0;
}

export async function listReplyOpportunities(workspaceId: string, limit = 40): Promise<ReplyOpportunity[]> {
  const rows = await db
    .select()
    .from(replyOpportunities)
    .where(and(eq(replyOpportunities.workspace_id, workspaceId), eq(replyOpportunities.status, "new")))
    .orderBy(desc(replyOpportunities.score), desc(replyOpportunities.created_at))
    .limit(limit);
  return rows.map(toReplyOpportunity);
}

export async function getOpportunity(workspaceId: string, id: string): Promise<ReplyOpportunity | null> {
  const [row] = await db
    .select()
    .from(replyOpportunities)
    .where(and(eq(replyOpportunities.workspace_id, workspaceId), eq(replyOpportunities.id, id)))
    .limit(1);
  return row ? toReplyOpportunity(row) : null;
}

export async function setOpportunityReplies(
  workspaceId: string,
  id: string,
  replies: { reply: string; note: string }[],
): Promise<void> {
  await db
    .update(replyOpportunities)
    .set({ suggested_replies: replies })
    .where(and(eq(replyOpportunities.workspace_id, workspaceId), eq(replyOpportunities.id, id)));
}

export async function dismissOpportunity(workspaceId: string, id: string): Promise<void> {
  await db
    .update(replyOpportunities)
    .set({ status: "dismissed" })
    .where(and(eq(replyOpportunities.workspace_id, workspaceId), eq(replyOpportunities.id, id)));
}

export async function markOpportunityReplied(
  workspaceId: string,
  id: string,
  replyUrl: string,
): Promise<void> {
  await db
    .update(replyOpportunities)
    .set({ status: "replied", reply_url: replyUrl })
    .where(and(eq(replyOpportunities.workspace_id, workspaceId), eq(replyOpportunities.id, id)));
}

/** Workspaces that have at least one active radar target — for the cron. */
export async function workspacesWithActiveTargets(limit = 25): Promise<string[]> {
  // tenant-scope-exempt: cron discovery across ALL workspaces; each is then
  // refreshed via refreshReplyRadar(workspace_id), which is workspace-scoped.
  const rows = await db
    .selectDistinct({ workspace_id: xTargets.workspace_id })
    .from(xTargets)
    .where(eq(xTargets.active, true))
    .limit(limit);
  return rows.map((r) => r.workspace_id);
}

/** Persist a planned task (+ its draft asset + an activity event). Returns the id. */
export async function createPlannedTask(
  wsId: string,
  planned: PlannedTask,
  actor: { name: string },
): Promise<string> {
  const now = new Date();
  const taskId = uid();

  // Attach to a worker agent in the same category, if one exists.
  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      category: agents.category,
      folder: agents.folder,
      premium: agents.premium,
      archived: agents.archived,
    })
    .from(agents)
    .where(eq(agents.workspace_id, wsId));
  const match = agentRows.find((a) => a.category === planned.category && !a.premium && !a.archived);

  await db.insert(tasks).values({
    id: taskId,
    workspace_id: wsId,
    category: planned.category,
    title: planned.title,
    description: planned.rationale,
    rationale: planned.rationale,
    status: "ready",
    risk_level: planned.risk_level,
    priority: "medium",
    due_at: null,
    agent_id: match?.id ?? null,
    created_by_type: "human",
    requires_approval: planned.requires_approval,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: planned.affected_systems,
    proposed_actions: planned.affected_systems.length || 1,
    impact_score: 45,
    created_at: now,
    updated_at: now,
  });

  if (planned.draft.trim()) {
    await db.insert(taskAssets).values({
      id: uid(),
      task_id: taskId,
      asset_type: plannedAssetType(planned.affected_systems),
      title: "Draft prepared by Operator",
      content: planned.draft,
      // Capture an explicit email recipient so execution sends for real (vs. self-send).
      metadata: planned.recipient ? { to: planned.recipient } : null,
    });
    await saveDocument({
      workspaceId: wsId,
      agentId: match?.id ?? null,
      authorName: match?.name ?? "Operator",
      taskId,
      taskTitle: planned.title,
      name: planned.title,
      content: planned.draft,
      folder: match?.folder ?? "",
      docType: plannedAssetType(planned.affected_systems),
    });
  }

  const systems = planned.affected_systems.length
    ? ` Systems: ${planned.affected_systems.join(", ")}.`
    : "";
  await db.insert(activityEvents).values({
    id: uid(),
    workspace_id: wsId,
    task_id: taskId,
    event_type: "task_created",
    actor_type: "human",
    actor_id: actor.name,
    summary: `${actor.name} created “${planned.title}”. Operator planned it and drafted the content.${systems}`,
    created_at: now,
  });

  return taskId;
}
