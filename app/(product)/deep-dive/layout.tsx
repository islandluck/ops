import { requirePageAccess } from "@/lib/access/guard";

/** Grantable: a member reaches Deep Dive only if the owner granted it. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/deep-dive");
  return <>{children}</>;
}
