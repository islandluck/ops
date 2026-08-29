import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getUserRoleInWorkspace, workspaceIdForUser } from "@/lib/db/queries";
import { signOutAction } from "@/app/actions";
import { Logo } from "@/components/brand";
import { NotificationsBell } from "@/components/portal/notifications-bell";

/**
 * The team-member portal shell — a stripped-down area with none of the owner app.
 * Owners are sent to the full app; only members (role="member") stay here.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  let role: string | null = null;
  let authed = false;
  try {
    const user = await getCurrentUser();
    authed = Boolean(user);
    if (user) {
      const ws = await workspaceIdForUser(user.id);
      if (ws) role = await getUserRoleInWorkspace(user.id, ws);
    }
  } catch {
    role = null;
  }
  if (!authed) redirect("/login");
  if (role === "owner") redirect("/approvals");

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-sm font-medium text-muted-foreground">Team portal</span>
        </div>
        <div className="flex items-center gap-3">
          <NotificationsBell />
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-muted-foreground hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
