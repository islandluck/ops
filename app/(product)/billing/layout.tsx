import { requireOwnerPage } from "@/lib/access/guard";

/** Owner-only: billing is the workspace owner's subscription + payment. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return <>{children}</>;
}
