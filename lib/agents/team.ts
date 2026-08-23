import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamAssignments, teamMembers } from "@/lib/db/schema";
import type { AssignmentStatus, TeamAssignment, TeamMember } from "@/lib/types";

/**
 * Team Room engine (Slice 1 — owner side). Roster + profiles + handoffs, plus a
 * team-context summary the Executive/Boardroom read. No member logins yet (Slice 2).
 */

function toMember(r: typeof teamMembers.$inferSelect): TeamMember {
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
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listTeamMembers(workspaceId: string): Promise<TeamMember[]> {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.workspace_id, workspaceId))
    .orderBy(desc(teamMembers.created_at));
  return rows.map(toMember);
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
  // Assignments cascade via the member FK.
  await db.delete(teamMembers).where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, id)));
  return { ok: true };
}

// ── Assignments (handoffs) ──────────────────────────────────────────────────

function toAssignment(r: typeof teamAssignments.$inferSelect, memberName: string): TeamAssignment {
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
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function listAssignments(workspaceId: string): Promise<TeamAssignment[]> {
  const rows = await db
    .select({ a: teamAssignments, memberName: teamMembers.name })
    .from(teamAssignments)
    .leftJoin(teamMembers, eq(teamAssignments.member_id, teamMembers.id))
    .where(eq(teamAssignments.workspace_id, workspaceId))
    .orderBy(desc(teamAssignments.created_at));
  return rows.map((r) => toAssignment(r.a, r.memberName ?? "—"));
}

export interface AssignmentInput {
  member_id: string;
  title: string;
  handoff_note?: string;
  deadline?: string | null;
  ref_type?: TeamAssignment["ref_type"];
  ref_id?: string | null;
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

// ── AI context ──────────────────────────────────────────────────────────────

const OPEN_STATUSES: AssignmentStatus[] = ["assigned", "in_progress", "blocked"];

/**
 * A compact roster + open-handoff summary for the Executive/Boardroom, so they
 * reason about the team. Returns "" when there's no team yet.
 */
export async function getTeamContext(workspaceId: string): Promise<string> {
  const members = await listTeamMembers(workspaceId);
  const active = members.filter((m) => m.status !== "inactive");
  if (!active.length) return "";

  const roster = active
    .map((m) => {
      const bits = [m.role_title && `— ${m.role_title}`, m.description && `: ${m.description}`]
        .filter(Boolean)
        .join(" ");
      const skills = m.skills.length ? ` [skills: ${m.skills.join(", ")}]` : "";
      return `- ${m.name} ${bits}${skills}`.replace(/\s+/g, " ").trim();
    })
    .join("\n");

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

  return `Team (${active.length} member${active.length === 1 ? "" : "s"}):\n${roster}${openText}`.slice(0, 3000);
}
