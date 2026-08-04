import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { workspaceIdForUser } from "@/lib/db/queries";
import { advanceProject, advanceWorkspaceProjects, healStuckProjectTasks } from "@/lib/agents/project";

/**
 * Heal wedged executions + advance/close finished project phases for the
 * signed-in user's workspace. A ROUTE (not a server action) on purpose: server
 * actions from one tab run sequentially, so a slow phase materialization inside
 * an action freezes every later action. fetch() to this route runs in parallel
 * with the app's actions — the UI stays responsive while a phase materializes.
 * Body (optional): { projectId } to advance one project.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 404 });

  let projectId = "";
  try {
    const body = (await request.json()) as { projectId?: string };
    projectId = typeof body.projectId === "string" ? body.projectId : "";
  } catch {
    /* empty body = advance all */
  }

  try {
    const healed = await healStuckProjectTasks(ws).catch(() => ({ healed: 0 }));
    if (projectId) {
      const r = await advanceProject(ws, projectId);
      return NextResponse.json({ ok: true, advanced: r.advanced ? 1 : 0, status: r.status, healed: healed.healed });
    }
    const r = await advanceWorkspaceProjects(ws);
    return NextResponse.json({ ok: true, advanced: r.advanced, healed: healed.healed });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "advance failed" },
      { status: 500 },
    );
  }
}
