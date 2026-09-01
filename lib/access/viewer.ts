import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamMembers, workspaceMembers } from "@/lib/db/schema";
import { PAGES, resolveMemberPages } from "./pages";

/**
 * Who is looking, and at what scope. The owner sees their own plane (data with no
 * member scope); a member sees only their own slice. `scopeUserId` is the data-scope
 * key: null = the owner's plane, a user id = that member's plane.
 */
export interface Viewer {
  userId: string;
  workspaceId: string;
  isOwner: boolean;
  isMember: boolean;
  scopeUserId: string | null;
  /** Page keys this viewer may open. */
  allowedPages: string[];
  /** The member's team_members row id (null for the owner). */
  teamMemberId: string | null;
}

const ALL_PAGE_KEYS = PAGES.map((p) => p.key);

export async function getViewer(userId: string, workspaceId: string): Promise<Viewer> {
  const [wm] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspace_id, workspaceId), eq(workspaceMembers.user_id, userId)))
    .limit(1);
  const isMember = wm?.role === "member";

  if (!isMember) {
    return {
      userId,
      workspaceId,
      isOwner: true,
      isMember: false,
      scopeUserId: null,
      allowedPages: ALL_PAGE_KEYS,
      teamMemberId: null,
    };
  }

  const [tm] = await db
    .select({ id: teamMembers.id, access: teamMembers.page_access })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const allowed = resolveMemberPages(tm?.access as string[] | undefined);

  return {
    userId,
    workspaceId,
    isOwner: false,
    isMember: true,
    scopeUserId: userId,
    allowedPages: [...allowed],
    teamMemberId: tm?.id ?? null,
  };
}
