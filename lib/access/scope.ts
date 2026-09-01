import "server-only";

import { eq, isNull, type Column, type SQL } from "drizzle-orm";

/**
 * A drizzle predicate that restricts a personal table to the viewer's plane.
 * scopeUserId === null  → the workspace owner's plane (member_user_id IS NULL).
 * scopeUserId === "<id>" → that member's own plane (member_user_id = id).
 *
 * Pair this with the usual `workspace_id` filter, e.g.
 *   .where(and(eq(tasks.workspace_id, ws), scopeFilter(tasks.member_user_id, scope)))
 */
export function scopeFilter(memberCol: Column, scopeUserId: string | null): SQL {
  return scopeUserId ? eq(memberCol, scopeUserId) : (isNull(memberCol) as SQL);
}
