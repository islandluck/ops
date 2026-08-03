"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { APP_URL, hasAnthropicKey, isBackendConfigured } from "@/lib/config";
import { randomUUID } from "node:crypto";
import {
  addXTarget,
  applyOnboardingForUser,
  createPlannedTask,
  deleteMediaRow,
  dismissOpportunity,
  ensureProvisioned,
  getDocumentById,
  getMediaRow,
  getOpportunity,
  getPlanningContext,
  getXStyleProfile,
  insertMedia,
  listMediaForTask,
  listReplyOpportunities,
  listXTargets,
  loadBundleForUser,
  markOpportunityReplied,
  removeXTarget,
  resetBundleForUser,
  saveBundleForUser,
  setDocumentNotionUrl,
  setOpportunityReplies,
  setXStyleProfile,
  workspaceIdForUser,
} from "@/lib/db/queries";
import { deleteImageAt, IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, uploadImageBytes } from "@/lib/media/storage";
import { searchStockImages, stockConfigured, type StockImage } from "@/lib/ai/stock";
import { draftWithClaude } from "@/lib/ai/draft";
import { planTask } from "@/lib/ai/plan";
import { analyzeTweetStyle, cleanUpTweets, growthBoostTweet, suggestReplies } from "@/lib/ai/style";
import { getUserTweets } from "@/lib/integrations/x";
import { parseTweets, scheduleBulkTweets } from "@/lib/agents/social-bulk";
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
import { executionKilled } from "@/lib/integrations/guardrails";
import { getTweetById, getUserByUsername, postTweet } from "@/lib/integrations/x";
import { refreshReplyRadar } from "@/lib/agents/reply-radar";
import {
  runAgentForWorkspace,
  runTaskWithAgent,
  type RunAgentResult,
  type RunTaskResult,
} from "@/lib/agents/run";
import { runEmailTriage, type TriageResult } from "@/lib/agents/triage";
import { runNotionTriage, type NotionTriageResult } from "@/lib/agents/notion-triage";
import { approveScheduledPost, scheduleTask, unscheduleTask } from "@/lib/agents/schedule";
import {
  advanceProject,
  approveProjectPlan,
  cancelProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
} from "@/lib/agents/project";
import { approveAllCampaignPosts, createGrowthCampaign, getCampaignData } from "@/lib/agents/growth";
import {
  addGoal,
  addMemory,
  approveBriefSuggestion,
  deleteGoal,
  deleteMemory,
  dismissBriefSuggestion,
  generateDailyBrief,
  getExecutiveBundle,
  sendExecutiveMessage,
  setGoalStatus,
  startNewExecutiveChat,
  togglePinMemory,
} from "@/lib/agents/executive";
import { countAttention } from "@/lib/executive/nudges";
import {
  boostPost,
  createPost,
  deletePost as deletePostEngine,
  getPost,
  listPosts,
  markChannelPublished,
  packagePost,
  publishPageChannel,
  scheduleThreadChannel,
  updatePost,
  updateThreadTweets,
} from "@/lib/agents/content";
import type { BoostedLongform } from "@/lib/ai/content";
import {
  createProduct,
  deletePage,
  generateAndSavePage,
  getPage,
  listOrders,
  listPages,
  listProducts,
  setPageStatus,
  updatePage,
} from "@/lib/pages";
import type {
  AppState,
  BriefKind,
  CampaignData,
  ChannelKind,
  DraftRequest,
  ExecBrief,
  ExecMessage,
  ExecutiveBundle,
  GoalHorizon,
  GoalMetric,
  GoalStatus,
  MemoryKind,
  OnboardingInput,
  Order,
  Page,
  PageContent,
  PageType,
  PermissionMode,
  PlannedTask,
  Post,
  PostImage,
  Product,
  Project,
  ReplyOpportunity,
  XTarget,
} from "@/lib/types";

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

/** Approve a task now but queue it to auto-execute at `whenISO` (auto-publish).
 *  `label` is a human-readable time (formatted in the user's tz) for the log. */
export async function scheduleTaskAction(
  taskId: string,
  whenISO: string,
  label?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return scheduleTask(ws, taskId, whenISO, { name: displayName(user) }, label);
}

/** Cancel a scheduled task, returning it to the board for review. */
export async function unscheduleTaskAction(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return unscheduleTask(ws, taskId, { name: displayName(user) });
}

/* -------------------------- post images (media) -------------------------- */

/** Images attached to a task/post. */
export async function getPostImagesAction(taskId: string): Promise<PostImage[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  return listMediaForTask(ws, taskId);
}

/** Upload an image file and attach it to a task. */
export async function uploadPostImageAction(
  taskId: string | null,
  formData: FormData,
): Promise<{ ok: boolean; image?: PostImage; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (!IMAGE_MIME_TYPES.includes(file.type)) {
    return { ok: false, error: "Unsupported image type — use PNG, JPEG, WebP, or GIF." };
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Image is too large (max 10 MB)." };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { path, publicUrl } = await uploadImageBytes(ws, randomUUID(), bytes, file.type);
    const image = await insertMedia({
      workspaceId: ws,
      taskId,
      source: "upload",
      storagePath: path,
      publicUrl,
      mimeType: file.type,
      byteSize: file.size,
      altText: file.name.replace(/\.[^.]+$/, "").slice(0, 200),
    });
    return { ok: true, image };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

/** Search the stock library (Pexels). `configured` is false until a key is set. */
export async function searchStockAction(
  query: string,
): Promise<{ ok: boolean; images: StockImage[]; configured: boolean }> {
  const user = await getCurrentUser();
  const configured = stockConfigured();
  if (!user) return { ok: false, images: [], configured };
  const images = await searchStockImages(query);
  return { ok: true, images, configured };
}

/** Save a chosen stock image into our storage and attach it to a task. */
export async function attachStockImageAction(
  taskId: string | null,
  stock: { url: string; alt: string; width: number; height: number; attribution: string },
): Promise<{ ok: boolean; image?: PostImage; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const res = await fetch(stock.url);
    if (!res.ok) return { ok: false, error: "Couldn't fetch that stock image." };
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!IMAGE_MIME_TYPES.includes(mime)) return { ok: false, error: "Unsupported image type." };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "Image is too large (max 10 MB)." };
    const { path, publicUrl } = await uploadImageBytes(ws, randomUUID(), bytes, mime);
    const image = await insertMedia({
      workspaceId: ws,
      taskId,
      source: "stock",
      storagePath: path,
      publicUrl,
      mimeType: mime,
      byteSize: bytes.length,
      altText: stock.alt.slice(0, 200),
      width: stock.width,
      height: stock.height,
      attribution: stock.attribution,
    });
    return { ok: true, image };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't attach that image." };
  }
}

/** Remove an attached image (deletes the row + the stored binary). */
export async function removePostImageAction(
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const row = await getMediaRow(ws, mediaId);
  if (!row) return { ok: false, error: "Image not found." };
  await deleteMediaRow(mediaId);
  await deleteImageAt(row.storage_path);
  return { ok: true };
}

/* ------------------------------- projects -------------------------------- */

/** Have a leadership agent plan a project from a goal (awaits plan approval). */
export async function createProjectAction(
  goal: string,
  ownerKind: "manager" | "executive",
): Promise<{ ok: boolean; projectId?: string; title?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return createProject(ws, goal, ownerKind);
}

/** Approve a project's plan and kick off phase 1. */
export async function approveProjectPlanAction(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return approveProjectPlan(ws, projectId, { name: displayName(user) });
}

/** Nudge a project to advance if its current phase is complete. */
export async function advanceProjectAction(
  projectId: string,
): Promise<{ ok: boolean; advanced?: boolean; status?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const r = await advanceProject(ws, projectId);
  return { ok: true, advanced: r.advanced, status: r.status };
}

export async function cancelProjectAction(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return cancelProject(ws, projectId, { name: displayName(user) });
}

/** Delete a project and discard its work (tasks, queued posts, draft pages). */
export async function deleteProjectAction(
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return deleteProject(ws, projectId, { name: displayName(user) });
}

export async function getProjectsAction(): Promise<Project[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  return listProjects(ws);
}

export async function getProjectAction(projectId: string): Promise<Project | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  return getProject(ws, projectId);
}

/* --------------------------- growth campaigns ---------------------------- */

/** Plan + create an Executive-run follower-growth campaign (awaits plan approval). */
export async function createGrowthCampaignAction(input: {
  goal: string;
  weeks: number;
  followerGoalPerWeek: number;
}): Promise<{ ok: boolean; projectId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return createGrowthCampaign(ws, input);
}

/** Follower trend + scheduled posts for a campaign's drawer. */
export async function getCampaignDataAction(projectId: string): Promise<CampaignData> {
  const user = await getCurrentUser();
  if (!user) return { followers: [], posts: [] };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { followers: [], posts: [] };
  return getCampaignData(ws, projectId);
}

/** Approve a single scheduled post, keeping its schedule (auto-publishes on time). */
export async function approveScheduledPostAction(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return approveScheduledPost(ws, taskId, { name: displayName(user) });
}

/** Approve every pending scheduled post in a campaign at once. */
export async function approveAllCampaignPostsAction(
  projectId: string,
): Promise<{ ok: boolean; approved?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const r = await approveAllCampaignPosts(ws, projectId, { name: displayName(user) });
  return { ok: true, approved: r.approved };
}

/* ---------------------------- content engine ----------------------------- */

/** Create a longform master — generate from a topic, or seed from a title/paste. */
export async function createPostAction(input: {
  topic?: string;
  angle?: string;
  title?: string;
  dek?: string;
  body_md?: string;
  generate?: boolean;
}): Promise<{ ok: boolean; postId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return createPost(ws, input);
}

export async function getPostsAction(): Promise<Post[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  return listPosts(ws);
}

export async function getPostAction(postId: string): Promise<Post | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  return getPost(ws, postId);
}

export async function updatePostAction(
  postId: string,
  patch: { title?: string; dek?: string; body_md?: string; hero_image_url?: string | null; boosted?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return updatePost(ws, postId, patch);
}

/** Growth-marketer viral rewrite of the master (advisory — returned, not saved). */
export async function boostPostAction(
  postId: string,
): Promise<{ ok: boolean; boosted?: BoostedLongform; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const boosted = await boostPost(ws, postId);
    return { ok: true, boosted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't boost the post." };
  }
}

export async function packagePostAction(
  postId: string,
  channels: ChannelKind[],
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return packagePost(ws, postId, channels);
}

export async function publishPageChannelAction(
  postId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return publishPageChannel(ws, postId);
}

/** Persist edited X-thread tweets before scheduling. */
export async function updateThreadTweetsAction(
  postId: string,
  tweets: string[],
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return updateThreadTweets(ws, postId, tweets);
}

export async function scheduleThreadChannelAction(
  postId: string,
  whenISO?: string,
): Promise<{ ok: boolean; scheduledAt?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return scheduleThreadChannel(ws, postId, { whenISO });
}

export async function markChannelPublishedAction(
  postId: string,
  channel: ChannelKind,
  url?: string,
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return markChannelPublished(ws, postId, channel, url);
}

export async function deletePostAction(postId: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return deletePostEngine(ws, postId);
}

/* --------------------------- executive office ---------------------------- */

export async function getExecutiveBundleAction(): Promise<ExecutiveBundle | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  return getExecutiveBundle(ws);
}

/** Count of things needing the founder's attention (for the sidebar badge). */
export async function getExecutiveAttentionAction(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return 0;
  return countAttention(ws);
}

/** Generate a fresh executive brief (daily snapshot or weekly review). */
export async function generateBriefAction(
  kind: BriefKind = "daily",
): Promise<{ ok: boolean; brief?: ExecBrief; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return generateDailyBrief(ws, kind);
}

/** Approve a brief suggestion — create the project/campaign/task it proposes. */
export async function approveBriefSuggestionAction(
  briefId: string,
  suggestionId: string,
): Promise<{ ok: boolean; href?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return approveBriefSuggestion(ws, briefId, suggestionId);
}

/** Dismiss a brief suggestion. */
export async function dismissBriefSuggestionAction(
  briefId: string,
  suggestionId: string,
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return dismissBriefSuggestion(ws, briefId, suggestionId);
}

/** Start a fresh Executive conversation (archives the current one). */
export async function startNewExecutiveChatAction(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return startNewExecutiveChat(ws);
}

/** Talk to the Executive Agent — a tool-using reply grounded in live business data. */
export async function sendExecutiveMessageAction(
  text: string,
): Promise<{ ok: boolean; reply?: ExecMessage; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return sendExecutiveMessage(ws, text);
}

export async function addGoalAction(input: {
  title: string;
  detail?: string;
  metric?: string;
  target?: string;
  horizon?: GoalHorizon;
  metric_key?: GoalMetric | null;
  target_number?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return addGoal(ws, input);
}

export async function setGoalStatusAction(id: string, status: GoalStatus): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return setGoalStatus(ws, id, status);
}

export async function deleteGoalAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return deleteGoal(ws, id);
}

export async function addMemoryAction(content: string, kind?: MemoryKind): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return addMemory(ws, content, kind);
}

export async function togglePinMemoryAction(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return togglePinMemory(ws, id, pinned);
}

export async function deleteMemoryAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return deleteMemory(ws, id);
}

/* --------------------------- pages & commerce ---------------------------- */

export async function getPagesAction(): Promise<Page[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  return ws ? listPages(ws) : [];
}

export async function generatePageAction(input: {
  offer: string;
  pageType?: PageType;
  productId?: string | null;
  projectId?: string | null;
}): Promise<{ ok: boolean; page?: Page; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if (!input.offer.trim()) return { ok: false, error: "Describe what the page is for." };
  return generateAndSavePage(ws, {
    offer: input.offer.trim(),
    pageType: input.pageType,
    productId: input.productId ?? null,
    projectId: input.projectId ?? null,
  });
}

export async function publishPageAction(pageId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return setPageStatus(ws, pageId, "published");
}

export async function unpublishPageAction(pageId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return setPageStatus(ws, pageId, "draft");
}

export async function attachProductToPageAction(
  pageId: string,
  productId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return updatePage(ws, pageId, { product_id: productId });
}

export async function deletePageAction(pageId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return deletePage(ws, pageId);
}

export async function getProductsAction(): Promise<Product[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  return ws ? listProducts(ws) : [];
}

export async function createProductAction(input: {
  name: string;
  price_cents: number;
  description?: string;
  currency?: string;
}): Promise<{ ok: boolean; product?: Product; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if (!input.name.trim()) return { ok: false, error: "Give the product a name." };
  const product = await createProduct(ws, {
    name: input.name.trim(),
    price_cents: input.price_cents,
    description: input.description,
    currency: input.currency,
  });
  return { ok: true, product };
}

export async function getOrdersAction(): Promise<Order[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  return ws ? listOrders(ws) : [];
}

export async function getPageAction(pageId: string): Promise<Page | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  return ws ? getPage(ws, pageId) : null;
}

/** Persist editor changes to a page (title, content, attached product). */
export async function updatePageAction(
  pageId: string,
  patch: { title?: string; content?: PageContent; product_id?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return updatePage(ws, pageId, patch);
}

/** Upload an image for a page (logo/hero/section); returns its stored URL. */
export async function uploadPageImageAction(
  formData: FormData,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (!IMAGE_MIME_TYPES.includes(file.type)) {
    return { ok: false, error: "Unsupported image type — use PNG, JPEG, WebP, or GIF." };
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Image is too large (max 10 MB)." };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { publicUrl } = await uploadImageBytes(ws, randomUUID(), bytes, file.type);
    return { ok: true, url: publicUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

/** Re-host a chosen stock image into our storage for a page; returns its URL. */
export async function attachStockToPageAction(
  stockUrl: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const res = await fetch(stockUrl);
    if (!res.ok) return { ok: false, error: "Couldn't fetch that image." };
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    if (!IMAGE_MIME_TYPES.includes(mime)) return { ok: false, error: "Unsupported image type." };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "Image is too large (max 10 MB)." };
    const { publicUrl } = await uploadImageBytes(ws, randomUUID(), bytes, mime);
    return { ok: true, url: publicUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't attach that image." };
  }
}

/* ------------------------------ X voice --------------------------------- */

export async function getXStyleAction(): Promise<{ profile: string | null }> {
  const user = await getCurrentUser();
  if (!user) return { profile: null };
  const ws = await workspaceIdForUser(user.id);
  return { profile: ws ? await getXStyleProfile(ws) : null };
}

/** Learn the owner's voice from their connected X account's recent tweets. */
export async function learnXStyleFromXAction(): Promise<{
  ok: boolean;
  profile?: string;
  count?: number;
  needsPaste?: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const token = await getValidAccessToken(ws, "X (Twitter)");
  if (!token) return { ok: false, needsPaste: true, error: "X isn't connected." };
  const tweets = await getUserTweets(token, 40);
  if (tweets.length < 5) {
    return { ok: false, needsPaste: true, error: `Only found ${tweets.length} usable tweets.` };
  }
  try {
    const profile = await analyzeTweetStyle(tweets);
    await setXStyleProfile(ws, profile);
    return { ok: true, profile, count: tweets.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't analyze your style." };
  }
}

/** Learn the owner's voice from pasted example tweets. */
export async function learnXStyleFromTextAction(
  text: string,
): Promise<{ ok: boolean; profile?: string; count?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const samples = parseTweets(text);
  if (samples.length < 3) return { ok: false, error: "Paste at least 3 example tweets." };
  try {
    const profile = await analyzeTweetStyle(samples);
    await setXStyleProfile(ws, profile);
    return { ok: true, profile, count: samples.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't analyze your style." };
  }
}

/** Save an edited style profile (or clear it when empty). */
export async function saveXStyleAction(profile: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  await setXStyleProfile(ws, profile.trim() ? profile.trim().slice(0, 4000) : null);
  return { ok: true };
}

/** Preview: parse a pasted list + clean each tweet in the owner's voice. */
export async function bulkPreviewTweetsAction(
  text: string,
): Promise<{ ok: boolean; tweets?: string[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const raw = parseTweets(text);
  if (!raw.length) return { ok: false, error: "Paste at least one tweet." };
  try {
    const { brief } = await getPlanningContext(ws);
    const style = await getXStyleProfile(ws);
    const tweets = await cleanUpTweets(raw, {
      company: brief.company_name,
      voiceRules: brief.voice_rules,
      styleProfile: style,
    });
    return { ok: true, tweets };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't clean up the tweets." };
  }
}

/** Growth Marketer: suggest 3 more-engaging/viral takes on one tweet (advisory). */
export async function growthBoostTweetAction(
  tweet: string,
): Promise<{ ok: boolean; suggestions?: { boosted: string; note: string }[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if (!tweet.trim()) return { ok: false, error: "Nothing to boost." };
  try {
    const { brief } = await getPlanningContext(ws);
    const style = await getXStyleProfile(ws);
    const suggestions = await growthBoostTweet(tweet, {
      company: brief.company_name,
      voiceRules: brief.voice_rules,
      styleProfile: style,
    });
    return { ok: true, suggestions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't boost the tweet." };
  }
}

/** Schedule the (possibly edited) cleaned tweets across the day/week. */
export async function bulkScheduleTweetsAction(
  items: { text: string; mediaId?: string | null }[],
  config: { perDay: number; startHour?: number; endHour?: number },
): Promise<{ ok: boolean; scheduled?: number; when?: string[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const clean = items
    .map((it) => ({ text: it.text.trim(), mediaId: it.mediaId ?? null }))
    .filter((it) => it.text);
  if (!clean.length) return { ok: false, error: "No tweets to schedule." };
  try {
    const res = await scheduleBulkTweets(
      ws,
      clean,
      { perDay: Math.max(1, Math.min(config.perDay || 3, 8)), startHour: config.startHour, endHour: config.endHour },
      { name: displayName(user) },
    );
    return { ok: true, scheduled: res.scheduled, when: res.when };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't schedule the tweets." };
  }
}

/** Reply Assistant: suggest value-add replies to a pasted tweet (link or text). */
export async function suggestRepliesAction(
  input: string,
  pastedText?: string,
): Promise<{
  ok: boolean;
  tweetId?: string;
  tweetText?: string;
  author?: string | null;
  suggestions?: { reply: string; note: string }[];
  needsText?: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const idMatch = input.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  const tweetId = idMatch?.[1];
  if (!tweetId) return { ok: false, error: "Paste a link to a tweet (e.g. x.com/user/status/12345…)." };

  // Prefer the API's copy of the tweet; fall back to the owner pasting the text.
  let tweetText = (pastedText ?? "").trim();
  let author: string | null = null;
  if (!tweetText) {
    const token = await getValidAccessToken(ws, "X (Twitter)");
    if (token) {
      const fetched = await getTweetById(token, tweetId);
      if (fetched) {
        tweetText = fetched.text;
        author = fetched.author;
      }
    }
  }
  if (!tweetText) return { ok: true, tweetId, needsText: true };

  try {
    const { brief } = await getPlanningContext(ws);
    const style = await getXStyleProfile(ws);
    const suggestions = await suggestReplies(
      { text: tweetText, author },
      {
        company: brief.company_name,
        idealCustomer: brief.ideal_customer_profile,
        voiceRules: brief.voice_rules,
        restrictedPhrases: brief.restricted_phrases,
        styleProfile: style,
      },
    );
    return { ok: true, tweetId, tweetText, author, suggestions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't suggest replies." };
  }
}

/** Post a reply to a tweet (user-initiated). Gated by the global kill switch. */
export async function postReplyAction(
  tweetId: string,
  text: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if (executionKilled()) return { ok: false, error: "Posting is paused (kill switch is on)." };
  const body = text.trim();
  if (!body) return { ok: false, error: "The reply is empty." };
  if (!/^\d+$/.test(tweetId)) return { ok: false, error: "That tweet link looks invalid." };
  const token = await getValidAccessToken(ws, "X (Twitter)");
  if (!token) return { ok: false, error: "Connect X first (from Integrations)." };
  try {
    const r = await postTweet(token, body, undefined, tweetId);
    return { ok: true, url: r.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't post the reply." };
  }
}

/* ------------------------------ reply radar ------------------------------ */

export async function getXTargetsAction(): Promise<XTarget[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  return ws ? listXTargets(ws) : [];
}

export async function addXTargetAction(
  handle: string,
  note?: string,
): Promise<{ ok: boolean; target?: XTarget; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const clean = handle.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) {
    return { ok: false, error: "Enter a valid X handle (letters, numbers, underscores)." };
  }
  // Best-effort resolve the user id now (so the first refresh is faster).
  let xUserId: string | null = null;
  const token = await getValidAccessToken(ws, "X (Twitter)");
  if (token) {
    const u = await getUserByUsername(token, clean);
    if (u) xUserId = u.id;
  }
  try {
    const target = await addXTarget(ws, clean, note ?? "", xUserId);
    return { ok: true, target };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't add that account." };
  }
}

export async function removeXTargetAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (ws) await removeXTarget(ws, id);
  return { ok: true };
}

export async function getReplyOpportunitiesAction(): Promise<ReplyOpportunity[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  return ws ? listReplyOpportunities(ws) : [];
}

export async function refreshReplyRadarAction(): Promise<{
  ok: boolean;
  found?: number;
  readBlocked?: boolean;
  targets?: number;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const r = await refreshReplyRadar(ws, { maxTargets: 8, perTarget: 10, draftTop: 2 });
    return { ok: true, found: r.found, readBlocked: r.readBlocked, targets: r.targets };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't refresh the radar." };
  }
}

export async function dismissOpportunityAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (ws) await dismissOpportunity(ws, id);
  return { ok: true };
}

/** Draft (or re-draft) reply options for an opportunity on demand. */
export async function draftOpportunityRepliesAction(
  id: string,
): Promise<{ ok: boolean; suggestions?: { reply: string; note: string }[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const opp = await getOpportunity(ws, id);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  try {
    const { brief } = await getPlanningContext(ws);
    const style = await getXStyleProfile(ws);
    const suggestions = await suggestReplies(
      { text: opp.tweet_text, author: opp.author_handle },
      {
        company: brief.company_name,
        idealCustomer: brief.ideal_customer_profile,
        voiceRules: brief.voice_rules,
        restrictedPhrases: brief.restricted_phrases,
        styleProfile: style,
      },
    );
    await setOpportunityReplies(ws, id, suggestions);
    return { ok: true, suggestions };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft replies." };
  }
}

/** Post the owner's reply to an opportunity's tweet, then mark it replied. */
export async function postOpportunityReplyAction(
  id: string,
  text: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if (executionKilled()) return { ok: false, error: "Posting is paused (kill switch is on)." };
  const body = text.trim();
  if (!body) return { ok: false, error: "The reply is empty." };
  const opp = await getOpportunity(ws, id);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const token = await getValidAccessToken(ws, "X (Twitter)");
  if (!token) return { ok: false, error: "Connect X first (from Integrations)." };
  try {
    const r = await postTweet(token, body, undefined, opp.tweet_id);
    await markOpportunityReplied(ws, id, r.url);
    return { ok: true, url: r.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't post the reply." };
  }
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

/** Run Notion triage now — read shared Notion pages and turn action items into tasks. */
export async function runNotionTriageAction(): Promise<NotionTriageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return runNotionTriage(ws, { name: displayName(user) });
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

/** The request's own origin — works on any deployment URL, not just APP_URL. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : APP_URL;
}

export async function signUpAction(
  email: string,
  password: string,
  name: string,
): Promise<{ error?: string; needsConfirmation?: boolean }> {
  const supabase = await createSupabaseServerClient();
  const origin = await requestOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      // Confirmation link returns here to establish the session, then → onboarding.
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });
  if (error) return { error: error.message };

  // Session present → email confirmation is off. Provision the profile +
  // workspace now (so it always exists before onboarding), then go to setup.
  if (data.session && data.user) {
    await ensureProvisioned(data.user.id, email, name).catch((e) =>
      console.error("[signUp provision] failed:", e instanceof Error ? e.message : e),
    );
    redirect("/onboarding");
  }

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
  if (autoConfirmed && data.user) {
    await ensureProvisioned(data.user.id, email, name).catch((e) =>
      console.error("[signUp provision] failed:", e instanceof Error ? e.message : e),
    );
    redirect("/onboarding");
  }

  return { needsConfirmation: true };
}

/** Send a password-reset email. Always returns ok — never reveal which emails exist. */
export async function requestPasswordResetAction(email: string): Promise<{ ok: true }> {
  if (email.trim()) {
    try {
      const supabase = await createSupabaseServerClient();
      const origin = await requestOrigin();
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/auth/callback?next=/reset-password`,
      });
    } catch {
      /* swallow — don't leak whether the account exists */
    }
  }
  return { ok: true };
}

/** Set a new password for the recovery-session user, then send them into the app. */
export async function updatePasswordAction(password: string): Promise<{ error?: string }> {
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/approvals");
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
    // Guarantee profile + workspace exist before applying onboarding, in case the
    // initial load didn't provision (session cookie not ready right after signup).
    await ensureProvisioned(user.id, user.email ?? "", input.user_name);
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
