import { AppShell } from "@/components/app/app-shell";

/**
 * The product app. Both the workspace owner ("Operator Pro" — every page) and team
 * members ("Operator Lite" — the same shell, gated to the pages the owner granted)
 * render here. The bundle the store loads is scoped to the viewer server-side, and
 * member routes are gated in middleware + the sidebar, so a member only ever sees
 * their own plane and their permitted pages.
 */
export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
