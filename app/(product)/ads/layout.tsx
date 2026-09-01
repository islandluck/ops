import { requirePageAccess } from "@/lib/access/guard";

/** Grantable: a member reaches Ads Manager only if the owner granted it. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/ads");
  return <>{children}</>;
}
