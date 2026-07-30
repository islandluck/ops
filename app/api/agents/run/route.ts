import { NextResponse, type NextRequest } from "next/server";
import { runBackgroundAgents } from "@/lib/agents/run";
import { advanceActiveProjects } from "@/lib/agents/project";

/**
 * Cron entry point — runs background-enabled agents across workspaces.
 * Secure with a CRON_SECRET env var; Vercel Cron sends it as a Bearer token.
 * Manual test: GET /api/agents/run?key=<CRON_SECRET>
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");

  if (secret) {
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }

  try {
    const result = await runBackgroundAgents();
    // Advance any active projects whose current phase is complete (the heartbeat
    // that moves long-running projects forward phase by phase).
    const projects = await advanceActiveProjects();
    return NextResponse.json({ ok: true, ...result, projectsAdvanced: projects.advanced });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "run failed" },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
