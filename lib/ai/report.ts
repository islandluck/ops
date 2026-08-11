import "server-only";

import { eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage, profiles, workspaces } from "@/lib/db/schema";

/**
 * AI usage report for the operator — aggregates Claude token usage across ALL
 * workspaces (admin-gated at the action layer) so you can see which customers cost
 * the most in AI. Cost is estimated from Anthropic list prices per model family.
 */

export interface AiUsageRow {
  workspaceId: string | null;
  name: string;
  email: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiUsageReport {
  rows: AiUsageRow[];
  totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  windowDays: number | null;
}

/** USD per 1M tokens, by model family (Anthropic list prices). */
const PRICING: Record<string, { in: number; out: number }> = {
  opus: { in: 5, out: 25 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
  fable: { in: 10, out: 50 },
};
function rateFor(model: string): { in: number; out: number } {
  const m = (model || "").toLowerCase();
  if (m.includes("sonnet")) return PRICING.sonnet;
  if (m.includes("haiku")) return PRICING.haiku;
  if (m.includes("fable")) return PRICING.fable;
  return PRICING.opus; // opus + anything unknown priced at Opus rates
}

/** Who may see the cross-tenant operator report. Set ADMIN_EMAILS (comma-separated)
 *  to whatever account(s) you sign in with; defaults to the known operator emails. */
const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ?? "laron@androsinnovations.com,laronburrows@gmail.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function getAiUsageReport(days?: number): Promise<AiUsageReport> {
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;

  const agg = await db
    .select({
      ws: aiUsage.workspace_id,
      model: aiUsage.model,
      calls: sql<string>`count(*)`,
      inTok: sql<string>`coalesce(sum(${aiUsage.input_tokens}), 0)`,
      outTok: sql<string>`coalesce(sum(${aiUsage.output_tokens}), 0)`,
    })
    // tenant-scope-exempt: operator report intentionally aggregates across ALL workspaces (admin-gated).
    .from(aiUsage)
    .where(since ? gte(aiUsage.created_at, since) : undefined)
    .groupBy(aiUsage.workspace_id, aiUsage.model);

  const wsRows = await db
    .select({ id: workspaces.id, name: workspaces.name, email: profiles.email })
    .from(workspaces)
    .leftJoin(profiles, eq(profiles.id, workspaces.owner_id));
  const wsMap = new Map(wsRows.map((r) => [r.id, { name: r.name, email: r.email ?? "" }]));

  const byWs = new Map<string, AiUsageRow>();
  for (const a of agg) {
    const key = a.ws ?? "__unattributed__";
    const meta = a.ws ? wsMap.get(a.ws) : undefined;
    const row =
      byWs.get(key) ??
      ({
        workspaceId: a.ws,
        name: a.ws ? meta?.name ?? "(deleted workspace)" : "Unattributed",
        email: a.ws ? meta?.email ?? "" : "",
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      } satisfies AiUsageRow);
    const inTok = Number(a.inTok) || 0;
    const outTok = Number(a.outTok) || 0;
    const rate = rateFor(a.model);
    row.calls += Number(a.calls) || 0;
    row.inputTokens += inTok;
    row.outputTokens += outTok;
    row.costUsd += (inTok / 1e6) * rate.in + (outTok / 1e6) * rate.out;
    byWs.set(key, row);
  }

  const rows = [...byWs.values()].sort((x, y) => y.costUsd - x.costUsd);
  const totals = rows.reduce(
    (t, r) => ({
      calls: t.calls + r.calls,
      inputTokens: t.inputTokens + r.inputTokens,
      outputTokens: t.outputTokens + r.outputTokens,
      costUsd: t.costUsd + r.costUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
  return { rows, totals, windowDays: days ?? null };
}
