import { requireOwnerPage } from "@/lib/access/guard";

/** Owner-only: the Executive office is the owner's private Chief of Staff. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return <>{children}</>;
}
