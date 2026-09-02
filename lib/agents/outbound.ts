import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, businessBriefs, outboundDrafts } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { scopeFilter } from "@/lib/access/scope";
import { getEmailPersona } from "@/lib/agents/email-settings";
import { sendGmail } from "@/lib/integrations/google";
import { executionKilled } from "@/lib/integrations/guardrails";
import { deleteAttachmentAt, getAttachmentBytes } from "@/lib/media/storage";
import { runWithUsage } from "@/lib/ai/usage";
import { composeOutbound, refineOutbound } from "@/lib/ai/compose";
import { resolveRecipientCandidates } from "./recipient";
import type {
  OutboundAttachment,
  OutboundDraft,
  OutboundDraftStatus,
  RecipientCandidate,
  RecipientSource,
} from "@/lib/types";

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

/** The brand + email context that grounds every compose/refine call. The company
 *  context comes from the shared brief; the reply style + signature come from the
 *  viewer's own plane (owner = brief, member = their own settings). */
async function loadComposeContext(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<{
  company: string;
  context: string;
  replyStyle: string;
  signature: string;
}> {
  const [[b], persona] = await Promise.all([
    db
      .select({
        company: businessBriefs.company_name,
        desc: businessBriefs.business_description,
        offer: businessBriefs.core_offer,
      })
      .from(businessBriefs)
      .where(eq(businessBriefs.workspace_id, workspaceId))
      .limit(1),
    getEmailPersona(workspaceId, scopeUserId),
  ]);
  return {
    company: b?.company ?? "",
    context: [b?.desc, b?.offer].filter(Boolean).join(" ").slice(0, 1200),
    replyStyle: persona.replyStyle,
    signature: persona.signature,
  };
}

/** Remove a known trailing signature so a refine edits only the message. */
function stripSignature(body: string, signature: string): string {
  if (!signature) return body;
  const b = body.trimEnd();
  const s = signature.trim();
  return b.endsWith(s) ? b.slice(0, b.length - s.length).trimEnd() : body;
}

function toDraft(r: typeof outboundDrafts.$inferSelect): OutboundDraft {
  return {
    id: r.id,
    intent: r.intent,
    recipient_name: r.recipient_name,
    to_email: r.to_email,
    recipient_source: r.recipient_source as RecipientSource,
    candidates: (r.candidates ?? []) as RecipientCandidate[],
    cc: r.cc,
    bcc: r.bcc,
    subject: r.subject,
    body: r.body,
    attachments: (r.attachments ?? []) as OutboundAttachment[],
    status: r.status as OutboundDraftStatus,
    error: r.error,
    scheduled_at: r.scheduled_at ? iso(r.scheduled_at) : null,
    created_at: iso(r.created_at),
    sent_at: r.sent_at ? iso(r.sent_at) : null,
  };
}

/** Draft one email per intent (single or bulk): compose in-voice, resolve the
 *  recipient, append the signature, and stage it for review. */
export async function composeOutboundDrafts(
  workspaceId: string,
  intents: string[],
  scopeUserId: string | null = null,
): Promise<{ ok: true; drafts: OutboundDraft[] } | { ok: false; error: string }> {
  const clean = intents.map((i) => i.trim()).filter(Boolean).slice(0, MAX_INTENTS);
  if (!clean.length) return { ok: false, error: "Write at least one instruction (one per line)." };

  return runWithUsage(workspaceId, "outbound-compose", async () => {
    const { company, context, replyStyle, signature } = await loadComposeContext(workspaceId, scopeUserId);
    const now = new Date();

    const rows = await Promise.all(
      clean.map(async (intent) => {
        const base = {
          id: randomUUID(),
          workspace_id: workspaceId,
          member_user_id: scopeUserId,
          intent,
          created_at: now,
          updated_at: now,
          sent_at: null as Date | null,
        };
        try {
          const composed = await composeOutbound({ intent, company, context, replyStyle });
          const { primary, candidates } = await resolveRecipientCandidates(
            workspaceId,
            composed.recipient_name,
            composed.recipient_email,
            scopeUserId,
          );
          const body = signature ? `${composed.body.trimEnd()}\n\n${signature}` : composed.body;
          return {
            ...base,
            recipient_name: composed.recipient_name,
            to_email: primary.email,
            recipient_source: primary.source,
            candidates,
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
            candidates: [] as RecipientCandidate[],
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

/**
 * Stage a ready-made outbound draft (no AI compose) — content is already written by
 * the caller (e.g. a meeting brief). Lands in the Email Manager's outbound review
 * queue for the user to confirm recipients and send. Nothing sends on its own.
 */
export async function stageOutboundDraft(
  workspaceId: string,
  input: { to?: string; cc?: string; subject: string; body: string; recipientName?: string; intent?: string },
  scopeUserId: string | null = null,
): Promise<{ ok: true; draft: OutboundDraft }> {
  const to = (input.to ?? "").trim();
  const now = new Date();
  const [row] = await db
    .insert(outboundDrafts)
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      member_user_id: scopeUserId,
      intent: input.intent ?? "",
      recipient_name: input.recipientName ?? "",
      to_email: to,
      recipient_source: to ? "manual" : "none",
      cc: (input.cc ?? "").trim(),
      subject: input.subject.slice(0, 300),
      body: input.body,
      status: "draft",
      error: "",
      created_at: now,
      updated_at: now,
    })
    .returning();
  return { ok: true, draft: toDraft(row) };
}

/** The review queue — everything not yet sent, newest first. */
export async function listOutboundDrafts(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<OutboundDraft[]> {
  const rows = await db
    .select()
    .from(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        ne(outboundDrafts.status, "sent"),
      ),
    )
    .orderBy(desc(outboundDrafts.created_at))
    .limit(50);
  return rows.map(toDraft);
}

/** Edit a draft's recipient / cc / bcc / subject / body before sending. Editing the
 *  address marks the recipient as manually set. */
export async function updateOutboundDraft(
  workspaceId: string,
  id: string,
  patch: { to_email?: string; cc?: string; bcc?: string; subject?: string; body?: string },
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (typeof patch.to_email === "string") {
    set.to_email = patch.to_email.trim();
    set.recipient_source = "manual";
  }
  if (typeof patch.cc === "string") set.cc = patch.cc.trim().slice(0, 500);
  if (typeof patch.bcc === "string") set.bcc = patch.bcc.trim().slice(0, 500);
  if (typeof patch.subject === "string") set.subject = patch.subject.slice(0, 300);
  if (typeof patch.body === "string") set.body = patch.body;
  await db
    .update(outboundDrafts)
    .set(set)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    );
  return { ok: true };
}

/** Deliver a claimed row via Gmail, then mark it sent (or failed). Assumes the
 *  caller already set status = "sending". Shared by manual + scheduled sends. */
async function deliverOutbound(row: typeof outboundDrafts.$inferSelect): Promise<{ ok: boolean; error?: string }> {
  const id = row.id;
  const to = row.to_email.trim();
  const markFailed = async (error: string) => {
    await db
      .update(outboundDrafts)
      .set({ status: "failed", error, updated_at: new Date() })
      .where(eq(outboundDrafts.id, id));
    return { ok: false as const, error };
  };
  if (!EMAIL_RE.test(to)) return markFailed("No valid recipient.");
  // Deliver from the plane the draft belongs to — a member's draft sends from the
  // MEMBER's own Gmail, never the owner's.
  const token = await getValidAccessToken(row.workspace_id, "Gmail", row.member_user_id);
  if (!token) return markFailed("Gmail isn't connected.");
  try {
    // Pull each attachment's bytes from storage; a missing file is skipped, not fatal.
    const atts = ((row.attachments ?? []) as OutboundAttachment[]).slice(0, 10);
    const loaded = await Promise.all(
      atts.map(async (a) => {
        try {
          const { bytes } = await getAttachmentBytes(a.path);
          return { filename: a.name, mime: a.mime, bytes };
        } catch {
          return null;
        }
      }),
    );
    const attachments = loaded.filter((a): a is NonNullable<typeof a> => Boolean(a));
    await sendGmail(token, {
      to,
      cc: row.cc || undefined,
      bcc: row.bcc || undefined,
      subject: row.subject || "(no subject)",
      body: row.body,
      attachments: attachments.length ? attachments : undefined,
    });
  } catch (e) {
    return markFailed(e instanceof Error ? e.message : "Send failed.");
  }
  const now = new Date();
  await db
    .update(outboundDrafts)
    .set({ status: "sent", error: "", scheduled_at: null, sent_at: now, updated_at: now })
    .where(eq(outboundDrafts.id, id));
  // Activity log is the owner plane — record only the owner's sends.
  if (!row.member_user_id) {
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: row.workspace_id,
      task_id: null,
      event_type: "integration_touched",
      actor_type: "human",
      actor_id: "owner",
      summary: `Sent email to ${row.recipient_name || to}: ${row.subject}`.slice(0, 300),
      created_at: now,
    });
  }
  return { ok: true };
}

/** Attach an already-uploaded file (storage path) to a draft. Max 10 per draft. */
export async function addOutboundAttachment(
  workspaceId: string,
  draftId: string,
  att: { name: string; path: string; mime: string; size: number },
  scopeUserId: string | null = null,
): Promise<{ ok: true; attachment: OutboundAttachment } | { ok: false; error: string }> {
  const [row] = await db
    .select({ attachments: outboundDrafts.attachments })
    .from(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, draftId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Draft not found." };
  const current = (row.attachments ?? []) as OutboundAttachment[];
  if (current.length >= 10) return { ok: false, error: "That's the max of 10 attachments." };
  const attachment: OutboundAttachment = {
    id: randomUUID(),
    name: att.name.slice(0, 255) || "attachment",
    path: att.path,
    mime: att.mime,
    size: att.size,
  };
  await db
    .update(outboundDrafts)
    .set({ attachments: [...current, attachment], updated_at: new Date() })
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, draftId),
      ),
    );
  return { ok: true, attachment };
}

/** Remove an attachment from a draft and delete the stored file (best-effort). */
export async function removeOutboundAttachment(
  workspaceId: string,
  draftId: string,
  attachmentId: string,
  scopeUserId: string | null = null,
): Promise<{ ok: true }> {
  const [row] = await db
    .select({ attachments: outboundDrafts.attachments })
    .from(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, draftId),
      ),
    )
    .limit(1);
  if (!row) return { ok: true };
  const current = (row.attachments ?? []) as OutboundAttachment[];
  const gone = current.find((a) => a.id === attachmentId);
  await db
    .update(outboundDrafts)
    .set({ attachments: current.filter((a) => a.id !== attachmentId), updated_at: new Date() })
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, draftId),
      ),
    );
  if (gone) await deleteAttachmentAt(gone.path);
  return { ok: true };
}

/** Send one draft now. Requires a valid, user-visible recipient — outbound to
 *  others never guesses an address. */
export async function sendOutboundDraft(
  workspaceId: string,
  id: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  if (executionKilled()) return { ok: false, error: "Sending is paused (the kill switch is on)." };

  const [row] = await db
    .select()
    .from(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Draft not found." };
  if (row.status === "sent") return { ok: true };
  if (!EMAIL_RE.test(row.to_email.trim())) return { ok: false, error: "Add a valid recipient email first." };
  if (!row.subject.trim() && !row.body.trim()) return { ok: false, error: "This draft is empty." };

  await db.update(outboundDrafts).set({ status: "sending", error: "" }).where(eq(outboundDrafts.id, id));
  const r = await deliverOutbound(row);
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Send failed." };
}

/** Schedule a draft to auto-send at a future time. */
export async function scheduleOutboundDraft(
  workspaceId: string,
  id: string,
  whenISO: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  const when = new Date(whenISO);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Pick a valid time." };
  if (when.getTime() < Date.now() + 30_000) return { ok: false, error: "Pick a time in the future." };
  const [row] = await db
    .select()
    .from(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Draft not found." };
  if (!EMAIL_RE.test(row.to_email.trim())) return { ok: false, error: "Add a valid recipient first." };
  await db
    .update(outboundDrafts)
    .set({ scheduled_at: when, status: "draft", error: "", updated_at: new Date() })
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    );
  return { ok: true };
}

/** Cancel a scheduled send (back to a plain draft). */
export async function unscheduleOutboundDraft(
  workspaceId: string,
  id: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  await db
    .update(outboundDrafts)
    .set({ scheduled_at: null, updated_at: new Date() })
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    );
  return { ok: true };
}

/**
 * Cron: send every scheduled draft whose time has arrived. A two-step claim
 * (select ids → set "sending" where still claimable) prevents double-sends across
 * overlapping ticks; the kill switch pauses all scheduled sends.
 */
async function flushDue(
  workspaceId: string | null,
  limit: number,
  scopeUserId: string | null = null,
): Promise<{ sent: string[]; failed: { id: string; error: string }[] }> {
  if (executionKilled()) return { sent: [], failed: [] };
  const now = new Date();
  const dueConds = [
    isNotNull(outboundDrafts.scheduled_at),
    lte(outboundDrafts.scheduled_at, now),
    inArray(outboundDrafts.status, ["draft", "failed"]),
  ];
  // App path: scoped to one workspace + the caller's plane. Cron path (no
  // workspaceId): flush EVERY plane across all workspaces — each row is delivered
  // via its own plane's token in deliverOutbound.
  if (workspaceId) {
    dueConds.push(eq(outboundDrafts.workspace_id, workspaceId));
    dueConds.push(scopeFilter(outboundDrafts.member_user_id, scopeUserId));
  }
  // tenant-scope-exempt: with no workspaceId this is the cron flushing due drafts
  // across ALL workspaces; each row carries its own workspace_id for delivery.
  const dueIds = await db
    .select({ id: outboundDrafts.id })
    .from(outboundDrafts)
    .where(and(...dueConds))
    .limit(limit);
  if (!dueIds.length) return { sent: [], failed: [] };
  const ids = dueIds.map((d) => d.id);
  const claimed = await db
    .update(outboundDrafts)
    .set({ status: "sending", error: "" })
    .where(
      workspaceId
        ? and(
            eq(outboundDrafts.workspace_id, workspaceId),
            scopeFilter(outboundDrafts.member_user_id, scopeUserId),
            inArray(outboundDrafts.id, ids),
            inArray(outboundDrafts.status, ["draft", "failed"]),
          )
        : and(inArray(outboundDrafts.id, ids), inArray(outboundDrafts.status, ["draft", "failed"])),
    )
    .returning();
  const sent: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const row of claimed) {
    const r = await deliverOutbound(row);
    if (r.ok) sent.push(row.id);
    else failed.push({ id: row.id, error: r.error ?? "Send failed." });
  }
  return { sent, failed };
}

/** Cron entry: send every scheduled draft (across all workspaces) whose time
 *  has arrived. Atomic claim prevents double-sends; kill switch pauses all. */
export async function sendDueOutboundDrafts(limit = 50): Promise<{ sent: number; failed: number }> {
  const r = await flushDue(null, limit);
  return { sent: r.sent.length, failed: r.failed.length };
}

/** Workspace-scoped due flush — lets the app send scheduled emails without waiting
 *  for the cron (called on composer open + a short poll), the same "advance without
 *  cron" pattern Projects + Deep Dive use. Returns the ids sent/failed so the UI can
 *  update only those cards. */
export async function flushDueOutboundDrafts(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<{ sent: string[]; failed: { id: string; error: string }[] }> {
  return flushDue(workspaceId, 25, scopeUserId);
}

/** Send every provided draft sequentially. */
export async function bulkSendOutboundDrafts(
  workspaceId: string,
  ids: string[],
  scopeUserId: string | null = null,
): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return { ok: false, error: "No drafts selected." };
  let sent = 0;
  let failed = 0;
  for (const id of unique) {
    const r = await sendOutboundDraft(workspaceId, id, scopeUserId);
    if (r.ok) sent += 1;
    else failed += 1;
  }
  return { ok: true, sent, failed };
}

/** Refine a draft in place per a short instruction (warmer / shorter / custom).
 *  Edits the message only; the signature is stripped and re-appended cleanly. */
export async function refineOutboundDraft(
  workspaceId: string,
  id: string,
  instruction: string,
  scopeUserId: string | null = null,
): Promise<{ ok: true; draft: OutboundDraft } | { ok: false; error: string }> {
  const inst = instruction.trim();
  if (!inst) return { ok: false, error: "Tell the agent how to change it." };
  const [row] = await db
    .select()
    .from(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Draft not found." };

  return runWithUsage(workspaceId, "outbound-refine", async () => {
    const ctx = await loadComposeContext(workspaceId, scopeUserId);
    const message = stripSignature(row.body, ctx.signature);
    let refined;
    try {
      refined = await refineOutbound({
        subject: row.subject,
        message,
        instruction: inst,
        company: ctx.company,
        replyStyle: ctx.replyStyle,
      });
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't refine this draft." };
    }
    const body = ctx.signature ? `${refined.body.trimEnd()}\n\n${ctx.signature}` : refined.body;
    const [updated] = await db
      .update(outboundDrafts)
      .set({ subject: refined.subject, body, status: "draft", error: "", updated_at: new Date() })
      .where(
        and(
          eq(outboundDrafts.workspace_id, workspaceId),
          scopeFilter(outboundDrafts.member_user_id, scopeUserId),
          eq(outboundDrafts.id, id),
        ),
      )
      .returning();
    return { ok: true as const, draft: toDraft(updated) };
  });
}

/** Re-draft a message from its original instruction (keeps the resolved recipient). */
export async function regenerateOutboundDraft(
  workspaceId: string,
  id: string,
  scopeUserId: string | null = null,
): Promise<{ ok: true; draft: OutboundDraft } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Draft not found." };
  if (!row.intent.trim()) return { ok: false, error: "No original instruction to regenerate from." };

  return runWithUsage(workspaceId, "outbound-compose", async () => {
    const ctx = await loadComposeContext(workspaceId, scopeUserId);
    let composed;
    try {
      composed = await composeOutbound({
        intent: row.intent,
        company: ctx.company,
        context: ctx.context,
        replyStyle: ctx.replyStyle,
      });
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't regenerate this draft." };
    }
    const body = ctx.signature ? `${composed.body.trimEnd()}\n\n${ctx.signature}` : composed.body;
    const [updated] = await db
      .update(outboundDrafts)
      .set({ subject: composed.subject, body, status: "draft", error: "", updated_at: new Date() })
      .where(
        and(
          eq(outboundDrafts.workspace_id, workspaceId),
          scopeFilter(outboundDrafts.member_user_id, scopeUserId),
          eq(outboundDrafts.id, id),
        ),
      )
      .returning();
    return { ok: true as const, draft: toDraft(updated) };
  });
}

/** Discard a draft. */
export async function discardOutboundDraft(
  workspaceId: string,
  id: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  await db
    .delete(outboundDrafts)
    .where(
      and(
        eq(outboundDrafts.workspace_id, workspaceId),
        scopeFilter(outboundDrafts.member_user_id, scopeUserId),
        eq(outboundDrafts.id, id),
      ),
    );
  return { ok: true };
}
