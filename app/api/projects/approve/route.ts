import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { workspaceIdForUser } from "@/lib/db/queries";
import { approveProjectPlan } from "@/lib/agents/project";

/**
 * Approve a project plan and materialize phase 1 for the signed-in user. A
 * ROUTE (not a server action) on purpose: materializing drafts the phase's
 * deliverables (minutes of AI work), and a slow server action would queue every
 * later load/save in the tab behind it. Via fetch, the app stays responsive —
 * the project flips to active within ~2s, its task rows appear as "Agent
 * Working" cards, and the drafts fill in as they complete.
 * Body: { projectId }
 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return NextResponse.json({ ok: false, error: "no workspace" }, { status: 404 });

  let projectId = "";
  try {
    const body = (await request.json()) as { projectId?: string };
    projectId = typeof body.projectId === "string" ? body.projectId : "";
  } catch {
    /* handled below */
  }
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId required" }, { status: 400 });

  try {
    const meta = user.user_metadata as { full_name?: string } | undefined;
    const name = meta?.full_name || user.email?.split("@")[0] || "You";
    const result = await approveProjectPlan(ws, projectId, { name });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't approve the plan" },
      { status: 500 },
    );
  }
}
