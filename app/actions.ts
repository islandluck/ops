"use server";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { hasAnthropicKey, isBackendConfigured } from "@/lib/config";
import {
  loadBundleForUser,
  resetBundleForUser,
  saveBundleForUser,
} from "@/lib/db/queries";
import { draftWithClaude } from "@/lib/ai/draft";
import type { AppState, DraftRequest } from "@/lib/types";

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
