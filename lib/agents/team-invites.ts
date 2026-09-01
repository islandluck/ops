import "server-only";

import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, teamInvites, teamMembers, workspaceMembers, workspaces } from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createTeamMember, type TeamMemberInput } from "@/lib/agents/team";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { sendGmail } from "@/lib/integrations/google";

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
  input: { memberId?: string; email: string; profile?: TeamMemberInput; baseUrl?: string; inviterName?: string },
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

  const base = (input.baseUrl || siteUrl()).replace(/\/$/, "");
  const accept_url = `${base}/invite/accept?token=${token}`;

  // Send a branded invite from the owner's connected Gmail (best-effort). We do NOT
  // pre-create a Supabase auth user — doing so left invitees passwordless AND blocked
  // them from signing up. The account is created at accept time on /invite/accept,
  // authorized by this token.
  try {
    const gmailToken = await getValidAccessToken(workspaceId, "Gmail");
    if (gmailToken) {
      const [wsRow] = await db
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      const wsName = wsRow?.name || "the team";
      const inviter = (input.inviterName || "").trim();
      const subject = `You're invited to join ${wsName}`;
      const bodyText = `${inviter ? `${inviter} invited you` : "You've been invited"} to join ${wsName}.\n\nAccept your invite and set up your account:\n${accept_url}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`;
      await sendGmail(gmailToken, { to: email, subject, body: bodyText, html: inviteEmailHtml({ wsName, inviter, accept_url }) });
      return { ok: true, emailed: true, accept_url };
    }
  } catch {
    /* fall through to the shareable link */
  }
  return {
    ok: true,
    emailed: false,
    accept_url,
    note: "Share this link so they can join. (Connect Gmail in Integrations to email invites automatically.)",
  };
}

/** A simple branded invite email (owner sends it from their own Gmail). */
function inviteEmailHtml(p: { wsName: string; inviter: string; accept_url: string }): string {
  const lead = p.inviter ? `${escapeHtml(p.inviter)} invited you` : "You've been invited";
  return `
  <div style="background:#f6f7f9;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;">
      <div style="font-size:20px;font-weight:700;color:#0f172a;">You're invited 👋</div>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#334155;">
        ${lead} to join <strong>${escapeHtml(p.wsName)}</strong>. Accept below to set up your account and get started.
      </p>
      <div style="margin:24px 0 8px;">
        <a href="${p.accept_url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;">Accept invite →</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">
        Or paste this link: <br>${escapeHtml(p.accept_url)}
      </p>
    </div>
  </div>`;
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

export interface InviteDetails {
  valid: boolean;
  email: string;
  workspaceName: string;
  error?: string;
}

/** Public lookup for the accept page — what workspace + email this token is for. */
export async function getInviteByToken(token: string): Promise<InviteDetails> {
  if (!token) return { valid: false, email: "", workspaceName: "", error: "Missing invite token." };
  // tenant-scope-exempt: looked up by the secret token (the credential); the visitor
  // isn't a member of any workspace yet, and the invite carries its target workspace.
  const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.token, token)).limit(1);
  if (!invite) return { valid: false, email: "", workspaceName: "", error: "This invite link is invalid." };
  if (invite.status === "revoked") {
    return { valid: false, email: invite.email, workspaceName: "", error: "This invite was revoked." };
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { valid: false, email: invite.email, workspaceName: "", error: "This invite has expired — ask for a new one." };
  }
  const [ws] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspace_id))
    .limit(1);
  return { valid: true, email: invite.email, workspaceName: ws?.name || "the team" };
}

/**
 * Create a brand-new account for the invitee (email + password, pre-confirmed via
 * service role) and bind them to the workspace. If the email already has an account,
 * returns `existing: true` so the caller can ask them to sign in instead. The invite
 * token is the credential authorizing account creation for its email.
 */
export async function acceptInviteWithPassword(
  token: string,
  password: string,
): Promise<{ ok: true; workspaceId: string } | { ok: false; existing?: boolean; error: string }> {
  // tenant-scope-exempt: looked up by the secret token (the credential); the invitee
  // has no workspace yet, and the invite carries its target workspace.
  const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.token, token)).limit(1);
  if (!invite) return { ok: false, error: "This invite link is invalid." };
  if (invite.status === "revoked") return { ok: false, error: "This invite was revoked." };
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This invite has expired — ask for a new one." };
  }
  if (!password || password.length < 8) return { ok: false, error: "Choose a password of at least 8 characters." };
  const email = invite.email.toLowerCase();

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { onboarded: true, member: true },
  });
  if (error || !data?.user) {
    const msg = error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      return { ok: false, existing: true, error: "You already have an account with this email — sign in to join." };
    }
    return { ok: false, error: msg || "Couldn't create your account." };
  }
  const res = await acceptInvite(data.user.id, email, token);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, workspaceId: res.workspaceId };
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
