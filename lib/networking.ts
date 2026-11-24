import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessBriefs, networkingTargets, opportunities } from "@/lib/db/schema";
import { listCompanies, listContacts } from "@/lib/crm";
import { stageOutboundDraft } from "@/lib/agents/outbound";
import { planNetworking } from "@/lib/ai/networking";
import type { NetworkingPlan, NetworkingStatus, NetworkingTarget } from "@/lib/types";

/**
 * Networking (Intelligence → Networking), guided mode (v1). The founder points the agent
 * at a person/outcome ("help me network my way to X") + their angle; the agent researches,
 * maps warm paths through the founder's own network, finds events + direct channels, and
 * drafts friendly intros. "Begin" stages those intros into the Email Manager to approve +
 * send. It NEVER sends and NEVER connects on the founder's behalf. See [[outreach-track]].
 */

type Row = typeof networkingTargets.$inferSelect;

function iso(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString() : "";
}

function toTarget(row: Row): NetworkingTarget {
  return {
    id: row.id,
    who: row.who,
    context: row.context,
    status: row.status as NetworkingStatus,
    plan: (row.plan ?? null) as NetworkingPlan | null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function listNetworkingTargets(workspaceId: string): Promise<NetworkingTarget[]> {
  const rows = await db
    .select()
    .from(networkingTargets)
    .where(eq(networkingTargets.workspace_id, workspaceId))
    .orderBy(desc(networkingTargets.updated_at))
    .limit(60);
  return rows.map(toTarget);
}

export async function getNetworkingTarget(workspaceId: string, id: string): Promise<NetworkingTarget | null> {
  const [row] = await db
    .select()
    .from(networkingTargets)
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
    .limit(1);
  return row ? toTarget(row) : null;
}

/** Create a target from the guided intake (who + the founder's angle/context). */
export async function createNetworkingTarget(
  workspaceId: string,
  input: { who: string; context: string },
): Promise<{ ok: true; target: NetworkingTarget } | { ok: false; error: string }> {
  const who = input.who.trim().slice(0, 200);
  if (!who) return { ok: false, error: "Who do you want to reach?" };
  const [row] = await db
    .insert(networkingTargets)
    .values({ workspace_id: workspaceId, who, context: input.context.trim().slice(0, 2000), status: "planning" })
    .returning();
  return { ok: true, target: toTarget(row) };
}

export async function deleteNetworkingTarget(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(networkingTargets).where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)));
  return { ok: true };
}

export async function closeNetworkingTarget(
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; target?: NetworkingTarget; error?: string }> {
  const [row] = await db
    .update(networkingTargets)
    .set({ status: "closed", updated_at: new Date() })
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
    .returning();
  if (!row) return { ok: false, error: "Target not found." };
  return { ok: true, target: toTarget(row) };
}

/** Compact "your existing network" dossier (CRM people + companies) for warm-path reasoning. */
async function gatherNetwork(workspaceId: string): Promise<string> {
  try {
    const [contacts, companies] = await Promise.all([listContacts(workspaceId), listCompanies(workspaceId)]);
    const nameById = new Map(companies.map((c) => [c.id, c.name]));
    const people = contacts
      .slice(0, 60)
      .map((c) => {
        const co = c.company_id ? nameById.get(c.company_id) : "";
        return `- ${c.name}${c.title ? `, ${c.title}` : ""}${co ? ` @ ${co}` : ""}`;
      })
      .join("\n");
    const cos = companies.slice(0, 40).map((c) => `- ${c.name}`).join("\n");
    return [people && `People you know:\n${people}`, cos && `Companies you deal with:\n${cos}`].filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}

/** Compact list of events/opportunities already on the founder's radar. */
async function gatherOpportunities(workspaceId: string): Promise<string> {
  try {
    const rows = await db
      .select({ title: opportunities.title, org: opportunities.org, summary: opportunities.summary })
      .from(opportunities)
      .where(eq(opportunities.workspace_id, workspaceId))
      .orderBy(desc(opportunities.created_at))
      .limit(15);
    return rows
      .map((r) => `- ${r.title}${r.org ? ` (${r.org})` : ""}${r.summary ? ` — ${r.summary.slice(0, 160)}` : ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

/** Research the target and draft (or redraft) the networking plan. */
export async function buildNetworkingPlan(
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; target?: NetworkingTarget; error?: string }> {
  const target = await getNetworkingTarget(workspaceId, id);
  if (!target) return { ok: false, error: "Target not found." };

  await db
    .update(networkingTargets)
    .set({ status: "planning", updated_at: new Date() })
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)));

  try {
    const [[brief], network, opps] = await Promise.all([
      db
        .select({ company: businessBriefs.company_name, desc: businessBriefs.business_description })
        .from(businessBriefs)
        .where(eq(businessBriefs.workspace_id, workspaceId))
        .limit(1),
      gatherNetwork(workspaceId),
      gatherOpportunities(workspaceId),
    ]);
    const plan = await planNetworking({
      who: target.who,
      context: target.context,
      company: brief?.company ?? "",
      companyDescription: brief?.desc ?? "",
      network,
      opportunities: opps,
    });
    const [row] = await db
      .update(networkingTargets)
      .set({ plan, status: "planned", updated_at: new Date() })
      .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
      .returning();
    return { ok: true, target: toTarget(row) };
  } catch (e) {
    // Revert the status so a failed build doesn't leave the target stuck "planning".
    await db
      .update(networkingTargets)
      .set({ status: target.plan ? "planned" : "planning", updated_at: new Date() })
      .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)));
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the plan." };
  }
}

/** Begin the plan: stage its friendly intro drafts into the Email Manager outbound queue
 *  (owner plane) to approve + send. Never sends. Social profiles stay a manual connect. */
export async function beginNetworkingPlan(
  workspaceId: string,
  id: string,
): Promise<{ ok: boolean; target?: NetworkingTarget; staged?: number; error?: string }> {
  const target = await getNetworkingTarget(workspaceId, id);
  if (!target) return { ok: false, error: "Target not found." };
  if (!target.plan) return { ok: false, error: "Draft a plan first." };
  const plan = target.plan;
  if (!plan.drafts.length) return { ok: false, error: "This plan has no intro emails to stage." };

  let staged = 0;
  const drafts = await Promise.all(
    plan.drafts.map(async (d) => {
      if (d.draft_id) return d; // already staged — don't duplicate
      if (!d.body.trim()) return d;
      try {
        const res = await stageOutboundDraft(
          workspaceId,
          {
            to: d.to_email || undefined,
            subject: d.subject || "Quick hello",
            body: d.body,
            recipientName: d.to_name,
            intent: `Networking: ${target.who}${d.purpose ? ` — ${d.purpose}` : ""}`,
          },
          null,
        );
        staged++;
        return { ...d, draft_id: res.draft.id };
      } catch {
        return d;
      }
    }),
  );

  const [row] = await db
    .update(networkingTargets)
    .set({ plan: { ...plan, drafts }, status: "active", updated_at: new Date() })
    .where(and(eq(networkingTargets.workspace_id, workspaceId), eq(networkingTargets.id, id)))
    .returning();
  return { ok: true, target: toTarget(row), staged };
}
