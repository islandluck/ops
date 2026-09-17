/**
 * Operator — Approval Center domain model.
 *
 * Entities map 1:1 to the PRD: Workspace, BusinessBrief, Agent, Task, TaskAsset,
 * ApprovalDecision, ExecutionRun, ActivityEvent. Types are intentionally explicit
 * so the prototype is structurally real and swappable to a Postgres-backed API.
 */

export type Category =
  | "growth"
  | "admin"
  | "content"
  | "research"
  | "finance";

/** Board columns / lifecycle statuses (PRD default six). */
export type TaskStatus =
  | "new"
  | "agent_working"
  | "ready"
  | "changes_requested"
  | "approved"
  | "done";

export type RiskLevel = "low" | "medium" | "high";

export type Priority = "low" | "medium" | "high" | "urgent";

export type CreatedByType = "agent" | "human";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected";

/** Execution lifecycle: Detected → Prepared → Ready → Approved → Executing → Completed/Failed. */
export type ExecutionStatus =
  | "none"
  | "queued"
  | "executing"
  | "completed"
  | "failed";

/** Permission tiers per agent / integration. */
export type PermissionMode = "suggest" | "approval" | "auto";

/** Result of Operator "thinking through" a user-created task before it lands. */
export interface PlannedTask {
  title: string;
  category: Category;
  /** Integration names the task needs (exact workspace integration names). */
  affected_systems: string[];
  risk_level: RiskLevel;
  /** How urgent this is. Omitted → "medium" (Executive triage refines it later). */
  priority?: Priority;
  requires_approval: boolean;
  rationale: string;
  /** Ready-to-use content the owner reviews (email, doc, page, etc.). */
  draft: string;
  /** Subset of affected_systems that isn't connected yet. */
  needs_connection: string[];
  /** For email tasks: the real recipient address, ONLY if explicitly given —
   *  null when unknown (never invented). Drives a real send vs. drafted-only. */
  recipient?: string | null;
}

/** Payload persisted when a user completes guided onboarding (server mode). */
export interface OnboardingBoardMember {
  role: BoardRole;
  name: string;
  emoji: string;
}

export interface OnboardingInput {
  user_name: string;
  company_name: string;
  website_url: string;
  business_description: string;
  ideal_customer_profile: string;
  goals: string[];
  voice_rules: string[];
  approvalDefault: PermissionMode;
  /** The board's goal set during onboarding ("" = default). */
  boardGoal?: string;
  /** The 5 board seats with the founder's chosen names/avatars. */
  boardMembers?: OnboardingBoardMember[];
}

/* -------------------------------- ads ------------------------------------ */

export type AdPlatform = "meta" | "google" | "x" | "linkedin";

/** One platform-specific ad the studio generated (copy + targeting + creative). */
export interface AdCreative {
  id: string;
  platform: AdPlatform;
  format: string;
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  keywords: string[];
  audience: string;
  geo: string;
  image_url: string;
  image_alt: string;
  /** draft | launched — tracked per platform. */
  status: string;
  /** Founder's own note for where it went live (e.g. the platform's campaign id). */
  placement_ref: string;
}

/** A ready-to-run ad campaign the Growth agent built across platforms. */
export interface AdCampaign {
  id: string;
  name: string;
  objective: string;
  audience: string;
  daily_budget_cents: number;
  status: string;
  /** Where clicks should land; UTM tags are derived from it per platform. */
  destination_url: string;
  creatives: AdCreative[];
  created_at: string;
}

export interface AdCampaignSummary {
  id: string;
  name: string;
  status: string;
  platforms: AdPlatform[];
  /** How many of this campaign's creatives are marked launched. */
  launched: number;
  created_at: string;
}

/** A proposed ad campaign the Growth agent derived from the business strategy. */
export interface AdCampaignIdea {
  title: string;
  rationale: string;
  /** Ready to drop straight into the campaign composer. */
  objective: string;
  platforms: AdPlatform[];
}

/** A record of placing (or planning to place) a creative on an external ad platform. */
export interface AdPlacement {
  id: string;
  creative_id: string;
  platform: string;
  /** planned (dry-run) | paused (created, $0 spend) | active (live) | failed. */
  status: string;
  external_campaign_id: string;
  detail: string;
  spend_cents: number;
  created_at: string;
}

/** Whether the X Ads integration is set up (drives the publish vs. setup UI). */
export interface XAdsStatus {
  /** App keys present — we can describe setup. */
  configured: boolean;
  /** All credentials present — we can actually publish. */
  ready: boolean;
  /** Human-readable list of missing env values. */
  missing: string[];
}

/** One step in the dry-run preview of what a publish would send to the platform. */
export interface AdPublishStep {
  label: string;
  method: string;
  path: string;
}

/** Client-safe preview of the campaign a publish would create on the platform. */
export interface AdPublishPreview {
  objective: string;
  daily_budget_cents: number;
  tweet_text: string;
  steps: AdPublishStep[];
}

/* -------------------------------- team ----------------------------------- */

export type TeamMemberStatus = "active" | "inactive" | "invited";

/** A person on the owner's team — a profile the Executive/Boardroom can reason about. */
/** In-team rank (inside the "member" access tier). Owner is a separate tier. */
export type TeamRole = "manager" | "contributor";
/** Roster kind: an operational teammate vs. a strategic advisor. */
export type MemberType = "teammate" | "advisor";
/** The viewer's effective role across the whole workspace. */
export type WorkspaceRole = "owner" | "manager" | "contributor";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role_title: string;
  description: string;
  skills: string[];
  birthday: string;
  start_date: string;
  timezone: string;
  emoji: string;
  accent: string;
  status: TeamMemberStatus;
  /** Roster kind: operational teammate vs. strategic advisor. */
  member_type: MemberType;
  /** In-team rank. Managers can be assigned reports + delegate to them. */
  team_role: TeamRole;
  /** Who they report to (another team member's id); null = reports to the owner. */
  manager_id: string | null;
  /** Denormalized manager name for display (null = reports to owner). */
  manager_name: string | null;
  /** True for the workspace owner's own roster entry — can't be removed. */
  is_owner: boolean;
  /** True once this member has accepted their invite and has an app login (Operator Lite). */
  linked: boolean;
  /**
   * Operator Lite: page keys (e.g. "/email") the owner granted this member. Empty
   * = the member defaults (see lib/access/pages.ts). Only meaningful once linked.
   */
  page_access: string[];
  created_at: string;
}

export type AssignmentStatus = "assigned" | "in_progress" | "blocked" | "done";
export type AssignmentRefType = "project" | "task" | "note" | "meeting";

/** A handoff/task assigned to a team member (optionally inside a human project). */
export interface TeamAssignment {
  id: string;
  member_id: string;
  /** Denormalized member name for display. */
  member_name: string;
  ref_type: AssignmentRefType | null;
  ref_id: string | null;
  title: string;
  handoff_note: string;
  status: AssignmentStatus;
  deadline: string | null;
  /** Phase 2: the human project this task belongs to (null = standalone). */
  project_id: string | null;
  project_title: string | null;
  /** Who delegated it (a manager's member id; null = owner-created). */
  created_by_member_id: string | null;
  created_at: string;
}

export type HumanProjectStatus = "active" | "on_hold" | "done";
export type HumanProjectSource = "manual" | "ai_handoff";

/** A human-owned project in the team plane (manual, or handed off from an AI project). */
export interface HumanProject {
  id: string;
  title: string;
  summary: string;
  status: HumanProjectStatus;
  deadline: string | null;
  /** The human who owns/drives it (null = owner-led). */
  lead_member_id: string | null;
  lead_name: string | null;
  /** The manager overseeing it. */
  manager_member_id: string | null;
  manager_name: string | null;
  source: HumanProjectSource;
  /** The AI project it was projected from (sanitized), if any. */
  source_project_id: string | null;
  open_tasks: number;
  total_tasks: number;
  created_at: string;
}

export type TeamGoalHorizon = "week" | "month" | "quarter";
export type TeamGoalScope = "team" | "individual";
export type TeamGoalStatus = "active" | "done";

/** A team goal — team-wide or for one member, over a week/month/quarter horizon. */
export interface TeamGoal {
  id: string;
  title: string;
  detail: string;
  horizon: TeamGoalHorizon;
  scope: TeamGoalScope;
  /** For scope "individual": the members it's for (one or more). */
  member_ids: string[];
  member_names: string[];
  status: TeamGoalStatus;
  created_at: string;
}

export type TeamDocumentKind = "link" | "note";

/** A shared team document — a link or an inline note the whole team can see. */
export interface TeamDocument {
  id: string;
  title: string;
  kind: TeamDocumentKind;
  url: string;
  content: string;
  created_by_name: string;
  created_at: string;
}

/** An in-platform chat channel (owner + all team members). */
export interface ChatChannel {
  id: string;
  name: string;
  /** Unread messages for the current viewer since they last read this channel. */
  unread: number;
  created_at: string;
}

/** A chat message. `mine` is true when the current viewer sent it. */
export interface ChatMessage {
  id: string;
  sender_name: string;
  body: string;
  mine: boolean;
  created_at: string;
}

/** A message in a member's Team Assistant (Haiku) conversation. */
export interface TeamAssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type TeamEventKind = "meeting" | "one_on_one" | "event";

/** A calendar entry the owner sets — a meeting, a 1:1, or a one-off event. */
export interface TeamEvent {
  id: string;
  title: string;
  detail: string;
  kind: TeamEventKind;
  starts_at: string;
  /** Length in minutes (drives the block height in the week grid). */
  duration_minutes: number;
  /** Recurrence rule keyword: "" | none | daily | weekly | biweekly | monthly. */
  recurrence: string;
  /** When a recurring event stops repeating (null = one-off / no end). */
  recurrence_until: string | null;
  member_id: string | null;
  member_name: string | null;
  /** Attendee member ids (a 1:1 falls back to [member_id]). */
  attendee_ids: string[];
  attendee_names: string[];
  /** Whole-team event (all-hands) — attendees resolve to everyone. */
  all_team: boolean;
  /** Linked to a Google Calendar event (two-way sync is on for this entry). */
  google_synced: boolean;
  /** Video/meeting join link (Zoom or a pasted link); "" when none. */
  meeting_link: string;
  created_at: string;
}

/** A row on the team calendar — an event occurrence OR a derived deadline. */
export interface CalendarItem {
  /** Unique per rendered occurrence (recurring events expand to several). */
  id: string;
  /** The underlying team_events row id (or hp-/ta- id) — the target of edit/delete. */
  source_id: string;
  kind: "meeting" | "one_on_one" | "event" | "deadline";
  title: string;
  when: string;
  /** Minutes; 0 for point-in-time deadlines. */
  duration_min: number;
  /** Short attendee summary for the grid/upcoming (e.g. "Whole team", "Maya, Alex +2"). */
  who: string | null;
  /** Full attendee names (for the details view). */
  attendees: string[];
  all_team: boolean;
  recurrence: string;
  detail: string;
  /** Video/meeting join link (Zoom or a pasted link); "" when none. */
  meeting_link: string;
  /** True only for team events (deadlines are derived and not editable here). */
  editable: boolean;
}

/** A Google Calendar event overlaid on the team grid (read-only, owner only). */
export interface GoogleCalItem {
  id: string;
  title: string;
  /** ISO start (local midnight for all-day events). */
  when: string;
  /** Minutes; 0 for all-day events. */
  duration_min: number;
  all_day: boolean;
  location: string;
  url: string | null;
}

/** An in-app notification for a team member (shown in the portal). */
export interface TeamNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  ref_type: string | null;
  ref_id: string | null;
  read: boolean;
  created_at: string;
}

/** A meeting record — notes now; action-items → tasks come later. */
export interface TeamMeeting {
  id: string;
  title: string;
  meeting_date: string;
  notes: string;
  attendee_ids: string[];
  attendee_names: string[];
  created_at: string;
}

export type AgentStatus = "idle" | "working" | "waiting" | "paused";

/** Role in the agent hierarchy. Manager/Executive are premium. */
export type AgentTier = "worker" | "manager" | "executive";

export type AssetType =
  | "email"
  | "email_batch"
  | "document"
  | "copy_diff"
  | "spreadsheet"
  | "social_post"
  | "summary"
  | "calendar_event"
  | "invoice_batch"
  | "checklist";

export type DecisionType =
  | "approve"
  | "approve_with_edits"
  | "request_changes"
  | "reject"
  | "snooze";

export type ActorType = "agent" | "human" | "system";

export type EventType =
  | "task_created"
  | "agent_updated_draft"
  | "task_opened"
  | "approved"
  | "approved_with_edits"
  | "changes_requested"
  | "rejected"
  | "snoozed"
  | "status_changed"
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "integration_touched"
  | "output_created"
  | "agent_revised";

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRule {
  label: string;
  mode: PermissionMode;
}

export interface BusinessBrief {
  id: string;
  workspace_id: string;
  company_name: string;
  website_url: string;
  business_description: string;
  core_offer: string;
  ideal_customer_profile: string;
  goals: string[];
  voice_rules: string[];
  restricted_phrases: string[];
  approval_rules: ApprovalRule[];
  budget_limits: { label: string; amount: number; period: string }[];
  working_hours: string;
  timezone: string;
  city: string;
  state: string;
  country: string;
  connected_systems: string[];
  updated_at: string;
}

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  category: Category;
  status: AgentStatus;
  /** Autonomy: suggest (ideas only) · approval (prepare + wait) · auto (ship). */
  permissions_mode: PermissionMode;
  description: string;
  last_run_at: string;
  tasks_prepared: number;
  /** Editable persona prompt — injected into this agent's Claude calls. */
  instructions: string;
  /** Named workspace this agent documents to. */
  folder: string;
  /** Whether this agent may run on a schedule / in the background. */
  background_enabled: boolean;
  /** Integration display-names this agent is allowed to use ([] = any connected). */
  allowed_integrations: string[];
  /** Whether the agent records its actions to the activity log. */
  log_activity: boolean;
  tier: AgentTier;
  /** Premium (paywalled) — Manager/Executive and, later, custom team agents. */
  premium: boolean;
  /** Built-in vs user-created. */
  created_by_type: "system" | "user";
  /** Identity. */
  emoji: string;
  accent: string;
  archived: boolean;
  /** Special workflow: undefined/null (standard) | "social" (social media manager). */
  kind?: string | null;
}

export interface TaskAsset {
  id: string;
  task_id: string;
  asset_type: AssetType;
  title: string;
  /** Human-readable preview content (markdown-ish plain text). */
  content: string;
  metadata?: Record<string, string | number>;
}

export interface ApprovalDecision {
  id: string;
  task_id: string;
  decided_by: string;
  decision_type: DecisionType;
  comment?: string;
  created_at: string;
}

export interface ExecutionRun {
  id: string;
  task_id: string;
  started_at: string;
  completed_at?: string;
  status: ExecutionStatus;
  error_message?: string;
  affected_systems: string[];
  result_summary?: string;
  steps: ExecutionStep[];
}

export interface ExecutionStep {
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
}

export interface Task {
  id: string;
  workspace_id: string;
  category: Category;
  title: string;
  description: string;
  rationale: string;
  status: TaskStatus;
  risk_level: RiskLevel;
  priority: Priority;
  due_at: string | null;
  /** When set (with execution_status "queued"), the task auto-executes at this
   *  instant via the scheduler rather than on the approval click. Optional:
   *  absent/undefined means "not scheduled" (the common case). */
  scheduled_at?: string | null;
  /** Project orchestration: the project this task belongs to (if any), which
   *  phase it's in, and whether it's an agent deliverable or a human action. */
  project_id?: string | null;
  project_phase?: number | null;
  project_step_kind?: "deliverable" | "action" | "page" | null;
  agent_id: string;
  created_by_type: CreatedByType;
  requires_approval: boolean;
  approval_status: ApprovalStatus;
  execution_status: ExecutionStatus;
  /** Short list of systems that will be touched after execution. */
  affected_systems: string[];
  /** Count surfaced on the card ("12 proposed actions"). */
  proposed_actions: number;
  impact_score: number; // 0..100, used for sorting
  /** Hidden from the board when true (kept for history) — archived to declutter. */
  archived?: boolean;
  /** Executive triage output (null until "Plan my day" runs): batch label, order
   *  in the plan, and a human-readable suggested time block (guidance only). */
  plan_group?: string | null;
  plan_rank?: number | null;
  suggested_time?: string | null;
  created_at: string;
  updated_at: string;
  /** Denormalised for convenience in the prototype store. */
  assets: TaskAsset[];
}

/** One batch in an Executive plan of action over the Approval Center. */
export interface TaskPlanGroup {
  name: string;
  note: string;
  priority: Priority;
  task_ids: string[];
}

/** The latest Executive triage of the open tasks — an ordered, grouped plan. */
export interface TaskPlan {
  summary: string;
  groups: TaskPlanGroup[];
  task_count: number;
  created_at: string;
}

/** An image attached to a post/task. Binary lives in Supabase Storage. */
export interface PostImage {
  id: string;
  task_id: string | null;
  source: "upload" | "stock" | "ai";
  /** Public URL for previewing/serving the image. */
  url: string;
  mime_type: string;
  alt_text: string;
  width: number;
  height: number;
  attribution?: string | null;
  created_at: string;
}

/* ----------------------------- projects ---------------------------------- */

export type ProjectStatus = "planning" | "active" | "blocked" | "done" | "cancelled";

/** One step in a project plan — either a deliverable a worker agent drafts, or
 *  an action the owner performs themselves (e.g. "build + publish the site"). */
export interface ProjectStep {
  id: string;
  title: string;
  /** What to produce (deliverable), build (page), or do (action). */
  brief: string;
  /** The worker department that owns it, or "human" for an owner action. */
  assignee: Category | "human";
  /** deliverable = a drafted artifact · page = a real hosted page with a buy
   *  button · action = a step the owner performs themselves. */
  kind: "deliverable" | "action" | "page";
}

export interface ProjectPhase {
  title: string;
  summary: string;
  steps: ProjectStep[];
}

/** Weekly cadence a growth campaign runs on. */
export interface GrowthCadence {
  tweets_per_day: number;
  replies_per_day: number;
  blogs_per_week: number;
}

/** Config for a follower-growth campaign, stored on its ProjectPlan. */
export interface GrowthConfig {
  cadence: GrowthCadence;
  /** The weekly follower target (e.g. 100 = "+100 followers/week"). */
  follower_goal_per_week: number;
  weeks: number;
}

export interface ProjectPlan {
  phases: ProjectPhase[];
  /** Present on growth-campaign projects (project.kind === "growth"). */
  growth?: GrowthConfig;
}

/** A follower-count reading over the life of a growth campaign. */
export interface FollowerSnapshot {
  followers: number;
  created_at: string;
}

/** A scheduled X post belonging to a growth campaign, for the review surface. */
export interface CampaignPost {
  id: string;
  text: string;
  scheduled_at: string | null;
  approval_status: ApprovalStatus;
  execution_status: ExecutionStatus;
  /** Campaign week (0-based) this post belongs to. */
  phase: number | null;
}

/** Everything the campaign drawer needs beyond the base Project. */
export interface CampaignData {
  followers: FollowerSnapshot[];
  posts: CampaignPost[];
}

/** A multi-step project a leadership agent (Manager/Executive) plans and runs. */
export interface Project {
  id: string;
  workspace_id: string;
  goal: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  owner_kind: "manager" | "executive";
  owner_agent_id: string | null;
  /** null (standard project) | "growth" (a follower-growth campaign). */
  kind?: string | null;
  plan: ProjectPlan;
  /** Index of the phase currently being worked (0-based). */
  current_phase: number;
  created_by_type: CreatedByType;
  /** Team Room: the member this whole project is assigned to (null = owner-run). */
  assigned_member_id: string | null;
  assigned_manager_id: string | null;
  created_at: string;
  updated_at: string;
  /** Denormalised progress, assembled at load. */
  progress?: { total: number; done: number };
}

/** A task inside an assigned project, as a team member sees it in their portal. */
export interface MemberProjectTask {
  id: string;
  title: string;
  description: string;
  category: Category;
  status: TaskStatus;
  approval_status: ApprovalStatus;
  execution_status: ExecutionStatus;
  requires_approval: boolean;
  project_phase: number | null;
  step_kind: "deliverable" | "action" | "page" | null;
  /** The drafted deliverable (first task asset), if any. */
  deliverable: { id: string; title: string; content: string } | null;
}

/** An assigned project + its tasks, scoped to the member it's assigned to. */
export interface MemberProjectDetail {
  project: Project;
  tasks: MemberProjectTask[];
}

/* --------------------------- pages & commerce ---------------------------- */

export type PageStatus = "draft" | "published";
export type PageType = "landing" | "product" | "blog";

/** The structured content of a generated page (a page with a buy button). */
export interface PageContent {
  headline: string;
  subheadline: string;
  cta_label: string;
  sections: { heading: string; body: string; image_url?: string }[];
  features?: { title: string; body: string }[];
  footer_note?: string;
  /** Brand + media, added in the editor (all optional). */
  logo_url?: string;
  hero_image_url?: string;
  /** Accent hex used for the CTA + highlights (e.g. "#2a44c0"). */
  accent?: string;
  /** When present, the page renders as an ARTICLE (blog post from the content
   *  engine) — headline + dek + hero + this HTML body, no buy-button CTA. */
  body_html?: string;
}

export interface Page {
  id: string;
  workspace_id: string;
  project_id: string | null;
  product_id: string | null;
  slug: string;
  title: string;
  status: PageStatus;
  page_type: PageType;
  content: PageContent;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
}

export interface Order {
  id: string;
  workspace_id: string;
  page_id: string | null;
  product_id: string | null;
  status: "pending" | "paid" | "failed";
  amount_cents: number;
  currency: string;
  customer_email: string | null;
  created_at: string;
}

/* --------------------------- content engine ------------------------------ */

export type PostStatus = "draft" | "distributed";

/** The longform master — one canonical draft, repurposed + distributed to many
 *  channels (its channels are assembled at load). Markdown is the master format. */
export interface Post {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  /** Subtitle / standfirst. */
  dek: string;
  /** The canonical markdown body everything downstream derives from. */
  body_md: string;
  hero_image_url: string | null;
  status: PostStatus;
  /** Whether the growth-marketer rewrite has been applied to the master. */
  boosted: boolean;
  created_by_type: CreatedByType;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  channels?: PostChannel[];
}

/** Destinations a post can be packaged + distributed to (Slice 1). */
export type ChannelKind = "page" | "x_thread" | "substack";
/** packaged = ready · scheduled = queued to publish · published = live · handoff = export-ready (manual). */
export type ChannelStatus = "packaged" | "scheduled" | "published" | "handoff";

/** Channel-specific packaged content derived from the master. */
export interface PackagedVariant {
  /** X thread — ordered tweets (each ≤ 280). */
  tweets?: string[];
  /** Full post rendered for paste/import (Substack handoff). */
  html?: string;
  markdown?: string;
  /** Short teaser/summary (thread intro, social blurb). */
  teaser?: string;
}

/** A packaged variant of a Post for one destination + its distribution status. */
export interface PostChannel {
  id: string;
  post_id: string;
  channel: ChannelKind;
  status: ChannelStatus;
  variant: PackagedVariant;
  /** The page_id or task_id this channel created downstream, if any. */
  ref_id: string | null;
  /** Published / permalink URL, once live. */
  url: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------ reply radar ------------------------------ */

/** An account the owner watches for reply opportunities (the reply radar). */
export interface XTarget {
  id: string;
  workspace_id: string;
  handle: string;
  x_user_id: string | null;
  note: string;
  active: boolean;
  last_checked_at: string | null;
  created_at: string;
}

export type ReplyOpportunityStatus = "new" | "dismissed" | "replied";

/** A scored tweet worth replying to, with pre-drafted reply options. */
export interface ReplyOpportunity {
  id: string;
  workspace_id: string;
  target_id: string | null;
  tweet_id: string;
  tweet_url: string;
  author_handle: string;
  tweet_text: string;
  score: number;
  reason: string;
  suggested_replies: { reply: string; note: string }[];
  status: ReplyOpportunityStatus;
  reply_url: string | null;
  created_at: string;
}

/** One tweet that actually went out — for the Social page's "sent" tally. */
export interface SentTweet {
  id: string;
  text: string;
  /** ISO instant it was published. */
  at: string;
  /** Live tweet URL when captured, else null. */
  url: string | null;
}

/** Account stats for the Social page's right rail (follower count, growth, cadence, sent). */
export interface SocialStats {
  /** Whether X is connected (drives the connect prompt). */
  connected: boolean;
  /** Current follower count (null when unavailable / not connected). */
  followers: number | null;
  /** Follower count over time — latest per day, up to 30 days. */
  followerTrend: { date: string; followers: number }[];
  /** Tweets published per day over the last 14 days (zero-filled). */
  tweetsPerDay: { date: string; count: number }[];
  /** The last 20 tweets that went out, newest first. */
  sent: SentTweet[];
}

export interface Integration {
  id: string;
  name: string;
  provider: string;
  category: "email" | "calendar" | "website" | "crm" | "payments" | "other";
  connected: boolean;
  account?: string;
  permission_mode: PermissionMode;
  optional: boolean;
  /** Phase 3 (computed at load, never stored): the real OAuth/API provider key. */
  oauth_provider?: string;
  /** Phase 3: whether the backend has this provider's credentials configured. */
  configured?: boolean;
  /** Phase 3: one-line description of what executing this provider does. */
  action_label?: string;
}

export interface ActivityEvent {
  id: string;
  workspace_id: string;
  task_id: string | null;
  event_type: EventType;
  actor_type: ActorType;
  actor_id: string;
  summary: string;
  metadata?: Record<string, string | number>;
  created_at: string;
}

/** Full client-side application state (the seeded "database"). */
/** An agent-authored document, surfaced in the file manager. */
export interface Document {
  id: string;
  workspace_id: string;
  /** Author agent id (null if system-authored). */
  agent_id: string | null;
  author_name: string;
  /** Task it was produced for (null if standalone / task later removed). */
  task_id: string | null;
  task_title: string;
  name: string;
  content: string;
  folder: string;
  doc_type: AssetType;
  /** Set once exported to Notion. */
  notion_url: string | null;
  created_at: string;
  updated_at: string;
}

/** A freeform note the user jots down, optionally handed to the Executive to
 *  turn into a project or tasks. */
export interface Note {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  status: "draft" | "actioned";
  /** Set when actioning produced a project. */
  spawned_project_id: string | null;
  /** How many tasks actioning this note created. */
  spawned_task_count: number;
  created_at: string;
  updated_at: string;
}

/** What the Executive proposes when a note is actioned: a project OR discrete tasks. */
export interface NoteProposal {
  kind: "project" | "tasks";
  /** One-line reasoning shown to the user. */
  summary: string;
  /** For kind "project". */
  project?: { title: string; goal: string };
  /** For kind "tasks". */
  tasks?: Array<{ title: string; category: Category; description: string; rationale: string }>;
}

export interface AppState {
  workspace: Workspace;
  brief: BusinessBrief;
  agents: Agent[];
  tasks: Task[];
  integrations: Integration[];
  decisions: ApprovalDecision[];
  runs: ExecutionRun[];
  activity: ActivityEvent[];
  documents: Document[];
  session: {
    authenticated: boolean;
    onboarded: boolean;
    user_name: string;
    user_email: string;
    /** True when the backend has an Anthropic API key (real AI drafting on). */
    ai_enabled: boolean;
  };
  /**
   * Operator Lite: who is looking and what they may open. The owner is a full
   * "Operator Pro" viewer (all pages); a team member is an "Operator Lite" viewer
   * whose sidebar + routes are gated to `allowedPages`.
   */
  viewer: ViewerState;
}

export interface ViewerState {
  isOwner: boolean;
  isMember: boolean;
  /** Route keys (e.g. "/email") this viewer may open. Owner = every page. */
  allowedPages: string[];
}

/** Payload for AI drafting / revision (Phase 2). */
export interface DraftRequest {
  category: Category;
  title: string;
  description: string;
  rationale: string;
  instruction?: string;
  existingDraft?: string;
  companyName: string;
  companyContext: string;
  idealCustomer: string;
  voiceRules: string[];
  restrictedPhrases: string[];
  /** True when the task publishes to X — draft to fit the 280-char limit. */
  xPost?: boolean;
  /** The acting agent's persona (Phase 4 — editable agents). */
  agentName?: string;
  agentInstructions?: string;
}

/* --------------------------- executive office ---------------------------- */

export type ExecRole = "user" | "assistant";

/** An action the Executive Agent took while replying (a tool call). */
export interface ExecAction {
  tool: string;
  summary: string;
  /** Optional deep link to what it created (e.g. /projects). */
  href?: string;
}

/** One turn in the conversation with the Executive Agent. */
export interface ExecMessage {
  id: string;
  role: ExecRole;
  content: string;
  actions: ExecAction[];
  created_at: string;
}

/** A conversation thread with the Executive — a saved chat the founder can reopen. */
export interface ExecThread {
  id: string;
  title: string;
  message_count: number;
  updated_at: string;
  created_at: string;
}

/** A thread that matched a search, with a snippet of the matching message. */
export interface ExecThreadHit extends ExecThread {
  snippet: string;
}

export type MemoryKind = "fact" | "preference" | "decision" | "insight";

/* ------------------------------ Email Manager ------------------------------ */

/** Lifecycle of an inbox message in the Email Manager. "new" = not yet triaged. */
export type EmailStatus = "new" | "triaged" | "sent" | "archived" | "trashed";

/** An inbox row: live Gmail metadata + the triage overlay (if triaged). */
export interface EmailListItem {
  id: string;
  thread_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  status: EmailStatus;
  category: string;
  urgency: string;
  action_type: string;
  summary: string;
  draft_reply: string;
}

/** One email on the "needs attention" shortlist — clickable to open in the reader. */
export interface EmailAttentionItem {
  id: string;
  from_name: string;
  subject: string;
  category: string;
  urgency: string;
}

/** The "Daily Triage Info" panel — counts + the attention shortlist. */
export interface EmailTriageInfo {
  total: number;
  attention: number;
  drafts: number;
  sent: number;
  cleared: number;
  attentionItems: EmailAttentionItem[];
}

/** How often the Admin agent auto-triages the inbox in the background. */
export type EmailCadence = "off" | "hourly" | "daily";

export interface EmailSettings {
  signature: string;
  reply_style: string;
  cadence: EmailCadence;
}

export interface EmailManagerState {
  connected: boolean;
  items: EmailListItem[];
  nextPageToken: string | null;
  triageInfo: EmailTriageInfo;
  settings: EmailSettings;
}

/** Full body of a selected email (fetched on demand for the reader pane). */
export interface EmailBody {
  id: string;
  from_name: string;
  from_email: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}

/* --------------------------- outbound composer --------------------------- */

export type RecipientSource = "explicit" | "hubspot" | "gmail" | "manual" | "none";
export type OutboundDraftStatus = "draft" | "sending" | "sent" | "failed";

/** A possible recipient the resolver found — the user can pick among these when a
 *  name matches more than one contact. */
export interface RecipientCandidate {
  email: string;
  name: string;
  source: RecipientSource;
  context?: string;
}

/** An AI-drafted outbound email awaiting the founder's review + one-click send. */
/** A file attached to an outbound email draft (binary lives in Supabase Storage). */
export interface OutboundAttachment {
  id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
}

export interface OutboundDraft {
  id: string;
  intent: string;
  recipient_name: string;
  to_email: string;
  recipient_source: RecipientSource;
  candidates: RecipientCandidate[];
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: OutboundAttachment[];
  status: OutboundDraftStatus;
  error: string;
  scheduled_at: string | null;
  created_at: string;
  sent_at: string | null;
}

/* ------------------------------- boardroom ------------------------------- */

export type BoardRole = "finance" | "marketing" | "product" | "strategy" | "technology" | "chair" | "custom";
export type BoardRound = "opening" | "rebuttal" | "verdict";
export type BoardSessionStatus =
  | "opening_pending"
  | "rebuttal_pending"
  | "awaiting_founder"
  | "verdict_pending"
  | "complete"
  | "failed";

/** One seat on the board — a domain lens modeled after blue-chip VC wisdom. */
export interface BoardMember {
  id: string;
  role: BoardRole;
  name: string;
  mandate: string;
  emoji: string;
  accent: string;
  seat: number;
  active: boolean;
}

/** One thing a member said during a deliberation (an opening or a rebuttal). */
export interface BoardContribution {
  id: string;
  member_id: string | null;
  member_name: string;
  member_role: BoardRole;
  member_emoji: string;
  round: BoardRound;
  content: string;
  seq: number;
}

export interface BoardRecommendation {
  title: string;
  detail: string;
}

/** One turn of the post-verdict discussion between the founder and the board (Chair). */
export interface BoardDiscussionTurn {
  id: string;
  role: "founder" | "board";
  author: string;
  content: string;
  /** True for a board turn that revised the verdict (vs. held its position). */
  revised: boolean;
  seq: number;
  created_at: string;
}

/** A full board deliberation: the debate transcript + the Chair's verdict. */
export interface BoardSession {
  id: string;
  title: string;
  trigger: "user" | "assessment" | "research";
  status: BoardSessionStatus;
  /** The founder's response to the debate, before the board rules (may correct assumptions). */
  founder_input: string;
  verdict: string;
  disagreements: string[];
  recommendations: BoardRecommendation[];
  accountability: string;
  /** The project spawned when the verdict was handed to the Executive. */
  project_id: string | null;
  contributions: BoardContribution[];
  /** Post-verdict back-and-forth with the board, oldest first. */
  discussion: BoardDiscussionTurn[];
  /** Set once the founder accepts the verdict as final (locks it, enables handoff). */
  accepted_at: string | null;
  error: string;
  created_at: string;
  completed_at: string | null;
}

export type BoardDirectiveStatus = "open" | "in_motion" | "done" | "dropped";

/** A commitment the board is tracking — a recommendation the founder put into motion. */
export interface BoardDirective {
  id: string;
  session_id: string | null;
  title: string;
  detail: string;
  status: BoardDirectiveStatus;
  project_id: string | null;
  created_at: string;
}

export interface BoardSessionSummary {
  id: string;
  title: string;
  status: BoardSessionStatus;
  created_at: string;
}

export type BoardAlertSeverity = "info" | "attention" | "urgent";
export type BoardAlertStatus = "new" | "read" | "dismissed" | "actioned";

/** An unprompted finding a board member raised during an autonomous scan. */
export interface BoardAlert {
  id: string;
  member_id: string | null;
  member_name: string;
  member_role: BoardRole;
  member_emoji: string;
  severity: BoardAlertSeverity;
  title: string;
  detail: string;
  suggested_action: string;
  status: BoardAlertStatus;
  created_at: string;
}

/** How often the board researches on its own and raises alerts. */
export type BoardCadence = "off" | "daily" | "weekly";

export interface BoardSettings {
  cadence: BoardCadence;
  last_scan_at: string | null;
  /** The board's mission/goal (empty = use the default). Drives every deliberation. */
  mission: string;
}

export interface BoardroomView {
  members: BoardMember[];
  sessions: BoardSessionSummary[];
  alerts: BoardAlert[];
  directives: BoardDirective[];
  settings: BoardSettings;
}

/* ------------------------------ Command Center ----------------------------- */

/** One goal bullet. `done` renders strikethrough; `indent` (0|1) gives one nesting level. */
export interface GoalItem {
  id: string;
  text: string;
  done: boolean;
  indent: 0 | 1;
}

/** A time period row in the grid — its four goal columns. */
export interface GoalPeriod {
  id: string;
  label: string;
  monthly: GoalItem[];
  weekly: GoalItem[];
  daily: GoalItem[];
  parking: GoalItem[];
}

/** The long-horizon goal boxes below the grid. */
export interface CommandCenterHorizons {
  year: GoalItem[];
  future: GoalItem[];
  moonshot: GoalItem[];
}

/** The whole user-authored Command Center document (one per workspace). */
export interface CommandCenterDoc {
  periods: GoalPeriod[];
  horizons: CommandCenterHorizons;
}

/** Where a suggested goal lands: a grid column (of the current period) or a horizon. */
export type GoalTarget = "monthly" | "weekly" | "daily" | "parking" | "year" | "future" | "moonshot";

/** An Executive-proposed goal the user can accept into the Command Center. */
export interface GoalSuggestion {
  target: GoalTarget;
  text: string;
}

/** A durable thing the Executive Agent knows about the business. */
export interface ExecMemory {
  id: string;
  content: string;
  kind: MemoryKind;
  source: "user" | "agent";
  pinned: boolean;
  created_at: string;
}

/** A chat message the founder saved to revisit. `title`/`category` are filled in
 *  when the Executive organizes the saved list. */
export interface ExecSavedMessage {
  id: string;
  message_id: string | null;
  role: ExecRole;
  content: string;
  title: string;
  category: string;
  pinned: boolean;
  created_at: string;
}

export type GoalStatus = "active" | "achieved" | "archived";
/** Time horizon — a "month"/"quarter" goal is a north star the agent cascades
 *  down to the weekly review + daily brief; "ongoing" is untimed. */
export type GoalHorizon = "month" | "quarter" | "ongoing";
/** A live metric a goal can track against (maps to a computed KPI). */
export type GoalMetric = "revenue" | "followers";

/** Live progress for a metric-linked goal, computed at load. */
export interface GoalProgress {
  current: number;
  target: number;
  pct: number;
}

/** A company-wide goal the owner sets with the Executive Agent. */
export interface CompanyGoal {
  id: string;
  title: string;
  detail: string;
  /** What to watch, free text (e.g. "MRR", "X followers"). */
  metric: string;
  target: string;
  status: GoalStatus;
  horizon: GoalHorizon;
  /** When set, the goal tracks live against this metric + numeric target. */
  metric_key: GoalMetric | null;
  target_number: number | null;
  created_at: string;
  updated_at: string;
  /** Assembled at load for metric-linked goals. */
  progress?: GoalProgress | null;
}

/** A single computed business metric for the KPI strip. */
export interface ExecKpi {
  key: string;
  label: string;
  value: string;
  /** Week-over-week change, pre-formatted (e.g. "+12%"). */
  delta?: string;
  tone?: "up" | "down" | "neutral";
  hint?: string;
}

/** What the current workspace is entitled to use (for client-side gating/banners). */
export interface EntitlementView {
  effectiveTier: string;
  enforced: boolean;
  trialing: boolean;
  trialEndsAt: string | null;
  /** Feature key → whether this workspace can use it. */
  can: Record<string, boolean>;
}

/** One subscription tier as the billing page renders it. */
export interface BillingPlanView {
  key: string;
  name: string;
  amountLabel: string;
  cadence: string;
  tagline: string;
  features: string[];
  anchor: boolean;
  /** Has a Stripe Price ID configured, so it can actually be purchased. */
  purchasable: boolean;
  /** The workspace's current tier. */
  current: boolean;
}

/** The workspace's subscription state for the billing surface. */
export interface BillingState {
  /** Platform Stripe key + at least one Price ID are set. */
  configured: boolean;
  tier: string;
  tierName: string;
  /** none | trialing | active | past_due | canceled. */
  status: string;
  /** Has a Stripe customer, so the billing portal can be opened. */
  hasSubscription: boolean;
  periodEnd: string | null;
  trialEndsAt: string | null;
  plans: BillingPlanView[];
}

/** One point in a KPI trend series (a weekly bucket). */
export interface KpiTrendPoint {
  /** Short bucket label, e.g. "8/24". */
  label: string;
  value: number;
}

/** A KPI's history over the last several weeks, for a sparkline. */
export interface KpiTrendSeries {
  key: string;
  label: string;
  points: KpiTrendPoint[];
  /** Pre-formatted current (latest) value, e.g. "$4,200" or "1,830". */
  current: string;
  /** Percent change across the window (first→last), or null when undefined. */
  changePct: number | null;
  /** How to draw it — cumulative metrics as an area, per-week counts as bars. */
  chart: "area" | "bars";
}

/** A forward-looking idea/observation in the daily brief. */
export interface ExecBriefInsight {
  title: string;
  detail: string;
}

export type BriefSuggestionKind = "project" | "campaign" | "task";
export type BriefSuggestionStatus = "proposed" | "accepted" | "dismissed";

/** A concrete next action the brief proposes — the founder approves (which
 *  creates it) or dismisses it. */
export interface BriefSuggestion {
  id: string;
  kind: BriefSuggestionKind;
  title: string;
  /** Why the agent is proposing this. */
  rationale: string;
  /** The outcome to accomplish (project/campaign) or the task's description. */
  goal: string;
  /** For a task suggestion — which department it belongs to. */
  category?: Category | null;
  status: BriefSuggestionStatus;
  /** Deep link to the created project/task once approved. */
  ref_href?: string | null;
}

/** The structured content of a daily executive brief. */
export interface ExecBriefContent {
  /** One-line read on where the business stands today. */
  headline: string;
  /** Prose commentary on the KPIs. */
  kpi_review: string;
  /** What got done recently. */
  shipped: string[];
  /** The current plan / what's underway. */
  in_motion: string[];
  /** What's next / needs the founder. */
  next: string[];
  /** Patterns + new ideas for the future. */
  insights: ExecBriefInsight[];
  /** Concrete next actions the founder can greenlight from the brief. */
  suggestions: BriefSuggestion[];
}

/** daily = the morning brief · weekly = the strategic retrospective. */
export type BriefKind = "daily" | "weekly";

export interface ExecBrief {
  id: string;
  kind: BriefKind;
  content: ExecBriefContent;
  created_at: string;
}

export type NudgeSeverity = "attention" | "info" | "positive";

/** A real-time alert the Executive Agent surfaces without being asked. */
export interface ExecNudge {
  id: string;
  severity: NudgeSeverity;
  title: string;
  detail: string;
  href?: string | null;
}

/* --------------------------- investor updates ---------------------------- */

/** A single metric line in an investor update. */
/** Who a stakeholder update is written for. Drives tone, dossier scope, and labels. */
export type UpdateAudience = "investor" | "team" | "advisor";

export interface InvestorMetric {
  label: string;
  value: string;
  note?: string;
}

/** The structured content of a monthly investor / stakeholder update. */
export interface InvestorUpdateContent {
  /** The period the update covers, e.g. "August 2026". */
  period: string;
  /** 2–3 sentence headline summary. */
  tldr: string;
  /** Concrete wins / progress this period. */
  highlights: string[];
  /** The numbers that matter, framed for investors. */
  metrics: InvestorMetric[];
  /** Honest challenges / risks (investors value candor). */
  lowlights: string[];
  /** The plan for next period. */
  whats_next: string[];
  /** Specific asks — intros, hires, advice, capital. */
  asks: string[];
  /** Optional closing note. */
  closing: string;
  /** Optional hero image (uploaded or stock), shown at the top and in the email. */
  image_url?: string;
}

export interface InvestorUpdate {
  id: string;
  /** Which stakeholder audience this update is written for. */
  audience: UpdateAudience;
  content: InvestorUpdateContent;
  archived: boolean;
  created_at: string;
}

/** Everything the Executive Office page loads. */
export interface ExecutiveBundle {
  agentName: string;
  /** The company name (for outward artifacts like the investor-update subject line). */
  companyName: string;
  messages: ExecMessage[];
  memory: ExecMemory[];
  goals: CompanyGoal[];
  kpis: ExecKpi[];
  /** Real-time things needing the founder's attention. */
  nudges: ExecNudge[];
  /** Recent briefs, newest first (for the archive + the current view). */
  briefs: ExecBrief[];
  /** Recent investor updates, newest first. */
  investorUpdates: InvestorUpdate[];
  /** All conversation threads (history column), most-recently-active first. */
  threads: ExecThread[];
  /** The thread whose messages `messages` holds (null if none yet). */
  activeThreadId: string | null;
}

/** One thing needing the owner's attention on the Today hub. */
export interface TodayItem {
  id: string;
  kind: "approval" | "board" | "nudge" | "email" | "deadline" | "opportunity";
  title: string;
  detail: string;
  href: string;
  tone: "urgent" | "attention" | "normal" | "positive";
}

/** The owner's daily home surface — everything needing them, in one place. */
export interface TodayData {
  name: string;
  kpis: ExecKpi[];
  needsYou: TodayItem[];
  /** Upcoming calendar items (next few days). */
  schedule: CalendarItem[];
  opportunities: { id: string; title: string; org: string; type: string; fit_score: number; url: string }[];
  brief: { id: string; headline: string; created_at: string } | null;
  /** Whether the proactive morning digest (Slack/email) is turned on. */
  digestOn: boolean;
}

/* ----------------------------- Deep Dive -------------------------------- */

/** A Deep Dive run's lifecycle. `wiring` = folding findings into brief + memory. */
export type DeepDiveStatus =
  | "queued"
  | "collecting"
  | "distilling"
  | "synthesizing"
  | "wiring"
  | "complete"
  | "failed";

export type DeepDiveSourceKind = "upload" | "text" | "email" | "notion";
export type DeepDiveSourceStatus = "pending" | "distilled" | "failed";

/** Token/cost accounting for a run (metered even though the feature is free). */
export interface DeepDiveUsage {
  input_tokens: number;
  output_tokens: number;
  est_cost_cents: number;
  calls: number;
}

/** Distill progress — done/total sources processed in the map stage. */
export interface DeepDiveProgress {
  done: number;
  total: number;
}

/** A person surfaced from ingested material. */
export interface ContextPerson {
  name: string;
  role?: string;
  note?: string;
}

export interface ContextTimelineEntry {
  when: string;
  what: string;
}

export interface ContextItem {
  title: string;
  detail?: string;
}

/** The synthesized understanding of the company — the "Context Pack". */
export interface CompanyContextPack {
  people: ContextPerson[];
  timeline: ContextTimelineEntry[];
  themes: ContextItem[];
  decisions: ContextItem[];
  open_threads: ContextItem[];
  risks: ContextItem[];
  products: ContextItem[];
}

/** Per-source extraction from the map (distill) stage. */
export interface SourceDistillation {
  summary: string;
  people: ContextPerson[];
  decisions: string[];
  dates: ContextTimelineEntry[];
  topics: string[];
  status_notes: string[];
}

export interface DeepDive {
  id: string;
  title: string;
  status: DeepDiveStatus;
  stage_detail: string;
  progress: DeepDiveProgress;
  usage: DeepDiveUsage;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DeepDiveSource {
  id: string;
  deep_dive_id: string;
  kind: DeepDiveSourceKind;
  title: string;
  char_count: number;
  status: DeepDiveSourceStatus;
  created_at: string;
}

/** The current Context Pack for a workspace (versioned + cumulative). */
export interface CompanyContext {
  id: string;
  version: number;
  summary: string;
  pack: CompanyContextPack;
  created_at: string;
}

/* ---------------------------- Opportunities ----------------------------- */

export type OpportunityType = "grant" | "conference" | "event" | "competition";
export type ScannerCadence = "weekly" | "biweekly" | "monthly";
/** The autonomy phase of a scanner. */
export type ScannerMode = "scan" | "scan_draft" | "approve";
/** How wide to scan geographically. */
export type ScannerScope = "local" | "state" | "national";
export type ScannerStatus = "idle" | "scanning" | "failed";
export type OpportunityStatus = "new" | "shortlisted" | "dismissed" | "drafted";

/** Metered usage for a scanner (web search is billed per search). */
export interface ScanUsage {
  input_tokens: number;
  output_tokens: number;
  searches: number;
  est_cost_cents: number;
  runs: number;
}

export interface OpportunityScanner {
  id: string;
  type: OpportunityType;
  enabled: boolean;
  cadence: ScannerCadence;
  mode: ScannerMode;
  scope: ScannerScope;
  sources: string[];
  status: ScannerStatus;
  last_error: string | null;
  usage: ScanUsage;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface Opportunity {
  id: string;
  scanner_id: string;
  type: OpportunityType;
  title: string;
  org: string;
  url: string;
  summary: string;
  /** Free text — "March 15, 2026", "Rolling", "Quarterly". */
  deadline: string;
  /** Free text — award/prize like "$50k–$250k". */
  amount: string;
  location: string;
  fit_score: number;
  fit_rationale: string;
  /** Eligibility / what it would take to apply. */
  requirements: string;
  status: OpportunityStatus;
  /** Set once an application plan is drafted into a project. */
  project_id: string | null;
  created_at: string;
}
