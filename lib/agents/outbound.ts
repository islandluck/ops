import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, businessBriefs, outboundDrafts } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { sendGmail } from "@/lib/integrations/google";
import { executionKilled } from "@/lib/integrations/guardrails";
import { runWithUsage } from "@/lib/ai/usage";
import { composeOutbound } from "@/lib/ai/compose";
import { resolveRecipient } from "./recipient";
import type { OutboundDraft, OutboundDraftStatus, RecipientSource } from "@/lib/types";

/**
 * The Email Manager's AI Outbound Composer. Turns short natural-language asks
 * ("email Jane for a follow-up") into ready-to-send drafts — the founder's tone,
 * their signature, and a resolved recipient they confirm — then sends each on one
 * explicit click. Nothing here sends on its own.
 */

const MAX_INTENTS = 12;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

type ActionResult = { ok: true } | { ok: false; error: string };

function iso(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString() : "";
}

function toDraft(r: typeof outboundDrafts.$inferSelect): OutboundDraft {
  return {
    id: r.id,
    intent: r.intent,
    recipient_name: r.recipient_name,
    to_email: r.to_email,
    recipient_source: r.recipient_source as RecipientSource,
    subject: r.subject,
    body: r.body,
    status: r.status as OutboundDraftStatus,
    error: r.error,
    created_at: iso(r.created_at),
    sent_at: r.sent_at ? iso(r.sent_at) : null,
  };
}

/** Draft one email per intent (single or bulk): compose in-voice, resolve the
 *  recipient, append the signature, and stage it for review. */
export async function composeOutboundDrafts(
  workspaceId: string,
  intents: string[],
): Promise<{ ok: true; drafts: OutboundDraft[] } | { ok: false; error: string }> {
  const clean = intents.map((i) => i.trim()).filter(Boolean).slice(0, MAX_INTENTS);
  if (!clean.length) return { ok: false, error: "Write at least one instruction (one per line)." };

  return runWithUsage(workspaceId, "outbound-compose", async () => {
    const [b] = await db
      .select({
        company: businessBriefs.company_name,
        desc: businessBriefs.business_description,
        offer: businessBriefs.core_offer,
        signature: businessBriefs.email_signature,
        reply_style: businessBriefs.email_reply_style,
      })
      .from(businessBriefs)
      .where(eq(businessBriefs.workspace_id, workspaceId))
      .limit(1);
    const company = b?.company ?? "";
    const context = [b?.desc, b?.offer].filter(Boolean).join(" ").slice(0, 1200);
    const replyStyle = b?.reply_style ?? "";
    const signature = (b?.signature ?? "").trim();
    const now = new Date();

    const rows = await Promise.all(
      clean.map(async (intent) => {
        const base = {
          id: randomUUID(),
          workspace_id: workspaceId,
          intent,
          created_at: now,
          updated_at: now,
          sent_at: null as Date | null,
        };
        try {
          const composed = await composeOutbound({ intent, company, context, replyStyle });
          const rec = await resolveRecipient(workspaceId, composed.recipient_name, composed.recipient_email);
          const body = signature ? `${composed.body.trimEnd()}\n\n${signature}` : composed.body;
          return {
            ...base,
            recipient_name: composed.recipient_name,
            to_email: rec.email,
            recipient_source: rec.source,
            subject: composed.subject,
            body,
            status: "draft" as OutboundDraftStatus,
            error: "",
          };
        } catch (e) {
          return {
            ...base,
            recipient_name: "",
            to_email: "",
            recipient_source: "none" as RecipientSource,
            subject: "",
            body: "",
            status: "failed" as OutboundDraftStatus,
            error: e instanceof Error ? e.message : "Couldn't draft this one.",
          };
        }
      }),
    );

    const inserted = await db.insert(outboundDrafts).values(rows).returning();
    // Newest first, matching the review queue order.
    const drafts = inserted.map(toDraft).sort((a, z) => (a.created_at < z.created_at ? 1 : -1));
    return { ok: true as const, drafts };
  });
}

/** The review queue — everything not yet sent, newest first. */
export async function listOutboundDrafts(workspaceId: string): Promise<OutboundDraft[]> {
  const rows = await db
    .select()
    .from(outboundDrafts)
    .where(and(eq(outboundDrafts.workspace_id, workspaceId), ne(outboundDrafts.status, "sent")))
    .orderBy(desc(outboundDrafts.created_at))
    .limit(50);
  return rows.map(toDraft);
}

/** Edit a draft's recipient / subject / body before sending. Editing the address
 *  marks the recipient as manually set. */
export async function updateOutboundDraft(
  workspaceId: string,
  id: string,
  patch: { to_email?: string; subject?: string; body?: string },
): Promise<ActionResult> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.to_email === "string") {
    set.to_email = patch.to_email.trim();
    set.recipient_source = "manual";
  }
  if (typeof patch.subject === "string") set.subject = patch.subject.slice(0, 300);
  if (typeof patch.body === "string") set.body = patch.body;
  await db
    .update(outboundDrafts)
    .set(set)
    .where(and(eq(outboundDrafts.workspace_id, workspaceId), eq(outboundDrafts.id, id)));
  return { ok: true };
}

/** Send one draft now (reuses the hardened Gmail send path). Requires a valid,
 *  user-visible recipient — outbound to others never guesses an address. */
export async function sendOutboundDraft(workspaceId: string, id: string): Promise<ActionResult> {
  if (executionKilled()) return { ok: false, error: "Sending is paused (the kill switch is on)." };

  const [row] = await db
    .select()
    .from(outboundDrafts)
    .where(and(eq(outboundDrafts.workspace_id, workspaceId), eq(outboundDrafts.id, id)))
    .limit(1);
  if (!row) return { ok: false, error: "Draft not found." };
  if (row.status === "sent") return { ok: true };
  const to = row.to_email.trim();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "Add a valid recipient email first." };
  if (!row.subject.trim() && !row.body.trim()) return { ok: false, error: "This draft is empty." };

  const token = await getValidAccessToken(workspaceId, "Gmail");
  if (!token) {
    await db.update(outboundDrafts).set({ status: "failed", error: "Gmail isn't connected." }).where(eq(outboundDrafts.id, id));
    return { ok: false, error: "Gmail isn't connected." };
  }

  await db.update(outboundDrafts).set({ status: "sending", error: "" }).where(eq(outboundDrafts.id, id));
  try {
    await sendGmail(token, { to, subject: row.subject || "(no subject)", body: row.body });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Send failed.";
    await db.update(outboundDrafts).set({ status: "failed", error }).where(eq(outboundDrafts.id, id));
    return { ok: false, error };
  }

  const now = new Date();
  await db
    .update(outboundDrafts)
    .set({ status: "sent", error: "", sent_at: now, updated_at: now })
    .where(eq(outboundDrafts.id, id));
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "integration_touched",
    actor_type: "human",
    actor_id: "owner",
    summary: `Sent email to ${row.recipient_name || to}: ${row.subject}`.slice(0, 300),
    created_at: now,
  });
  return { ok: true };
}

/** Send every provided draft sequentially. */
export async function bulkSendOutboundDrafts(
  workspaceId: string,
  ids: string[],
): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return { ok: false, error: "No drafts selected." };
  let sent = 0;
  let failed = 0;
  for (const id of unique) {
    const r = await sendOutboundDraft(workspaceId, id);
    if (r.ok) sent += 1;
    else failed += 1;
  }
  return { ok: true, sent, failed };
}

/** Discard a draft. */
export async function discardOutboundDraft(workspaceId: string, id: string): Promise<ActionResult> {
  await db
    .delete(outboundDrafts)
    .where(and(eq(outboundDrafts.workspace_id, workspaceId), eq(outboundDrafts.id, id)));
  return { ok: true };
}
