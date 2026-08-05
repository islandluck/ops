import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  agents,
  businessBriefs,
  integrations,
  taskAssets,
  tasks,
  triagedCrm,
} from "@/lib/db/schema";
import { draftWithClaude } from "@/lib/ai/draft";
import { getCurrentContext } from "@/lib/agents/deepdive";
import {
  getHubSpotSnapshot,
  snapshotToContext,
  STALE_DEAL_DAYS,
  type HubSpotSnapshot,
} from "@/lib/integrations/hubspot";
import type { DraftRequest } from "@/lib/types";

/**
 * CRM Radar — the HubSpot mining loop. Scans the CRM for revenue signals the
 * founder would otherwise miss (deals going cold, fresh leads never contacted)
 * and turns the best few into board tasks WITH a drafted next step attached.
 * Approving one sends the email via Gmail (when a recipient is known) and logs
 * it to the HubSpot timeline. Dedup via triaged_crm so a signal fires once.
 */

const MAX_TASKS_PER_SWEEP = 3;

interface CrmSignal {
  ref: string;
  kind: "crm_followup" | "crm_outreach";
  title: string;
  brief: string;
  facts: string;
  to?: string;
  subject: string;
  contactId?: string;
  dealId?: string;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function signalsFrom(snap: HubSpotSnapshot, companyName: string): CrmSignal[] {
  const staleBiggestFirst = [...snap.staleDeals].sort((a, b) => b.amount - a.amount);
  const dealSignals: CrmSignal[] = staleBiggestFirst.map((d) => ({
    ref: `deal:${d.id}:stale`,
    kind: "crm_followup",
    title: `Re-engage: ${d.name}`.slice(0, 120),
    brief: `This deal has had no activity for over ${STALE_DEAL_DAYS} days — draft a short, specific re-engagement message that moves it forward.`,
    facts: [
      `Deal: ${d.name}`,
      d.amount ? `Value: ${money(d.amount)}` : "",
      `Stage: ${d.stageLabel}`,
      d.closeDate ? `Target close: ${d.closeDate.slice(0, 10)}` : "",
      `Last activity: ${d.lastModifiedAt.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    subject: `Checking in — ${d.name}`.slice(0, 140),
    dealId: d.id,
  }));

  const contactSignals: CrmSignal[] = snap.uncontacted.map((c) => ({
    ref: `contact:${c.id}:new`,
    kind: "crm_outreach",
    title: `First outreach: ${c.name}${c.company ? ` (${c.company})` : ""}`.slice(0, 120),
    brief:
      "A new contact landed in the CRM and has never been contacted — draft a warm, personal first email (no hard sell).",
    facts: [
      `Contact: ${c.name}`,
      c.email ? `Email: ${c.email}` : "",
      c.company ? `Company: ${c.company}` : "",
      c.lifecycleStage ? `Lifecycle stage: ${c.lifecycleStage}` : "",
      `Added: ${c.createdAt.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    to: c.email || undefined,
    subject: `Great to connect${companyName ? ` — ${companyName}` : ""}`.slice(0, 140),
    contactId: c.id,
  }));

  // Interleave so one big sweep doesn't drown the board in a single kind.
  const out: CrmSignal[] = [];
  const max = Math.max(dealSignals.length, contactSignals.length);
  for (let i = 0; i < max; i++) {
    if (dealSignals[i]) out.push(dealSignals[i]);
    if (contactSignals[i]) out.push(contactSignals[i]);
  }
  return out;
}

/** Scan one workspace's CRM and surface up to MAX_TASKS_PER_SWEEP drafted tasks. */
export async function runCrmRadar(workspaceId: string): Promise<{ scanned: boolean; created: number }> {
  const snap = await getHubSpotSnapshot(workspaceId).catch(() => null);
  if (!snap?.connected) return { scanned: false, created: 0 };

  const [briefRow] = await db
    .select()
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  const signals = signalsFrom(snap, briefRow?.company_name ?? "");
  if (!signals.length) return { scanned: true, created: 0 };

  const [growth] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspace_id, workspaceId),
        eq(agents.category, "growth"),
        eq(agents.premium, false),
        eq(agents.archived, false),
      ),
    )
    .limit(1);
  const deep = await getCurrentContext(workspaceId).catch(() => null);
  const crmLine = snapshotToContext(snap);

  let created = 0;
  for (const sig of signals) {
    if (created >= MAX_TASKS_PER_SWEEP) break;

    // Fire-once dedup: the unique (workspace, ref) insert is the claim.
    const claimed = await db
      .insert(triagedCrm)
      .values({ id: randomUUID(), workspace_id: workspaceId, ref: sig.ref, created_at: new Date() })
      .onConflictDoNothing()
      .returning({ id: triagedCrm.id });
    if (!claimed.length) continue;

    let draft = "";
    try {
      const req: DraftRequest = {
        category: "growth",
        title: sig.title,
        description: `${sig.brief}\n\n${sig.facts}`,
        rationale: "Surfaced by the CRM Radar from live HubSpot data.",
        companyName: briefRow?.company_name ?? "",
        companyContext: [
          `${briefRow?.business_description ?? ""} ${briefRow?.core_offer ?? ""}`.trim(),
          deep?.summary ?? "",
          crmLine,
        ]
          .filter(Boolean)
          .join("\n\n"),
        idealCustomer: briefRow?.ideal_customer_profile ?? "",
        voiceRules: briefRow?.voice_rules ?? [],
        restrictedPhrases: briefRow?.restricted_phrases ?? [],
        xPost: false,
        agentName: growth?.name,
        agentInstructions: growth?.instructions,
      };
      draft = await draftWithClaude(req);
    } catch {
      continue; // drafting failed — leave the claim so we don't spam retries
    }

    const now = new Date();
    const taskId = randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      workspace_id: workspaceId,
      category: "growth",
      title: sig.title,
      description: sig.brief,
      rationale: sig.facts.replace(/\n/g, " · ").slice(0, 300),
      status: "ready",
      risk_level: "low",
      priority: sig.kind === "crm_followup" ? "high" : "medium",
      due_at: null,
      agent_id: growth?.id ?? null,
      created_by_type: "agent",
      requires_approval: true,
      approval_status: "pending",
      execution_status: "none",
      affected_systems: sig.to ? ["Gmail", "HubSpot"] : ["HubSpot"],
      proposed_actions: 1,
      impact_score: sig.kind === "crm_followup" ? 65 : 55,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskAssets).values({
      id: randomUUID(),
      task_id: taskId,
      asset_type: "email",
      title: sig.to ? `Outreach email to ${sig.to}` : `Follow-up draft — ready to send`,
      content: draft,
      metadata: {
        kind: sig.kind,
        subject: sig.subject,
        ...(sig.to ? { to: sig.to } : {}),
        ...(sig.contactId ? { hubspot_contact_id: sig.contactId, contact_email: sig.to ?? "" } : {}),
        ...(sig.dealId ? { hubspot_deal_id: sig.dealId } : {}),
      },
    });
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: taskId,
      event_type: "agent_updated_draft",
      actor_type: "agent",
      actor_id: growth?.id ?? "sys",
      summary: `${growth?.name ?? "Growth Agent"} drafted “${sig.title}” from live HubSpot data.`,
      created_at: now,
    });
    created += 1;
  }

  return { scanned: true, created };
}

/** Cron sweep: run the CRM Radar for every workspace with HubSpot connected. */
export async function crmRadarSweep(limit = 10): Promise<{ workspaces: number; created: number }> {
  // tenant-scope-exempt: cron sweep finds HubSpot-connected workspaces; each is
  // then scanned via runCrmRadar(workspace_id), which is scoped.
  const rows = await db
    .select({ workspace_id: integrations.workspace_id })
    .from(integrations)
    .where(and(eq(integrations.name, "HubSpot"), eq(integrations.connected, true)))
    .limit(limit);

  let workspaces = 0;
  let created = 0;
  for (const r of rows) {
    try {
      const res = await runCrmRadar(r.workspace_id);
      if (res.scanned) workspaces += 1;
      created += res.created;
    } catch {
      /* one workspace's CRM hiccup never blocks the rest */
    }
  }
  return { workspaces, created };
}
