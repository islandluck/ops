import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, businessBriefs, emailTriage } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { scopeFilter } from "@/lib/access/scope";
import {
  archiveMessage,
  getMessageDetail,
  getMessageMeta,
  listInboxPage,
  sendGmail,
  trashMessage,
  type GmailMessage,
  type GmailMeta,
} from "@/lib/integrations/google";
import { learnEmailStyle, type LearnedStyle } from "@/lib/ai/email-style";
import type {
  EmailBody,
  EmailCadence,
  EmailListItem,
  EmailManagerState,
  EmailSettings,
  EmailStatus,
  EmailTriageInfo,
} from "@/lib/types";

/**
 * Email Manager — the read + dispatch operations behind the /email page. The inbox
 * list is LIVE from Gmail; the triage classification + editable draft come from the
 * email_triage table. Send / Archive / Trash are one explicit human click each —
 * nothing here fires on its own.
 *
 * Operator Lite: every op is scoped to a plane via `scopeUserId` (null = the owner's
 * mailbox + settings, unchanged; a member's id = that member's OWN connected mailbox
 * and their own triage rows). A member never reads the owner's mail or settings.
 */

const PAGE_SIZE = 10;

/** Gmail category tabs the user can filter by. Default hides Promotions/Social clutter. */
export const INBOX_CATEGORIES = ["primary", "updates", "promotions", "social"] as const;
const DEFAULT_CATEGORIES: string[] = ["primary", "updates"];
const ALLOWED_CATEGORIES = new Set<string>(INBOX_CATEGORIES);

/**
 * Build the Gmail search query for the chosen category tabs. Filtering here (not
 * client-side) means the API only returns — and we only fetch metadata for — mail
 * that matters, so Promotions/Social never hit the screen or the triage AI.
 */
function buildInboxQuery(categories?: string[]): string {
  const chosen = (categories ?? DEFAULT_CATEGORIES).filter((c) => ALLOWED_CATEGORIES.has(c));
  const cats = chosen.length ? chosen : DEFAULT_CATEGORIES;
  return `in:inbox (${cats.map((c) => `category:${c}`).join(" OR ")})`;
}

const CATEGORY_EMOJI: Record<string, string> = {
  Investor: "💼",
  Customer: "🤝",
  Internal: "🏢",
  Admin: "🧾",
  Noise: "🔕",
};
const URGENCY_RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };
function isAttention(category: string, urgency: string, action: string): boolean {
  return urgency === "Critical" || urgency === "High" || action === "Reply" || action === "Schedule";
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/* -------------------------------- settings -------------------------------- */

const CADENCES: EmailCadence[] = ["off", "hourly", "daily"];

const DEFAULT_SETTINGS: EmailSettings = { signature: "", reply_style: "", cadence: "off" };

async function getSettings(workspaceId: string, scopeUserId: string | null = null): Promise<EmailSettings> {
  // Email settings live on the (shared) business brief — the owner's. A member
  // uses defaults for now; they never read or write the owner's signature/style.
  if (scopeUserId) return { ...DEFAULT_SETTINGS };
  const [b] = await db
    .select({
      signature: businessBriefs.email_signature,
      reply_style: businessBriefs.email_reply_style,
      cadence: businessBriefs.email_triage_cadence,
    })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  const cadence = (CADENCES as string[]).includes(b?.cadence ?? "") ? (b!.cadence as EmailCadence) : "off";
  return { signature: b?.signature ?? "", reply_style: b?.reply_style ?? "", cadence };
}

export async function saveEmailSettings(
  workspaceId: string,
  settings: EmailSettings,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  // The shared brief settings are the owner's; a member can't change them.
  if (scopeUserId) return { ok: true };
  const cadence: EmailCadence = (CADENCES as string[]).includes(settings.cadence) ? settings.cadence : "off";
  await db
    .update(businessBriefs)
    .set({
      email_signature: settings.signature.slice(0, 2000),
      email_reply_style: settings.reply_style.slice(0, 2000),
      email_triage_cadence: cadence,
      updated_at: new Date(),
    })
    .where(eq(businessBriefs.workspace_id, workspaceId));
  return { ok: true };
}

/** Send every provided draft sequentially (bulk send). Returns how many went out. */
export async function bulkSendReplies(
  workspaceId: string,
  messageIds: string[],
  scopeUserId: string | null = null,
): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  const ids = [...new Set(messageIds)].filter(Boolean);
  if (!ids.length) return { ok: false, error: "No drafts to send." };
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    const r = await sendEmailReply(workspaceId, id, scopeUserId);
    if (r.ok) sent += 1;
    else failed += 1;
  }
  return { ok: true, sent, failed };
}

/** Archive every provided message sequentially — the batch "clear the low-value mail" action. */
export async function bulkArchive(
  workspaceId: string,
  messageIds: string[],
  scopeUserId: string | null = null,
): Promise<{ ok: true; archived: number; failed: number } | { ok: false; error: string }> {
  const ids = [...new Set(messageIds)].filter(Boolean);
  if (!ids.length) return { ok: false, error: "Nothing to archive." };
  let archived = 0;
  let failed = 0;
  for (const id of ids) {
    const r = await moveOut(workspaceId, id, "archived", scopeUserId);
    if (r.ok) archived += 1;
    else failed += 1;
  }
  return { ok: true, archived, failed };
}

/**
 * Learn the founder's email voice from their recent Sent mail — returns a proposed
 * signature + reply style for them to review and save. Read-only; nothing is applied.
 */
export async function learnEmailStyleFromSent(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<{ ok: true; style: LearnedStyle } | { ok: false; error: string }> {
  const token = await getValidAccessToken(workspaceId, "Gmail", scopeUserId);
  if (!token) return { ok: false, error: "Gmail isn't connected." };
  try {
    const page = await listInboxPage(token, { query: "in:sent", max: 15 });
    const details = (
      await Promise.all(page.items.slice(0, 12).map((m) => getMessageDetail(token, m.id).catch(() => null)))
    ).filter((d): d is GmailMessage => d !== null);
    const bodies = details.map((d) => d.body).filter((b) => b.trim());
    if (!bodies.length) return { ok: false, error: "No sent emails found to learn from yet." };
    const style = await learnEmailStyle(bodies);
    return { ok: true, style };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't learn your style." };
  }
}

/* ------------------------------ triage info ------------------------------- */

/** The "Daily Triage Info" panel — a rollup of what's been triaged in the last day. */
async function buildTriageInfo(workspaceId: string, scopeUserId: string | null = null): Promise<EmailTriageInfo> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db
    .select()
    .from(emailTriage)
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        gte(emailTriage.triaged_at, since),
      ),
    )
    .orderBy(desc(emailTriage.triaged_at))
    .limit(100);
  // "Needs attention" = still unhandled (status triaged) + flagged important, so
  // the count matches what you see when you open the Attention view.
  const attention = rows
    .filter((r) => r.status === "triaged" && isAttention(r.category, r.urgency, r.action_type))
    .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9));
  const attentionItems = attention.slice(0, 8).map((r) => ({
    id: r.gmail_message_id,
    from_name: r.from_name,
    subject: r.subject,
    category: r.category,
    urgency: r.urgency,
  }));
  return {
    total: rows.length,
    attention: attention.length,
    drafts: rows.filter((r) => r.status === "triaged" && r.draft_reply.trim()).length,
    sent: rows.filter((r) => r.status === "sent").length,
    cleared: rows.filter((r) => r.status === "archived" || r.status === "trashed").length,
    attentionItems,
  };
}

/**
 * The focused "needs attention" queue — unhandled, important emails from the last
 * 24h (urgency-sorted), rendered straight from email_triage. Backs the Attention
 * view you drop into from the Daily Triage panel.
 */
export async function listAttentionQueue(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<EmailListItem[]> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db
    .select()
    .from(emailTriage)
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        gte(emailTriage.triaged_at, since),
      ),
    )
    .orderBy(desc(emailTriage.triaged_at))
    .limit(100);
  return rows
    .filter((r) => r.status === "triaged" && isAttention(r.category, r.urgency, r.action_type))
    .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9))
    .slice(0, 60)
    .map((r) => ({
      id: r.gmail_message_id,
      thread_id: r.thread_id,
      from_name: r.from_name,
      from_email: r.from_email,
      subject: r.subject,
      date: r.triaged_at instanceof Date ? r.triaged_at.toISOString() : String(r.triaged_at ?? ""),
      snippet: r.snippet,
      unread: false,
      status: r.status as EmailStatus,
      category: r.category,
      urgency: r.urgency,
      action_type: r.action_type,
      summary: r.summary,
      draft_reply: r.draft_reply,
    }));
}

/* ------------------------------- page state ------------------------------- */

/**
 * The review queue — every triaged email with a ready draft that hasn't been sent,
 * archived, or trashed yet. Rendered straight from email_triage (no live Gmail call),
 * so after a big triage you can rip through the drafts in one place.
 */
export async function listDraftQueue(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<EmailListItem[]> {
  const rows = await db
    .select()
    .from(emailTriage)
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        eq(emailTriage.status, "triaged"),
        ne(emailTriage.draft_reply, ""),
      ),
    )
    .orderBy(desc(emailTriage.triaged_at))
    .limit(60);
  return rows.map((r) => ({
    id: r.gmail_message_id,
    thread_id: r.thread_id,
    from_name: r.from_name,
    from_email: r.from_email,
    subject: r.subject,
    date: r.triaged_at instanceof Date ? r.triaged_at.toISOString() : String(r.triaged_at ?? ""),
    snippet: r.snippet,
    unread: false,
    status: r.status as EmailStatus,
    category: r.category,
    urgency: r.urgency,
    action_type: r.action_type,
    summary: r.summary,
    draft_reply: r.draft_reply,
  }));
}

/** Assemble the Email Manager page: one live inbox page merged with the triage overlay. */
export async function getEmailManagerState(
  workspaceId: string,
  pageToken?: string,
  categories?: string[],
  scopeUserId: string | null = null,
): Promise<EmailManagerState> {
  const settings = await getSettings(workspaceId, scopeUserId);
  const token = await getValidAccessToken(workspaceId, "Gmail", scopeUserId);
  if (!token) {
    return {
      connected: false,
      items: [],
      nextPageToken: null,
      triageInfo: await buildTriageInfo(workspaceId, scopeUserId),
      settings,
    };
  }

  const page = await listInboxPage(token, { max: PAGE_SIZE, pageToken, query: buildInboxQuery(categories) });
  const metas = (
    await Promise.all(page.items.map((m) => getMessageMeta(token, m.id).catch(() => null)))
  ).filter((m): m is GmailMeta => m !== null);

  const ids = metas.map((m) => m.id);
  const rows = ids.length
    ? await db
        .select()
        .from(emailTriage)
        .where(
          and(
            eq(emailTriage.workspace_id, workspaceId),
            scopeFilter(emailTriage.member_user_id, scopeUserId),
            inArray(emailTriage.gmail_message_id, ids),
          ),
        )
    : [];
  const byId = new Map(rows.map((r) => [r.gmail_message_id, r]));

  const items: EmailListItem[] = metas.map((m) => {
    const r = byId.get(m.id);
    return {
      id: m.id,
      thread_id: m.threadId,
      from_name: m.from.name,
      from_email: m.from.email,
      subject: m.subject,
      date: m.date,
      snippet: m.snippet,
      unread: m.unread,
      status: (r?.status as EmailStatus) ?? "new",
      category: r?.category ?? "",
      urgency: r?.urgency ?? "",
      action_type: r?.action_type ?? "",
      summary: r?.summary ?? "",
      draft_reply: r?.draft_reply ?? "",
    };
  });

  return {
    connected: true,
    items,
    nextPageToken: page.nextPageToken,
    triageInfo: await buildTriageInfo(workspaceId, scopeUserId),
    settings,
  };
}

/** Full body of one email, fetched live for the reader pane. */
export async function getEmailBody(
  workspaceId: string,
  messageId: string,
  scopeUserId: string | null = null,
): Promise<{ ok: true; email: EmailBody } | { ok: false; error: string }> {
  const token = await getValidAccessToken(workspaceId, "Gmail", scopeUserId);
  if (!token) return { ok: false, error: "Gmail isn't connected." };
  try {
    const m = await getMessageDetail(token, messageId);
    return {
      ok: true,
      email: {
        id: m.id,
        from_name: m.from.name,
        from_email: m.from.email,
        to: m.to,
        subject: m.subject,
        date: m.date,
        body: m.body,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't open that email." };
  }
}

/* --------------------------------- dispatch -------------------------------- */

export async function saveEmailDraft(
  workspaceId: string,
  messageId: string,
  draft: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  const res = await db
    .update(emailTriage)
    .set({ draft_reply: draft, updated_at: new Date() })
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        eq(emailTriage.gmail_message_id, messageId),
      ),
    )
    .returning({ id: emailTriage.id });
  if (!res.length) return { ok: false, error: "Triage this email first, then edit the draft." };
  return { ok: true };
}

/** Send the (possibly edited) draft as an in-thread reply, then mark it sent. */
export async function sendEmailReply(
  workspaceId: string,
  messageId: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  const [row] = await db
    .select()
    .from(emailTriage)
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        eq(emailTriage.gmail_message_id, messageId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Triage this email first." };
  if (!row.draft_reply.trim()) return { ok: false, error: "There's no draft to send." };

  const token = await getValidAccessToken(workspaceId, "Gmail", scopeUserId);
  if (!token) return { ok: false, error: "Gmail isn't connected." };

  const subject = /^re:/i.test(row.subject) ? row.subject : `Re: ${row.subject}`;
  try {
    await sendGmail(token, {
      to: row.from_email,
      subject,
      body: row.draft_reply,
      threadId: row.thread_id || undefined,
      inReplyTo: row.source_message_id || undefined,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }

  const now = new Date();
  await db
    .update(emailTriage)
    .set({ status: "sent", updated_at: now })
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        eq(emailTriage.gmail_message_id, messageId),
      ),
    );
  // Activity log is an owner-plane surface — only record on the owner's plane.
  if (!scopeUserId) {
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: null,
      event_type: "integration_touched",
      actor_type: "human",
      actor_id: "owner",
      summary: `Sent reply to ${row.from_name}: ${row.subject}`.slice(0, 300),
      created_at: now,
    });
  }
  return { ok: true };
}

/** Archive (drop INBOX) or Trash (recoverable) a message, then record the outcome. */
async function moveOut(
  workspaceId: string,
  messageId: string,
  kind: "archived" | "trashed",
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  const token = await getValidAccessToken(workspaceId, "Gmail", scopeUserId);
  if (!token) return { ok: false, error: "Gmail isn't connected." };
  try {
    if (kind === "archived") await archiveMessage(token, messageId);
    else await trashMessage(token, messageId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Action failed." };
  }
  const now = new Date();
  // Update the triage row if this message was triaged (may be a no-op otherwise).
  await db
    .update(emailTriage)
    .set({ status: kind, updated_at: now })
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        eq(emailTriage.gmail_message_id, messageId),
      ),
    );
  if (!scopeUserId) {
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: null,
      event_type: "integration_touched",
      actor_type: "human",
      actor_id: "owner",
      summary: kind === "archived" ? "Archived an email from the inbox." : "Moved an email to Trash.",
      created_at: now,
    });
  }
  return { ok: true };
}

export function archiveEmail(
  workspaceId: string,
  messageId: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  return moveOut(workspaceId, messageId, "archived", scopeUserId);
}
export function trashEmail(
  workspaceId: string,
  messageId: string,
  scopeUserId: string | null = null,
): Promise<ActionResult> {
  return moveOut(workspaceId, messageId, "trashed", scopeUserId);
}
