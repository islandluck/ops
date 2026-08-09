import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, businessBriefs, emailTriage } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import {
  archiveMessage,
  getMessageDetail,
  getMessageMeta,
  listInboxPage,
  sendGmail,
  trashMessage,
  type GmailMeta,
} from "@/lib/integrations/google";
import type {
  EmailBody,
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

async function getSettings(workspaceId: string): Promise<EmailSettings> {
  const [b] = await db
    .select({ signature: businessBriefs.email_signature, reply_style: businessBriefs.email_reply_style })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  return { signature: b?.signature ?? "", reply_style: b?.reply_style ?? "" };
}

export async function saveEmailSettings(workspaceId: string, settings: EmailSettings): Promise<ActionResult> {
  await db
    .update(businessBriefs)
    .set({
      email_signature: settings.signature.slice(0, 2000),
      email_reply_style: settings.reply_style.slice(0, 2000),
      updated_at: new Date(),
    })
    .where(eq(businessBriefs.workspace_id, workspaceId));
  return { ok: true };
}

/* ------------------------------ triage info ------------------------------- */

/** The "Daily Triage Info" panel — a rollup of what's been triaged in the last day. */
async function buildTriageInfo(workspaceId: string): Promise<EmailTriageInfo> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db
    .select()
    .from(emailTriage)
    .where(and(eq(emailTriage.workspace_id, workspaceId), gte(emailTriage.triaged_at, since)))
    .orderBy(desc(emailTriage.triaged_at))
    .limit(100);
  const attention = rows
    .filter((r) => isAttention(r.category, r.urgency, r.action_type))
    .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9));
  const lines = attention
    .slice(0, 6)
    .map((r) => `${CATEGORY_EMOJI[r.category] ?? ""} [${r.category} · ${r.urgency}] ${r.from_name} — ${r.subject}`);
  return {
    total: rows.length,
    attention: attention.length,
    drafts: rows.filter((r) => r.draft_reply.trim()).length,
    sent: rows.filter((r) => r.status === "sent").length,
    cleared: rows.filter((r) => r.status === "archived" || r.status === "trashed").length,
    lines,
  };
}

/* ------------------------------- page state ------------------------------- */

/** Assemble the Email Manager page: one live inbox page merged with the triage overlay. */
export async function getEmailManagerState(
  workspaceId: string,
  pageToken?: string,
  categories?: string[],
): Promise<EmailManagerState> {
  const settings = await getSettings(workspaceId);
  const token = await getValidAccessToken(workspaceId, "Gmail");
  if (!token) {
    return {
      connected: false,
      items: [],
      nextPageToken: null,
      triageInfo: await buildTriageInfo(workspaceId),
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
        .where(and(eq(emailTriage.workspace_id, workspaceId), inArray(emailTriage.gmail_message_id, ids)))
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
    triageInfo: await buildTriageInfo(workspaceId),
    settings,
  };
}

/** Full body of one email, fetched live for the reader pane. */
export async function getEmailBody(
  workspaceId: string,
  messageId: string,
): Promise<{ ok: true; email: EmailBody } | { ok: false; error: string }> {
  const token = await getValidAccessToken(workspaceId, "Gmail");
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

export async function saveEmailDraft(workspaceId: string, messageId: string, draft: string): Promise<ActionResult> {
  const res = await db
    .update(emailTriage)
    .set({ draft_reply: draft, updated_at: new Date() })
    .where(and(eq(emailTriage.workspace_id, workspaceId), eq(emailTriage.gmail_message_id, messageId)))
    .returning({ id: emailTriage.id });
  if (!res.length) return { ok: false, error: "Triage this email first, then edit the draft." };
  return { ok: true };
}

/** Send the (possibly edited) draft as an in-thread reply, then mark it sent. */
export async function sendEmailReply(workspaceId: string, messageId: string): Promise<ActionResult> {
  const [row] = await db
    .select()
    .from(emailTriage)
    .where(and(eq(emailTriage.workspace_id, workspaceId), eq(emailTriage.gmail_message_id, messageId)))
    .limit(1);
  if (!row) return { ok: false, error: "Triage this email first." };
  if (!row.draft_reply.trim()) return { ok: false, error: "There's no draft to send." };

  const token = await getValidAccessToken(workspaceId, "Gmail");
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
    .where(and(eq(emailTriage.workspace_id, workspaceId), eq(emailTriage.gmail_message_id, messageId)));
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
  return { ok: true };
}

/** Archive (drop INBOX) or Trash (recoverable) a message, then record the outcome. */
async function moveOut(workspaceId: string, messageId: string, kind: "archived" | "trashed"): Promise<ActionResult> {
  const token = await getValidAccessToken(workspaceId, "Gmail");
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
    .where(and(eq(emailTriage.workspace_id, workspaceId), eq(emailTriage.gmail_message_id, messageId)));
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
  return { ok: true };
}

export function archiveEmail(workspaceId: string, messageId: string): Promise<ActionResult> {
  return moveOut(workspaceId, messageId, "archived");
}
export function trashEmail(workspaceId: string, messageId: string): Promise<ActionResult> {
  return moveOut(workspaceId, messageId, "trashed");
}
