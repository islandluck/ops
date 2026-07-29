import "server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, taskAssets, tasks, triagedEmails } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { getMessageDetail, listInboxMessages, type GmailMessage } from "@/lib/integrations/google";
import { triageEmails, type TriagedEmail } from "@/lib/ai/triage";
import { getPlanningContext } from "@/lib/db/queries";

/**
 * Email triage — the Admin agent reads recent unread inbox mail, classifies it,
 * writes a prioritized digest, drafts approval-gated replies, and creates action
 * tasks (routed to the right team) for the work an email implies. Read-only
 * against Gmail; nothing is sent, labelled, or deleted without an approval.
 */

export interface TriageResult {
  ok: boolean;
  triaged?: number;
  replyTasks?: number;
  actionTasks?: number;
  /** New unread emails still waiting after this batch (backlog). */
  remaining?: number;
  error?: string;
}

/** Max emails triaged per run — one Claude pass, fetched in parallel. */
const TRIAGE_MAX = 40;
/** How many recent unread ids to consider, so dedup can still fill a batch. */
const CANDIDATE_MAX = 150;

const URGENCY_RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };
const CATEGORY_EMOJI: Record<string, string> = {
  Investor: "💼",
  Customer: "🤝",
  Internal: "🏢",
  Admin: "🧾",
  Noise: "🔕",
};

function needsAttention(t: TriagedEmail): boolean {
  return (
    t.urgency === "Critical" ||
    t.urgency === "High" ||
    t.action_type === "Reply" ||
    t.action_type === "Schedule"
  );
}

function buildDigest(emails: GmailMessage[], triaged: TriagedEmail[], remaining = 0): string {
  const rows = emails.map((e, i) => ({ e, t: triaged[i] }));
  const line = (r: { e: GmailMessage; t: TriagedEmail }) =>
    `• ${CATEGORY_EMOJI[r.t.category] ?? ""} [${r.t.category} · ${r.t.urgency}] ${r.e.from.name} — “${r.e.subject}” — ${r.t.summary}${r.t.action_type !== "Read" ? ` → ${r.t.action_type}` : ""}`;

  const attention = rows
    .filter((r) => needsAttention(r.t))
    .sort((a, b) => (URGENCY_RANK[a.t.urgency] ?? 9) - (URGENCY_RANK[b.t.urgency] ?? 9));
  const lower = rows.filter((r) => !needsAttention(r.t));
  const replies = rows.filter((r) => r.t.suggested_reply.trim()).length;
  const taskCount = rows.filter((r) => r.t.task_title.trim()).length;

  const parts: string[] = [`Triaged ${emails.length} unread email${emails.length === 1 ? "" : "s"}.`];
  const made: string[] = [];
  if (replies) made.push(`${replies} reply draft${replies === 1 ? "" : "s"}`);
  if (taskCount) made.push(`${taskCount} task${taskCount === 1 ? "" : "s"}`);
  if (made.length) parts.push(`Prepared ${made.join(" and ")} for your review.`);
  parts.push("");
  if (attention.length) {
    parts.push("Needs attention", ...attention.map(line), "");
  }
  if (lower.length) {
    parts.push("Lower priority", ...lower.map(line));
  }
  const body = parts.join("\n").trim();
  return remaining > 0
    ? `${body}\n\n${remaining} more unread email${remaining === 1 ? "" : "s"} not yet triaged — run triage again to continue.`
    : body;
}

/** Run one triage pass for a workspace. Safe to call on-demand or from cron. */
export async function runEmailTriage(
  workspaceId: string,
  actor: { name: string; email: string },
): Promise<TriageResult> {
  const token = await getValidAccessToken(workspaceId, "Gmail");
  if (!token) return { ok: false, error: "Gmail isn't connected. Connect it in Integrations first." };

  let emails: GmailMessage[];
  let remaining = 0;
  try {
    // List candidate ids (cheap), then skip already-triaged ones so repeat and
    // background runs process only new mail — grinding a backlog down 40 at a time.
    const candidates = await listInboxMessages(token, { max: CANDIDATE_MAX, query: "in:inbox is:unread" });
    const seenRows = await db
      .select({ mid: triagedEmails.gmail_message_id })
      .from(triagedEmails)
      .where(eq(triagedEmails.workspace_id, workspaceId));
    const seen = new Set(seenRows.map((r) => r.mid));
    const fresh = candidates.filter((m) => !seen.has(m.id));
    const batch = fresh.slice(0, TRIAGE_MAX);
    remaining = fresh.length - batch.length;
    // Fetch bodies in parallel; skip any that fail rather than aborting the run.
    const settled = await Promise.all(batch.map((m) => getMessageDetail(token, m.id).catch(() => null)));
    emails = settled.filter((e): e is GmailMessage => e !== null);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the inbox." };
  }

  const now = new Date();
  if (!emails.length) return { ok: true, triaged: 0, replyTasks: 0, remaining };

  const { brief } = await getPlanningContext(workspaceId);
  let triaged: TriagedEmail[];
  try {
    triaged = await triageEmails(emails, brief);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Triage failed." };
  }

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
  // Route action tasks to the first worker agent in each department.
  const agentByDept = new Map<string, string>();
  for (const a of allAgents) {
    if (!a.premium && !a.archived && !agentByDept.has(a.category)) agentByDept.set(a.category, a.id);
  }

  // 1) Prioritized digest — informational (no execution, no approval needed).
  const digestId = randomUUID();
  await db.insert(tasks).values({
    id: digestId,
    workspace_id: workspaceId,
    category: "admin",
    title: `Inbox triage — ${emails.length} email${emails.length === 1 ? "" : "s"}`,
    description: "Prioritized summary of your unread inbox, triaged by the Admin agent.",
    rationale: "Turns your raw inbox into a prioritized queue.",
    status: "ready",
    risk_level: "low",
    priority: "medium",
    due_at: null,
    agent_id: adminId,
    created_by_type: "agent",
    requires_approval: false,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: [],
    proposed_actions: 0,
    impact_score: 30,
    created_at: now,
    updated_at: now,
  });
  await db.insert(taskAssets).values({
    id: randomUUID(),
    task_id: digestId,
    asset_type: "summary",
    title: "Inbox triage digest",
    content: buildDigest(emails, triaged, remaining),
    metadata: null,
  });

  // 2) Reply drafts + action tasks per email, as the agent flagged them.
  let replyCount = 0;
  let taskCount = 0;
  for (let i = 0; i < emails.length; i++) {
    const e = emails[i];
    const t = triaged[i];

    // (a) Reply task — a drafted reply to send (in-thread) on approval.
    if (t.suggested_reply.trim()) {
      replyCount += 1;
      const taskId = randomUUID();
      const replySubject = /^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`;
      const risk = t.category === "Investor" || t.category === "Customer" ? "medium" : "low";
      await db.insert(tasks).values({
        id: taskId,
        workspace_id: workspaceId,
        category: "admin",
        title: `Reply to ${e.from.name}: ${e.subject}`.slice(0, 120),
        description: t.summary,
        rationale: `${t.category} · ${t.urgency} · ${t.intent}`.slice(0, 300),
        status: "ready",
        risk_level: risk,
        priority: t.urgency === "Critical" || t.urgency === "High" ? "high" : "medium",
        due_at: null,
        agent_id: adminId,
        created_by_type: "agent",
        requires_approval: true,
        approval_status: "pending",
        execution_status: "none",
        affected_systems: ["Gmail"],
        proposed_actions: 1,
        impact_score: 55,
        created_at: now,
        updated_at: now,
      });
      await db.insert(taskAssets).values({
        id: randomUUID(),
        task_id: taskId,
        asset_type: "email",
        title: `Suggested reply to ${e.from.email}`,
        content: t.suggested_reply,
        metadata: {
          kind: "reply",
          to: e.from.email,
          subject: replySubject,
          thread_id: e.threadId,
          in_reply_to: e.messageId,
        },
      });
    }

    // (b) Action task — the work the email implies, routed to the right team.
    if (t.task_title.trim()) {
      taskCount += 1;
      const actionId = randomUUID();
      const highUrgency = t.urgency === "Critical" || t.urgency === "High";
      await db.insert(tasks).values({
        id: actionId,
        workspace_id: workspaceId,
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

  // 3) Audit trail + agent stats.
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: digestId,
    event_type: "agent_updated_draft",
    actor_type: "agent",
    actor_id: adminId ?? "sys",
    summary: `${adminName} triaged ${emails.length} email${emails.length === 1 ? "" : "s"} — ${replyCount} repl${replyCount === 1 ? "y" : "ies"} + ${taskCount} task${taskCount === 1 ? "" : "s"} prepared.`,
    created_at: now,
  });
  if (admin) {
    await db
      .update(agents)
      .set({
        last_run_at: now,
        tasks_prepared: admin.tasks_prepared + 1 + replyCount + taskCount,
        status: "waiting",
      })
      .where(eq(agents.id, admin.id));
  }

  // Remember what we triaged so future (and background) runs skip it.
  await db
    .insert(triagedEmails)
    .values(emails.map((e) => ({ workspace_id: workspaceId, gmail_message_id: e.id })))
    .onConflictDoNothing();

  return { ok: true, triaged: emails.length, replyTasks: replyCount, actionTasks: taskCount, remaining };
}
