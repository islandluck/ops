import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, commandCenter, executiveMemory } from "@/lib/db/schema";
import type { CommandCenterDoc, GoalItem } from "@/lib/types";

/**
 * Command Center — the user's own goals workspace. Get/save the free-form doc, and
 * (on command) push it into the Executive's memory so the chief-of-staff knows the
 * founder's goals. Agents never write this doc; only the user does.
 */

const MEMORY_MARKER = "📋 Command Center goals";

/** A fresh doc for a workspace that hasn't started one — one empty month to write into. */
export function emptyCommandCenterDoc(): CommandCenterDoc {
  return {
    periods: [{ id: randomUUID(), label: "This month", monthly: [], weekly: [], daily: [], parking: [] }],
    horizons: { year: [], future: [], moonshot: [] },
  };
}

export async function getCommandCenterDoc(workspaceId: string): Promise<CommandCenterDoc> {
  const [row] = await db
    .select({ doc: commandCenter.doc })
    .from(commandCenter)
    .where(eq(commandCenter.workspace_id, workspaceId))
    .limit(1);
  return row?.doc ?? emptyCommandCenterDoc();
}

export async function saveCommandCenterDoc(workspaceId: string, doc: CommandCenterDoc): Promise<{ ok: true }> {
  const now = new Date();
  await db
    .insert(commandCenter)
    .values({ id: randomUUID(), workspace_id: workspaceId, doc, updated_at: now })
    .onConflictDoUpdate({ target: commandCenter.workspace_id, set: { doc, updated_at: now } });
  return { ok: true };
}

/* ------------------------------ rendering --------------------------------- */

function renderItems(items: GoalItem[]): string {
  return items
    .filter((i) => i.text.trim())
    .map((i) => `${i.indent ? "    - " : "- "}${i.done ? `~~${i.text.trim()}~~` : i.text.trim()}`)
    .join("\n");
}

/** Render the whole doc as compact markdown (for the Executive, or a Deep-Dive artifact). */
export function renderGoalsMarkdown(doc: CommandCenterDoc): string {
  const parts: string[] = [];
  for (const p of doc.periods) {
    const cols: string[] = [];
    const add = (label: string, items: GoalItem[]) => {
      const body = renderItems(items);
      if (body) cols.push(`**${label}**\n${body}`);
    };
    add("Monthly", p.monthly);
    add("Weekly", p.weekly);
    add("Daily", p.daily);
    add("Parking lot", p.parking);
    if (cols.length) parts.push(`### ${p.label || "Untitled period"}\n${cols.join("\n\n")}`);
  }
  const hz: string[] = [];
  const addH = (label: string, items: GoalItem[]) => {
    const body = renderItems(items);
    if (body) hz.push(`**${label}**\n${body}`);
  };
  addH("Year goals", doc.horizons.year);
  addH("Future goals", doc.horizons.future);
  addH("Moonshot goals", doc.horizons.moonshot);
  if (hz.length) parts.push(`### Horizons\n${hz.join("\n\n")}`);
  return parts.join("\n\n").trim();
}

/* --------------------------- Executive hand-off ---------------------------- */

export interface SendGoalsResult {
  ok: boolean;
  error?: string;
}

/** Push the current goals into the Executive's memory as ONE replaceable entry. */
export async function sendGoalsToExecutive(workspaceId: string): Promise<SendGoalsResult> {
  const doc = await getCommandCenterDoc(workspaceId);
  const md = renderGoalsMarkdown(doc);
  if (!md) return { ok: false, error: "Add some goals first, then send them to the Executive." };

  const content = `${MEMORY_MARKER} (the founder's stated goals across timelines):\n\n${md}`.slice(0, 4000);
  const now = new Date();
  // Replace any prior Command Center memory so the Executive always holds ONE current copy.
  await db
    .delete(executiveMemory)
    .where(and(eq(executiveMemory.workspace_id, workspaceId), like(executiveMemory.content, `${MEMORY_MARKER}%`)));
  await db.insert(executiveMemory).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    content,
    kind: "decision",
    source: "user",
    pinned: true,
    created_at: now,
    updated_at: now,
  });
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: null,
    event_type: "output_created",
    actor_type: "human",
    actor_id: "owner",
    summary: "Sent Command Center goals to the Executive.",
    created_at: now,
  });
  return { ok: true };
}
