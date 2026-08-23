import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { getCurrentUser } from "@/lib/supabase/server";
import { getUserRoleInWorkspace, workspaceIdForUser } from "@/lib/db/queries";

/**
 * The owner app. Team members (role="member" in their active workspace) are gated
 * out to the restricted /portal — they never load the full workspace here. Owners
 * (and anyone not yet resolved) pass straight through, so existing login is unchanged.
 */
export default async function ProductLayout({ children }: { children: React.ReactNode }) {
  let role: string | null = null;
  try {
    const user = await getCurrentUser();
    if (user) {
      const ws = await workspaceIdForUser(user.id);
      if (ws) role = await getUserRoleInWorkspace(user.id, ws);
    }
  } catch {
    // Never block the owner app on a resolution hiccup — treat as owner and render.
    role = null;
  }
  // redirect() throws a control-flow signal — must be outside the try/catch above.
  if (role === "member") redirect("/portal");
  return <AppShell>{children}</AppShell>;
}
