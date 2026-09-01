import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  agents,
  businessBriefs,
  emailTriage,
  executiveMemory,
  taskAssets,
  tasks,
} from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { scopeFilter } from "@/lib/access/scope";
import { getMessageDetail, listInboxMessages, type GmailMessage } from "@/lib/integrations/google";
import { triageEmails } from "@/lib/ai/triage";
import { runWithUsage } from "@/lib/ai/usage";
import { getPlanningContext } from "@/lib/db/queries";

/**
 * Email triage — the Admin agent reads inbox mail, classifies it, drafts an
 * approval-gated reply (in the founder's voice, with their signature), and files
 * any non-email work an email implies as a board task. Read-only against Gmail:
 * every reply is stored as an EDITABLE DRAFT in email_triage and only leaves the
 * outbox when the user sends it from the Email Manager. Nothing is sent, archived,
 * or trashed here — those stay one explicit human click away.
 */

export interface TriageResult {
  ok: boolean;
  triaged?: number;
  replyDrafts?: number;
  actionTasks?: number;
  /** New unread emails still waiting after this batch (backlog). */
  remaining?: number;
  error?: string;
}

/** Max emails triaged per run — one Claude pass, fetched in parallel. */
const TRIAGE_MAX = 40;
/** How many recent inbox ids to consider, so dedup can still fill a batch. */
const CANDIDATE_MAX = 150;

const URGENCY_RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };
const CATEGORY_EMOJI: Record<string, string> = {
  Investor: "💼",
  Customer: "🤝",
  Internal: "🏢",
  Admin: "🧾",
  Noise: "🔕",
};

function needsAttention(category: string, urgency: string, action: string): boolean {
  return urgency === "Critical" || urgency === "High" || action === "Reply" || action === "Schedule";
}

/* ------------------------------- email style ------------------------------- */

async function getEmailStyle(
  workspaceId: string,
): Promise<{ signature: string; replyStyle: string }> {
  const [b] = await db
    .select({
      signature: businessBriefs.email_signature,
      replyStyle: businessBriefs.email_reply_style,
    })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  return { signature: b?.signature?.trim() ?? "", replyStyle: b?.replyStyle?.trim() ?? "" };
}

/** Append the founder's signature to a non-empty drafted reply. */
function withSignature(reply: string, signature: string): string {
  const r = reply.trim();
  if (!r) return "";
  return signature ? `${r}\n\n${signature}` : r;
}

/* ---------------------------------- core ----------------------------------- */

/**
 * Triage a set of already-fetched emails: classify each, draft a signed reply into
 * email_triage, and file any implied non-email work as a board task. Shared by the
 * on-demand page triage and the background cron sweep. Assumes the caller already
 * filtered out messages that were triaged before (dedup).
 */
function triageAndStore(
  workspaceId: string,
  emails: GmailMessage[],
  scopeUserId: string | null = null,
): Promise<{ replyDrafts: number; actionTasks: number }> {
  return runWithUsage(workspaceId, "email-triage", () => _triageAndStore(workspaceId, emails, scopeUserId));
}
async function _triageAndStore(
  workspaceId: string,
  emails: GmailMessage[],
  scopeUserId: string | null = null,
): Promise<{ replyDrafts: number; actionTasks: number }> {
  const now = new Date();
  const { brief } = await getPlanningContext(workspaceId);
  // A member's inbox uses default voice (no shared owner signature/style).
  const { signature, replyStyle } = scopeUserId
    ? { signature: "", replyStyle: "" }
    : await getEmailStyle(workspaceId);

  const triaged = await triageEmails(emails, brief, { replyStyle });

  // The Admin agent owns triage; action tasks route to each team's first worker.
  const allAgents = await db
    .select({
      id: agents.id,
      name: agents.name,
      category: agents.category,
      premium: agents.premium,
      archived: agents.archived,
      tasks_prepared: agents.tasks_prepared,
    })
    .from(agents)
    .where(eq(agents.workspace_id, workspaceId));
  const admin = allAgents.find((a) => a.category === "admin" && !a.premium && !a.archived) ?? null;
  const adminId = admin?.id ?? null;
  const adminName = admin?.name ?? "Admin Agent";
  const agentByDept = new Map<string, string>();
  for (const a of allAgents) {
    if (!a.premium && !a.archived && !agentByDept.has(a.category)) agentByDept.set(a.category, a.id);
  }

  let replyDrafts = 0;
  let actionTasks = 0;

  for (let i = 0; i < emails.length; i++) {
    const e = emails[i];
    const t = triaged[i];
    const draft = withSignature(t.suggested_reply, signature);
    if (draft) replyDrafts += 1;

    // (1) Store the triage + editable draft — this is what the Email Manager renders.
    await db
      .insert(emailTriage)
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        member_user_id: scopeUserId,
        gmail_message_id: e.id,
        thread_id: e.threadId,
        source_message_id: e.messageId,
        from_name: e.from.name,
        from_email: e.from.email,
        subject: e.subject,
        snippet: e.snippet,
        category: t.category,
        urgency: t.urgency,
        action_type: t.action_type,
        summary: t.summary,
        draft_reply: draft,
        status: "triaged",
        triaged_at: now,
        updated_at: now,
      })
      .onConflictDoNothing();

    // (2) Non-email work the email implies → a board task, routed to the right team.
    if (t.task_title.trim()) {
      actionTasks += 1;
      const highUrgency = t.urgency === "Critical" || t.urgency === "High";
      const actionId = randomUUID();
      await db.insert(tasks).values({
        id: actionId,
        workspace_id: workspaceId,
        member_user_id: scopeUserId,
        category: t.task_department,
        title: t.task_title.slice(0, 120),
        description: t.task_detail || t.summary,
        rationale: `From email — ${e.from.name}: ${e.subject}`.slice(0, 300),
        status: "new",
        risk_level: "low",
        priority: highUrgency ? "high" : "medium",
        due_at: null,
        agent_id: agentByDept.get(t.task_department) ?? adminId,
        created_by_type: "agent",
        requires_approval: false,
        approval_status: "pending",
        execution_status: "none",
        affected_systems: [],
        proposed_actions: 0,
        impact_score: highUrgency ? 65 : 45,
        created_at: now,
        updated_at: now,
      });
      await db.insert(taskAssets).values({
        id: randomUUID(),
        task_id: actionId,
        asset_type: "summary",
        title: `Context — ${e.from.name}: ${e.subject}`.slice(0, 120),
        content: `From: ${e.from.name} <${e.from.email}>\nSubject: ${e.subject}\n\n${t.task_detail || t.summary}`,
        metadata: null,
      });
    }
  }

  // Audit + agent stats. Activity is an owner-plane surface — skip for members.
  if (!scopeUserId) {
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: null,
      event_type: "agent_updated_draft",
      actor_type: "agent",
      actor_id: adminId ?? "sys",
      summary: `${adminName} triaged ${emails.length} email${emails.length === 1 ? "" : "s"} — ${replyDrafts} reply draft${replyDrafts === 1 ? "" : "s"} + ${actionTasks} task${actionTasks === 1 ? "" : "s"} prepared.`,
      created_at: now,
    });
  }
  if (admin) {
    await db
      .update(agents)
      .set({
        last_run_at: now,
        tasks_prepared: admin.tasks_prepared + replyDrafts + actionTasks,
        status: "waiting",
      })
      .where(eq(agents.id, admin.id));
  }

  return { replyDrafts, actionTasks };
}

/* ------------------------------- entry points ------------------------------ */

/**
 * On-demand triage of a specific set of inbox messages (the page's "Triage All" /
 * "Triage selected"). Skips any already triaged. Does NOT auto-notify the Executive
 * — the user decides that with the "Send to Executive" button.
 */
export async function triageMessages(
  workspaceId: string,
  messageIds: string[],
  scopeUserId: string | null = null,
): Promise<TriageResult> {
  const ids = [...new Set(messageIds)].filter(Boolean);
  if (!ids.length) return { ok: true, triaged: 0, replyDrafts: 0, actionTasks: 0 };

  const token = await getValidAccessToken(workspaceId, "Gmail", scopeUserId);
  if (!token) return { ok: false, error: "Gmail isn't connected. Connect it in Integrations first." };

  // Dedup: only triage messages we haven't triaged before (within this plane).
  const seenRows = await db
    .select({ mid: emailTriage.gmail_message_id })
    .from(emailTriage)
    .where(
      and(
        eq(emailTriage.workspace_id, workspaceId),
        scopeFilter(emailTriage.member_user_id, scopeUserId),
        inArray(emailTriage.gmail_message_id, ids),
      ),
    );
  const seen = new Set(seenRows.map((r) => r.mid));
  const fresh = ids.filter((id) => !seen.has(id));
  if (!fresh.length) return { ok: true, triaged: 0, replyDrafts: 0, actionTasks: 0 };

  let emails: GmailMessage[];
  try {
    const settled = await Promise.all(fresh.map((id) => getMessageDetail(token, id).catch(() => null)));
    emails = settled.filter((e): e is GmailMessage => e !== null);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the selected emails." };
  }
  if (!emails.length) return { ok: false, error: "Couldn't read the selected emails." };

  let out: { replyDrafts: number; actionTasks: number };
  try {
    out = await triageAndStore(workspaceId, emails, scopeUserId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Triage failed." };
  }
  return { ok: true, triaged: emails.length, replyDrafts: out.replyDrafts, actionTasks: out.actionTasks };
}

/**
 * Background sweep — triage recent UNREAD inbox mail, grinding a backlog down
 * TRIAGE_MAX at a time, then post a summary to the Executive. Safe to call from the
 * cron (the Admin agent's background job).
 */
export async function runEmailTriage(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<TriageResult> {
  const token = await getValidAccessToken(workspaceId, "Gmail", scopeUserId);
  if (!token) return { ok: false, error: "Gmail isn't connected. Connect it in Integrations first." };

  let emails: GmailMessage[];
  let remaining = 0;
  try {
    // Only sweep mail worth a human reply — Primary + Updates, never Promotions/Social.
    const candidates = await listInboxMessages(token, {
      max: CANDIDATE_MAX,
      query: "in:inbox is:unread (category:primary OR category:updates)",
    });
    const seenRows = await db
      .select({ mid: emailTriage.gmail_message_id })
      .from(emailTriage)
      .where(and(eq(emailTriage.workspace_id, workspaceId), scopeFilter(emailTriage.member_user_id, scopeUserId)));
    const seen = new Set(seenRows.map((r) => r.mid));
    const fresh = candidates.filter((m) => !seen.has(m.id));
    const batch = fresh.slice(0, TRIAGE_MAX);
    remaining = fresh.length - batch.length;
    const settled = await Promise.all(batch.map((m) => getMessageDetail(token, m.id).catch(() => null)));
    emails = settled.filter((e): e is GmailMessage => e !== null);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the inbox." };
  }

  if (!emails.length) return { ok: true, triaged: 0, replyDrafts: 0, actionTasks: 0, remaining };

  let out: { replyDrafts: number; actionTasks: number };
  try {
    out = await triageAndStore(workspaceId, emails, scopeUserId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Triage failed." };
  }

  // Keep the Executive in the loop automatically on the OWNER's background path only.
  if (!scopeUserId) await summarizeInboxToExecutive(workspaceId).catch(() => {});

  return { ok: true, triaged: emails.length, replyDrafts: out.replyDrafts, actionTasks: out.actionTasks, remaining };
}

/* --------------------------- Executive hand-off ---------------------------- */

export interface InboxSummaryResult {
  ok: boolean;
  count?: number;
  error?: string;
}

/**
 * Build a compact summary of recently-triaged mail and drop it into the Executive's
 * memory, so your chief-of-staff stays current on what's moving in the inbox. Used
 * by the "Send to Executive" button and automatically by the background sweep.
 */
export async function summarizeInboxToExecutive(workspaceId: string): Promise<InboxSummaryResult> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db
    .select()
    .from(emailTriage)
    .where(and(eq(emailTriage.workspace_id, workspaceId), gte(emailTriage.triaged_at, since)))
    .orderBy(desc(emailTriage.triaged_at))
    .limit(80);
  if (!rows.length) return { ok: false, error: "Nothing triaged in the last day to summarize." };

  const attention = rows
    .filter((r) => needsAttention(r.category, r.urgency, r.action_type))
    .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9));
  const drafts = rows.filter((r) => r.draft_reply.trim()).length;
  const sent = rows.filter((r) => r.status === "sent").length;
  const archived = rows.filter((r) => r.status === "archived" || r.status === "trashed").length;

  const head = `Inbox update — triaged ${rows.length} email${rows.length === 1 ? "" : "s"} in the last day. ${attention.length} need attention, ${drafts} repl${drafts === 1 ? "y" : "ies"} drafted for review${sent ? `, ${sent} sent` : ""}${archived ? `, ${archived} cleared` : ""}.`;
  const lines = attention
    .slice(0, 6)
    .map(
      (r) =>
        `• ${CATEGORY_EMOJI[r.category] ?? ""} [${r.category} · ${r.urgency}] ${r.from_name} — “${r.subject}”: ${r.summary}`,
    );
  const content = [head, "", ...lines].join("\n").slice(0, 600);

  const now = new Date();
  await db.insert(executiveMemory).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    content,
    kind: "insight",
    source: "agent",
    pinned: false,
    created_at: now,
    updated_at: now,
  });
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "agent_updated_draft",
    actor_type: "agent",
    actor_id: "sys",
    summary: `Inbox summary sent to the Executive — ${rows.length} email${rows.length === 1 ? "" : "s"}, ${attention.length} flagged.`,
    created_at: now,
  });

  return { ok: true, count: rows.length };
}

/* --------------------------- auto-triage cadence --------------------------- */

/**
 * Cron sweep — run email triage for each workspace whose auto-triage cadence is due
 * (hourly / daily). Drafts + summarizes to the Executive; NEVER sends. Claims the
 * run time before running so overlapping cron ticks don't double-fire a workspace.
 */
export async function runDueEmailTriage(): Promise<{ ran: number }> {
  // tenant-scope-exempt: cron sweeps every workspace on its own configured cadence;
  // each triage run below is scoped to its workspace_id.
  const rows = await db
    .select({
      ws: businessBriefs.workspace_id,
      cadence: businessBriefs.email_triage_cadence,
      last: businessBriefs.email_triage_last_run_at,
    })
    .from(businessBriefs);

  const now = Date.now();
  let ran = 0;
  for (const r of rows) {
    const interval = r.cadence === "hourly" ? 3_600_000 : r.cadence === "daily" ? 86_400_000 : 0;
    if (!interval) continue;
    if (r.last && now - r.last.getTime() < interval) continue;
    // Claim the slot first so a concurrent tick won't re-fire this workspace.
    await db
      .update(businessBriefs)
      .set({ email_triage_last_run_at: new Date(now) })
      .where(eq(businessBriefs.workspace_id, r.ws));
    try {
      await runEmailTriage(r.ws);
      ran += 1;
    } catch {
      /* skip and continue */
    }
  }
  return { ran };
}
