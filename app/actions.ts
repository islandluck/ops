"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
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
  getBriefLocation,
  getDocumentById,
  getMediaRow,
  getOpportunity,
  getPlanningContext,
  saveBriefLocation,
  getXStyleProfile,
  insertMedia,
  listMediaForTask,
  bulkDeleteTasksForUser,
  bulkSetTasksArchivedForUser,
  createNoteForUser,
  deleteNoteForUser,
  deleteTaskForUser,
  getNoteForUser,
  hardResetWorkspace,
  listNotesForUser,
  listReplyOpportunities,
  listXTargets,
  loadBundleForUser,
  markNoteActioned,
  markOpportunityReplied,
  rejectTaskForUser,
  removeXTarget,
  resetBundleForUser,
  saveBundleForUser,
  setAgentBackgroundForUser,
  setDocumentNotionUrl,
  setOpportunityReplies,
  setTaskArchivedForUser,
  setXStyleProfile,
  updateNoteForUser,
  updateTaskAssetContent,
  workspaceIdForUser,
  getUserRoleInWorkspace,
} from "@/lib/db/queries";
import { getViewer } from "@/lib/access/viewer";
import {
  deleteImageAt,
  IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
  uploadAttachmentBytes,
  uploadImageBytes,
} from "@/lib/media/storage";
import { searchStockImages, stockConfigured, type StockImage } from "@/lib/ai/stock";
import { draftWithClaude } from "@/lib/ai/draft";
import { planTask } from "@/lib/ai/plan";
import { analyzeTweetStyle, cleanUpTweets, growthBoostTweet, suggestReplies } from "@/lib/ai/style";
import { getUserTweets } from "@/lib/integrations/x";
import { makeThreadFromText, parseTweets, postSingleTweetNow, scheduleBulkTweets, scheduleSingleTweet } from "@/lib/agents/social-bulk";
import { getSocialStats } from "@/lib/agents/social-stats";
import { isProviderConfigured, providerByKey } from "@/lib/integrations/registry";
import {
  clearIntegration,
  getValidAccessToken,
  markApiKeyConnected,
  setIntegrationPermissionMode,
  storeProviderTokens,
} from "@/lib/integrations/tokens";
import { getStripeAccount } from "@/lib/integrations/stripe";
import { hsValidateToken } from "@/lib/integrations/hubspot";
import { runCrmRadar } from "@/lib/agents/crm";
import { actionNote, analyzeNote } from "@/lib/agents/notes";
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
import {
  runEmailTriage,
  summarizeInboxToExecutive,
  triageMessages,
  type InboxSummaryResult,
  type TriageResult,
} from "@/lib/agents/triage";
import {
  archiveEmail,
  bulkArchive,
  bulkSendReplies,
  getEmailBody,
  getEmailManagerState,
  learnEmailStyleFromSent,
  listAttentionQueue,
  listDraftQueue,
  saveEmailDraft,
  saveEmailSettings,
  sendEmailReply,
  trashEmail,
} from "@/lib/agents/email-manager";
import {
  bulkSendOutboundDrafts,
  addOutboundAttachment,
  composeOutboundDrafts,
  discardOutboundDraft,
  flushDueOutboundDrafts,
  listOutboundDrafts,
  refineOutboundDraft,
  regenerateOutboundDraft,
  removeOutboundAttachment,
  scheduleOutboundDraft,
  sendOutboundDraft,
  stageOutboundDraft,
  unscheduleOutboundDraft,
  updateOutboundDraft,
} from "@/lib/agents/outbound";
import {
  acceptBoardVerdict,
  advanceBoard,
  alertToTask,
  conveneBoard,
  deleteBoardSession,
  discussWithBoard,
  getBoardSession,
  getBoardroom,
  handVerdictToExecutive,
  markAllAlertsRead,
  resetBoardMember,
  respondToBoard,
  runBoardScan,
  runBoardScanIfDue,
  seedBoardFromOnboarding,
  setAlertStatus,
  setBoardCadence,
  setBoardMission,
  setDirectiveStatus,
  unreadBoardAlertCount,
  updateBoardMember,
} from "@/lib/agents/boardroom";
import {
  activatePlacement,
  createAdCampaign,
  deleteAdCampaign,
  getAdCampaign,
  getPlacement,
  listAdCampaigns,
  pausePlacement,
  publishCreativeToX,
  setCampaignDestination,
  setCreativeStatus,
  suggestCampaigns,
  updateAdCreative,
  xAdsStatus,
} from "@/lib/agents/ads";
import {
  createAssignment,
  createChatChannel,
  deleteChatChannel,
  deleteChatMessage,
  markChannelRead,
  createDelegatedTask,
  createHumanProject,
  createTeamDocument,
  createTeamGoal,
  createTeamEvent,
  updateTeamEvent,
  getTeamEvent,
  listMyNotifications,
  markMyNotificationsRead,
  getNotifyChannels,
  createTeamMeeting,
  createTeamMember,
  deleteAssignment,
  deleteHumanProject,
  deleteTeamDocument,
  deleteTeamEvent,
  deleteTeamGoal,
  deleteTeamMeeting,
  deleteTeamMember,
  assignProjectToMember,
  getMyGoals,
  getTeamCalendar,
  getTeamCalendarRange,
  getGoogleCalendar,
  getTeamDriveFolder,
  setTeamDriveFolder,
  clearTeamDriveFolder,
  browseTeamDrive,
  type DriveBrowse,
  listNotionMeetingPages,
  previewNotionMeeting,
  importNotionMeeting,
  type MeetingImportInput,
  type MeetingPreview,
  type NotionMeetingPage,
  getPortalData,
  getWorkspaceRole,
  isProjectAssignedToMember,
  listAssignments,
  listChatChannels,
  listChatMessages,
  listHumanProjects,
  listMeetingAssignments,
  listMeetingTasks,
  listTeamDocuments,
  listTeamEvents,
  listTeamGoals,
  listTeamMeetings,
  getMemberWorkloads,
  listTeamMembers,
  sendChatMessage,
  setMemberOrg,
  setMemberPageAccess,
  setMyGoalStatus,
  updateAssignment,
  updateHumanProject,
  updateMyAssignmentStatus,
  updateTeamGoal,
  updateTeamMeeting,
  updateTeamMember,
  type AssignmentInput,
  type HumanProjectInput,
  type TeamDocumentInput,
  type TeamEventInput,
  type TeamEventPatch,
  type TeamGoalInput,
  type TeamMeetingInput,
  type TeamMemberInput,
} from "@/lib/agents/team";
import { getTeamAssistantHistory, sendTeamAssistantMessage } from "@/lib/agents/team-assistant";
import {
  acceptInvite,
  acceptInviteWithPassword,
  acceptPendingInvite,
  getInviteByToken,
  inviteTeamMember,
  listInvites,
  revokeInvite,
} from "@/lib/agents/team-invites";
import { clearPlan, getLatestPlan, planApprovalCenter, setTaskPriority } from "@/lib/agents/task-plan";
import type { AssignmentStatus, MeetingTask, Priority } from "@/lib/types";
import type { AdCampaign, AdPlatform, BoardAlertStatus, BoardCadence, BoardDirectiveStatus } from "@/lib/types";
import { getAiUsageReport, isAdminEmail, type AiUsageReport } from "@/lib/ai/report";
import {
  getCommandCenterDoc,
  saveCommandCenterDoc,
  sendGoalsToDeepDive,
  sendGoalsToExecutive,
  suggestGoals,
} from "@/lib/agents/command-center";
import { runNotionTriage, type NotionTriageResult } from "@/lib/agents/notion-triage";
import { approveScheduledPost, scheduleTask, unscheduleTask } from "@/lib/agents/schedule";
import {
  advanceProject,
  advanceWorkspaceProjects,
  approveProjectPlan,
  cancelProject,
  getMemberProjectDetail,
  getProjectPacket,
  healStuckProjectTasks,
  listAssignedProjects,
  listAssignedProjectsForOwner,
  memberOwnsAsset,
  memberOwnsTask,
  type ProjectPacket,
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
  deleteInvestorUpdate,
  generateInvestorUpdate,
  getExecutiveBundle,
  sendExecutiveMessage,
  getThreadMessages,
  searchThreads,
  newExecutiveThread,
  renameThread,
  deleteThread,
  saveExecutiveMessage,
  deleteSavedMessage,
  togglePinSaved,
  organizeSavedMessages,
  promoteSavedToMemory,
  setGoalStatus,
  setInvestorUpdateArchived,
  startNewExecutiveChat,
  togglePinMemory,
  updateInvestorUpdate,
} from "@/lib/agents/executive";
import type { ExecImage } from "@/lib/ai/executive";
import { computeKpiTrends } from "@/lib/executive/kpis";
import type { BillingState, EntitlementView, KpiTrendSeries } from "@/lib/types";
import { getBillingState, isWorkspaceOwner, openPortal, startCheckout } from "@/lib/billing/service";
import { ALL_FEATURES, getEntitlement, getSeatUsage } from "@/lib/billing/entitlements";
import type { PlanTier } from "@/lib/billing/plans";
import { getTodayData, setDigestCadence, sendMorningDigest } from "@/lib/agents/today";
import {
  advanceWorkspaceDeepDives,
  getCurrentContext,
  getDeepDive,
  listDeepDives,
  startDeepDive,
  type NewDeepDiveSource,
} from "@/lib/agents/deepdive";
import {
  draftGrantPlan,
  getOpportunitiesBundle,
  saveScanner,
  scanNow,
  setOpportunityStatus,
  type ScannerPatch,
} from "@/lib/agents/opportunities";
import { extractDocText, isSupportedDoc, MAX_DOC_BYTES, SUPPORTED_DOC_LABEL } from "@/lib/deepdive/extract";
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
  BoardSession,
  BoardroomView,
  BriefKind,
  CampaignData,
  ChannelKind,
  DraftRequest,
  ExecBrief,
  ExecMessage,
  ExecThreadHit,
  TodayData,
  ExecutiveBundle,
  GoalHorizon,
  GoalMetric,
  CompanyContext,
  DeepDive,
  DeepDiveSource,
  GoalStatus,
  InvestorUpdate,
  InvestorUpdateContent,
  MemoryKind,
  UpdateAudience,
  OnboardingInput,
  Opportunity,
  Note,
  NoteProposal,
  OpportunityScanner,
  OpportunityStatus,
  OpportunityType,
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
  SocialStats,
  XTarget,
  EmailListItem,
  EmailManagerState,
  EmailSettings,
  CommandCenterDoc,
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
    // Completing the last task of a phase must progress/close its project.
    // CRITICAL: server actions from one tab run sequentially, so this MUST NOT
    // block the response — materializing a phase can take a minute of AI
    // drafting, and awaiting it here froze the whole app. after() runs it once
    // the response is sent; the atomic claim in advanceProject makes concurrent
    // triggers (save, projects page, cron) safe.
    const ws = await workspaceIdForUser(user.id);
    if (ws) after(() => advanceWorkspaceProjects(ws).catch(() => ({ advanced: 0 })));
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
  // Operator Lite: a member only ever disconnects their OWN connection.
  const { scopeUserId } = await getViewer(user.id, ws);
  await clearIntegration(ws, integrationId, scopeUserId);
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
  const { scopeUserId } = await getViewer(user.id, ws);
  await setIntegrationPermissionMode(ws, integrationId, mode, scopeUserId);
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

/**
 * Connect HubSpot with a private-app access token (`pat-…`). The simplest path
 * for a single company connecting its OWN CRM — no developer app, no OAuth. The
 * token is validated against the live API, then stored encrypted exactly like
 * an OAuth access token (connected=true, no refresh), so everything downstream
 * — snapshot, KPIs, CRM Radar, timeline logging — works unchanged.
 */
export async function connectHubSpotTokenAction(
  token: string,
): Promise<{ ok: boolean; account?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const provider = providerByKey("hubspot");
  if (!provider) return { ok: false, error: "HubSpot provider not found." };

  const clean = token.trim();
  if (!clean) return { ok: false, error: "Paste your private app token first." };

  const check = await hsValidateToken(clean);
  if (!check.ok) return { ok: false, error: check.error ?? "That token didn’t work." };

  await storeProviderTokens(ws, provider, { access: clean }, check.account);
  // Surface value immediately: scan the CRM for follow-ups after we respond.
  after(() => runCrmRadar(ws).catch(() => null));
  return { ok: true, account: check.account ?? "HubSpot account" };
}

/** Approve + execute a task for real (server-side provider calls). */
/** Save a user's edits to a task's deliverable document (grant narrative, etc.). */
export async function updateTaskAssetAction(
  assetId: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const r = await updateTaskAssetContent(ws, assetId, content);
  return r.ok ? { ok: true } : { ok: false, error: "Couldn't save the edit." };
}

/**
 * Persist a task removal IMMEDIATELY (delete / reject / archive), so it survives
 * a refresh and can't be reverted by a background reload — the board's debounced
 * bundle-save was dropping these for agent-created (CRM Radar) cards. The store
 * still updates optimistically; these run alongside it for durability.
 */
export async function deleteTaskAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  try {
    await deleteTaskForUser(ws, id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function rejectTaskAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  try {
    await rejectTaskForUser(ws, id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function setTaskArchivedAction(id: string, archived: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  try {
    await setTaskArchivedForUser(ws, id, archived);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * The reliable OFF switch for a background agent — a single targeted UPDATE that
 * bypasses the whole-workspace bundle save (which fails once a runaway agent has
 * produced thousands of tasks). Lets the founder always stop an agent.
 */
export async function setAgentBackgroundAction(agentId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  try {
    await setAgentBackgroundForUser(ws, agentId, enabled);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Bulk-delete tasks by id (targeted + chunked). Clears a runaway backlog without
 *  the doomed whole-bundle save. Returns how many were actually removed. */
export async function bulkDeleteTasksAction(ids: string[]): Promise<{ ok: boolean; count: number }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, count: 0 };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, count: 0 };
  try {
    const count = await bulkDeleteTasksForUser(ws, ids);
    return { ok: true, count };
  } catch {
    return { ok: false, count: 0 };
  }
}

/** Bulk archive/unarchive tasks by id (targeted + chunked). Returns the count. */
export async function bulkArchiveTasksAction(
  ids: string[],
  archived = true,
): Promise<{ ok: boolean; count: number }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, count: 0 };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, count: 0 };
  try {
    const count = await bulkSetTasksArchivedForUser(ws, ids, archived);
    return { ok: true, count };
  } catch {
    return { ok: false, count: 0 };
  }
}

/* --------------------------------- notes -------------------------------- */

export async function listNotesAction(): Promise<Note[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    return await listNotesForUser(ws, scopeUserId);
  } catch {
    return [];
  }
}

export async function createNoteAction(): Promise<Note | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    return await createNoteForUser(ws, scopeUserId);
  } catch {
    return null;
  }
}

export async function updateNoteAction(
  id: string,
  patch: { title?: string; content?: string },
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    await updateNoteForUser(ws, id, patch, scopeUserId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function deleteNoteAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    await deleteNoteForUser(ws, id, scopeUserId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Hand a note to the Executive → a proposal (project OR tasks) to approve. */
export async function analyzeNoteAction(
  id: string,
): Promise<{ ok: boolean; proposal?: NoteProposal; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const note = await getNoteForUser(ws, id);
  if (!note) return { ok: false, error: "Note not found." };
  try {
    const proposal = await analyzeNote(ws, note);
    return { ok: true, proposal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't analyze the note." };
  }
}

/** Approve a proposal → create the project/tasks; mark the note actioned. */
export async function actionNoteAction(
  id: string,
  proposal: NoteProposal,
): Promise<{ ok: boolean; kind?: NoteProposal["kind"]; projectId?: string; taskCount?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const note = await getNoteForUser(ws, id);
  if (!note) return { ok: false, error: "Note not found." };
  try {
    return await actionNote(ws, note, proposal);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't action the note." };
  }
}

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
  // Operator Lite: members work on projects assigned to them; the owner spins up
  // new workspace projects.
  if ((await getViewer(user.id, ws)).isMember) return { ok: false, error: "Only the workspace owner can start new projects." };
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

/** Assemble a project's deliverables into an export packet (grant application
 *  bundle, etc.) — the user downloads and submits it themselves. */
export async function getProjectPacketAction(projectId: string): Promise<ProjectPacket | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getProjectPacket(ws, projectId);
  } catch {
    return null;
  }
}

/** Auto-advance every active project whose current phase is fully done. Called
 *  when the Projects page loads so completed phases progress without the cron. */
export async function advanceMyProjectsAction(): Promise<{ ok: boolean; advanced: number; healed?: number }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, advanced: 0 };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, advanced: 0 };
  try {
    // Revive any task wedged mid-execution (e.g. a server restart killed the
    // run) so it returns to the board, THEN advance completed phases.
    const healed = await healStuckProjectTasks(ws).catch(() => ({ healed: 0 }));
    const r = await advanceWorkspaceProjects(ws);
    return { ok: true, advanced: r.advanced, healed: healed.healed };
  } catch {
    return { ok: false, advanced: 0 };
  }
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
  // Operator Lite: a member sees only the projects assigned to them.
  if ((await getViewer(user.id, ws)).isMember) return listAssignedProjects(ws, user.id);
  return listProjects(ws);
}

export async function getProjectAction(projectId: string): Promise<Project | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  // Members can only open a project assigned to them.
  if ((await getViewer(user.id, ws)).isMember) {
    const mine = await listAssignedProjects(ws, user.id);
    return mine.find((p) => p.id === projectId) ?? null;
  }
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

/** Generate a monthly stakeholder update for an audience (on-demand). */
export async function generateInvestorUpdateAction(audience: UpdateAudience = "investor"): Promise<{
  ok: boolean;
  update?: InvestorUpdate;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return generateInvestorUpdate(ws, audience);
}

/** Save founder edits to an investor update (content + optional hero image). */
export async function updateInvestorUpdateAction(
  id: string,
  content: InvestorUpdateContent,
): Promise<{ ok: boolean; update?: InvestorUpdate; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return updateInvestorUpdate(ws, id, content);
}

/** Archive or unarchive an investor update. */
export async function archiveInvestorUpdateAction(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; update?: InvestorUpdate; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return setInvestorUpdateArchived(ws, id, archived);
}

/** Permanently delete an investor update. */
export async function deleteInvestorUpdateAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return deleteInvestorUpdate(ws, id);
}

/* ------------------------------ Deep Dive ------------------------------- */

/** Start a Deep Dive: extract text from uploaded docs + pasted notes, then queue it. */
export async function startDeepDiveAction(
  formData: FormData,
): Promise<{ ok: boolean; deepDive?: DeepDive; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };

  const title = String(formData.get("title") ?? "");
  const sources: NewDeepDiveSource[] = [];

  const pasted = String(formData.get("text") ?? "").trim();
  if (pasted) sources.push({ kind: "text", title: "Pasted notes", text: pasted });

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  for (const file of files) {
    if (file.size === 0) continue;
    if (!isSupportedDoc(file.type, file.name)) {
      return { ok: false, error: `"${file.name}" isn't a supported file — use ${SUPPORTED_DOC_LABEL}.` };
    }
    if (file.size > MAX_DOC_BYTES) {
      return { ok: false, error: `"${file.name}" is too large (max 20 MB).` };
    }
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const text = await extractDocText(file.name, file.type, bytes);
      if (text.trim()) sources.push({ kind: "upload", title: file.name, text });
    } catch {
      return { ok: false, error: `Couldn't read "${file.name}". It may be scanned, encrypted, or corrupt.` };
    }
  }

  return startDeepDive(ws, title, sources);
}

export async function listDeepDivesAction(): Promise<DeepDive[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  return listDeepDives(ws);
}

export async function getDeepDiveAction(
  id: string,
): Promise<{ deepDive: DeepDive; sources: DeepDiveSource[] } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  return getDeepDive(ws, id);
}

export async function getCompanyContextAction(): Promise<CompanyContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  return getCurrentContext(ws);
}

/** Nudge in-progress Deep Dives forward one step (the UI polls this while a run is active,
 *  so it makes progress even without the cron — e.g. in local dev). */
export async function pokeDeepDiveAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return;
  await advanceWorkspaceDeepDives(ws);
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
export async function getTodayDataAction(): Promise<TodayData | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    return await getTodayData(ws, displayName(user), scopeUserId);
  } catch {
    return null;
  }
}

export async function setDigestCadenceAction(cadence: "off" | "daily"): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  // The morning digest is the owner's (it's keyed to the business brief).
  if ((await getViewer(user.id, ws)).isMember) return { ok: false };
  return setDigestCadence(ws, cadence);
}

export async function sendMorningDigestNowAction(): Promise<{ ok: boolean; slack: boolean; email: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, slack: false, email: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, slack: false, email: false };
  if ((await getViewer(user.id, ws)).isMember) return { ok: false, slack: false, email: false };
  try {
    return await sendMorningDigest(ws);
  } catch {
    return { ok: false, slack: false, email: false };
  }
}

export async function startNewExecutiveChatAction(): Promise<{ ok: boolean; threadId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return startNewExecutiveChat(ws);
}

export async function newExecutiveThreadAction(): Promise<{ id: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await newExecutiveThread(ws);
  } catch {
    return null;
  }
}

export async function getThreadMessagesAction(threadId: string): Promise<ExecMessage[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await getThreadMessages(ws, threadId);
  } catch {
    return [];
  }
}

export async function searchThreadsAction(query: string): Promise<ExecThreadHit[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await searchThreads(ws, query);
  } catch {
    return [];
  }
}

export async function renameThreadAction(id: string, title: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return renameThread(ws, id, title);
}

export async function deleteThreadAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return deleteThread(ws, id);
}

/** Talk to the Executive Agent — a tool-using reply grounded in live business data. */
export async function sendExecutiveMessageAction(
  text: string,
  threadId?: string,
  image?: ExecImage,
): Promise<{ ok: boolean; reply?: ExecMessage; threadId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return sendExecutiveMessage(ws, text, threadId, image ? [image] : undefined);
}

/* ------------------------------- Billing -------------------------------- */

/** The workspace's subscription state + the tiers to render on /billing. */
export async function getBillingStateAction(): Promise<BillingState | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getBillingState(ws);
  } catch {
    return null;
  }
}

/** Start a subscription — returns a Stripe Checkout URL to redirect to. Owner-only. */
export async function startSubscriptionCheckoutAction(
  tier: PlanTier,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if (!(await isWorkspaceOwner(ws, user.id))) {
    return { ok: false, error: "Only the workspace owner can manage billing." };
  }
  return startCheckout(ws, tier, { email: user.email ?? "", name: displayName(user) });
}

/** What the current workspace can use — drives client-side gates + the trial banner. */
export async function getEntitlementAction(): Promise<EntitlementView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    const e = await getEntitlement(ws);
    const can: Record<string, boolean> = {};
    for (const f of ALL_FEATURES) can[f] = e.canUse(f);
    return { effectiveTier: e.effectiveTier, enforced: e.enforced, trialing: e.trialing, trialEndsAt: e.trialEndsAt, can };
  } catch {
    return null;
  }
}

/** Open the Stripe Billing Portal (manage / cancel). Owner-only. */
export async function openBillingPortalAction(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if (!(await isWorkspaceOwner(ws, user.id))) {
    return { ok: false, error: "Only the workspace owner can manage billing." };
  }
  return openPortal(ws);
}

/** KPI trend series (revenue / followers / shipped over recent weeks) for the
 *  Executive Office sparklines. */
export async function getKpiTrendsAction(): Promise<KpiTrendSeries[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await computeKpiTrends(ws);
  } catch {
    return [];
  }
}

/** Extract plain text from an uploaded document (PDF / .docx / text) so the founder
 *  can attach it in the Executive chat. Reuses the Deep Dive parse stack. */
export async function extractAttachmentTextAction(
  base64: string,
  filename: string,
  mime: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  try {
    if (!isSupportedDoc(mime, filename)) return { ok: false, error: "Unsupported file type." };
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length) return { ok: false, error: "That file came through empty." };
    if (bytes.length > MAX_DOC_BYTES) return { ok: false, error: "That file is too large (max 20 MB)." };
    const text = await extractDocText(filename, mime, bytes);
    if (!text.trim()) return { ok: false, error: "Couldn't find any readable text in that document." };
    return { ok: true, text: text.slice(0, 30_000) };
  } catch (e) {
    console.error("[extractAttachment] failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't read that document." };
  }
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

export async function saveExecutiveMessageAction(input: {
  messageId?: string | null;
  role: "user" | "assistant";
  content: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return saveExecutiveMessage(ws, input);
}

export async function deleteSavedMessageAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return deleteSavedMessage(ws, id);
}

export async function togglePinSavedAction(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return togglePinSaved(ws, id, pinned);
}

export async function organizeSavedMessagesAction(): Promise<{ ok: boolean; organized: number }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, organized: 0 };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, organized: 0 };
  try {
    return await organizeSavedMessages(ws);
  } catch {
    return { ok: false, organized: 0 };
  }
}

export async function promoteSavedToMemoryAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return promoteSavedToMemory(ws, id);
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

/** Composer: post ONE tweet to X right now (real publish; lands in the sent tally). */
export async function postTweetNowAction(
  text: string,
  mediaId?: string | null,
  thread?: string[] | null,
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const r = await postSingleTweetNow(ws, { text, mediaId: mediaId ?? null, thread: thread ?? null }, { name: displayName(user), email: user.email ?? "" });
    return r.ok ? { ok: true, summary: r.summary } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't post the tweet." };
  }
}

/** Composer: schedule ONE tweet — or a whole thread — at a specific future time. */
export async function scheduleTweetAction(
  text: string,
  whenISO: string,
  mediaId?: string | null,
  thread?: string[] | null,
): Promise<{ ok: boolean; when?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const r = await scheduleSingleTweet(ws, { text, mediaId: mediaId ?? null, whenISO, thread: thread ?? null }, { name: displayName(user) });
    return r.ok ? { ok: true, when: r.when } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't schedule the tweet." };
  }
}

/** Composer: turn pasted long text into a growth-optimized X thread (owner voice). */
export async function makeThreadAction(
  text: string,
): Promise<{ ok: boolean; tweets?: string[]; changes?: string[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const r = await makeThreadFromText(ws, text, { boost: true });
    return r.ok ? { ok: true, tweets: r.tweets, changes: r.changes } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't build the thread." };
  }
}

/** Social page right rail: follower count, growth trend, tweets/day, last 20 sent. */
export async function getSocialStatsAction(): Promise<SocialStats | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getSocialStats(ws);
  } catch {
    return null;
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
    // Operator Lite: a member's task lands on their own plane.
    const { scopeUserId } = await getViewer(user.id, ws);
    const taskId = await createPlannedTask(ws, planned, { name: displayName(user) }, scopeUserId);
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
  // Operator Lite: a member's agent run works on their plane (own tasks, own integrations).
  const { scopeUserId } = await getViewer(user.id, ws);
  return runAgentForWorkspace(ws, agentId, { name: displayName(user), email: user.email ?? "" }, {}, scopeUserId);
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
  const { scopeUserId } = await getViewer(user.id, ws);
  return runEmailTriage(ws, scopeUserId);
}

/** Run Notion triage now — read shared Notion pages and turn action items into tasks. */
export async function runNotionTriageAction(): Promise<NotionTriageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return runNotionTriage(ws, { name: displayName(user) });
}

/* ------------------------------ Email Manager ------------------------------ */

/** Load the Email Manager: a live inbox page (filtered to the chosen Gmail category
 *  tabs) + the triage overlay + settings. */
export async function getEmailManagerAction(
  pageToken?: string,
  categories?: string[],
): Promise<EmailManagerState | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { error: "No workspace." };
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    return await getEmailManagerState(ws, pageToken, categories, scopeUserId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load your inbox." };
  }
}

/** Triage the given inbox messages (all shown, or the ones the user checked). */
export async function triageEmailsAction(messageIds: string[]): Promise<TriageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return triageMessages(ws, messageIds, scopeUserId);
}

/** Fetch one email's full body for the reader pane. */
export async function getEmailBodyAction(messageId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return getEmailBody(ws, messageId, scopeUserId);
}

/** Save the user's edits to a drafted reply. */
export async function saveEmailDraftAction(messageId: string, draft: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return saveEmailDraft(ws, messageId, draft, scopeUserId);
}

/** Send the drafted reply in-thread, then mark it sent. */
export async function sendEmailReplyAction(messageId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return sendEmailReply(ws, messageId, scopeUserId);
}

/** Archive an email — removes it from the inbox. */
export async function archiveEmailAction(messageId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return archiveEmail(ws, messageId, scopeUserId);
}

/** Move an email to Trash — recoverable in Gmail for 30 days, not a permanent delete. */
export async function trashEmailAction(messageId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return trashEmail(ws, messageId, scopeUserId);
}

/** Push the recent triage summary into the Executive's memory. Owner-only. */
export async function sendInboxSummaryToExecutiveAction(): Promise<InboxSummaryResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  if ((await getViewer(user.id, ws)).isMember) return { ok: false, error: "Not available for team members." };
  return summarizeInboxToExecutive(ws);
}

/** Save the founder's email signature + reply style + auto-triage cadence. */
export async function saveEmailSettingsAction(settings: EmailSettings) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return saveEmailSettings(ws, settings, scopeUserId);
}

/* ----------------------- outbound email composer ------------------------ */

/** Draft one email per instruction (single or bulk) for review. */
export async function composeOutboundDraftsAction(intents: string[]) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return composeOutboundDrafts(ws, intents, scopeUserId);
}

/** The outbound review queue (everything not yet sent). */
export async function listOutboundDraftsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  const { scopeUserId } = await getViewer(user.id, ws);
  return listOutboundDrafts(ws, scopeUserId);
}

/** Edit a draft's recipient / cc / bcc / subject / body before sending. */
export async function updateOutboundDraftAction(
  id: string,
  patch: { to_email?: string; cc?: string; bcc?: string; subject?: string; body?: string },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return updateOutboundDraft(ws, id, patch, scopeUserId);
}

/** Schedule a draft to auto-send at a future time. */
export async function scheduleOutboundDraftAction(id: string, whenISO: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return scheduleOutboundDraft(ws, id, whenISO, scopeUserId);
}

/** Cancel a scheduled send. */
export async function unscheduleOutboundDraftAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return unscheduleOutboundDraft(ws, id, scopeUserId);
}

/** Send any scheduled drafts whose time has arrived (called on composer open +
 *  poll, so scheduling works without waiting for the cron). Returns sent/failed ids. */
export async function flushDueOutboundDraftsAction() {
  const user = await getCurrentUser();
  if (!user) return { sent: [] as string[], failed: [] as { id: string; error: string }[] };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { sent: [] as string[], failed: [] as { id: string; error: string }[] };
  const { scopeUserId } = await getViewer(user.id, ws);
  return flushDueOutboundDrafts(ws, scopeUserId);
}

/* -------------------------------- boardroom ------------------------------- */

/** The board roster + recent deliberations. */
export async function getBoardroomAction(): Promise<BoardroomView | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { error: "No workspace." };
  try {
    return await getBoardroom(ws);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load the boardroom." };
  }
}

/** Convene the board on a matter (creates the session; drive it with advanceBoardAction). */
export async function conveneBoardAction(question: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return conveneBoard(ws, question);
}

/** Run the session's next deliberation stage (openings → rebuttals → verdict). */
export async function advanceBoardAction(sessionId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return advanceBoard(ws, sessionId);
}

/** Load one deliberation (transcript + verdict). */
export async function getBoardSessionAction(
  sessionId: string,
): Promise<{ session: BoardSession } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { error: "No workspace." };
  try {
    return { session: await getBoardSession(ws, sessionId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load that deliberation." };
  }
}

/** Run the board's autonomous scan now (manual trigger). */
export async function scanBoardNowAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    const r = await runBoardScan(ws);
    return { ok: true as const, created: r.created };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "The scan failed." };
  }
}

/** Run a scan only if the cadence is due (page-load poke, so it works without cron). */
export async function scanBoardIfDueAction() {
  const user = await getCurrentUser();
  if (!user) return { ran: false, created: 0 };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ran: false, created: 0 };
  try {
    return await runBoardScanIfDue(ws);
  } catch {
    return { ran: false, created: 0 };
  }
}

/** Set how often the board scans on its own (off | daily | weekly). */
export async function setBoardCadenceAction(cadence: BoardCadence) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return setBoardCadence(ws, cadence);
}

/** Mark one alert read / dismissed / actioned. */
export async function setBoardAlertStatusAction(id: string, status: BoardAlertStatus) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return setAlertStatus(ws, id, status);
}

/** Mark every new alert read (clears the badge). */
export async function markAllBoardAlertsReadAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return markAllAlertsRead(ws);
}

/** Unread board-alert count for the sidebar badge. */
export async function getBoardAlertCountAction(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return 0;
  try {
    return await unreadBoardAlertCount(ws);
  } catch {
    return 0;
  }
}

/** Submit the founder's response to the debate before the board rules (empty = skip). */
export async function respondToBoardAction(sessionId: string, text: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return respondToBoard(ws, sessionId, text);
}

/** Post-verdict: discuss the verdict with the board (they may revise it). */
export async function discussWithBoardAction(sessionId: string, message: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return discussWithBoard(ws, sessionId, message);
}

/** Accept the board's verdict as final — locks it and enables the handoff. */
export async function acceptBoardVerdictAction(sessionId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return acceptBoardVerdict(ws, sessionId);
}

/** Delete a deliberation. */
export async function deleteBoardSessionAction(sessionId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return deleteBoardSession(ws, sessionId);
}

/** Hand a completed verdict to the Executive as a project + tracked directives. */
export async function handVerdictToExecutiveAction(sessionId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return handVerdictToExecutive(ws, sessionId);
}

/** Turn a board alert into a task on the Approval Center. */
export async function boardAlertToTaskAction(alertId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return alertToTask(ws, alertId);
}

/** Mark a tracked directive done / dropped / etc. */
export async function setBoardDirectiveStatusAction(id: string, status: BoardDirectiveStatus) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return setDirectiveStatus(ws, id, status);
}

/** Set the board's mission/goal (empty restores the default). */
export async function setBoardMissionAction(mission: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return setBoardMission(ws, mission);
}

/** Edit a board member's name / emoji / mandate. */
export async function updateBoardMemberAction(
  memberId: string,
  patch: { name?: string; emoji?: string; mandate?: string },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return updateBoardMember(ws, memberId, patch);
}

/** Restore a board member to its suggested archetype. */
export async function resetBoardMemberAction(memberId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return resetBoardMember(ws, memberId);
}

/** Send one outbound draft now. */
export async function sendOutboundDraftAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return sendOutboundDraft(ws, id, scopeUserId);
}

/** Send several outbound drafts at once. */
export async function bulkSendOutboundDraftsAction(ids: string[]) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return bulkSendOutboundDrafts(ws, ids, scopeUserId);
}

/** Refine one draft per a short instruction (warmer / shorter / custom). */
export async function refineOutboundDraftAction(id: string, instruction: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return refineOutboundDraft(ws, id, instruction, scopeUserId);
}

/** Re-draft one email from its original instruction. */
export async function regenerateOutboundDraftAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return regenerateOutboundDraft(ws, id, scopeUserId);
}

/** Discard an outbound draft. */
export async function discardOutboundDraftAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return discardOutboundDraft(ws, id, scopeUserId);
}

/** Check for new mail now — sweep unread Primary+Updates, triage + draft, notify Executive. */
export async function checkInboxNowAction(): Promise<TriageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return runEmailTriage(ws, scopeUserId);
}

/** Bulk-send the given drafted replies (all ready, or the checked subset). */
export async function bulkSendRepliesAction(messageIds: string[]) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return bulkSendReplies(ws, messageIds, scopeUserId);
}

/** The review queue — all triaged emails with a ready draft to approve + send. */
export async function getDraftQueueAction(): Promise<{ items: EmailListItem[] } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { error: "No workspace." };
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    return { items: await listDraftQueue(ws, scopeUserId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load your drafts." };
  }
}

/** The focused "needs attention" queue — unhandled, important emails. */
export async function getAttentionQueueAction(): Promise<{ items: EmailListItem[] } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { error: "No workspace." };
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    return { items: await listAttentionQueue(ws, scopeUserId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load these emails." };
  }
}

/** Bulk-archive the given messages (the agent's low-value suggestions, on your approval). */
export async function bulkArchiveAction(messageIds: string[]) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return bulkArchive(ws, messageIds, scopeUserId);
}

/** Learn the founder's signature + reply style from their recent Sent mail (to review + save). */
export async function learnEmailStyleAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return learnEmailStyleFromSent(ws, scopeUserId);
}

/* --------------------------- Operator (admin) ----------------------------- */

/** Cross-tenant AI usage ranking — admin-email gated (ADMIN_EMAILS). */
export async function getAiUsageReportAction(days?: number): Promise<AiUsageReport | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  if (!isAdminEmail(user.email)) return { error: "Not authorized." };
  try {
    return await getAiUsageReport(days);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load the usage report." };
  }
}

/* ----------------------------- Command Center ------------------------------ */

/** Load the user's Command Center goals doc (seeds an empty one if none yet). */
export async function getCommandCenterAction(): Promise<CommandCenterDoc | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { error: "No workspace." };
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    return await getCommandCenterDoc(ws, scopeUserId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load your Command Center." };
  }
}

/** Persist the whole Command Center doc (client-authoritative autosave). */
export async function saveCommandCenterAction(doc: CommandCenterDoc) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  return saveCommandCenterDoc(ws, doc, scopeUserId);
}

/** Push the current goals into the Executive's memory, on command. Owner-only. */
export async function sendGoalsToExecutiveAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if ((await getViewer(user.id, ws)).isMember) return { ok: false as const, error: "Not available for team members." };
  return sendGoalsToExecutive(ws);
}

/** Ask the Executive to propose goals from the business context (user accepts what they want). Owner-only. */
export async function suggestGoalsAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if ((await getViewer(user.id, ws)).isMember) return { ok: false as const, error: "Not available for team members." };
  return suggestGoals(ws);
}

/** Send the current goals into the Deep Dive pipeline as a source (updates company knowledge). Owner-only. */
export async function sendGoalsToDeepDiveAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if ((await getViewer(user.id, ws)).isMember) return { ok: false as const, error: "Not available for team members." };
  return sendGoalsToDeepDive(ws);
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
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
  } catch (e) {
    // The auth REQUEST itself threw (not a wrong-password response) — Supabase is
    // unreachable/misconfigured (paused project, bad env, network). Log the real
    // cause for the server logs and show the user a clear, non-generic message.
    console.error("[signInAction] auth request failed:", e instanceof Error ? e.message : e);
    return { error: "We couldn't reach the sign-in service. Please try again in a moment." };
  }
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
  let data: Awaited<ReturnType<typeof supabase.auth.signUp>>["data"];
  try {
    const res = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        // Confirmation link returns here to establish the session, then → onboarding.
        emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
      },
    });
    if (res.error) return { error: res.error.message };
    data = res.data;
  } catch (e) {
    console.error("[signUpAction] signUp request failed:", e instanceof Error ? e.message : e);
    return { error: "We couldn't reach the sign-up service. Please try again in a moment." };
  }

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
    } catch (e) {
      // Swallow for the USER (never leak whether an account exists), but LOG the
      // real cause so a genuine outage (Supabase unreachable) is visible in logs.
      console.error("[requestPasswordResetAction] failed:", e instanceof Error ? e.message : e);
    }
  }
  return { ok: true };
}

/** Set a new password for the recovery-session user, then send them into the app. */
export async function updatePasswordAction(password: string): Promise<{ error?: string }> {
  if (password.length < 6) return { error: "Password must be at least 6 characters." };
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: error.message };
  } catch (e) {
    console.error("[updatePasswordAction] failed:", e instanceof Error ? e.message : e);
    return { error: "We couldn't reach the account service. Please try again in a moment." };
  }
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
    // Seed the boardroom with the founder's chosen goal + member names.
    if (input.boardGoal !== undefined || input.boardMembers) {
      const ws = await workspaceIdForUser(user.id);
      if (ws) await seedBoardFromOnboarding(ws, input.boardGoal ?? "", input.boardMembers ?? []);
    }
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

/**
 * HARD-reset the account: permanently wipe the workspace and send the user back
 * through onboarding. The typed phrase is re-validated server-side (defense in
 * depth — the 3-gate UI is not the only check). The next load re-provisions a
 * fresh clean-slate workspace.
 */
export async function hardResetAccountAction(confirmation: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  if (confirmation.trim().toUpperCase() !== "RESET") {
    return { ok: false, error: "Type RESET to confirm." };
  }
  try {
    await hardResetWorkspace(user.id);
    // Route back through onboarding (a brand-new-account experience).
    await supabase.auth.updateUser({ data: { onboarded: false } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed." };
  }
}

/* ---------------------------- Opportunities ----------------------------- */

export interface OpportunitiesView {
  scanners: OpportunityScanner[];
  opportunities: Opportunity[];
  location: { city: string; state: string; country: string };
}

/** Everything the Opportunities page renders: scanners, findings, location. */
export async function getOpportunitiesAction(): Promise<OpportunitiesView> {
  const empty: OpportunitiesView = { scanners: [], opportunities: [], location: { city: "", state: "", country: "" } };
  const user = await getCurrentUser();
  if (!user) return empty;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return empty;
  const [bundle, location] = await Promise.all([getOpportunitiesBundle(ws), getBriefLocation(ws)]);
  return { ...bundle, location };
}

/** Save a scanner's configuration (enable, cadence, autonomy mode, scope, sources). */
export async function saveOpportunityScannerAction(
  type: OpportunityType,
  patch: ScannerPatch,
): Promise<{ ok: boolean; scanner?: OpportunityScanner; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    const scanner = await saveScanner(ws, type, patch);
    return { ok: true, scanner };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the scanner." };
  }
}

/** Run a scan right now (user-triggered) and return how many new items it found. */
export async function scanOpportunitiesNowAction(
  type: OpportunityType,
): Promise<{ ok: boolean; found: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, found: 0, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, found: 0, error: "No workspace." };
  return scanNow(ws, type);
}

/** Shortlist / dismiss / reset a found opportunity. */
export async function setOpportunityStatusAction(
  id: string,
  status: OpportunityStatus,
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false };
  return setOpportunityStatus(ws, id, status);
}

/** Draft a grant application plan (a "planning" project) from a found grant. */
export async function draftGrantPlanAction(
  opportunityId: string,
): Promise<{ ok: boolean; projectId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  return draftGrantPlan(ws, opportunityId);
}

/** Save the company location the scanners search around. */
export async function saveOpportunityLocationAction(loc: {
  city: string;
  state: string;
  country: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false, error: "No workspace." };
  try {
    await saveBriefLocation(ws, loc);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save location." };
  }
}

// ── Ads Manager ─────────────────────────────────────────────────────────────

/** Propose ad campaigns from the business strategy (to prefill the composer). */
export async function suggestAdCampaignsAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return suggestCampaigns(ws);
}

/** Generate a launch-ready, multi-platform ad campaign from an objective. */
export async function createAdCampaignAction(input: {
  objective: string;
  platforms: AdPlatform[];
  budgetCents?: number;
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return createAdCampaign(ws, input);
}

/** List past ad campaigns for the history rail. */
export async function listAdCampaignsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listAdCampaigns(ws);
  } catch {
    return [];
  }
}

/** Load one campaign with all its platform creatives. */
export async function getAdCampaignAction(
  id: string,
): Promise<{ campaign: AdCampaign } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { error: "No workspace." };
  try {
    return { campaign: await getAdCampaign(ws, id) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load that campaign." };
  }
}

/** Edit one creative's copy / targeting / image. */
export async function updateAdCreativeAction(
  id: string,
  patch: {
    headline?: string;
    primary_text?: string;
    description?: string;
    cta?: string;
    audience?: string;
    geo?: string;
    image_url?: string;
  },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await updateAdCreative(ws, id, patch);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save the edit." };
  }
}

/** Delete an ad campaign and its creatives. */
export async function deleteAdCampaignAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteAdCampaign(ws, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't delete the campaign." };
  }
}

/** Set the campaign's click destination (drives per-platform UTM links). */
export async function setAdDestinationAction(id: string, url: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await setCampaignDestination(ws, id, url);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save the URL." };
  }
}

/** Whether X Ads is connected (drives the publish vs. setup UI). */
export async function getXAdsStatusAction() {
  const user = await getCurrentUser();
  if (!user) return { configured: false, ready: false, missing: [] as string[] };
  return xAdsStatus();
}

/** Publish an X creative to X Ads — creates it PAUSED, or dry-runs if not connected. */
export async function publishAdToXAction(creativeId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await publishCreativeToX(ws, creativeId);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't publish." };
  }
}

/** Current placement (X campaign id + status) for one creative. */
export async function getAdPlacementAction(creativeId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getPlacement(ws, creativeId);
  } catch {
    return null;
  }
}

/** Flip a paused X placement live — starts spending. Explicit, human-triggered. */
export async function activateAdPlacementAction(placementId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return activatePlacement(ws, placementId);
}

/** Pause a live X placement — stops spending. */
export async function pauseAdPlacementAction(placementId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  return pausePlacement(ws, placementId);
}

/** Mark one platform's ad launched / back to draft, with an optional placement note. */
export async function setAdCreativeStatusAction(
  creativeId: string,
  status: "draft" | "launched",
  placementRef?: string,
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await setCreativeStatus(ws, creativeId, status, placementRef);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't update the ad." };
  }
}

// ── Team Room ───────────────────────────────────────────────────────────────

export async function listTeamMembersAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listTeamMembers(ws);
  } catch {
    return [];
  }
}

export async function createTeamMemberAction(input: TeamMemberInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  // Per-seat billing: a new teammate consumes a seat (advisors don't). Blocked only
  // when billing is enforced and the plan's seats are full.
  if (input.member_type !== "advisor") {
    const seat = await seatGuard(ws);
    if (!seat.ok) return seat;
  }
  try {
    return await createTeamMember(ws, input);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't add the member." };
  }
}

/** Per-seat gate: does the workspace have room for one more teammate? Owner-facing message. */
async function seatGuard(workspaceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const seat = await getSeatUsage(workspaceId);
  if (seat.canAdd) return { ok: true };
  return {
    ok: false,
    error: `You've used all ${seat.included} team seat${seat.included === 1 ? "" : "s"} on your plan. Upgrade in Billing to add more team members.`,
  };
}

/** Operator Lite / per-seat billing: team seat usage vs. the plan allowance. */
export async function getSeatUsageAction() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getSeatUsage(ws);
  } catch {
    return null;
  }
}

export async function updateTeamMemberAction(id: string, patch: Partial<TeamMemberInput>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await updateTeamMember(ws, id, patch);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save the member." };
  }
}

export async function deleteTeamMemberAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteTeamMember(ws, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't remove the member." };
  }
}

/** Operator Lite owner oversight: each linked member's open-task count + whether
 *  they've connected their own email. Owner-only (reads across member planes). */
export async function getMemberWorkloadsAction(): Promise<Record<string, { openTasks: number; hasEmail: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return {};
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return {};
  if ((await getWorkspaceRole(ws, user.id)) !== "owner") return {};
  try {
    return await getMemberWorkloads(ws);
  } catch {
    return {};
  }
}

/** Operator Lite: set which app pages a team member can open. Owner-only. */
export async function setMemberPageAccessAction(id: string, pages: string[]) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const role = await getWorkspaceRole(ws, user.id);
  if (role !== "owner") return { ok: false as const, error: "Only the workspace owner can set page access." };
  try {
    return await setMemberPageAccess(ws, id, pages);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't update page access." };
  }
}

/** Set a member's in-team role and/or manager. Owner-only — this is the hierarchy wall. */
export async function setTeamMemberOrgAction(
  id: string,
  patch: { team_role?: "manager" | "contributor"; manager_id?: string | null },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const role = await getWorkspaceRole(ws, user.id);
  if (role !== "owner") return { ok: false as const, error: "Only the workspace owner can change roles." };
  try {
    return await setMemberOrg(ws, id, patch);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't update the role." };
  }
}

// ── Human projects + delegation (Phase 2) ────────────────────────────────────

export async function listHumanProjectsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listHumanProjects(ws);
  } catch {
    return [];
  }
}

export async function createHumanProjectAction(input: HumanProjectInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const role = await getWorkspaceRole(ws, user.id);
  if (role !== "owner" && role !== "manager") {
    return { ok: false as const, error: "Only owners and managers can create projects." };
  }
  try {
    return await createHumanProject(ws, input);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't create the project." };
  }
}

export async function updateHumanProjectAction(id: string, patch: Partial<HumanProjectInput>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const role = await getWorkspaceRole(ws, user.id);
  if (role !== "owner" && role !== "manager") {
    return { ok: false as const, error: "Only owners and managers can edit projects." };
  }
  try {
    return await updateHumanProject(ws, id, patch);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save the project." };
  }
}

export async function deleteHumanProjectAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const role = await getWorkspaceRole(ws, user.id);
  if (role !== "owner" && role !== "manager") {
    return { ok: false as const, error: "Only owners and managers can delete projects." };
  }
  try {
    return await deleteHumanProject(ws, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't delete the project." };
  }
}

/** Assign a full AI project to a team member (or clear it with member_id null). Owner-only. */
export async function assignProjectToMemberAction(
  projectId: string,
  opts: { member_id: string | null; manager_id?: string | null },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const role = await getWorkspaceRole(ws, user.id);
  if (role !== "owner") return { ok: false as const, error: "Only the owner can assign projects." };
  try {
    return await assignProjectToMember(ws, projectId, opts);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't assign the project." };
  }
}

/** Owner tracking board: every assigned AI project with live progress. Owner-only. */
export async function getAssignedProjectsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  const role = await getWorkspaceRole(ws, user.id);
  if (role !== "owner") return [];
  try {
    return await listAssignedProjectsForOwner(ws);
  } catch {
    return [];
  }
}

// ── Member: run an assigned project (every write scoped to the assignment) ───

export async function getMyAssignedProjectsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listAssignedProjects(ws, user.id);
  } catch {
    return [];
  }
}

export async function getMyProjectDetailAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getMemberProjectDetail(ws, user.id, projectId);
  } catch {
    return null;
  }
}

/** Have the agent draft a task's deliverable — only inside a project assigned to you. */
export async function memberRunTaskAction(taskId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if (!(await memberOwnsTask(ws, user.id, taskId))) {
    return { ok: false as const, error: "That task isn't in a project assigned to you." };
  }
  try {
    return await runTaskWithAgent(ws, taskId);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't run the task." };
  }
}

/** Approve + execute a task — only inside a project assigned to you. */
export async function memberApproveTaskAction(taskId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if (!(await memberOwnsTask(ws, user.id, taskId))) {
    return { ok: false as const, error: "That task isn't in a project assigned to you." };
  }
  try {
    return await runTaskExecution(ws, taskId, { name: displayName(user), email: user.email ?? "" });
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't approve the task." };
  }
}

/** Reject a task — only inside a project assigned to you. */
export async function memberRejectTaskAction(taskId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if (!(await memberOwnsTask(ws, user.id, taskId))) {
    return { ok: false as const, error: "That task isn't in a project assigned to you." };
  }
  try {
    await rejectTaskForUser(ws, taskId);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't reject the task." };
  }
}

/** Edit a deliverable — only inside a project assigned to you. */
export async function memberUpdateTaskAssetAction(assetId: string, content: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if (!(await memberOwnsAsset(ws, user.id, assetId))) {
    return { ok: false as const, error: "That deliverable isn't in a project assigned to you." };
  }
  try {
    return await updateTaskAssetContent(ws, assetId, content);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

/** Advance an assigned project when its current phase is done — only if it's yours. */
export async function memberAdvanceProjectAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if (!(await isProjectAssignedToMember(ws, projectId, user.id))) {
    return { ok: false as const, error: "That project isn't assigned to you." };
  }
  try {
    await advanceProject(ws, projectId);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't advance the project." };
  }
}

/** A manager/owner delegates a task to someone they manage. Permission enforced inside. */
export async function createDelegatedTaskAction(input: AssignmentInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await createDelegatedTask(ws, user.id, input);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't create the task." };
  }
}

// ── Team goals (Phase 3) ─────────────────────────────────────────────────────

export async function listTeamGoalsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listTeamGoals(ws);
  } catch {
    return [];
  }
}

export async function getMyGoalsAction() {
  const user = await getCurrentUser();
  if (!user) return { team: [], mine: [], reports: [] };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { team: [], mine: [], reports: [] };
  try {
    return await getMyGoals(ws, user.id);
  } catch {
    return { team: [], mine: [], reports: [] };
  }
}

export async function createTeamGoalAction(input: TeamGoalInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await createTeamGoal(ws, user.id, input);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't create the goal." };
  }
}

export async function updateTeamGoalAction(
  id: string,
  patch: {
    title?: string;
    detail?: string;
    horizon?: "week" | "month" | "quarter";
    status?: "active" | "done";
    scope?: "team" | "individual";
    member_ids?: string[];
  },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await updateTeamGoal(ws, user.id, id, patch);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save the goal." };
  }
}

export async function deleteTeamGoalAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteTeamGoal(ws, user.id, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't delete the goal." };
  }
}

export async function setMyGoalStatusAction(id: string, status: "active" | "done") {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await setMyGoalStatus(ws, user.id, id, status);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't update the goal." };
  }
}

// ── Team documents (Phase 4) ─────────────────────────────────────────────────

export async function listTeamDocumentsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listTeamDocuments(ws);
  } catch {
    return [];
  }
}

export async function createTeamDocumentAction(input: TeamDocumentInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await createTeamDocument(ws, user.id, input, displayName(user));
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't add the document." };
  }
}

export async function deleteTeamDocumentAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteTeamDocument(ws, user.id, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't remove the document." };
  }
}

// ── Team chat (Phase 5) ──────────────────────────────────────────────────────

export async function listChatChannelsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listChatChannels(ws, user.id);
  } catch {
    return [];
  }
}

export async function markChannelReadAction(channelId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const };
  try {
    await markChannelRead(ws, user.id, channelId);
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function deleteChatChannelAction(channelId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteChatChannel(ws, user.id, channelId);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't delete the channel." };
  }
}

export async function deleteChatMessageAction(messageId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteChatMessage(ws, user.id, messageId);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't delete the message." };
  }
}

// ── Team calendar + meetings (Phase: refinements) ────────────────────────────

export async function getTeamCalendarAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await getTeamCalendar(ws);
  } catch {
    return [];
  }
}

export async function getTeamCalendarRangeAction(fromISO: string, toISO: string) {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await getTeamCalendarRange(ws, fromISO, toISO);
  } catch {
    return [];
  }
}

/** OWNER-ONLY: the workspace's Google Calendar overlay. Gated to the owner so the
 *  connected (owner's) personal calendar never reaches team members. */
export async function getGoogleCalendarAction(fromISO: string, toISO: string) {
  const user = await getCurrentUser();
  if (!user) return { connected: false, items: [] };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { connected: false, items: [] };
  const role = await getUserRoleInWorkspace(user.id, ws);
  if (role !== "owner") return { connected: false, items: [] };
  try {
    return await getGoogleCalendar(ws, fromISO, toISO);
  } catch {
    return { connected: false, items: [] };
  }
}

export async function listTeamEventsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listTeamEvents(ws);
  } catch {
    return [];
  }
}

export async function createTeamEventAction(input: TeamEventInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await createTeamEvent(ws, user.id, input, displayName(user));
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't add the entry." };
  }
}

export async function updateTeamEventAction(id: string, patch: TeamEventPatch) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await updateTeamEvent(ws, user.id, id, patch, displayName(user));
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't update the entry." };
  }
}

export async function getMyNotificationsAction() {
  const user = await getCurrentUser();
  if (!user) return { items: [], unread: 0 };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { items: [], unread: 0 };
  try {
    return await listMyNotifications(ws, user.id);
  } catch {
    return { items: [], unread: 0 };
  }
}

export async function markNotificationsReadAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const };
  try {
    return await markMyNotificationsRead(ws, user.id);
  } catch {
    return { ok: false as const };
  }
}

export async function getNotifyChannelsAction() {
  const user = await getCurrentUser();
  if (!user) return { slack: false, email: false, zoom: false };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { slack: false, email: false, zoom: false };
  try {
    return await getNotifyChannels(ws);
  } catch {
    return { slack: false, email: false, zoom: false };
  }
}

export async function getTeamEventAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getTeamEvent(ws, id);
  } catch {
    return null;
  }
}

export async function deleteTeamEventAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteTeamEvent(ws, user.id, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't remove the entry." };
  }
}

export async function listTeamMeetingsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listTeamMeetings(ws);
  } catch {
    return [];
  }
}

/** The action items (assigned tasks) created from one meeting — for the email brief. */
export async function listMeetingAssignmentsAction(meetingId: string) {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listMeetingAssignments(ws, meetingId);
  } catch {
    return [];
  }
}

/** Every task created from a meeting — teammate assignments + owner/advisor
 *  board tasks — with assignee + live status, for the Meetings view. */
export async function listMeetingTasksAction(meetingId: string): Promise<MeetingTask[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listMeetingTasks(ws, meetingId);
  } catch {
    return [];
  }
}

/**
 * Stage a ready-made email in the Email Manager's outbound queue (no AI compose) —
 * used by "Email the team" on meeting briefs. Owner-plane; the user reviews +
 * sends it in /email. Returns the new draft id.
 */
export async function stageOutboundDraftAction(input: {
  to?: string;
  cc?: string;
  subject: string;
  body: string;
  recipientName?: string;
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  if (!input.subject.trim() && !input.body.trim()) return { ok: false as const, error: "Nothing to draft." };
  try {
    const { scopeUserId } = await getViewer(user.id, ws);
    const r = await stageOutboundDraft(ws, input, scopeUserId);
    return { ok: true as const, draftId: r.draft.id };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't stage the draft." };
  }
}

export async function createTeamMeetingAction(input: TeamMeetingInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await createTeamMeeting(ws, user.id, input);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't add the meeting." };
  }
}

export async function updateTeamMeetingAction(
  id: string,
  patch: { title?: string; notes?: string; meeting_date?: string; attendee_ids?: string[] },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await updateTeamMeeting(ws, user.id, id, patch);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't save the meeting." };
  }
}

export async function deleteTeamMeetingAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteTeamMeeting(ws, user.id, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't delete the meeting." };
  }
}

// ── Import a meeting from Notion (Team Meetings) ──────────────────────────────

export async function listNotionMeetingPagesAction(): Promise<{
  connected: boolean;
  pages: NotionMeetingPage[];
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { connected: false, pages: [] };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { connected: false, pages: [] };
  try {
    return await listNotionMeetingPages(ws, user.id);
  } catch {
    return { connected: false, pages: [], error: "Couldn't list Notion pages." };
  }
}

export async function previewNotionMeetingAction(pageId: string, pageTitle?: string): Promise<MeetingPreview> {
  const empty: MeetingPreview = { ok: false, title: "", date: null, summary: "", notes: "", attendee_ids: [], actions: [] };
  const user = await getCurrentUser();
  if (!user) return { ...empty, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ...empty, error: "No workspace." };
  try {
    return await previewNotionMeeting(ws, user.id, pageId, pageTitle);
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "Couldn't read that meeting." };
  }
}

export async function importNotionMeetingAction(input: MeetingImportInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await importNotionMeeting(ws, user.id, input);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't import the meeting." };
  }
}

// ── Shared Google Drive folder (Team Docs) ───────────────────────────────────

export async function browseTeamDriveAction(folderId?: string): Promise<DriveBrowse> {
  const user = await getCurrentUser();
  if (!user) return { connected: false, teamFolder: null, folder: null, entries: [] };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { connected: false, teamFolder: null, folder: null, entries: [] };
  try {
    return await browseTeamDrive(ws, user.id, folderId);
  } catch {
    return { connected: false, teamFolder: null, folder: null, entries: [] };
  }
}

export async function getTeamDriveFolderAction() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getTeamDriveFolder(ws);
  } catch {
    return null;
  }
}

export async function setTeamDriveFolderAction(folderUrlOrId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await setTeamDriveFolder(ws, user.id, folderUrlOrId);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't set the folder." };
  }
}

export async function clearTeamDriveFolderAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await clearTeamDriveFolder(ws, user.id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't clear the folder." };
  }
}

export async function createChatChannelAction(name: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await createChatChannel(ws, user.id, name);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't create the channel." };
  }
}

export async function listChatMessagesAction(channelId: string) {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listChatMessages(ws, user.id, channelId);
  } catch {
    return [];
  }
}

export async function sendChatMessageAction(channelId: string, body: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await sendChatMessage(ws, user.id, channelId, body, displayName(user));
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't send." };
  }
}

// ── Team Assistant (Phase 6, Haiku) ──────────────────────────────────────────

export async function getTeamAssistantHistoryAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await getTeamAssistantHistory(ws, user.id);
  } catch {
    return [];
  }
}

export async function sendTeamAssistantMessageAction(text: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await sendTeamAssistantMessage(ws, user.id, text);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "The assistant couldn't respond." };
  }
}

export async function listAssignmentsAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listAssignments(ws);
  } catch {
    return [];
  }
}

export async function createAssignmentAction(input: AssignmentInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await createAssignment(ws, input);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't create the handoff." };
  }
}

export async function updateAssignmentAction(
  id: string,
  patch: { status?: AssignmentStatus; title?: string; handoff_note?: string; deadline?: string | null },
) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await updateAssignment(ws, id, patch);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't update the handoff." };
  }
}

export async function deleteAssignmentAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await deleteAssignment(ws, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't delete the handoff." };
  }
}

// ── Team invites (Slice 2a) ─────────────────────────────────────────────────

export async function inviteTeamMemberAction(input: {
  memberId?: string;
  email: string;
  profile?: TeamMemberInput;
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  // Per-seat billing: a brand-new invite consumes a seat. Re-inviting an existing
  // roster member (memberId set) doesn't, so only gate genuinely new teammates.
  if (!input.memberId) {
    const seat = await seatGuard(ws);
    if (!seat.ok) return seat;
  }
  try {
    // Build the accept link from the ACTUAL request host, so it's always the live
    // domain even if NEXT_PUBLIC_APP_URL isn't set/redeployed yet.
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    const baseUrl = host ? `${proto}://${host}` : undefined;
    return await inviteTeamMember(ws, user.id, { ...input, baseUrl, inviterName: displayName(user) });
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't send the invite." };
  }
}

export async function listInvitesAction() {
  const user = await getCurrentUser();
  if (!user) return [];
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return [];
  try {
    return await listInvites(ws);
  } catch {
    return [];
  }
}

export async function revokeInviteAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await revokeInvite(ws, id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't revoke the invite." };
  }
}

/** Accept an invite as the logged-in user (their email must match the invite). */
export async function acceptInviteAction(token: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Please sign in to accept this invite." };
  try {
    return token
      ? await acceptInvite(user.id, user.email ?? "", token)
      : await acceptPendingInvite(user.id, user.email ?? "");
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't accept the invite." };
  }
}

/** Public — what workspace + email an invite token is for (drives the accept page). */
export async function getInviteAction(token: string) {
  try {
    return await getInviteByToken(token);
  } catch {
    return { valid: false as const, email: "", workspaceName: "", error: "Couldn't load this invite." };
  }
}

/** Public — create the invitee's account (email + password) and join them. The token
 *  is the credential; no session is required. */
export async function acceptInviteWithPasswordAction(token: string, password: string) {
  try {
    return await acceptInviteWithPassword(token, password);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't complete signup." };
  }
}

// ── Member portal ───────────────────────────────────────────────────────────

export async function getPortalDataAction() {
  const user = await getCurrentUser();
  if (!user) return { member: null, assignments: [], reports: [], projects: [] };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { member: null, assignments: [], reports: [], projects: [] };
  try {
    return await getPortalData(ws, user.id);
  } catch {
    return { member: null, assignments: [], reports: [], projects: [] };
  }
}

export async function updateMyAssignmentStatusAction(id: string, status: AssignmentStatus) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await updateMyAssignmentStatus(ws, user.id, id, status);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't update." };
  }
}

// ── Approval Center triage ("Plan my day") ──────────────────────────────────

export async function planApprovalCenterAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await planApprovalCenter(ws);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't build the plan." };
  }
}

export async function getTaskPlanAction() {
  const user = await getCurrentUser();
  if (!user) return null;
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return null;
  try {
    return await getLatestPlan(ws);
  } catch {
    return null;
  }
}

export async function clearTaskPlanAction() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const };
  try {
    await clearPlan(ws);
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function setTaskPriorityAction(taskId: string, priority: Priority) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  try {
    return await setTaskPriority(ws, taskId, priority);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't set priority." };
  }
}

/** Email intent: obvious "email/reply/message someone" phrasings. Borderline
 *  cases fall through to the Executive, which can still draft via its tools. */
const EMAIL_INTENT = /\b(e-?mails?|reply to|respond to|follow[- ]?up with|send (?:an? )?(?:note|message|update|reminder|invite|email)? ?to)\b/i;

/**
 * Route a Command Center daily-goal item by intent: email tasks are drafted into
 * the Email Manager (recipient resolved via HubSpot/Gmail); everything else goes
 * to the Executive, which now has the tools to act on it.
 */
export async function routeDailyGoalAction(text: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  // Owner-only: this routes into the Executive (an owner surface).
  if ((await getViewer(user.id, ws)).isMember) return { ok: false as const, error: "Not available for team members." };
  const clean = text.trim();
  if (!clean) return { ok: false as const, error: "Nothing to send." };
  try {
    if (EMAIL_INTENT.test(clean)) {
      const r = await composeOutboundDrafts(ws, [clean.slice(0, 500)]);
      if (!r.ok) return { ok: false as const, error: r.error };
      return { ok: true as const, label: "Drafted in Email Manager", href: "/email" };
    }
    // The Executive now has lookup_person / search_inbox / draft_email + is told
    // to act; the reply + any draft show in /executive and /email.
    await sendExecutiveMessage(
      ws,
      `From my Command Center daily plan — take this on: "${clean.slice(0, 500)}". Resolve anyone named, draft any emails into the Email Manager, and take the next concrete step.`,
    );
    return { ok: true as const, label: "Sent to Executive", href: "/executive" };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't route the goal." };
  }
}

// ── Email attachments ───────────────────────────────────────────────────────

export async function uploadOutboundAttachmentAction(draftId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not authenticated." };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const, error: "No workspace." };
  const { scopeUserId } = await getViewer(user.id, ws);
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "No file provided." };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false as const, error: "File is too large (max 15 MB)." };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";
    const { path } = await uploadAttachmentBytes(ws, randomUUID(), bytes, mime, file.name);
    return await addOutboundAttachment(ws, draftId, { name: file.name, path, mime, size: file.size }, scopeUserId);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export async function removeOutboundAttachmentAction(draftId: string, attachmentId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const };
  const ws = await workspaceIdForUser(user.id);
  if (!ws) return { ok: false as const };
  const { scopeUserId } = await getViewer(user.id, ws);
  try {
    return await removeOutboundAttachment(ws, draftId, attachmentId, scopeUserId);
  } catch {
    return { ok: false as const };
  }
}
