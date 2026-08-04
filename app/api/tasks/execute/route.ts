import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { workspaceIdForUser } from "@/lib/db/queries";
import { runTaskExecution } from "@/lib/integrations/execute";

/**
 * Execute an approved task for the signed-in user. A ROUTE (not a server
 * action) on purpose: a tab's server actions run sequentially, so a slow
 * execution (external APIs, token refreshes) inside an action would queue —
 * and freeze — every load/save behind it. fetch() runs in parallel.
 * Body: { taskId }
 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return NextResponse.json({ ok: false, error: "no workspace" }, { status: 404 });

  let taskId = "";
  try {
    const body = (await request.json()) as { taskId?: string };
    taskId = typeof body.taskId === "string" ? body.taskId : "";
  } catch {
    /* handled below */
  }
  if (!taskId) return NextResponse.json({ ok: false, error: "taskId required" }, { status: 400 });

  try {
    const meta = user.user_metadata as { full_name?: string } | undefined;
    const name = meta?.full_name || user.email?.split("@")[0] || "You";
    const result = await runTaskExecution(ws, taskId, { name, email: user.email ?? "" });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Execution failed" },
      { status: 500 },
    );
  }
}
