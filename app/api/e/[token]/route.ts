import { type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { outboundDrafts } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A 1x1 transparent GIF, served for EVERY request — so the endpoint never reveals
// which tokens are valid and never errors inside a recipient's mail client.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function pixel(): Response {
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

/**
 * Email open-tracking pixel. The owner's outbound mail embeds
 * `<img src="/api/e/<token>.gif">`; loading it stamps the open back onto the draft row.
 *
 * Public + unauthenticated by design — a recipient's mail client carries no session —
 * and keyed only by an unguessable per-send token. The `.gif` suffix keeps the request
 * out of the auth middleware (its matcher excludes image extensions). Opens are
 * APPROXIMATE: Apple Mail / Gmail image proxies pre-fetch and cache, so `opened_at`
 * (first load) is the trustworthy signal and the count is a soft upper bound.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token: raw } = await ctx.params;
    const token = (raw || "").replace(/\.gif$/i, "").trim();
    if (/^[a-f0-9]{16,80}$/i.test(token)) {
      // tenant-scope-exempt: a mail client carries no workspace context; the row is
      // located by its own unguessable per-send token, which binds it to one workspace.
      await db
        .update(outboundDrafts)
        .set({
          open_count: sql`${outboundDrafts.open_count} + 1`,
          opened_at: sql`COALESCE(${outboundDrafts.opened_at}, now())`,
          last_opened_at: sql`now()`,
        })
        .where(eq(outboundDrafts.tracking_token, token));
    }
  } catch {
    // A tracking hiccup must never error the image — the recipient just sees a pixel.
  }
  return pixel();
}
