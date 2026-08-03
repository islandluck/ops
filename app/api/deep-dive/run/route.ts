import { NextResponse, type NextRequest } from "next/server";
import { advanceDeepDives } from "@/lib/agents/deepdive";

/**
 * Cron entry point — advances in-progress Deep Dives a bounded step at a time.
 * Secured with CRON_SECRET (Vercel Cron sends it as a Bearer token).
 * Manual test: GET /api/deep-dive/run?key=<CRON_SECRET>
 */
export const maxDuration = 60;

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
    const result = await advanceDeepDives();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "run failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
