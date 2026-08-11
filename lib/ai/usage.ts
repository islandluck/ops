import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";

/**
 * AI usage attribution. A per-async-context store (AsyncLocalStorage) carries the
 * workspace + operation label for the current unit of work; the metered Anthropic
 * client (lib/ai/client.ts) reads it after each response and records token usage.
 * Setting the context at the workspace-scoped entry points means individual AI
 * functions never have to thread a workspaceId through their signatures.
 */

interface UsageCtx {
  workspaceId?: string;
  operation?: string;
}

const usageStore = new AsyncLocalStorage<UsageCtx>();

/** Run `fn` with AI-usage attribution (workspace + operation) in scope. */
export function runWithUsage<T>(
  workspaceId: string | undefined,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  return usageStore.run({ workspaceId, operation }, fn);
}

/** The current attribution context, or {} outside any runWithUsage scope. */
export function currentUsage(): UsageCtx {
  return usageStore.getStore() ?? {};
}

/** Record one Claude call's token usage against the current workspace/operation. Fire-and-forget. */
export function recordAiUsage(u: { model: string; input_tokens: number; output_tokens: number }): void {
  const ctx = currentUsage();
  void (async () => {
    try {
      await db.insert(aiUsage).values({
        id: randomUUID(),
        workspace_id: ctx.workspaceId ?? null,
        operation: ctx.operation ?? "",
        model: u.model || "",
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        created_at: new Date(),
      });
    } catch {
      /* metering must never break an AI call */
    }
  })();
}
