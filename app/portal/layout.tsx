import { redirect } from "next/navigation";

/**
 * The stripped-down team portal is retired. Team members now get "Operator Lite" —
 * the full app shell, scoped to their own plane and the pages the owner granted —
 * so anyone landing on /portal is sent to their home in the real app.
 */
export default function PortalLayout() {
  redirect("/today");
}
