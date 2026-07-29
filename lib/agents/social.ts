import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, agents, taskAssets, tasks } from "@/lib/db/schema";
import { getPlanningContext, saveDocument } from "@/lib/db/queries";
import { researchTopics } from "@/lib/ai/research";
import { generateSocialBatch, type SocialPiece } from "@/lib/ai/social";

/**
 * Social Media Agent — researches current topics in the company's industry
 * (Tavily; falls back to brief-grounded when no key), drafts a batch of on-brand
 * X posts + blog drafts, and routes each to the approval board + the file
 * manager. Draft-only for now: approving files it; publishing is a later phase.
 */

export interface SocialRunResult {
  ok: boolean;
  drafted?: number;
  error?: string;
}

/** How many pieces one run produces (rate cap). */
const CONFIG = { x: 3, blog: 1 };

export async function runSocialMediaAgent(
  workspaceId: string,
  agentId: string | null,
): Promise<SocialRunResult> {
  const [agent] = agentId
    ? await db
        .select()
        .from(agents)
        .where(and(eq(agents.workspace_id, workspaceId), eq(agents.id, agentId)))
        .limit(1)
    : await db
        .select()
        .from(agents)
        .where(and(eq(agents.workspace_id, workspaceId), eq(agents.kind, "social")))
        .limit(1);

  const { brief } = await getPlanningContext(workspaceId);

  // Live research (falls back to brief-grounded when TAVILY_API_KEY is absent).
  const query = `latest news, trends, and discussions relevant to this business: ${brief.business_description} ${brief.core_offer}`
    .slice(0, 380)
    .trim();
  const research = await researchTopics(query);

  let pieces: SocialPiece[];
  try {
    pieces = await generateSocialBatch(brief, agent?.instructions ?? "", research, CONFIG);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Content generation failed." };
  }
  if (!pieces.length) return { ok: true, drafted: 0 };

  const now = new Date();
  const authorName = agent?.name ?? "Social Media Agent";
  const authorId = agent?.id ?? null;
  const folder = agent?.folder || "Social";

  for (const p of pieces) {
    const isX = p.channel === "x";
    const finalContent =
      isX && p.hashtags.length ? `${p.content}\n\n${p.hashtags.map((h) => `#${h}`).join(" ")}` : p.content;
    const label = isX ? "X post" : "Blog draft";
    const heading = `${label}: ${p.title}`.slice(0, 120);
    const taskId = randomUUID();

    await db.insert(tasks).values({
      id: taskId,
      workspace_id: workspaceId,
      category: "content",
      title: heading,
      description: isX ? "Ready-to-post X/Twitter draft for your review." : "Blog draft for your review.",
      rationale: research?.sources.length
        ? "Drafted from current industry topics."
        : "Drafted from your business brief.",
      status: "ready",
      risk_level: "low",
      priority: "medium",
      due_at: null,
      agent_id: authorId,
      created_by_type: "agent",
      requires_approval: true,
      approval_status: "pending",
      execution_status: "none",
      affected_systems: [],
      proposed_actions: 1,
      impact_score: 40,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskAssets).values({
      id: randomUUID(),
      task_id: taskId,
      asset_type: isX ? "social_post" : "document",
      title: isX ? "X post" : p.title,
      content: finalContent,
      metadata: isX ? { channel: "X (Twitter)", chars: finalContent.length } : { channel: "Blog" },
    });
    await saveDocument({
      workspaceId,
      agentId: authorId,
      authorName,
      taskId,
      taskTitle: heading,
      name: heading,
      content: finalContent,
      folder,
      docType: isX ? "social_post" : "document",
    });
  }

  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "agent_updated_draft",
    actor_type: "agent",
    actor_id: authorId ?? "sys",
    summary: `${authorName} drafted ${pieces.length} piece${pieces.length === 1 ? "" : "s"} of content${research?.sources.length ? " from current topics" : ""}.`,
    created_at: now,
  });
  if (agent) {
    await db
      .update(agents)
      .set({ last_run_at: now, tasks_prepared: agent.tasks_prepared + pieces.length, status: "waiting" })
      .where(eq(agents.id, agent.id));
  }
  return { ok: true, drafted: pieces.length };
}
