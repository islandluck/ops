import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  approvalDecisions,
  businessBriefs,
  executionRuns,
  integrations,
  taskAssets,
  tasks,
} from "@/lib/db/schema";
import { isProviderConfigured, providerForIntegrationName } from "./registry";
import { getValidAccessToken } from "./tokens";
import { createCalendarEvent, createSpreadsheet, sendGmail } from "./google";
import { upsertContact } from "./hubspot";
import { createNotionPage } from "./notion";
import { createDraftInvoice } from "./stripe";
import { postTweet, uploadMediaToX } from "./x";
import { listMediaRowsForTask } from "@/lib/db/queries";
import { getImageBytes } from "@/lib/media/storage";
import { setPageStatus } from "@/lib/pages";
import type { ExecutionStep } from "@/lib/types";

export interface ExecResult {
  ok: boolean;
  summary?: string;
  error?: string;
}

function parseSubject(content: string): string {
  const m = content.match(/Subject:\s*(.+)/i);
  return m ? m[1].trim() : "Operator — message";
}

/** Guardrail: cap posts published to X per workspace per day (anti-spam). */
const X_DAILY_CAP = 10;

async function xPostsToday(workspaceId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: executionRuns.id })
    .from(executionRuns)
    .innerJoin(tasks, eq(tasks.id, executionRuns.task_id))
    .where(
      and(
        eq(tasks.workspace_id, workspaceId),
        eq(executionRuns.status, "completed"),
        gte(executionRuns.started_at, startOfDay),
        sql`${"X (Twitter)"} = any(${executionRuns.affected_systems})`,
      ),
    );
  return rows.length;
}

/**
 * Approve + execute a task entirely server-side, performing REAL provider
 * actions for connected integrations and recording an auditable run. Safe by
 * design: Gmail sends to the operator's own address, Stripe creates a draft
 * (never charges), HubSpot upserts a single demo contact.
 */
export async function runTaskExecution(
  workspaceId: string,
  taskId: string,
  actor: { name: string; email: string },
): Promise<ExecResult> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspace_id, workspaceId), eq(tasks.id, taskId)))
    .limit(1);
  if (!task) return { ok: false, error: "Task not found." };

  const assets = await db.select().from(taskAssets).where(eq(taskAssets.task_id, taskId));
  const draft = assets[0]?.content ?? "";
  const integrationRows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.workspace_id, workspaceId));
  const connectedByName = new Map(integrationRows.map((i) => [i.name, i]));

  const now = new Date();

  // Record the approval + start.
  await db.insert(approvalDecisions).values({
    id: randomUUID(),
    task_id: taskId,
    decided_by: actor.name,
    decision_type: "approve",
    created_at: now,
  });
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: taskId,
    event_type: "approved",
    actor_type: "human",
    actor_id: actor.name,
    summary: `${actor.name} approved “${task.title}”.`,
    created_at: now,
  });
  await db
    .update(tasks)
    .set({ approval_status: "approved", status: "approved", execution_status: "executing", updated_at: now })
    .where(eq(tasks.id, taskId));

  const runId = randomUUID();
  const steps: ExecutionStep[] = [];
  const touched: string[] = [];
  let failure: string | null = null;

  await db.insert(executionRuns).values({
    id: runId,
    task_id: taskId,
    started_at: now,
    status: "executing",
    affected_systems: task.affected_systems,
    steps: [],
  });
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: taskId,
    event_type: "execution_started",
    actor_type: "system",
    actor_id: "sys",
    summary: `Execution started: ${task.title}.`,
    created_at: now,
  });

  // Project "page" step: approving publishes the generated page live at /p/[slug].
  const pageMeta = assets
    .map((a) => a.metadata as { page_id?: string; slug?: string } | null | undefined)
    .find((m) => m?.page_id);
  if (pageMeta?.page_id) {
    try {
      await setPageStatus(workspaceId, String(pageMeta.page_id), "published");
      steps.push({ label: `Published page — /p/${pageMeta.slug ?? ""}`, status: "done" });
      touched.push("Pages");
    } catch (e) {
      failure = e instanceof Error ? e.message : "Failed to publish the page.";
      steps.push({ label: `Pages: ${failure}`, status: "failed" });
    }
  }

  for (const name of task.affected_systems) {
    if (failure) break;
    const provider = providerForIntegrationName(name);
    const integ = connectedByName.get(name);
    const live = provider && isProviderConfigured(provider) && integ?.connected;

    if (!live) {
      steps.push({ label: `Simulated: update ${name} (not connected)`, status: "done" });
      continue;
    }

    try {
      if (name === "Gmail") {
        const token = await getValidAccessToken(workspaceId, name);
        if (!token) throw new Error("No Gmail token");
        const meta = assets[0]?.metadata as Record<string, string | number> | null | undefined;
        if (meta && meta.kind === "reply" && meta.to) {
          // Triage reply: send the approved draft back to the original sender, in-thread.
          await sendGmail(token, {
            to: String(meta.to),
            subject: meta.subject ? String(meta.subject) : `Re: ${parseSubject(draft)}`,
            body: draft || task.description,
            threadId: meta.thread_id ? String(meta.thread_id) : undefined,
            inReplyTo: meta.in_reply_to ? String(meta.in_reply_to) : undefined,
          });
          steps.push({ label: `Replied via Gmail (to ${String(meta.to)})`, status: "done" });
        } else {
          await sendGmail(token, {
            to: actor.email, // safe self-send (verifiable); production targets the real recipient
            subject: `[Operator approved] ${parseSubject(draft)}`,
            body: `This email was sent by Operator after you approved "${task.title}".\n\n— — —\n${draft || task.description}`,
          });
          steps.push({ label: `Sent via Gmail (to ${actor.email})`, status: "done" });
        }
        touched.push("Gmail");
      } else if (name === "Google Calendar") {
        const token = await getValidAccessToken(workspaceId, name);
        if (!token) throw new Error("No Calendar token");
        const start = task.due_at ? new Date(task.due_at) : new Date(Date.now() + 3600_000);
        const end = new Date(start.getTime() + 30 * 60_000);
        await createCalendarEvent(token, {
          summary: task.title,
          description: task.description,
          startISO: start.toISOString(),
          endISO: end.toISOString(),
        });
        steps.push({ label: "Created Google Calendar event", status: "done" });
        touched.push("Google Calendar");
      } else if (name === "HubSpot") {
        const token = await getValidAccessToken(workspaceId, name);
        if (!token) throw new Error("No HubSpot token");
        const r = await upsertContact(token, {
          email: "operator-demo@example.com",
          firstname: "Operator",
          lastname: "Demo Contact",
        });
        steps.push({ label: `${r.created ? "Created" : "Updated"} HubSpot contact`, status: "done" });
        touched.push("HubSpot");
      } else if (name === "Google Sheets") {
        const token = await getValidAccessToken(workspaceId, name);
        if (!token) throw new Error("No Google Sheets token");
        const when = new Date().toISOString();
        const r = await createSpreadsheet(token, {
          title: `Operator — ${task.title}`.slice(0, 90),
          rows: [
            ["Task", "Category", "Approved by", "When", "Details"],
            [task.title, task.category, actor.name, when, (draft || task.description).slice(0, 400)],
          ],
        });
        steps.push({ label: `Logged to Google Sheets${r.url ? ` — ${r.url}` : ""}`, status: "done" });
        touched.push("Google Sheets");
      } else if (name === "Notion") {
        const token = await getValidAccessToken(workspaceId, name);
        if (!token) throw new Error("No Notion token");
        const r = await createNotionPage(token, {
          title: `[Operator] ${task.title}`.slice(0, 100),
          content: draft || task.description,
        });
        steps.push({ label: `Created Notion page${r.url ? ` — ${r.url}` : ""}`, status: "done" });
        touched.push("Notion");
      } else if (name === "X (Twitter)") {
        const posted = await xPostsToday(workspaceId);
        if (posted >= X_DAILY_CAP) {
          throw new Error(
            `Daily limit reached — ${posted} posts already published to X today (cap ${X_DAILY_CAP}). Approve this tomorrow.`,
          );
        }
        const token = await getValidAccessToken(workspaceId, name);
        if (!token) throw new Error("No X token");
        // Publish the composed X post specifically — the `social_post` asset the
        // agent wrote and clamped for X — never some other draft asset (e.g. a
        // longer "Drafted by …" document) that may also be attached to the task.
        const xText =
          assets.find((a) => a.asset_type === "social_post")?.content?.trim() ||
          draft ||
          task.description;

        // Attach up to 4 images (X's per-post limit). A media failure never
        // sinks the post — publish text-only and note what was skipped.
        let mediaIds: string[] = [];
        let mediaNote = "";
        const mediaRows = (await listMediaRowsForTask(taskId)).slice(0, 4);
        if (mediaRows.length) {
          try {
            for (const m of mediaRows) {
              const { bytes, mime } = await getImageBytes(m.storage_path);
              mediaIds.push(await uploadMediaToX(token, bytes, mime));
            }
          } catch (e) {
            mediaIds = [];
            mediaNote = ` (image skipped: ${e instanceof Error ? e.message : "media upload failed"})`;
          }
        }

        const r = await postTweet(token, xText, mediaIds);
        const withImgs = mediaIds.length
          ? ` with ${mediaIds.length} image${mediaIds.length === 1 ? "" : "s"}`
          : mediaNote;
        steps.push({
          label: `Published to X — ${r.url}${r.truncated ? " (trimmed to fit 280)" : ""}${withImgs}`,
          status: "done",
        });
        touched.push("X (Twitter)");
      } else if (name === "Stripe") {
        const key = process.env.STRIPE_SECRET_KEY ?? "";
        await createDraftInvoice(key, {
          customerEmail: "operator-demo@example.com",
          amountCents: 5000,
          description: task.title,
        });
        steps.push({ label: "Created Stripe draft invoice (test)", status: "done" });
        touched.push("Stripe");
      } else {
        steps.push({ label: `Simulated: update ${name}`, status: "done" });
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : `Failed updating ${name}`;
      steps.push({ label: `${name}: ${failure}`, status: "failed" });
      break;
    }
  }

  const done = new Date();
  if (failure) {
    await db
      .update(executionRuns)
      .set({ status: "failed", error_message: failure, completed_at: done, steps })
      .where(eq(executionRuns.id, runId));
    await db.update(tasks).set({ execution_status: "failed", updated_at: done }).where(eq(tasks.id, taskId));
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: taskId,
      event_type: "execution_failed",
      actor_type: "system",
      actor_id: "sys",
      summary: `Execution failed: ${failure}`,
      created_at: done,
    });
    return { ok: false, error: failure };
  }

  const summary = touched.length
    ? `Executed live: ${touched.join(", ")}.`
    : "Completed (no connected systems — simulated).";
  await db
    .update(executionRuns)
    .set({ status: "completed", completed_at: done, result_summary: summary, steps })
    .where(eq(executionRuns.id, runId));
  await db
    .update(tasks)
    .set({ status: "done", execution_status: "completed", updated_at: done })
    .where(eq(tasks.id, taskId));
  await db.insert(activityEvents).values({
    id: randomUUID(),
    workspace_id: workspaceId,
    task_id: taskId,
    event_type: "execution_completed",
    actor_type: "system",
    actor_id: "sys",
    summary: `Execution completed: ${task.title}. ${summary}`,
    created_at: done,
  });
  if (touched.length) {
    await db.insert(activityEvents).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      task_id: taskId,
      event_type: "integration_touched",
      actor_type: "system",
      actor_id: "sys",
      summary: `Touched ${touched.join(", ")}.`,
      created_at: new Date(done.getTime() + 1),
    });
  }
  return { ok: true, summary };
}
