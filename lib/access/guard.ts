import "server-only";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { workspaceIdForUser } from "@/lib/db/queries";
import { getViewer } from "./viewer";

/**
 * Authoritative server-side page guards for Operator Lite. Used from a route's
 * server `layout.tsx` so a member can never reach a page by typing its URL — the
 * middleware gate is a fast UX redirect; this is the real (DB-derived) boundary.
 *
 * redirect() throws NEXT_REDIRECT, so it is always called OUTSIDE the try/catch —
 * a resolution hiccup must never block the owner, and must never swallow a redirect.
 */

/** Owner-only page: send any team member back to their home. */
export async function requireOwnerPage(): Promise<void> {
  let isMember = false;
  try {
    const user = await getCurrentUser();
    if (user) {
      const ws = await workspaceIdForUser(user.id);
      if (ws) isMember = (await getViewer(user.id, ws)).isMember;
    }
  } catch {
    isMember = false;
  }
  if (isMember) redirect("/today");
}

/** Grantable page: a member reaches it only if the owner granted that page key. */
export async function requirePageAccess(pageKey: string): Promise<void> {
  let deny = false;
  let target = "/today";
  try {
    const user = await getCurrentUser();
    if (user) {
      const ws = await workspaceIdForUser(user.id);
      if (ws) {
        const viewer = await getViewer(user.id, ws);
        if (viewer.isMember && !viewer.allowedPages.includes(pageKey)) {
          deny = true;
          target = viewer.allowedPages[0] ?? "/today";
        }
      }
    }
  } catch {
    deny = false;
  }
  if (deny) redirect(target);
}
