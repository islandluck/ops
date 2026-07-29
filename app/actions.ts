"use server";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { hasAnthropicKey, isBackendConfigured } from "@/lib/config";
import {
  applyOnboardingForUser,
  createPlannedTask,
  getDocumentById,
  getPlanningContext,
  loadBundleForUser,
  resetBundleForUser,
  saveBundleForUser,
  setDocumentNotionUrl,
  workspaceIdForUser,
} from "@/lib/db/queries";
import { draftWithClaude } from "@/lib/ai/draft";
import { planTask } from "@/lib/ai/plan";
import { isProviderConfigured, providerByKey } from "@/lib/integrations/registry";
import {
  clearIntegration,
  getValidAccessToken,
  markApiKeyConnected,
  setIntegrationPermissionMode,
} from "@/lib/integrations/tokens";
import { getStripeAccount } from "@/lib/integrations/stripe";
import { createNotionPage } from "@/lib/integrations/notion";
import { runTaskExecution } from "@/lib/integrations/execute";
import {
  runAgentForWorkspace,
  runTaskWithAgent,
  type RunAgentResult,
  type RunTaskResult,
} from "@/lib/agents/run";
import { runEmailTriage, type TriageResult } from "@/lib/agents/triage";
import type { AppState, DraftRequest, OnboardingInput, PermissionMode, PlannedTask } from "@/lib/types";

function displayName(user: User): string {
  const meta = user.user_metadata as { full_name?: string } | undefined;
  return meta?.full_name || user.email?.split("@")[0] || "You";
}

/** True once the user has completed guided onboarding (tracked in auth metadata). */
function isOnboarded(user: User): boolean {
  const meta = user.user_metadata as { onboarded?: boolean } | undefined;
  return Boolean(meta?.onboarded);
}

/* --------------------------- workspace ----------------------------- */

export async function loadWorkspace(): Promise<AppState | null> {
  if (!isBackendConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    return await loadBundleForUser(user.id, user.email ?? "", displayName(user), isOnboarded(user));
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
  return resetBundleForUser(user.id, user.email ?? "", displayName(user), isOnboarded(user));
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

/**
 * Create a task from a plain-language request. Operator plans it first —
 * interpreting intent, choosing the integrations it needs, and drafting the
 * actual content — so it lands ready to review and (once approved) execute for
 * real. Falls back to a bare task when AI drafting isn't configured.
 */
export async function createTaskAction(
  input: { title: string; notes?: string },
): Promise<{ ok: boolean; taskId?: string; title?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const ctx = await getPlanningContext(ws);
    let planned: PlannedTask;
    if (hasAnthropicKey()) {
      planned = await planTask({ title: input.title, notes: input.notes }, ctx);
    } else {
      planned = {
        title: input.title.slice(0, 120),
        category: "admin",
        affected_systems: [],
        risk_level: "low",
        requires_approval: true,
        rationale: input.notes?.trim() || "Created manually.",
        draft: input.notes?.trim() || "",
        needs_connection: [],
      };
    }
    // The approval center is human-in-the-loop: anything that touches a real
    // system must be approved before it runs, regardless of the model's guess.
    if (planned.affected_systems.length > 0) planned.requires_approval = true;
    const taskId = await createPlannedTask(ws, planned, { name: displayName(user) });
    return { ok: true, taskId, title: planned.title };
  } catch (e) {
    console.error("[createTask] failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create the task." };
  }
}

/** Run an agent now — it prepares a fresh task (and ships it if on auto). */
export async function runAgentAction(agentId: string): Promise<RunAgentResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return runAgentForWorkspace(ws, agentId, { name: displayName(user), email: user.email ?? "" });
}

/** Have a task's assigned agent draft the deliverable (then it awaits approval). */
export async function runTaskAction(taskId: string): Promise<RunTaskResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return runTaskWithAgent(ws, taskId);
}

/** Run email triage now — the Admin agent reads + prioritizes your unread inbox. */
export async function runEmailTriageAction(): Promise<TriageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return runEmailTriage(ws, { name: displayName(user), email: user.email ?? "" });
}

/** Export a document to Notion (creates a page under a shared Notion page). */
export async function sendDocumentToNotionAction(
  documentId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const doc = await getDocumentById(ws, documentId);
  if (!doc) return { ok: false, error: "Document not found." };
  const token = await getValidAccessToken(ws, "Notion");
  if (!token) return { ok: false, error: "Connect Notion in Integrations first." };
  try {
    const page = await createNotionPage(token, { title: doc.name, content: doc.content });
    if (page.url) await setDocumentNotionUrl(ws, documentId, page.url);
    return { ok: true, url: page.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't send to Notion." };
  }
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

  // Session present → email confirmation is off; go straight to guided setup.
  if (data.session) redirect("/onboarding");

  // No session → Supabase requires email confirmation. For local/dev testing
  // (AUTH_AUTOCONFIRM=true) confirm immediately via the service role and sign in,
  // so signup is exercisable end-to-end without waiting on email delivery.
  // In production this stays off — real confirmation (custom SMTP) is required.
  let autoConfirmed = false;
  if (process.env.AUTH_AUTOCONFIRM === "true" && data.user) {
    try {
      const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
      const admin = createSupabaseAdminClient();
      await admin.auth.admin.updateUserById(data.user.id, { email_confirm: true });
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) return { error: signInError.message };
      autoConfirmed = true;
    } catch (e) {
      console.error("[signUp autoconfirm] failed:", e instanceof Error ? e.message : e);
    }
  }
  if (autoConfirmed) redirect("/onboarding");

  return { needsConfirmation: true };
}

/**
 * Persist guided onboarding: write the brief + workspace name + default
 * permission mode, then mark the user onboarded (auth metadata) so middleware
 * lets them into the app on the next request.
 */
export async function completeOnboardingAction(
  input: OnboardingInput,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  try {
    await applyOnboardingForUser(user.id, input);
    const prevName = (user.user_metadata as { full_name?: string } | undefined)?.full_name ?? "";
    await supabase.auth.updateUser({
      data: { onboarded: true, full_name: input.user_name || prevName },
    });
    return { ok: true };
  } catch (e) {
    console.error("[completeOnboarding] failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "Onboarding failed." };
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // Navigation is handled by the caller so it works uniformly in both modes.
}
