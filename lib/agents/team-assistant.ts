import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getAnthropic } from "@/lib/ai/client";
import { runWithUsage } from "@/lib/ai/usage";
import { db } from "@/lib/db";
import { teamAssignments, teamAssistantMessages, teamMembers } from "@/lib/db/schema";
import { listAssignedProjects } from "@/lib/agents/project";
import { getMyGoals, listTeamDocuments, listTeamMembers } from "@/lib/agents/team";
import type { TeamAssistantMessage } from "@/lib/types";

/**
 * The Team Assistant — a member-facing helper that runs on Haiku (the low tier).
 * Its context is drawn ONLY from team-plane data: the member's own projects,
 * tasks, goals, the shared documents, and the roster. It has NO access to the
 * owner plane (KPIs, CRM, the inbox, executive/board strategy), so it structurally
 * cannot leak them — the sensitive data simply isn't in its context.
 */

// The Team Assistant always runs on Haiku (the low tier) by default, regardless
// of ANTHROPIC_MODEL — it's a member-facing helper, not the strategic Executive.
const MODEL = process.env.TEAM_ASSISTANT_MODEL || "claude-haiku-4-5-20251001";

/** Assemble the SCOPED system prompt for `userId`. Team-plane data only. */
async function buildSystem(workspaceId: string, userId: string): Promise<string> {
  const [me] = await db
    .select({ id: teamMembers.id, name: teamMembers.name, role_title: teamMembers.role_title })
    .from(teamMembers)
    .where(and(eq(teamMembers.workspace_id, workspaceId), eq(teamMembers.user_id, userId)))
    .limit(1);
  const name = me?.name || "there";

  const [projects, goals, docs, roster] = await Promise.all([
    listAssignedProjects(workspaceId, userId),
    getMyGoals(workspaceId, userId),
    listTeamDocuments(workspaceId),
    listTeamMembers(workspaceId),
  ]);
  const tasks = me
    ? await db
        .select({ title: teamAssignments.title, status: teamAssignments.status, deadline: teamAssignments.deadline })
        .from(teamAssignments)
        .where(and(eq(teamAssignments.workspace_id, workspaceId), eq(teamAssignments.member_id, me.id)))
    : [];

  const lines: string[] = [];
  lines.push(`You are the Team Assistant for ${name}${me?.role_title ? `, ${me.role_title}` : ""}.`);
  lines.push(
    "Help this team member with THEIR OWN work — their assigned projects and tasks, their goals, and the team's shared documents. Be concise, warm, and practical, like a sharp teammate. When they ask for help drafting or planning something, just do it.",
  );
  lines.push("");
  lines.push(
    "STRICT BOUNDARY: you can see ONLY this person's own work and the shared team info below. You do NOT have access to company financials, revenue, KPIs, the sales pipeline or CRM, the founder's email/inbox, or executive/board strategy. If asked about any of that, say plainly that you don't have access to it — you're the team assistant, focused on their work — and never guess or invent numbers.",
  );
  lines.push("");

  if (projects.length) {
    lines.push("THEIR ASSIGNED PROJECTS:");
    for (const p of projects.slice(0, 20)) {
      const prog = p.progress ? ` (${p.progress.done}/${p.progress.total} tasks done)` : "";
      lines.push(`- ${p.title} — ${p.status}${prog}${p.summary ? `. ${p.summary}` : ""}`);
    }
    lines.push("");
  }
  if (tasks.length) {
    lines.push("THEIR TASKS:");
    for (const t of tasks.slice(0, 30)) {
      const due = t.deadline ? `, due ${new Date(t.deadline).toISOString().slice(0, 10)}` : "";
      lines.push(`- ${t.title} (${t.status}${due})`);
    }
    lines.push("");
  }
  const allGoals = [
    ...goals.team.map((g) => ({ ...g, who: "Team" })),
    ...goals.mine.map((g) => ({ ...g, who: "You" })),
  ];
  if (allGoals.length) {
    lines.push("GOALS:");
    for (const g of allGoals.slice(0, 30)) {
      lines.push(`- [${g.horizon}] ${g.who}: ${g.title}${g.status === "done" ? " (done)" : ""}`);
    }
    lines.push("");
  }
  if (docs.length) {
    lines.push("SHARED TEAM DOCUMENTS:");
    for (const d of docs.slice(0, 30)) {
      if (d.kind === "link") lines.push(`- ${d.title} (link: ${d.url})`);
      else lines.push(`- ${d.title} (note): ${d.content.slice(0, 500)}`);
    }
    lines.push("");
  }
  const activeRoster = roster.filter((r) => r.status !== "inactive").slice(0, 30);
  if (activeRoster.length) {
    lines.push("TEAMMATES:");
    for (const r of activeRoster) lines.push(`- ${r.name}${r.role_title ? ` — ${r.role_title}` : ""}`);
  }

  return lines.join("\n").slice(0, 12000);
}

export async function getTeamAssistantHistory(workspaceId: string, userId: string): Promise<TeamAssistantMessage[]> {
  const rows = await db
    .select()
    .from(teamAssistantMessages)
    .where(and(eq(teamAssistantMessages.workspace_id, workspaceId), eq(teamAssistantMessages.user_id, userId)))
    .orderBy(asc(teamAssistantMessages.created_at))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    role: r.role as "user" | "assistant",
    content: r.content,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

export async function sendTeamAssistantMessage(
  workspaceId: string,
  userId: string,
  text: string,
): Promise<{ ok: true; reply: TeamAssistantMessage } | { ok: false; error: string }> {
  const clean = text.trim();
  if (!clean) return { ok: false, error: "Type a message first." };
  return runWithUsage(workspaceId, "team-assistant", async () => {
    // History is stored as complete user→assistant pairs, so it always ends on an
    // assistant turn — appending this user message keeps the roles alternating.
    const history = await getTeamAssistantHistory(workspaceId, userId);
    const system = await buildSystem(workspaceId, userId);
    const client = getAnthropic();
    let replyText = "";
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system,
        messages: [
          ...history.slice(-16).map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: clean.slice(0, 4000) },
        ],
      });
      replyText = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "The assistant couldn't respond." };
    }
    if (!replyText) replyText = "Sorry — I didn't catch that. Could you rephrase?";
    const now = new Date();
    const replyId = randomUUID();
    // Record the pair only after a successful reply.
    await db.insert(teamAssistantMessages).values([
      { id: randomUUID(), workspace_id: workspaceId, user_id: userId, role: "user", content: clean.slice(0, 4000), created_at: now },
      {
        id: replyId,
        workspace_id: workspaceId,
        user_id: userId,
        role: "assistant",
        content: replyText.slice(0, 8000),
        created_at: new Date(now.getTime() + 1),
      },
    ]);
    return {
      ok: true as const,
      reply: { id: replyId, role: "assistant" as const, content: replyText, created_at: new Date().toISOString() },
    };
  });
}
