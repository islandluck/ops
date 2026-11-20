import { requirePageAccess } from "@/lib/access/guard";

/** Grantable: a member reaches Quotes only if the owner granted it. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/quotes");
  return <>{children}</>;
}
