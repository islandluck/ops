import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { humanProjects, projects, teamAssignments, teamMembers, workspaceMembers } from "@/lib/db/schema";
import type {
  AssignmentStatus,
  HumanProject,
  HumanProjectStatus,
  TeamAssignment,
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
 * Project an AI project into the team plane through the sanitized gate: copies
 * ONLY the title + summary/goal (never the plan, rationale, or agent context) plus
 * a deadline the owner sets. Owner-gated at the action layer.
 */
export async function handoffAiProjectToHumans(
  workspaceId: string,
  aiProjectId: string,
  opts: { lead_member_id?: string | null; manager_member_id?: string | null; deadline?: string | null },
): Promise<{ ok: true; project: HumanProject } | { ok: false; error: string }> {
  const [ai] = await db
    .select({ title: projects.title, goal: projects.goal, summary: projects.summary })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, aiProjectId)))
    .limit(1);
  if (!ai) return { ok: false, error: "That project no longer exists." };
  // Sanitized projection — the WHAT, never the how/why. Only title + summary cross.
  return createHumanProject(workspaceId, {
    title: (ai.title || ai.goal || "Project").slice(0, 200),
    summary: (ai.summary || ai.goal || "").slice(0, 4000),
    lead_member_id: opts.lead_member_id ?? null,
    manager_member_id: opts.manager_member_id ?? null,
    deadline: opts.deadline ?? null,
    source: "ai_handoff",
    source_project_id: aiProjectId,
  });
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
  const [row] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  if (!row) return { member: null, assignments: [], reports: [], projects: [] };
  const assignments = await db
    .select()
    .from(teamAssignments)
    .where(and(eq(teamAssignments.workspace_id, workspaceId), eq(teamAssignments.member_id, row.id)))
    .orderBy(desc(teamAssignments.created_at));
  // Resolve the manager's name for display.
  let managerName: string | null = null;
  if (row.manager_id) {
    const [mgr] = await db
      .select({ name: teamMembers.name })
      .from(teamMembers)
      .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, row.manager_id)))
      .limit(1);
    managerName = mgr?.name ?? null;
  }
  // A manager also sees their direct reports (for delegation).
  const reports = row.team_role === "manager" ? await getDirectReports(workspaceId, row.id) : [];
  // Human projects this member leads or manages, + a title lookup for their tasks.
  const allProjects = await listHumanProjects(workspaceId);
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

  return `Team (${active.length} member${active.length === 1 ? "" : "s"}):\n${roster}${bdayText}${openText}`.slice(0, 8000);
}
