import "server-only";

import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, teamInvites, teamMembers, workspaceMembers } from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTeamMember, type TeamMemberInput } from "@/lib/agents/team";

/**
 * Team Room — invite flow (Slice 2a). The owner enters a member's profile + email;
 * we create the profile (status=invited), a token, and send a Supabase invite email.
 * On accept, a workspace_members row (role=member) binds the person to the workspace.
 *
 * A person can belong to MANY workspaces — so if their email already has an account
 * (they own their own workspace), the Supabase invite email can't be sent (already
 * registered); we still create the invite and return an accept link they can open
 * once logged in. Nothing here ever ties an email to a single workspace.
 */

const INVITE_TTL_DAYS = 14;

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export interface TeamInvite {
  id: string;
  member_id: string;
  email: string;
  status: string;
  created_at: string;
  accept_url: string;
}

function toInvite(r: typeof teamInvites.$inferSelect): TeamInvite {
  return {
    id: r.id,
    member_id: r.member_id,
    email: r.email,
    status: r.status,
    created_at: new Date(r.created_at).toISOString(),
    accept_url: `${siteUrl()}/invite/accept?token=${r.token}`,
  };
}

/**
 * Invite a new or existing team member. Creates the profile if `memberId` is omitted,
 * issues an invite token, and sends the Supabase invite email (best-effort).
 */
export async function inviteTeamMember(
  workspaceId: string,
  invitedBy: string | null,
  input: { memberId?: string; email: string; profile?: TeamMemberInput },
): Promise<
  | { ok: true; emailed: boolean; accept_url: string; note?: string }
  | { ok: false; error: string }
> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, error: "A valid email is required." };

  // Resolve (or create) the team_members profile row.
  let memberId = input.memberId;
  if (!memberId) {
    const created = await createTeamMember(workspaceId, {
      ...(input.profile ?? { name: email.split("@")[0] }),
      email,
      status: "invited",
    });
    if (!created.ok) return { ok: false, error: created.error };
    memberId = created.member.id;
  } else {
    await db
      .update(teamMembers)
      .set({ email, status: "invited", updated_at: new Date() })
      .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.id, memberId)));
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
  await db.insert(teamInvites).values({
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    member_id: memberId,
    email,
    role: "member",
    token,
    status: "pending",
    invited_by: invitedBy,
    expires_at: expires,
    created_at: new Date(),
  });

  const accept_url = `${siteUrl()}/invite/accept?token=${token}`;

  // Send the invite email via Supabase (creates a pending auth user + magic link).
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: accept_url,
      data: { pending_invite: true, invite_token: token, onboarded: true },
    });
    if (error) {
      // Most common: the email already has an account (they own another workspace).
      // The invite still stands — they accept by opening the link while logged in.
      return {
        ok: true,
        emailed: false,
        accept_url,
        note: "This email already has an account, so we couldn't auto-send. Share the accept link — they can join once logged in.",
      };
    }
    return { ok: true, emailed: true, accept_url };
  } catch (e) {
    return {
      ok: true,
      emailed: false,
      accept_url,
      note: e instanceof Error ? e.message : "Email couldn't be sent — share the accept link instead.",
    };
  }
}

export async function listInvites(workspaceId: string): Promise<TeamInvite[]> {
  const rows = await db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.workspace_id, workspaceId), eq(teamInvites.status, "pending")))
    .orderBy(desc(teamInvites.created_at));
  return rows.map(toInvite);
}

export async function revokeInvite(workspaceId: string, id: string): Promise<{ ok: true }> {
  await db
    .update(teamInvites)
    .set({ status: "revoked" })
    .where(and(eq(teamInvites.workspace_id, workspaceId), eq(teamInvites.id, id)));
  return { ok: true };
}

/**
 * Bind the logged-in person to the workspace as a member. The auth email MUST match
 * the invite email. Idempotent — re-accepting is a no-op. Sets it as their active
 * workspace so they land in it.
 */
export async function acceptInvite(
  userId: string,
  userEmail: string,
  token: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }> {
  // tenant-scope-exempt: the invitee isn't a member of any workspace yet — the
  // secret token IS the credential, and the workspace is derived from the invite.
  const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.token, token)).limit(1);
  if (!invite) return { ok: false, error: "This invite link is invalid." };
  if (invite.status === "revoked") return { ok: false, error: "This invite was revoked." };
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This invite has expired — ask for a new one." };
  }
  if (invite.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
    return { ok: false, error: "This invite was sent to a different email address." };
  }

  // Create the membership (skip if they're somehow already a member).
  const existing = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.user_id, userId), eq(workspaceMembers.workspace_id, invite.workspace_id)))
    .limit(1);
  if (!existing[0]) {
    await db.insert(workspaceMembers).values({
      workspace_id: invite.workspace_id,
      user_id: userId,
      role: invite.role,
    });
  }

  // Bind the profile row + activate the workspace + mark the invite accepted.
  await db
    .update(teamMembers)
    .set({ user_id: userId, status: "active", updated_at: new Date() })
    .where(and(eq(teamMembers.workspace_id, invite.workspace_id), eq(teamMembers.id, invite.member_id)));
  await db
    .update(teamInvites)
    .set({ status: "accepted", accepted_at: new Date() })
    .where(eq(teamInvites.id, invite.id));
  await db
    .update(profiles)
    .set({ active_workspace_id: invite.workspace_id })
    .where(eq(profiles.id, userId));

  // Clear the pending flag so middleware stops forcing the accept page.
  try {
    const admin = createSupabaseAdminClient();
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { pending_invite: false, invite_token: null, onboarded: true, member: true },
    });
  } catch {
    /* best-effort — the accept page also clears it client-side */
  }

  return { ok: true, workspaceId: invite.workspace_id };
}

/** Accept the latest pending invite matching the signed-in user's email (no token needed). */
export async function acceptPendingInvite(
  userId: string,
  userEmail: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }> {
  // tenant-scope-exempt: matched by the caller's OWN verified auth email, before
  // they belong to any workspace — the invite carries the target workspace.
  const [invite] = await db
    .select({ token: teamInvites.token })
    .from(teamInvites)
    .where(and(eq(teamInvites.email, userEmail.trim().toLowerCase()), eq(teamInvites.status, "pending")))
    .orderBy(desc(teamInvites.created_at))
    .limit(1);
  if (!invite) return { ok: false, error: "No pending invite found for your account." };
  return acceptInvite(userId, userEmail, invite.token);
}
