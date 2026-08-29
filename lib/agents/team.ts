import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chatChannels,
  chatMessages,
  chatReads,
  humanProjects,
  projects,
  teamAssignments,
  teamDocuments,
  teamEvents,
  teamGoals,
  teamMeetings,
  teamMembers,
  teamSettings,
  workspaceMembers,
} from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { getDriveMeta, isWithinDriveFolder, listDriveFolder, type DriveEntry } from "@/lib/integrations/google";
import { getNotionPageContent, searchNotionPages } from "@/lib/integrations/notion";
import { extractMeeting, type MeetingExtraction } from "@/lib/ai/meeting-extract";
import { runWithUsage } from "@/lib/ai/usage";
import type {
  AssignmentStatus,
  CalendarItem,
  ChatChannel,
  ChatMessage,
  HumanProject,
  HumanProjectStatus,
  TeamAssignment,
  TeamDocument,
  TeamDocumentKind,
  TeamEvent,
  TeamEventKind,
  TeamGoal,
  TeamGoalHorizon,
  TeamGoalScope,
  TeamGoalStatus,
  TeamMeeting,
  TeamMember,
  TeamRole,
  WorkspaceRole,
} from "@/lib/types";

/**
 * Team Room engine (Slice 1 — owner side). Roster + profiles + handoffs, plus a
 * team-context summary the Executive/Boardroom read. No member logins yet (Slice 2).
 */

function toMember(r: typeof teamMembers.$inferSelect, managerName: string | null = null): TeamMember {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role_title: r.role_title,
    description: r.description,
    skills: (r.skills ?? []) as string[],
    birthday: r.birthday,
    start_date: r.start_date,
    timezone: r.timezone,
    emoji: r.emoji,
    accent: r.accent,
    status: r.status as TeamMember["status"],
    team_role: (r.team_role ?? "contributor") as TeamRole,
    manager_id: r.manager_id ?? null,
    manager_name: managerName,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listTeamMembers(workspaceId: string): Promise<TeamMember[]> {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId))
    .orderBy(desc(teamMembers.created_at));
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  return rows.map((r) => toMember(r, r.manager_id ? nameById.get(r.manager_id) ?? null : null));
}

export interface TeamMemberInput {
  name: string;
  email?: string;
  role_title?: string;
  description?: string;
  skills?: string[];
  birthday?: string;
  start_date?: string;
  timezone?: string;
  emoji?: string;
  accent?: string;
  status?: TeamMember["status"];
  /** Initial in-team rank. Manager/report wiring is edited later via setMemberOrg. */
  team_role?: TeamRole;
}

export async function createTeamMember(
  workspaceId: string,
  input: TeamMemberInput,
): Promise<{ ok: true; member: TeamMember } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "A name is required." };
  const now = new Date();
  const [row] = await db
    .insert(teamMembers)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      name: name.slice(0, 120),
      email: (input.email ?? "").trim().slice(0, 200),
      role_title: (input.role_title ?? "").slice(0, 120),
      description: (input.description ?? "").slice(0, 2000),
      skills: (input.skills ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 20),
      birthday: (input.birthday ?? "").slice(0, 20),
      start_date: (input.start_date ?? "").slice(0, 20),
      timezone: (input.timezone ?? "").slice(0, 60),
      emoji: (input.emoji ?? "").slice(0, 8),
      accent: (input.accent ?? "indigo").slice(0, 20),
      status: input.status ?? "active",
      team_role: input.team_role === "manager" ? "manager" : "contributor",
      manager_id: null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return { ok: true, member: toMember(row) };
}

export async function updateTeamMember(
  workspaceId: string,
  id: string,
  patch: Partial<TeamMemberInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.name === "string") {
    if (!patch.name.trim()) return { ok: false, error: "A name is required." };
    set.name = patch.name.trim().slice(0, 120);
  }
  if (typeof patch.email === "string") set.email = patch.email.trim().slice(0, 200);
  if (typeof patch.role_title === "string") set.role_title = patch.role_title.slice(0, 120);
  if (typeof patch.description === "string") set.description = patch.description.slice(0, 2000);
  if (Array.isArray(patch.skills)) set.skills = patch.skills.map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (typeof patch.birthday === "string") set.birthday = patch.birthday.slice(0, 20);
  if (typeof patch.start_date === "string") set.start_date = patch.start_date.slice(0, 20);
  if (typeof patch.timezone === "string") set.timezone = patch.timezone.slice(0, 60);
  if (typeof patch.emoji === "string") set.emoji = patch.emoji.slice(0, 8);
  if (typeof patch.accent === "string") set.accent = patch.accent.slice(0, 20);
  if (typeof patch.status === "string") set.status = patch.status;
  await db
    .update(teamMembers)
    .set(set)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, id)));
  return { ok: true };
}

export async function deleteTeamMember(workspaceId: string, id: string): Promise<{ ok: true }> {
  // Detach anyone who reported to this person (manager_id has no DB FK), then delete.
  // Assignments cascade via the member FK.
  await db
    .update(teamMembers)
    .set({ manager_id: null, updated_at: new Date() })
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.manager_id, id)));
  await db.delete(teamMembers).where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, id)));
  return { ok: true };
}

// ── Org hierarchy (Phase 1) ──────────────────────────────────────────────────

/**
 * Set a member's in-team rank and/or who they report to. Keeps a clean two-level
 * tree: managers report to the owner (manager_id null); only contributors carry a
 * manager_id, and only to an actual manager. Demoting a manager detaches its reports.
 * This is the privileged hierarchy op — gate it to the owner at the action layer.
 */
export async function setMemberOrg(
  workspaceId: string,
  memberId: string,
  patch: { team_role?: TeamRole; manager_id?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [target] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, memberId)))
    .limit(1);
  if (!target) return { ok: false, error: "That team member no longer exists." };

  const nextRole: TeamRole =
    patch.team_role === "manager" || patch.team_role === "contributor" ? patch.team_role : (target.team_role as TeamRole);

  const set: Record<string, unknown> = { updated_at: new Date(), team_role: nextRole };

  if (nextRole === "manager") {
    // Managers report to the owner.
    set.manager_id = null;
  } else {
    // Contributor: keep the current manager unless the patch changes it.
    let mid: string | null = patch.manager_id !== undefined ? patch.manager_id || null : target.manager_id ?? null;
    if (mid) {
      if (mid === memberId) return { ok: false, error: "Someone can't report to themselves." };
      const [mgr] = await db
        .select({ role: teamMembers.team_role })
        .from(teamMembers)
        .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, mid)))
        .limit(1);
      if (!mgr) return { ok: false, error: "That manager no longer exists." };
      if (mgr.role !== "manager") return { ok: false, error: "Reports can only be assigned to a manager." };
    }
    set.manager_id = mid;
  }

  await db
    .update(teamMembers)
    .set(set)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, memberId)));

  // If they're no longer a manager, detach anyone who reported to them.
  if (nextRole !== "manager") {
    await db
      .update(teamMembers)
      .set({ manager_id: null, updated_at: new Date() })
      .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.manager_id, memberId)));
  }
  return { ok: true };
}

/**
 * The viewer's effective role across the whole workspace: owner (from
 * workspace_members) trumps everything; otherwise their in-team rank.
 */
export async function getWorkspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRole> {
  const [wm] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspace_id, workspaceId), eq(workspaceMembers.user_id, userId)))
    .limit(1);
  if (wm?.role === "owner") return "owner";
  const [tm] = await db
    .select({ role: teamMembers.team_role })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  return tm?.role === "manager" ? "manager" : "contributor";
}

/** A manager's direct reports (the members whose manager_id is this member). */
export async function getDirectReports(workspaceId: string, managerMemberId: string): Promise<TeamMember[]> {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.manager_id, managerMemberId)))
    .orderBy(desc(teamMembers.created_at));
  return rows.map((r) => toMember(r));
}

/**
 * Can `actorUserId` assign work to `targetMemberId`? Owner → anyone; a manager →
 * their own direct reports; a contributor → no one.
 */
export async function canDelegateTo(
  workspaceId: string,
  actorUserId: string,
  targetMemberId: string,
): Promise<boolean> {
  const role = await getWorkspaceRole(workspaceId, actorUserId);
  if (role === "owner") return true;
  if (role !== "manager") return false;
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, actorUserId)))
    .limit(1);
  if (!me) return false;
  const [target] = await db
    .select({ manager_id: teamMembers.manager_id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, targetMemberId)))
    .limit(1);
  return !!target && target.manager_id === me.id;
}

// ── Human projects + delegation (Phase 2) ────────────────────────────────────

function toHumanProject(
  r: typeof humanProjects.$inferSelect,
  names: { lead: string | null; manager: string | null },
  counts: { open: number; total: number },
): HumanProject {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    status: r.status as HumanProjectStatus,
    deadline: r.deadline ? new Date(r.deadline).toISOString() : null,
    lead_member_id: r.lead_member_id ?? null,
    lead_name: names.lead,
    manager_member_id: r.manager_member_id ?? null,
    manager_name: names.manager,
    source: (r.source as HumanProject["source"]) ?? "manual",
    source_project_id: r.source_project_id ?? null,
    open_tasks: counts.open,
    total_tasks: counts.total,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listHumanProjects(workspaceId: string): Promise<HumanProject[]> {
  const rows = await db
    .select()
    .from(humanProjects)
    .where(eq(humanProjects.workspace_id, workspaceId))
    .orderBy(desc(humanProjects.created_at));
  if (!rows.length) return [];
  const memberRows = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId));
  const nameById = new Map(memberRows.map((m) => [m.id, m.name]));
  // Task counts per project (open vs total), computed in one pass.
  const taskRows = await db
    .select({ project_id: teamAssignments.project_id, status: teamAssignments.status })
    .from(teamAssignments)
    .where(eq(teamAssignments.workspace_id, workspaceId));
  const counts = new Map<string, { open: number; total: number }>();
  for (const t of taskRows) {
    if (!t.project_id) continue;
    const c = counts.get(t.project_id) ?? { open: 0, total: 0 };
    c.total += 1;
    if (t.status !== "done") c.open += 1;
    counts.set(t.project_id, c);
  }
  return rows.map((r) =>
    toHumanProject(
      r,
      {
        lead: r.lead_member_id ? nameById.get(r.lead_member_id) ?? null : null,
        manager: r.manager_member_id ? nameById.get(r.manager_member_id) ?? null : null,
      },
      counts.get(r.id) ?? { open: 0, total: 0 },
    ),
  );
}

export interface HumanProjectInput {
  title: string;
  summary?: string;
  status?: HumanProjectStatus;
  deadline?: string | null;
  lead_member_id?: string | null;
  manager_member_id?: string | null;
  source?: HumanProject["source"];
  source_project_id?: string | null;
}

export async function createHumanProject(
  workspaceId: string,
  input: HumanProjectInput,
): Promise<{ ok: true; project: HumanProject } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the project a title." };
  const now = new Date();
  const [row] = await db
    .insert(humanProjects)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      title: title.slice(0, 200),
      summary: (input.summary ?? "").slice(0, 4000),
      status: input.status ?? "active",
      deadline: input.deadline ? new Date(input.deadline) : null,
      lead_member_id: input.lead_member_id || null,
      manager_member_id: input.manager_member_id || null,
      source: input.source ?? "manual",
      source_project_id: input.source_project_id || null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return { ok: true, project: toHumanProject(row, { lead: null, manager: null }, { open: 0, total: 0 }) };
}

export async function updateHumanProject(
  workspaceId: string,
  id: string,
  patch: Partial<HumanProjectInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.title === "string") {
    if (!patch.title.trim()) return { ok: false, error: "Title can't be empty." };
    set.title = patch.title.trim().slice(0, 200);
  }
  if (typeof patch.summary === "string") set.summary = patch.summary.slice(0, 4000);
  if (typeof patch.status === "string") set.status = patch.status;
  if (patch.deadline !== undefined) set.deadline = patch.deadline ? new Date(patch.deadline) : null;
  if (patch.lead_member_id !== undefined) set.lead_member_id = patch.lead_member_id || null;
  if (patch.manager_member_id !== undefined) set.manager_member_id = patch.manager_member_id || null;
  await db
    .update(humanProjects)
    .set(set)
    .where(and(eq(humanProjects.workspace_id, workspaceId), eq(humanProjects.id, id)));
  return { ok: true };
}

export async function deleteHumanProject(workspaceId: string, id: string): Promise<{ ok: true }> {
  // Detach its tasks (they survive as standalone), then delete the project.
  await db
    .update(teamAssignments)
    .set({ project_id: null, updated_at: new Date() })
    .where(and(eq(teamAssignments.workspace_id, workspaceId), eq(teamAssignments.project_id, id)));
  await db.delete(humanProjects).where(and(eq(humanProjects.workspace_id, workspaceId), eq(humanProjects.id, id)));
  return { ok: true };
}

/**
 * Assign a FULL AI project to a team member. The real project — its plan, phases,
 * and agent execution — stays intact; it just gains an assignee and surfaces in
 * that member's portal, where they approve its deliverables (scoped to the
 * assignment). Pass member_id null to unassign. Owner-gated at the action layer.
 */
export async function assignProjectToMember(
  workspaceId: string,
  projectId: string,
  opts: { member_id: string | null; manager_id?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [ai] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!ai) return { ok: false, error: "That project no longer exists." };
  if (opts.member_id) {
    const [m] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, opts.member_id)))
      .limit(1);
    if (!m) return { ok: false, error: "That team member no longer exists." };
  }
  await db
    .update(projects)
    .set({
      assigned_member_id: opts.member_id || null,
      assigned_manager_id: opts.manager_id || null,
      updated_at: new Date(),
    })
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)));
  return { ok: true };
}

/** True if the AI project `projectId` is assigned to the member behind `userId`. */
export async function isProjectAssignedToMember(
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  if (!me) return false;
  const [p] = await db
    .select({ assigned: projects.assigned_member_id })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  return !!p && p.assigned === me.id;
}

/**
 * A manager (or the owner) creates a task for someone they're allowed to delegate
 * to, recording the delegator. Enforces canDelegateTo.
 */
export async function createDelegatedTask(
  workspaceId: string,
  actorUserId: string,
  input: AssignmentInput,
): Promise<{ ok: true; assignment: TeamAssignment } | { ok: false; error: string }> {
  if (!input.member_id) return { ok: false, error: "Pick who to assign it to." };
  const allowed = await canDelegateTo(workspaceId, actorUserId, input.member_id);
  if (!allowed) return { ok: false, error: "You can only delegate to your direct reports." };
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, actorUserId)))
    .limit(1);
  return createAssignment(workspaceId, { ...input, created_by_member_id: me?.id ?? null });
}

// ── Team goals (Phase 3) ─────────────────────────────────────────────────────

function toGoal(r: typeof teamGoals.$inferSelect, nameById: Map<string, string> = new Map()): TeamGoal {
  // member_ids is the source of truth; fall back to the legacy single member_id.
  const ids = ((r.member_ids?.length ? r.member_ids : r.member_id ? [r.member_id] : []) as string[]).filter(Boolean);
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    horizon: r.horizon as TeamGoalHorizon,
    scope: r.scope as TeamGoalScope,
    member_ids: ids,
    member_names: ids.map((id) => nameById.get(id)).filter((n): n is string => !!n),
    status: r.status as TeamGoalStatus,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listTeamGoals(workspaceId: string): Promise<TeamGoal[]> {
  const rows = await db
    .select()
    .from(teamGoals)
    .where(eq(teamGoals.workspace_id, workspaceId))
    .orderBy(desc(teamGoals.created_at));
  if (!rows.length) return [];
  const memberRows = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId));
  const nameById = new Map(memberRows.map((m) => [m.id, m.name]));
  return rows.map((r) => toGoal(r, nameById));
}

export interface TeamGoalInput {
  title: string;
  detail?: string;
  horizon: TeamGoalHorizon;
  scope: TeamGoalScope;
  member_ids?: string[];
}

/**
 * Can `userId` set/edit a goal of this scope + target? Owner: any; manager: team
 * goals + goals for themselves or a direct report; contributor: none.
 */
export async function canSetGoalFor(
  workspaceId: string,
  userId: string,
  scope: TeamGoalScope,
  memberIds: string[],
): Promise<boolean> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role === "owner") return true;
  if (role !== "manager") return false;
  if (scope === "team") return true;
  if (!memberIds.length) return false;
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  if (!me) return false;
  // A manager may set goals for themselves or any direct report — for ALL targets.
  const reports = await getDirectReports(workspaceId, me.id);
  const allowed = new Set([me.id, ...reports.map((r) => r.id)]);
  return memberIds.every((id) => allowed.has(id));
}

export async function createTeamGoal(
  workspaceId: string,
  userId: string,
  input: TeamGoalInput,
): Promise<{ ok: true; goal: TeamGoal } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the goal a title." };
  const scope: TeamGoalScope = input.scope === "individual" ? "individual" : "team";
  const memberIds = scope === "individual" ? (input.member_ids ?? []).filter(Boolean) : [];
  if (scope === "individual" && !memberIds.length) return { ok: false, error: "Pick who the goal is for." };
  if (!(await canSetGoalFor(workspaceId, userId, scope, memberIds))) {
    return { ok: false, error: "You can only set team goals or goals for your reports." };
  }
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const now = new Date();
  const [row] = await db
    .insert(teamGoals)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      title: title.slice(0, 300),
      detail: (input.detail ?? "").slice(0, 4000),
      horizon: input.horizon === "week" || input.horizon === "quarter" ? input.horizon : "month",
      scope,
      member_id: null,
      member_ids: memberIds,
      status: "active",
      created_by_member_id: me?.id ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return { ok: true, goal: toGoal(row) };
}

export async function updateTeamGoal(
  workspaceId: string,
  userId: string,
  id: string,
  patch: {
    title?: string;
    detail?: string;
    horizon?: TeamGoalHorizon;
    status?: TeamGoalStatus;
    scope?: TeamGoalScope;
    member_ids?: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [goal] = await db
    .select()
    .from(teamGoals)
    .where(and(eq(teamGoals.workspace_id, workspaceId), eq(teamGoals.id, id)))
    .limit(1);
  if (!goal) return { ok: false, error: "That goal no longer exists." };
  const currentIds = ((goal.member_ids?.length ? goal.member_ids : goal.member_id ? [goal.member_id] : []) as string[]).filter(
    Boolean,
  );
  if (!(await canSetGoalFor(workspaceId, userId, goal.scope as TeamGoalScope, currentIds))) {
    return { ok: false, error: "You can't edit this goal." };
  }
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.title === "string") {
    if (!patch.title.trim()) return { ok: false, error: "Title can't be empty." };
    set.title = patch.title.trim().slice(0, 300);
  }
  if (typeof patch.detail === "string") set.detail = patch.detail.slice(0, 4000);
  if (patch.horizon) set.horizon = patch.horizon;
  if (patch.status) set.status = patch.status;
  // Reassigning people (and scope) — must also be allowed for the NEW target.
  if (patch.scope || patch.member_ids) {
    const nextScope: TeamGoalScope = patch.scope ?? (goal.scope as TeamGoalScope);
    const nextIds = nextScope === "individual" ? (patch.member_ids ?? currentIds).filter(Boolean) : [];
    if (nextScope === "individual" && !nextIds.length) return { ok: false, error: "Pick who the goal is for." };
    if (!(await canSetGoalFor(workspaceId, userId, nextScope, nextIds))) {
      return { ok: false, error: "You can only assign goals to your reports." };
    }
    set.scope = nextScope;
    set.member_ids = nextIds;
    set.member_id = null;
  }
  await db.update(teamGoals).set(set).where(and(eq(teamGoals.workspace_id, workspaceId), eq(teamGoals.id, id)));
  return { ok: true };
}

export async function deleteTeamGoal(
  workspaceId: string,
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [goal] = await db
    .select()
    .from(teamGoals)
    .where(and(eq(teamGoals.workspace_id, workspaceId), eq(teamGoals.id, id)))
    .limit(1);
  if (!goal) return { ok: true };
  const ids = ((goal.member_ids?.length ? goal.member_ids : goal.member_id ? [goal.member_id] : []) as string[]).filter(
    Boolean,
  );
  if (!(await canSetGoalFor(workspaceId, userId, goal.scope as TeamGoalScope, ids))) {
    return { ok: false, error: "You can't delete this goal." };
  }
  await db.delete(teamGoals).where(and(eq(teamGoals.workspace_id, workspaceId), eq(teamGoals.id, id)));
  return { ok: true };
}

/** A member marks THEIR OWN individual goal done/active (ownership enforced). */
export async function setMyGoalStatus(
  workspaceId: string,
  userId: string,
  id: string,
  status: TeamGoalStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  if (!me) return { ok: false, error: "No team profile found." };
  const [goal] = await db
    .select({ member_ids: teamGoals.member_ids, member_id: teamGoals.member_id })
    .from(teamGoals)
    .where(and(eq(teamGoals.workspace_id, workspaceId), eq(teamGoals.id, id)))
    .limit(1);
  const ids = (goal ? (goal.member_ids?.length ? goal.member_ids : goal.member_id ? [goal.member_id] : []) : []) as string[];
  if (!goal || !ids.includes(me.id)) return { ok: false, error: "That isn't one of your goals." };
  await db
    .update(teamGoals)
    .set({ status, updated_at: new Date() })
    .where(and(eq(teamGoals.workspace_id, workspaceId), eq(teamGoals.id, id)));
  return { ok: true };
}

/** Goals a member sees in their portal: team-wide, their own, and (managers) their reports'. */
export async function getMyGoals(
  workspaceId: string,
  userId: string,
): Promise<{ team: TeamGoal[]; mine: TeamGoal[]; reports: TeamGoal[] }> {
  const all = await listTeamGoals(workspaceId);
  const [me] = await db
    .select({ id: teamMembers.id, team_role: teamMembers.team_role })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const team = all.filter((g) => g.scope === "team");
  const mine = me ? all.filter((g) => g.scope === "individual" && g.member_ids.includes(me.id)) : [];
  let reports: TeamGoal[] = [];
  if (me?.team_role === "manager") {
    const reportRows = await getDirectReports(workspaceId, me.id);
    const reportIds = new Set(reportRows.map((r) => r.id));
    reports = all.filter((g) => g.scope === "individual" && g.member_ids.some((mid) => reportIds.has(mid)));
  }
  return { team, mine, reports };
}

// ── Team documents (Phase 4) ─────────────────────────────────────────────────

function toDocument(r: typeof teamDocuments.$inferSelect): TeamDocument {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as TeamDocumentKind,
    url: r.url,
    content: r.content,
    created_by_name: r.created_by_name,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listTeamDocuments(workspaceId: string): Promise<TeamDocument[]> {
  const rows = await db
    .select()
    .from(teamDocuments)
    .where(eq(teamDocuments.workspace_id, workspaceId))
    .orderBy(desc(teamDocuments.created_at));
  return rows.map(toDocument);
}

export interface TeamDocumentInput {
  title: string;
  kind: TeamDocumentKind;
  url?: string;
  content?: string;
}

/** Any team member can add a shared document. `fallbackName` names the owner (no member row). */
export async function createTeamDocument(
  workspaceId: string,
  userId: string,
  input: TeamDocumentInput,
  fallbackName: string,
): Promise<{ ok: true; document: TeamDocument } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the document a title." };
  const kind: TeamDocumentKind = input.kind === "note" ? "note" : "link";
  if (kind === "link" && !(input.url ?? "").trim()) return { ok: false, error: "Add a link URL." };
  if (kind === "note" && !(input.content ?? "").trim()) return { ok: false, error: "Add some content." };
  const [me] = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const now = new Date();
  const [row] = await db
    .insert(teamDocuments)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      title: title.slice(0, 200),
      kind,
      url: kind === "link" ? (input.url ?? "").trim().slice(0, 2000) : "",
      content: kind === "note" ? (input.content ?? "").slice(0, 20000) : "",
      created_by_member_id: me?.id ?? null,
      created_by_name: (me?.name || fallbackName || "Someone").slice(0, 120),
      created_at: now,
      updated_at: now,
    })
    .returning();
  return { ok: true, document: toDocument(row) };
}

/** Owner/manager can remove any shared document; a contributor only their own. */
export async function deleteTeamDocument(
  workspaceId: string,
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [doc] = await db
    .select({ created_by_member_id: teamDocuments.created_by_member_id })
    .from(teamDocuments)
    .where(and(eq(teamDocuments.workspace_id, workspaceId), eq(teamDocuments.id, id)))
    .limit(1);
  if (!doc) return { ok: true };
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    const [me] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
      .limit(1);
    if (!me || doc.created_by_member_id !== me.id) {
      return { ok: false, error: "You can only remove documents you added." };
    }
  }
  await db.delete(teamDocuments).where(and(eq(teamDocuments.workspace_id, workspaceId), eq(teamDocuments.id, id)));
  return { ok: true };
}

// ── Team chat (Phase 5) ──────────────────────────────────────────────────────

/** List chat channels, seeding a default "general" the first time. */
export async function listChatChannels(workspaceId: string, userId: string): Promise<ChatChannel[]> {
  let rows = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.workspace_id, workspaceId))
    .orderBy(asc(chatChannels.created_at));
  if (!rows.length) {
    const now = new Date();
    await db.insert(chatChannels).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      name: "general",
      created_by_member_id: null,
      created_at: now,
      updated_at: now,
    });
    rows = await db
      .select()
      .from(chatChannels)
      .where(eq(chatChannels.workspace_id, workspaceId))
      .orderBy(asc(chatChannels.created_at));
  }
  // This user's read markers → unread = others' messages since they last read.
  const reads = await db
    .select({ channel_id: chatReads.channel_id, last_read_at: chatReads.last_read_at })
    .from(chatReads)
    .where(and(eq(chatReads.workspace_id, workspaceId), eq(chatReads.user_id, userId)));
  const lastReadByChannel = new Map(reads.map((r) => [r.channel_id, r.last_read_at]));
  return Promise.all(
    rows.map(async (r) => {
      const since = lastReadByChannel.get(r.id);
      const conds = [
        eq(chatMessages.workspace_id, workspaceId),
        eq(chatMessages.channel_id, r.id),
        ne(chatMessages.sender_user_id, userId),
      ];
      if (since) conds.push(gt(chatMessages.created_at, since));
      // tenant-scope-exempt: conds[0] is eq(chatMessages.workspace_id, workspaceId)
      const [row] = await db.select({ n: count() }).from(chatMessages).where(and(...conds));
      return { id: r.id, name: r.name, unread: Number(row?.n ?? 0), created_at: new Date(r.created_at).toISOString() };
    }),
  );
}

export async function markChannelRead(workspaceId: string, userId: string, channelId: string): Promise<void> {
  const [existing] = await db
    .select({ id: chatReads.id })
    .from(chatReads)
    .where(
      and(
        eq(chatReads.workspace_id, workspaceId),
        eq(chatReads.user_id, userId),
        eq(chatReads.channel_id, channelId),
      ),
    )
    .limit(1);
  const now = new Date();
  if (existing) {
    await db.update(chatReads).set({ last_read_at: now }).where(eq(chatReads.id, existing.id));
  } else {
    await db.insert(chatReads).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      user_id: userId,
      channel_id: channelId,
      last_read_at: now,
    });
  }
}

/** Delete a channel + its messages/read markers. Owner/manager only. */
export async function deleteChatChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can delete channels." };
  }
  await db.delete(chatMessages).where(and(eq(chatMessages.workspace_id, workspaceId), eq(chatMessages.channel_id, channelId)));
  await db.delete(chatReads).where(and(eq(chatReads.workspace_id, workspaceId), eq(chatReads.channel_id, channelId)));
  await db.delete(chatChannels).where(and(eq(chatChannels.workspace_id, workspaceId), eq(chatChannels.id, channelId)));
  return { ok: true };
}

/** Delete a message. The sender can delete their own; owner/manager can delete any. */
export async function deleteChatMessage(
  workspaceId: string,
  userId: string,
  messageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [msg] = await db
    .select({ sender_user_id: chatMessages.sender_user_id })
    .from(chatMessages)
    .where(and(eq(chatMessages.workspace_id, workspaceId), eq(chatMessages.id, messageId)))
    .limit(1);
  if (!msg) return { ok: true };
  if (msg.sender_user_id !== userId) {
    const role = await getWorkspaceRole(workspaceId, userId);
    if (role !== "owner" && role !== "manager") return { ok: false, error: "You can only delete your own messages." };
  }
  await db.delete(chatMessages).where(and(eq(chatMessages.workspace_id, workspaceId), eq(chatMessages.id, messageId)));
  return { ok: true };
}

export async function createChatChannel(
  workspaceId: string,
  userId: string,
  name: string,
): Promise<{ ok: true; channel: ChatChannel } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can add channels." };
  }
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!clean) return { ok: false, error: "Give the channel a name." };
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const now = new Date();
  const [row] = await db
    .insert(chatChannels)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      name: clean,
      created_by_member_id: me?.id ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return {
    ok: true,
    channel: { id: row.id, name: row.name, unread: 0, created_at: new Date(row.created_at).toISOString() },
  };
}

/** Messages in a channel (oldest→newest), each flagged `mine` for the viewer. */
export async function listChatMessages(
  workspaceId: string,
  userId: string,
  channelId: string,
  limit = 100,
): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.workspace_id, workspaceId), eq(chatMessages.channel_id, channelId)))
    .orderBy(desc(chatMessages.created_at))
    .limit(limit);
  return rows.reverse().map((r) => ({
    id: r.id,
    sender_name: r.sender_name,
    body: r.body,
    mine: r.sender_user_id === userId,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

export async function sendChatMessage(
  workspaceId: string,
  userId: string,
  channelId: string,
  body: string,
  fallbackName: string,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; error: string }> {
  const clean = body.trim();
  if (!clean) return { ok: false, error: "Message is empty." };
  const [ch] = await db
    .select({ id: chatChannels.id })
    .from(chatChannels)
    .where(and(eq(chatChannels.workspace_id, workspaceId), eq(chatChannels.id, channelId)))
    .limit(1);
  if (!ch) return { ok: false, error: "That channel no longer exists." };
  const [me] = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const now = new Date();
  const [row] = await db
    .insert(chatMessages)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      channel_id: channelId,
      sender_user_id: userId,
      sender_member_id: me?.id ?? null,
      sender_name: (me?.name || fallbackName || "Someone").slice(0, 120),
      body: clean.slice(0, 4000),
      created_at: now,
    })
    .returning();
  return {
    ok: true,
    message: {
      id: row.id,
      sender_name: row.sender_name,
      body: row.body,
      mine: true,
      created_at: new Date(row.created_at).toISOString(),
    },
  };
}

// ── Assignments (handoffs) ──────────────────────────────────────────────────

function toAssignment(
  r: typeof teamAssignments.$inferSelect,
  memberName: string,
  projectTitle: string | null = null,
): TeamAssignment {
  return {
    id: r.id,
    member_id: r.member_id,
    member_name: memberName,
    ref_type: (r.ref_type as TeamAssignment["ref_type"]) ?? null,
    ref_id: r.ref_id ?? null,
    title: r.title,
    handoff_note: r.handoff_note,
    status: r.status as AssignmentStatus,
    deadline: r.deadline ? new Date(r.deadline).toISOString() : null,
    project_id: r.project_id ?? null,
    project_title: projectTitle,
    created_by_member_id: r.created_by_member_id ?? null,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listAssignments(workspaceId: string): Promise<TeamAssignment[]> {
  const rows = await db
    .select({ a: teamAssignments, memberName: teamMembers.name, projectTitle: humanProjects.title })
    .from(teamAssignments)
    .leftJoin(teamMembers, eq(teamAssignments.member_id, teamMembers.id))
    .leftJoin(humanProjects, eq(teamAssignments.project_id, humanProjects.id))
    .where(eq(teamAssignments.workspace_id, workspaceId))
    .orderBy(desc(teamAssignments.created_at));
  return rows.map((r) => toAssignment(r.a, r.memberName ?? "—", r.projectTitle ?? null));
}

export interface AssignmentInput {
  member_id: string;
  title: string;
  handoff_note?: string;
  deadline?: string | null;
  ref_type?: TeamAssignment["ref_type"];
  ref_id?: string | null;
  /** Phase 2: attach to a human project + record the delegator. */
  project_id?: string | null;
  created_by_member_id?: string | null;
}

export async function createAssignment(
  workspaceId: string,
  input: AssignmentInput,
): Promise<{ ok: true; assignment: TeamAssignment } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the handoff a title." };
  if (!input.member_id) return { ok: false, error: "Pick a team member." };

  // Confirm the member belongs to this workspace (also gives us the display name).
  const [member] = await db
    .select({ name: teamMembers.name })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, input.member_id)))
    .limit(1);
  if (!member) return { ok: false, error: "That team member no longer exists." };

  const now = new Date();
  const [row] = await db
    .insert(teamAssignments)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      member_id: input.member_id,
      ref_type: input.ref_type ?? null,
      ref_id: input.ref_id ?? null,
      title: title.slice(0, 200),
      handoff_note: (input.handoff_note ?? "").slice(0, 4000),
      status: "assigned",
      deadline: input.deadline ? new Date(input.deadline) : null,
      project_id: input.project_id ?? null,
      created_by_member_id: input.created_by_member_id ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return { ok: true, assignment: toAssignment(row, member.name) };
}

export async function updateAssignment(
  workspaceId: string,
  id: string,
  patch: { status?: AssignmentStatus; title?: string; handoff_note?: string; deadline?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.status === "string") set.status = patch.status;
  if (typeof patch.title === "string") {
    if (!patch.title.trim()) return { ok: false, error: "Title can't be empty." };
    set.title = patch.title.trim().slice(0, 200);
  }
  if (typeof patch.handoff_note === "string") set.handoff_note = patch.handoff_note.slice(0, 4000);
  if (patch.deadline !== undefined) set.deadline = patch.deadline ? new Date(patch.deadline) : null;
  await db
    .update(teamAssignments)
    .set(set)
    .where(and(eq(teamAssignments.workspace_id, workspaceId), eq(teamAssignments.id, id)));
  return { ok: true };
}

export async function deleteAssignment(workspaceId: string, id: string): Promise<{ ok: true }> {
  await db
    .delete(teamAssignments)
    .where(and(eq(teamAssignments.workspace_id, workspaceId), eq(teamAssignments.id, id)));
  return { ok: true };
}

// ── Member portal (member-scoped reads/writes) ──────────────────────────────

/** The member's own profile + assignments (scoped to who they are, not the workspace). */
export async function getPortalData(
  workspaceId: string,
  userId: string,
): Promise<{
  member: TeamMember | null;
  assignments: TeamAssignment[];
  reports: TeamMember[];
  projects: HumanProject[];
}> {
  // `allProjects` doesn't depend on the member row, so resolve it in parallel.
  const [rows, allProjects] = await Promise.all([
    db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
      .limit(1),
    listHumanProjects(workspaceId),
  ]);
  const [row] = rows;
  if (!row) return { member: null, assignments: [], reports: [], projects: [] };
  // Assignments, the manager's name, and direct reports are mutually independent
  // once we have the member row — run them together instead of in sequence.
  const [assignments, managerName, reports] = await Promise.all([
    db
      .select()
      .from(teamAssignments)
      .where(and(eq(teamAssignments.workspace_id, workspaceId), eq(teamAssignments.member_id, row.id)))
      .orderBy(desc(teamAssignments.created_at)),
    row.manager_id
      ? db
          .select({ name: teamMembers.name })
          .from(teamMembers)
          .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, row.manager_id)))
          .limit(1)
          .then((r) => r[0]?.name ?? null)
      : Promise.resolve<string | null>(null),
    row.team_role === "manager" ? getDirectReports(workspaceId, row.id) : Promise.resolve<TeamMember[]>([]),
  ]);
  const myProjects = allProjects.filter((p) => p.lead_member_id === row.id || p.manager_member_id === row.id);
  const projectTitleById = new Map(allProjects.map((p) => [p.id, p.title]));
  return {
    member: toMember(row, managerName),
    assignments: assignments.map((a) =>
      toAssignment(a, row.name, a.project_id ? projectTitleById.get(a.project_id) ?? null : null),
    ),
    reports,
    projects: myProjects,
  };
}

/** A member updates the status of one of THEIR OWN assignments (ownership enforced). */
export async function updateMyAssignmentStatus(
  workspaceId: string,
  userId: string,
  assignmentId: string,
  status: AssignmentStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [m] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  if (!m) return { ok: false, error: "No team profile found." };
  await db
    .update(teamAssignments)
    .set({ status, updated_at: new Date() })
    .where(
      and(
        eq(teamAssignments.workspace_id, workspaceId),
        eq(teamAssignments.id, assignmentId),
        eq(teamAssignments.member_id, m.id),
      ),
    );
  return { ok: true };
}

// ── AI context ──────────────────────────────────────────────────────────────

const OPEN_STATUSES: AssignmentStatus[] = ["assigned", "in_progress", "blocked"];

/**
 * A compact roster + open-handoff summary for the Executive/Boardroom, so they
 * reason about the team. Returns "" when there's no team yet.
 */
/** "Mar 14" + days until the next occurrence of a stored birthday, or null. */
function birthdayInfo(raw: string): { label: string; daysUntil: number } | null {
  const m = raw.match(/(?:\d{4}-)?(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(start.getFullYear(), month - 1, day);
  if (next.getTime() < start.getTime()) next = new Date(start.getFullYear() + 1, month - 1, day);
  const daysUntil = Math.round((next.getTime() - start.getTime()) / 86_400_000);
  return { label: next.toLocaleDateString("en-US", { month: "short", day: "numeric" }), daysUntil };
}

/**
 * A full roster the Executive/Boardroom read: each person's role, place in the
 * hierarchy, skills, birthday, start date, timezone, and description — plus an
 * upcoming-birthdays list and open handoffs. Returns "" when there's no team yet.
 */
export async function getTeamContext(workspaceId: string): Promise<string> {
  const members = await listTeamMembers(workspaceId);
  const active = members.filter((m) => m.status !== "inactive");
  if (!active.length) return "";

  // Reverse the reporting edge so each manager can list who they manage.
  const reportsByManager = new Map<string, string[]>();
  for (const m of active) {
    if (m.manager_id) reportsByManager.set(m.manager_id, [...(reportsByManager.get(m.manager_id) ?? []), m.name]);
  }

  const roster = active
    .map((m) => {
      const tags: string[] = [];
      if (m.team_role === "manager") {
        const reps = reportsByManager.get(m.id);
        tags.push(reps?.length ? `Manager of ${reps.join(", ")}` : "Manager");
      }
      if (m.manager_name) tags.push(`reports to ${m.manager_name}`);
      const bday = m.birthday ? birthdayInfo(m.birthday) : null;
      const facts = [
        m.skills.length ? `Skills: ${m.skills.join(", ")}` : "",
        bday ? `Birthday: ${bday.label}` : "",
        m.start_date ? `Started: ${m.start_date}` : "",
        m.timezone ? `Timezone: ${m.timezone}` : "",
      ].filter(Boolean);
      const head = `- ${m.name} — ${m.role_title || "—"}${tags.length ? ` (${tags.join("; ")})` : ""}`;
      const factLine = facts.length ? `\n  ${facts.join(" · ")}` : "";
      const about = m.description ? `\n  About: ${m.description}` : "";
      return `${head}${factLine}${about}`;
    })
    .join("\n");

  // Upcoming birthdays, soonest first — so "whose birthday is coming up?" just works.
  const birthdays = active
    .map((m) => ({ name: m.name, info: m.birthday ? birthdayInfo(m.birthday) : null }))
    .filter((b): b is { name: string; info: { label: string; daysUntil: number } } => b.info !== null)
    .sort((a, b) => a.info.daysUntil - b.info.daysUntil);
  const bdayText = birthdays.length
    ? "\n\nUpcoming birthdays (soonest first):\n" +
      birthdays
        .map((b) => `- ${b.name}: ${b.info.label} (in ${b.info.daysUntil} day${b.info.daysUntil === 1 ? "" : "s"})`)
        .join("\n")
    : "";

  // Active team goals (team-wide + individual), so plans ladder to them.
  const goals = (await listTeamGoals(workspaceId)).filter((g) => g.status === "active");
  const goalsText = goals.length
    ? "\n\nTeam goals (active):\n" +
      goals
        .slice(0, 40)
        .map(
          (g) =>
            `- [${g.horizon}] ${g.scope === "individual" ? g.member_names.join(", ") || "someone" : "Team"}: ${g.title}`,
        )
        .join("\n")
    : "";

  const assignments = await listAssignments(workspaceId);
  const open = assignments.filter((a) => OPEN_STATUSES.includes(a.status));
  const openText = open.length
    ? "\n\nOpen handoffs:\n" +
      open
        .slice(0, 30)
        .map((a) => {
          const due = a.deadline ? `, due ${a.deadline.slice(0, 10)}` : "";
          return `- ${a.member_name}: ${a.title} (${a.status}${due})`;
        })
        .join("\n")
    : "";

  return `Team (${active.length} member${active.length === 1 ? "" : "s"}):\n${roster}${goalsText}${bdayText}${openText}`.slice(
    0,
    8000,
  );
}

// ── Team calendar (Phase: refinements) ───────────────────────────────────────

function toEvent(r: typeof teamEvents.$inferSelect, memberName: string | null = null): TeamEvent {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    kind: r.kind as TeamEventKind,
    starts_at: new Date(r.starts_at).toISOString(),
    duration_minutes: r.duration_minutes,
    recurrence: r.recurrence,
    recurrence_until: r.recurrence_until ? new Date(r.recurrence_until).toISOString() : null,
    member_id: r.member_id ?? null,
    member_name: memberName,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listTeamEvents(workspaceId: string): Promise<TeamEvent[]> {
  const rows = await db
    .select()
    .from(teamEvents)
    .where(eq(teamEvents.workspace_id, workspaceId))
    .orderBy(asc(teamEvents.starts_at));
  if (!rows.length) return [];
  const memberRows = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId));
  const nameById = new Map(memberRows.map((m) => [m.id, m.name]));
  return rows.map((r) => toEvent(r, r.member_id ? nameById.get(r.member_id) ?? null : null));
}

export interface TeamEventInput {
  title: string;
  detail?: string;
  kind: TeamEventKind;
  starts_at: string;
  duration_minutes?: number;
  recurrence?: string;
  recurrence_until?: string | null;
  member_id?: string | null;
}

/** Clamp a duration to a sane 15 min – 24 h window (default 1 h). */
function clampDuration(n?: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 60;
  return Math.min(Math.max(v, 15), 24 * 60);
}
/** Normalize any recurrence label to a stored keyword ("" when non-recurring). */
function ruleKeyword(rule?: string): string {
  const f = normFreq(rule ?? "");
  return f === "none" ? "" : f;
}

export async function createTeamEvent(
  workspaceId: string,
  userId: string,
  input: TeamEventInput,
): Promise<{ ok: true; event: TeamEvent } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can add calendar entries." };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the entry a title." };
  const when = new Date(input.starts_at);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Pick a valid date & time." };
  const kind: TeamEventKind = input.kind === "one_on_one" || input.kind === "event" ? input.kind : "meeting";
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const now = new Date();
  const [row] = await db
    .insert(teamEvents)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      title: title.slice(0, 200),
      detail: (input.detail ?? "").slice(0, 2000),
      kind,
      starts_at: when,
      duration_minutes: clampDuration(input.duration_minutes),
      recurrence: ruleKeyword(input.recurrence),
      recurrence_until: input.recurrence_until ? new Date(input.recurrence_until) : null,
      member_id: kind === "one_on_one" ? input.member_id || null : null,
      created_by_member_id: me?.id ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  return { ok: true, event: toEvent(row) };
}

export async function deleteTeamEvent(
  workspaceId: string,
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can remove calendar entries." };
  }
  await db.delete(teamEvents).where(and(eq(teamEvents.workspace_id, workspaceId), eq(teamEvents.id, id)));
  return { ok: true };
}

export interface TeamEventPatch {
  title?: string;
  detail?: string;
  kind?: TeamEventKind;
  starts_at?: string;
  duration_minutes?: number;
  recurrence?: string;
  recurrence_until?: string | null;
  member_id?: string | null;
}

export async function updateTeamEvent(
  workspaceId: string,
  userId: string,
  id: string,
  patch: TeamEventPatch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can edit calendar entries." };
  }
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.title === "string") {
    if (!patch.title.trim()) return { ok: false, error: "Title can't be empty." };
    set.title = patch.title.trim().slice(0, 200);
  }
  if (typeof patch.detail === "string") set.detail = patch.detail.slice(0, 2000);
  if (patch.kind === "meeting" || patch.kind === "one_on_one" || patch.kind === "event") set.kind = patch.kind;
  if (patch.starts_at) {
    const d = new Date(patch.starts_at);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Pick a valid date & time." };
    set.starts_at = d;
  }
  if (patch.duration_minutes !== undefined) set.duration_minutes = clampDuration(patch.duration_minutes);
  if (patch.recurrence !== undefined) set.recurrence = ruleKeyword(patch.recurrence);
  if (patch.recurrence_until !== undefined) {
    set.recurrence_until = patch.recurrence_until ? new Date(patch.recurrence_until) : null;
  }
  if (patch.member_id !== undefined) set.member_id = patch.member_id || null;
  await db.update(teamEvents).set(set).where(and(eq(teamEvents.workspace_id, workspaceId), eq(teamEvents.id, id)));
  return { ok: true };
}

/** One event by id (for the details / edit view). */
export async function getTeamEvent(workspaceId: string, id: string): Promise<TeamEvent | null> {
  const [r] = await db
    .select()
    .from(teamEvents)
    .where(and(eq(teamEvents.workspace_id, workspaceId), eq(teamEvents.id, id)))
    .limit(1);
  if (!r) return null;
  let name: string | null = null;
  if (r.member_id) {
    const [m] = await db
      .select({ name: teamMembers.name })
      .from(teamMembers)
      .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, r.member_id)))
      .limit(1);
    name = m?.name ?? null;
  }
  return toEvent(r, name);
}

/* ── Recurrence expansion ─────────────────────────────────────────────────── */

type Freq = "none" | "daily" | "weekly" | "biweekly" | "monthly";

/** Interpret a stored recurrence keyword/label into a frequency. */
function normFreq(rule: string): Freq {
  const s = (rule || "").toLowerCase();
  if (/bi.?week|every other|fortnight|2\s*week/.test(s)) return "biweekly";
  if (/week/.test(s)) return "weekly";
  if (/dail|day/.test(s)) return "daily";
  if (/month/.test(s)) return "monthly";
  return "none";
}
function stepFreq(d: Date, freq: Freq): Date {
  const x = new Date(d);
  if (freq === "daily") x.setDate(x.getDate() + 1);
  else if (freq === "weekly") x.setDate(x.getDate() + 7);
  else if (freq === "biweekly") x.setDate(x.getDate() + 14);
  else if (freq === "monthly") x.setMonth(x.getMonth() + 1);
  return x;
}
/** Start times of an event's occurrences within [from, to), respecting an until date. */
function expandOccurrences(
  start: Date,
  rule: string,
  until: Date | null | undefined,
  from: Date,
  to: Date,
): Date[] {
  const freq = normFreq(rule);
  if (freq === "none") {
    return start.getTime() >= from.getTime() && start.getTime() < to.getTime() ? [start] : [];
  }
  const stop = until ?? null;
  const res: Date[] = [];
  let cur = new Date(start);
  // Fast-forward fixed-interval series close to `from` so an old daily event
  // doesn't iterate thousands of times before reaching the window.
  const stepMs =
    freq === "daily" ? 86_400_000 : freq === "weekly" ? 7 * 86_400_000 : freq === "biweekly" ? 14 * 86_400_000 : 0;
  if (stepMs && cur.getTime() < from.getTime()) {
    const jumps = Math.floor((from.getTime() - cur.getTime()) / stepMs);
    cur = new Date(cur.getTime() + jumps * stepMs);
  }
  let guard = 0;
  while (cur.getTime() < to.getTime() && guard++ < 1000) {
    if (stop && cur.getTime() > stop.getTime()) break;
    if (cur.getTime() >= from.getTime()) res.push(new Date(cur));
    cur = stepFreq(cur, freq);
  }
  return res;
}

/** All calendar items in [from, to): team events (recurrences expanded) + derived deadlines. */
async function buildCalendarItems(workspaceId: string, from: Date, to: Date): Promise<CalendarItem[]> {
  const memberRows = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId));
  const nameById = new Map(memberRows.map((m) => [m.id, m.name]));
  const items: CalendarItem[] = [];
  const inRange = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime();

  const events = await db.select().from(teamEvents).where(eq(teamEvents.workspace_id, workspaceId));
  for (const e of events) {
    const who = e.member_id ? nameById.get(e.member_id) ?? null : null;
    const until = e.recurrence_until ? new Date(e.recurrence_until) : null;
    for (const occ of expandOccurrences(new Date(e.starts_at), e.recurrence, until, from, to)) {
      items.push({
        id: `${e.id}@${occ.getTime()}`,
        source_id: e.id,
        kind: e.kind as CalendarItem["kind"],
        title: e.title,
        when: occ.toISOString(),
        duration_min: e.duration_minutes,
        who,
        recurrence: e.recurrence,
        detail: e.detail,
        editable: true,
      });
    }
  }

  const hps = await db
    .select({ id: humanProjects.id, title: humanProjects.title, deadline: humanProjects.deadline, lead: humanProjects.lead_member_id })
    .from(humanProjects)
    .where(and(eq(humanProjects.workspace_id, workspaceId), isNotNull(humanProjects.deadline)));
  for (const p of hps) {
    if (!p.deadline) continue;
    const when = new Date(p.deadline);
    if (!inRange(when)) continue;
    items.push({
      id: `hp-${p.id}`,
      source_id: `hp-${p.id}`,
      kind: "deadline",
      title: `${p.title} — due`,
      when: when.toISOString(),
      duration_min: 0,
      who: p.lead ? nameById.get(p.lead) ?? null : null,
      recurrence: "",
      detail: "",
      editable: false,
    });
  }

  const tas = await db
    .select({ id: teamAssignments.id, title: teamAssignments.title, deadline: teamAssignments.deadline, member: teamAssignments.member_id })
    .from(teamAssignments)
    .where(and(eq(teamAssignments.workspace_id, workspaceId), isNotNull(teamAssignments.deadline)));
  for (const t of tas) {
    if (!t.deadline) continue;
    const when = new Date(t.deadline);
    if (!inRange(when)) continue;
    items.push({
      id: `ta-${t.id}`,
      source_id: `ta-${t.id}`,
      kind: "deadline",
      title: `${t.title} — due`,
      when: when.toISOString(),
      duration_min: 0,
      who: t.member ? nameById.get(t.member) ?? null : null,
      recurrence: "",
      detail: "",
      editable: false,
    });
  }

  return items;
}

/** Upcoming items (next ~120 days), sorted; each recurring event collapses to its NEXT occurrence. */
export async function getTeamCalendar(workspaceId: string): Promise<CalendarItem[]> {
  const from = new Date(Date.now() - 2 * 86_400_000);
  const to = new Date(Date.now() + 120 * 86_400_000);
  const items = (await buildCalendarItems(workspaceId, from, to)).sort(
    (a, b) => new Date(a.when).getTime() - new Date(b.when).getTime(),
  );
  const seen = new Set<string>();
  const out: CalendarItem[] = [];
  for (const it of items) {
    if (seen.has(it.source_id)) continue; // one row per meeting/deadline, its soonest instance
    seen.add(it.source_id);
    out.push(it);
  }
  return out.slice(0, 100);
}

/** Every occurrence whose start falls in [fromISO, toISO) — for the week-grid view (any week). */
export async function getTeamCalendarRange(
  workspaceId: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarItem[]> {
  const items = await buildCalendarItems(workspaceId, new Date(fromISO), new Date(toISO));
  return items.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
}

// ── Meetings (manual notes + Notion import → assigned tasks, see below) ───────

function toMeeting(r: typeof teamMeetings.$inferSelect, nameById: Map<string, string>): TeamMeeting {
  const ids = (r.attendee_ids ?? []) as string[];
  return {
    id: r.id,
    title: r.title,
    meeting_date: new Date(r.meeting_date).toISOString(),
    notes: r.notes,
    attendee_ids: ids,
    attendee_names: ids.map((id) => nameById.get(id)).filter((n): n is string => !!n),
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listTeamMeetings(workspaceId: string): Promise<TeamMeeting[]> {
  const rows = await db
    .select()
    .from(teamMeetings)
    .where(eq(teamMeetings.workspace_id, workspaceId))
    .orderBy(desc(teamMeetings.meeting_date));
  if (!rows.length) return [];
  const memberRows = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId));
  const nameById = new Map(memberRows.map((m) => [m.id, m.name]));
  return rows.map((r) => toMeeting(r, nameById));
}

export interface TeamMeetingInput {
  title: string;
  meeting_date: string;
  notes?: string;
  attendee_ids?: string[];
}

export async function createTeamMeeting(
  workspaceId: string,
  userId: string,
  input: TeamMeetingInput,
): Promise<{ ok: true; meeting: TeamMeeting } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can add meetings." };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the meeting a title." };
  const when = new Date(input.meeting_date);
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const now = new Date();
  const [row] = await db
    .insert(teamMeetings)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      title: title.slice(0, 200),
      meeting_date: Number.isNaN(when.getTime()) ? now : when,
      notes: (input.notes ?? "").slice(0, 20000),
      attendee_ids: (input.attendee_ids ?? []).filter(Boolean),
      created_by_member_id: me?.id ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning();
  const memberRows = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId));
  return { ok: true, meeting: toMeeting(row, new Map(memberRows.map((m) => [m.id, m.name]))) };
}

export async function updateTeamMeeting(
  workspaceId: string,
  userId: string,
  id: string,
  patch: { title?: string; notes?: string; meeting_date?: string; attendee_ids?: string[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can edit meetings." };
  }
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.title === "string") {
    if (!patch.title.trim()) return { ok: false, error: "Title can't be empty." };
    set.title = patch.title.trim().slice(0, 200);
  }
  if (typeof patch.notes === "string") set.notes = patch.notes.slice(0, 20000);
  if (patch.meeting_date) {
    const d = new Date(patch.meeting_date);
    if (!Number.isNaN(d.getTime())) set.meeting_date = d;
  }
  if (Array.isArray(patch.attendee_ids)) set.attendee_ids = patch.attendee_ids.filter(Boolean);
  await db.update(teamMeetings).set(set).where(and(eq(teamMeetings.workspace_id, workspaceId), eq(teamMeetings.id, id)));
  return { ok: true };
}

export async function deleteTeamMeeting(
  workspaceId: string,
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can delete meetings." };
  }
  await db.delete(teamMeetings).where(and(eq(teamMeetings.workspace_id, workspaceId), eq(teamMeetings.id, id)));
  return { ok: true };
}

// ── Import a meeting from Notion → tasks ─────────────────────────────────────
// We use Notion AI to transcribe meetings; this pulls a transcript page, has the
// LLM (Haiku) structure it, and the manager confirms participants + assigns the
// action items as team tasks. Read-only against Notion — nothing is written back.

/** Case-insensitive match of a spoken name to a roster member (exact → first-name). */
function matchMemberByName(name: string, members: { id: string; name: string }[]): string | null {
  const n = name.toLowerCase().trim();
  if (!n) return null;
  const exact = members.find((m) => m.name.toLowerCase() === n);
  if (exact) return exact.id;
  const first = n.split(/\s+/)[0];
  const byFirst = members.find((m) => {
    const mn = m.name.toLowerCase();
    return mn.split(/\s+/)[0] === first || mn === n;
  });
  return byFirst?.id ?? null;
}

export interface NotionMeetingPage {
  id: string;
  title: string;
  url: string;
  last_edited: string;
}

/** Recently-edited Notion pages the integration can read (owner/manager only). */
export async function listNotionMeetingPages(
  workspaceId: string,
  userId: string,
): Promise<{ connected: boolean; pages: NotionMeetingPage[]; error?: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { connected: false, pages: [], error: "Only owners and managers can import meetings." };
  }
  const token = await getValidAccessToken(workspaceId, "Notion");
  if (!token) return { connected: false, pages: [] };
  try {
    const pages = await searchNotionPages(token, 20);
    return { connected: true, pages };
  } catch {
    return { connected: true, pages: [], error: "Couldn't reach Notion. Reconnect it in Integrations." };
  }
}

export interface MeetingPreviewAction {
  title: string;
  detail: string;
  /** Owner name as written in the notes (for display); null if unassigned. */
  owner_name: string | null;
  /** Roster member the owner name resolved to (pre-fills the assignee); null if no match. */
  member_id: string | null;
  due: string | null;
}

export interface MeetingPreview {
  ok: boolean;
  error?: string;
  title: string;
  date: string | null;
  summary: string;
  /** The pulled transcript (best-effort plain text). */
  notes: string;
  /** Roster members matched from the detected participants (pre-fills attendees). */
  attendee_ids: string[];
  actions: MeetingPreviewAction[];
}

/** Pull a Notion page and structure it into an editable meeting preview. */
export async function previewNotionMeeting(
  workspaceId: string,
  userId: string,
  pageId: string,
  pageTitle?: string,
): Promise<MeetingPreview> {
  const empty: MeetingPreview = { ok: false, title: "", date: null, summary: "", notes: "", attendee_ids: [], actions: [] };
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ...empty, error: "Only owners and managers can import meetings." };
  }
  const id = (pageId ?? "").trim();
  if (!id) return { ...empty, error: "Pick a Notion page." };
  const token = await getValidAccessToken(workspaceId, "Notion");
  if (!token) return { ...empty, error: "Notion isn't connected. Connect it in Integrations first." };

  let notes = "";
  try {
    notes = await getNotionPageContent(token, id);
  } catch {
    return { ...empty, error: "Couldn't read that Notion page. Make sure it's shared with the Operator integration." };
  }
  if (!notes.trim()) {
    return { ...empty, error: "That Notion page looks empty — is the transcript on the page itself?" };
  }

  const memberRows = await db
    .select({ id: teamMembers.id, name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId));

  const titleHint = (pageTitle ?? "").trim() || "Meeting";
  let extraction: MeetingExtraction | null = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    extraction = await runWithUsage(workspaceId, "notion-meeting-extract", () =>
      extractMeeting({ title: titleHint, text: notes }, memberRows.map((m) => m.name), today),
    );
  } catch (e) {
    return { ...empty, notes, error: e instanceof Error ? e.message : "Couldn't analyze the meeting." };
  }
  if (!extraction) return { ...empty, notes, error: "Couldn't extract anything from that page." };

  const attendee_ids = Array.from(
    new Set(
      extraction.participants
        .map((p) => matchMemberByName(p, memberRows))
        .filter((x): x is string => !!x),
    ),
  );
  const actions: MeetingPreviewAction[] = extraction.actions.map((a) => ({
    title: a.title,
    detail: a.detail,
    owner_name: a.owner,
    member_id: a.owner ? matchMemberByName(a.owner, memberRows) : null,
    due: a.due,
  }));

  return {
    ok: true,
    title: extraction.title || titleHint,
    date: extraction.date,
    summary: extraction.summary,
    notes,
    attendee_ids,
    actions,
  };
}

export interface MeetingImportInput {
  title: string;
  meeting_date: string;
  notes: string;
  attendee_ids: string[];
  actions: { title: string; detail: string; member_id: string | null; deadline: string | null }[];
}

/** Persist the confirmed meeting + create a team task for each assigned action item. */
export async function importNotionMeeting(
  workspaceId: string,
  userId: string,
  input: MeetingImportInput,
): Promise<{ ok: true; meeting: TeamMeeting; assignments: number } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner" && role !== "manager") {
    return { ok: false, error: "Only owners and managers can import meetings." };
  }

  const created = await createTeamMeeting(workspaceId, userId, {
    title: input.title,
    meeting_date: input.meeting_date,
    notes: input.notes,
    attendee_ids: input.attendee_ids,
  });
  if (!created.ok) return created;

  // The importer's member id — recorded as the delegator on each resulting task.
  const [me] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);

  let assignments = 0;
  for (const a of input.actions) {
    if (!a.member_id || !a.title.trim()) continue;
    const note = a.detail?.trim()
      ? `${a.detail.trim()}\n\nFrom meeting: ${created.meeting.title}`
      : `From meeting: ${created.meeting.title}`;
    const r = await createAssignment(workspaceId, {
      member_id: a.member_id,
      title: a.title,
      handoff_note: note,
      deadline: a.deadline ?? null,
      ref_type: "meeting",
      ref_id: created.meeting.id,
      created_by_member_id: me?.id ?? null,
    });
    if (r.ok) assignments++;
  }

  return { ok: true, meeting: created.meeting, assignments };
}

// ── Team settings + shared Google Drive folder ───────────────────────────────

async function getTeamSetting(workspaceId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: teamSettings.value })
    .from(teamSettings)
    .where(and(eq(teamSettings.workspace_id, workspaceId), eq(teamSettings.key, key)))
    .limit(1);
  return row?.value ?? null;
}

async function setTeamSetting(workspaceId: string, key: string, value: string): Promise<void> {
  const [existing] = await db
    .select({ id: teamSettings.id })
    .from(teamSettings)
    .where(and(eq(teamSettings.workspace_id, workspaceId), eq(teamSettings.key, key)))
    .limit(1);
  if (existing) {
    await db.update(teamSettings).set({ value, updated_at: new Date() }).where(eq(teamSettings.id, existing.id));
  } else {
    await db
      .insert(teamSettings)
      .values({ id: randomUUID(), workspace_id: workspaceId, key, value, updated_at: new Date() });
  }
}

export async function getTeamDriveFolder(workspaceId: string): Promise<{ id: string; name: string } | null> {
  const raw = await getTeamSetting(workspaceId, "drive_folder");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: string; name?: string };
    return parsed.id ? { id: parsed.id, name: parsed.name ?? "Team folder" } : null;
  } catch {
    return null;
  }
}

/** Pull a Google Drive folder id out of a share link (or accept a raw id). */
function parseDriveFolderId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) ?? s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

export async function setTeamDriveFolder(
  workspaceId: string,
  userId: string,
  folderUrlOrId: string,
): Promise<{ ok: true; folder: { id: string; name: string } } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner") return { ok: false, error: "Only the workspace owner can set the team Drive folder." };
  const folderId = parseDriveFolderId(folderUrlOrId);
  if (!folderId) return { ok: false, error: "Paste a Google Drive folder link." };
  const token = await getValidAccessToken(workspaceId, "Gmail");
  if (!token) return { ok: false, error: "Connect Google in Integrations first." };
  try {
    const meta = await getDriveMeta(token, folderId);
    if (!meta.isFolder) return { ok: false, error: "That link points to a file, not a folder." };
    await setTeamSetting(workspaceId, "drive_folder", JSON.stringify({ id: meta.id, name: meta.name }));
    return { ok: true, folder: { id: meta.id, name: meta.name } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read that folder." };
  }
}

export async function clearTeamDriveFolder(
  workspaceId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (role !== "owner") return { ok: false, error: "Only the owner can change this." };
  await setTeamSetting(workspaceId, "drive_folder", "");
  return { ok: true };
}

export interface DriveBrowse {
  connected: boolean;
  teamFolder: { id: string; name: string } | null;
  folder: { id: string; name: string } | null;
  entries: DriveEntry[];
  error?: string;
}

/** Browse within the shared team Drive folder. A requested subfolder must be
 *  inside the team folder's subtree; anything else falls back to the team root. */
export async function browseTeamDrive(
  workspaceId: string,
  userId: string,
  folderId?: string,
): Promise<DriveBrowse> {
  const teamFolder = await getTeamDriveFolder(workspaceId);
  const token = await getValidAccessToken(workspaceId, "Gmail");
  if (!token) return { connected: false, teamFolder, folder: null, entries: [] };
  if (!teamFolder) return { connected: true, teamFolder: null, folder: null, entries: [] };
  let target = teamFolder.id;
  let targetName = teamFolder.name;
  if (folderId && folderId !== teamFolder.id) {
    try {
      if (await isWithinDriveFolder(token, folderId, teamFolder.id)) {
        target = folderId;
        targetName = (await getDriveMeta(token, folderId)).name;
      }
    } catch {
      /* fall back to the team root */
    }
  }
  try {
    const entries = await listDriveFolder(token, target);
    return { connected: true, teamFolder, folder: { id: target, name: targetName }, entries };
  } catch (e) {
    return {
      connected: true,
      teamFolder,
      folder: { id: target, name: targetName },
      entries: [],
      error: e instanceof Error ? e.message : "Couldn't list the folder.",
    };
  }
}
