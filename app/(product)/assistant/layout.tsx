import { requireMemberOnlyPage } from "@/lib/access/guard";

/** Member-only: the Team Assistant is the team member's chief-of-staff (the owner
 *  has the Executive instead). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireMemberOnlyPage();
  return <>{children}</>;
}
