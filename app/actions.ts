"use server";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { hasAnthropicKey, isBackendConfigured } from "@/lib/config";
import {
  loadBundleForUser,
  resetBundleForUser,
  saveBundleForUser,
  workspaceIdForUser,
} from "@/lib/db/queries";
import { draftWithClaude } from "@/lib/ai/draft";
import { isProviderConfigured, providerByKey } from "@/lib/integrations/registry";
import {
  clearIntegration,
  markApiKeyConnected,
  setIntegrationPermissionMode,
} from "@/lib/integrations/tokens";
import { getStripeAccount } from "@/lib/integrations/stripe";
import { runTaskExecution } from "@/lib/integrations/execute";
import { runAgentForWorkspace, type RunAgentResult } from "@/lib/agents/run";
import type { AppState, DraftRequest, PermissionMode } from "@/lib/types";

function displayName(user: User): string {
  const meta = user.user_metadata as { full_name?: string } | undefined;
  return meta?.full_name || user.email?.split("@")[0] || "You";
}

/* --------------------------- workspace ----------------------------- */

export async function loadWorkspace(): Promise<AppState | null> {
  if (!isBackendConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    return await loadBundleForUser(user.id, user.email ?? "", displayName(user));
  } catch (e) {
    console.error("[loadWorkspace] failed:", e instanceof Error ? e.message : e);
    throw e;
  }
}

export async function saveWorkspace(state: AppState): Promise<{ ok: boolean; error?: string }> {
  if (!isBackendConfigured()) return { ok: false, error: "Backend not configured" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  try {
    await saveBundleForUser(user.id, state);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function resetWorkspace(): Promise<AppState | null> {
  if (!isBackendConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  return resetBundleForUser(user.id, user.email ?? "", displayName(user));
}

/* ------------------------ integrations (Phase 3) ------------------- */

export async function disconnectIntegrationAction(
  integrationId: string,
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  await clearIntegration(ws, integrationId);
  return { ok: true };
}

export async function setIntegrationModeAction(
  integrationId: string,
  mode: PermissionMode,
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  await setIntegrationPermissionMode(ws, integrationId, mode);
  return { ok: true };
}

/** Stripe connects via a server-side secret key (no OAuth). Validates + marks connected. */
export async function connectStripeAction(): Promise<{ ok: boolean; account?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const provider = providerByKey("stripe");
  if (!provider || !isProviderConfigured(provider)) {
    return { ok: false, error: "STRIPE_SECRET_KEY is not configured on the server." };
  }
  const account = await getStripeAccount(process.env.STRIPE_SECRET_KEY ?? "");
  if (!account) return { ok: false, error: "Stripe key appears invalid." };
  await markApiKeyConnected(ws, provider, account);
  return { ok: true, account };
}

/** Approve + execute a task for real (server-side provider calls). */
export async function runTaskExecutionAction(
  taskId: string,
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return runTaskExecution(ws, taskId, { name: displayName(user), email: user.email ?? "" });
}

/** Run an agent now — it prepares a fresh task (and ships it if on auto). */
export async function runAgentAction(agentId: string): Promise<RunAgentResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return runAgentForWorkspace(ws, agentId, { name: displayName(user), email: user.email ?? "" });
}

/* --------------------------- AI drafting --------------------------- */

export async function generateDraft(
  req: DraftRequest,
): Promise<{ content?: string; error?: string }> {
  if (!hasAnthropicKey()) return { error: "AI drafting is not configured." };
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  try {
    const content = await draftWithClaude(req);
    return { content };
  } catch (e) {
    console.error("[generateDraft] failed:", e instanceof Error ? e.message : e);
    return { error: e instanceof Error ? e.message : "AI drafting failed." };
  }
}

/* ----------------------------- auth -------------------------------- */

export async function signInAction(
  email: string,
  password: string,
): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect("/approvals");
}

export async function signUpAction(
  email: string,
  password: string,
  name: string,
): Promise<{ error?: string; needsConfirmation?: boolean }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });
  if (error) return { error: error.message };
  if (!data.session) return { needsConfirmation: true };
  redirect("/onboarding");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // Navigation is handled by the caller so it works uniformly in both modes.
}
