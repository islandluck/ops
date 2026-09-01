import { requireOwnerPage } from "@/lib/access/guard";

/** Owner-only: the business brief holds the company's private operating config. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return <>{children}</>;
}
