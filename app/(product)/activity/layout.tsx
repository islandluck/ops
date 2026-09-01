import { requireOwnerPage } from "@/lib/access/guard";

/** Owner-only: the activity log narrates the owner's plane. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return <>{children}</>;
}
