import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, taskAssets, tasks, triagedNotion } from "@/lib/db/schema";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { getNotionPageContent, searchNotionPages } from "@/lib/integrations/notion";
import { extractNotionActions, type NotionAction } from "@/lib/ai/notion-triage";
import { getPlanningContext, saveDocument } from "@/lib/db/queries";
import type { AssetType } from "@/lib/types";

/**
 * Notion triage — reads the pages shared with Operator (typically meeting
 * notes), extracts the owner's action items, and creates board tasks: items that
 * warrant an email/document land Ready with a draft attached (email drafts carry
 * a real recipient when the notes name one, so approve → send). Read-only against
 * Notion; nothing is created in Notion or sent without the approval flow.
 */

const MAX_PAGES = 8;

function itemHash(pageId: string, title: string): string {
  const norm = title.toLowerCase().replace(/\s+/g, " ").trim();
  return "item:" + createHash("sha1").update(`${pageId}::${norm}`).digest("hex").slice(0, 16);
}

export interface NotionTriageResult {
  ok: boolean;
  pages?: number; // pages with content actually scanned
  actions?: number; // new action tasks created
  drafted?: number; // of those, how many came with a ready draft
  error?: string;
}

export async function runNotionTriage(
  workspaceId: string,
  actor: { name: string },
): Promise<NotionTriageResult> {
  const token = await getValidAccessToken(workspaceId, "Notion");
  if (!token) return { ok: false, error: "Notion isn't connected. Connect it in Integrations first." };

  const pages = await searchNotionPages(token, MAX_PAGES);
  if (!pages.length) {
    return {
      ok: false,
      error: "No accessible Notion pages — in Notion, share your meeting-notes page(s) with the Operator integration.",
    };
  }

  const seenRows = await db
    .select({ ref: triagedNotion.ref })
    .from(triagedNotion)
    .where(eq(triagedNotion.workspace_id, workspaceId));
  const seen = new Set(seenRows.map((r) => r.ref));

  const { brief } = await getPlanningContext(workspaceId);

  const allAgents = await db
    .select({
      id: agents.id,
      name: agents.name,
      category: agents.category,
      folder: agents.folder,
      premium: agents.premium,
      archived: agents.archived,
      tasks_prepared: agents.tasks_prepared,
    })
    .from(agents)
    .where(eq(agents.workspace_id, workspaceId));
  const admin = allAgents.find((a) => a.category === "admin" && !a.premium && !a.archived) ?? null;
  const agentByDept = new Map<string, string>();
  for (const a of allAgents) {
    if (!a.premium && !a.archived && !agentByDept.has(a.category)) agentByDept.set(a.category, a.id);
  }

  const now = new Date();
  const newRefs: string[] = [];
  let scanned = 0;
  let created = 0;
  let drafted = 0;

  for (const page of pages) {
    const pageRef = `page:${page.id}:${page.last_edited}`;
    if (seen.has(pageRef)) continue; // unchanged since last triage

    let actions: NotionAction[] = [];
    try {
      const text = await getNotionPageContent(token, page.id);
      if (!text.trim()) {
        newRefs.push(pageRef); // mark empty page seen so we don't re-fetch it
        continue;
      }
      scanned++;
      actions = await extractNotionActions({ title: page.title, text }, brief);
    } catch {
      continue; // skip a failing page; leave it unseen so it retries next run
    }
    newRefs.push(pageRef);

    for (const a of actions) {
      const ref = itemHash(page.id, a.title);
      if (seen.has(ref) || newRefs.includes(ref)) continue;
      newRefs.push(ref);

      const hasDraft = a.deliverable !== "none" && a.draft.trim().length > 0;
      const isEmail = a.deliverable === "email" && hasDraft;
      const deptAgent = agentByDept.get(a.department) ?? admin?.id ?? null;
      const taskId = randomUUID();

      await db.insert(tasks).values({
        id: taskId,
        workspace_id: workspaceId,
        category: a.department,
        title: a.title.slice(0, 120),
        description: a.detail || a.title,
        rationale: `From Notion — ${page.title}`.slice(0, 300),
        status: hasDraft ? "ready" : "new",
        risk_level: "low",
        priority: "medium",
        due_at: null,
        agent_id: deptAgent,
        created_by_type: "agent",
        requires_approval: isEmail,
        approval_status: "pending",
        execution_status: "none",
        affected_systems: isEmail ? ["Gmail"] : [],
        proposed_actions: isEmail ? 1 : 0,
        impact_score: hasDraft ? 55 : 45,
        created_at: now,
        updated_at: now,
      });

      if (hasDraft) {
        drafted++;
        const assetType: AssetType = a.deliverable === "email" ? "email" : "document";
        await db.insert(taskAssets).values({
          id: randomUUID(),
          task_id: taskId,
          asset_type: assetType,
          title: a.deliverable === "email" ? "Drafted email" : "Drafted document",
          content: a.draft,
          // Real recipient → sends on approval; absent → drafted-only (safe).
          metadata: isEmail && a.recipient ? { to: a.recipient } : null,
        });
        await saveDocument({
          workspaceId,
          agentId: deptAgent,
          authorName: admin?.name ?? "Operator",
          taskId,
          taskTitle: a.title,
          name: a.title,
          content: a.draft,
          folder: "Notion triage",
          docType: assetType,
        });
      } else {
        await db.insert(taskAssets).values({
          id: randomUUID(),
          task_id: taskId,
          asset_type: "summary",
          title: `Context — ${page.title}`.slice(0, 120),
          content: a.detail || a.title,
          metadata: null,
        });
      }
      created++;
    }
  }

  if (created > 0 || scanned > 0) {
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: null,
      event_type: "agent_updated_draft",
      actor_type: "agent",
      actor_id: admin?.id ?? "sys",
      summary: `${admin?.name ?? "Operator"} triaged Notion for ${actor.name} — ${created} action task${created === 1 ? "" : "s"} from ${scanned} page${scanned === 1 ? "" : "s"} (${drafted} drafted).`,
      created_at: now,
    });
    if (admin) {
      await db
        .update(agents)
        .set({ last_run_at: now, tasks_prepared: admin.tasks_prepared + created, status: "waiting" })
        .where(eq(agents.id, admin.id));
    }
  }

  if (newRefs.length) {
    await db
      .insert(triagedNotion)
      .values(newRefs.map((ref) => ({ workspace_id: workspaceId, ref })))
      .onConflictDoNothing();
  }

  return { ok: true, pages: scanned, actions: created, drafted };
}
