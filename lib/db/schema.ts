/**
 * Drizzle schema — the production Postgres model (Supabase-compatible).
 *
 * Column JS keys deliberately mirror the domain field names in lib/types.ts
 * (snake_case) so mapping rows → domain objects is near-identity; only dates
 * (Date → ISO string) and nested relations are assembled in lib/db/queries.ts.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ApprovalRule,
  AgentStatus,
  AgentTier,
  ApprovalStatus,
  AssetType,
  BoardRecommendation,
  Category,
  BriefKind,
  CampaignStatus,
  CommandCenterDoc,
  ChannelKind,
  ChannelStatus,
  MarketingChannel,
  MarketingItemStatus,
  CompanyContextPack,
  CreatedByType,
  DecisionType,
  DeepDiveProgress,
  DeepDiveSourceKind,
  DeepDiveSourceStatus,
  DeepDiveStatus,
  DeepDiveUsage,
  ApplicationEval,
  ApplicationStage,
  CandidateSource,
  EmploymentType,
  EventType,
  ExecAction,
  ExecBriefContent,
  ExecRole,
  ExecutionStatus,
  ExecutionStep,
  GoalHorizon,
  JobStatus,
  GoalMetric,
  GoalStatus,
  InvestorUpdateContent,
  MemoryKind,
  OpportunityStatus,
  OpportunityType,
  ScannerCadence,
  ScannerMode,
  ScannerScope,
  ScannerStatus,
  ScanUsage,
  UpdateAudience,
  PackagedVariant,
  PageContent,
  PageStatus,
  PageType,
  PayType,
  QuoteRequestStatus,
  SupplierStatus,
  SupplierContactMethod,
  OutreachCampaignStatus,
  OutreachStatus,
  OutreachContactMethod,
  PermissionMode,
  PostStatus,
  Priority,
  ProjectPlan,
  ProjectStatus,
  RecipientCandidate,
  RiskLevel,
  ScreeningQuestion,
  SourceDistillation,
  TaskStatus,
} from "@/lib/types";

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

/** A user profile, keyed to the Supabase auth.users id. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // == auth.users.id
  email: text("email").notNull(),
  full_name: text("full_name").notNull().default(""),
  // The workspace the user is currently viewing. Null → resolve to their owned
  // (or first) membership. Lets one user belong to several workspaces + switch.
  active_workspace_id: uuid("active_workspace_id"),
  created_at: createdAt,
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  owner_id: uuid("owner_id").notNull(),
  plan: text("plan").notNull().default("Operator Pro"),
  // Operator's own subscription billing (the platform Stripe account) —
  // distinct from the per-workspace Stripe a founder connects to sell products.
  stripe_customer_id: text("stripe_customer_id"),
  stripe_subscription_id: text("stripe_subscription_id"),
  /** Entitlement tier: free | starter | operator | agency. */
  subscription_tier: text("subscription_tier").notNull().default("free"),
  /** Stripe subscription status: none | trialing | active | past_due | canceled. */
  subscription_status: text("subscription_status").notNull().default("none"),
  subscription_period_end: timestamp("subscription_period_end", { withTimezone: true }),
  trial_ends_at: timestamp("trial_ends_at", { withTimezone: true }),
  /** Globally-unique slug for this workspace's public careers board at
   *  /careers/[careers_slug]. Lazily set the first time a job is published. */
  careers_slug: text("careers_slug"),
  /** The workspace's default HR/compliance statement (markdown) — pre-fills the
   *  compliance block on every new job posting. */
  compliance_md: text("compliance_md"),
  created_at: createdAt,
  updated_at: updatedAt,
});

export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull(),
  role: text("role").notNull().default("owner"),
  created_at: createdAt,
}, (t) => [index("workspace_members_user_idx").on(t.user_id, t.workspace_id)]);

export const businessBriefs = pgTable("business_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  company_name: text("company_name").notNull().default(""),
  website_url: text("website_url").notNull().default(""),
  business_description: text("business_description").notNull().default(""),
  core_offer: text("core_offer").notNull().default(""),
  ideal_customer_profile: text("ideal_customer_profile").notNull().default(""),
  goals: text("goals").array().notNull().default([]),
  voice_rules: text("voice_rules").array().notNull().default([]),
  restricted_phrases: text("restricted_phrases").array().notNull().default([]),
  // Email Manager — the founder's outgoing-email identity, injected into every
  // drafted reply so replies sound like them and sign off correctly.
  email_signature: text("email_signature").notNull().default(""),
  email_reply_style: text("email_reply_style").notNull().default(""),
  // Auto-triage cadence: off | hourly | daily. Drives runDueEmailTriage (never auto-sends).
  email_triage_cadence: text("email_triage_cadence").notNull().default("off"),
  email_triage_last_run_at: timestamp("email_triage_last_run_at", { withTimezone: true }),
  approval_rules: jsonb("approval_rules").$type<ApprovalRule[]>().notNull().default([]),
  budget_limits: jsonb("budget_limits")
    .$type<{ label: string; amount: number; period: string }[]>()
    .notNull()
    .default([]),
  working_hours: text("working_hours").notNull().default(""),
  timezone: text("timezone").notNull().default(""),
  // Company location — feeds local opportunity scanning (web_search user_location).
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  country: text("country").notNull().default(""),
  connected_systems: text("connected_systems").array().notNull().default([]),
  // Proactive morning digest: "off" | "daily". last_sent dedups to once per day.
  digest_cadence: text("digest_cadence").notNull().default("off"),
  digest_last_sent_at: timestamp("digest_last_sent_at", { withTimezone: true }),
  updated_at: updatedAt,
}, (t) => [index("business_briefs_ws_idx").on(t.workspace_id)]);

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").$type<Category>().notNull(),
  status: text("status").$type<AgentStatus>().notNull().default("idle"),
  permissions_mode: text("permissions_mode").$type<PermissionMode>().notNull().default("approval"),
  description: text("description").notNull().default(""),
  last_run_at: timestamp("last_run_at", { withTimezone: true }).defaultNow().notNull(),
  tasks_prepared: integer("tasks_prepared").notNull().default(0),
  // Editable persona + capabilities (agent personas / build-an-agent).
  instructions: text("instructions").notNull().default(""),
  folder: text("folder").notNull().default(""),
  background_enabled: boolean("background_enabled").notNull().default(false),
  allowed_integrations: text("allowed_integrations").array().notNull().default([]),
  log_activity: boolean("log_activity").notNull().default(true),
  tier: text("tier").$type<AgentTier>().notNull().default("worker"),
  premium: boolean("premium").notNull().default(false),
  created_by_type: text("created_by_type").$type<"system" | "user">().notNull().default("system"),
  emoji: text("emoji").notNull().default(""),
  accent: text("accent").notNull().default("indigo"),
  archived: boolean("archived").notNull().default(false),
  /** Special agent workflow: null (standard) | "social" (social media manager). */
  kind: text("kind"),
  /** Learned writing voice, distilled from the owner's own tweets — injected into
   *  X drafting so posts match how they actually write. Null until learned. */
  style_profile: text("style_profile"),
}, (t) => [index("agents_ws_idx").on(t.workspace_id)]);

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  category: text("category")
    .$type<"email" | "calendar" | "website" | "crm" | "payments" | "other">()
    .notNull(),
  connected: boolean("connected").notNull().default(false),
  account: text("account"),
  permission_mode: text("permission_mode").$type<PermissionMode>().notNull().default("approval"),
  optional: boolean("optional").notNull().default(true),
  // Phase 3 — encrypted OAuth credentials (nullable until a provider is wired):
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  // Operator Lite: whose plane this connection belongs to. NULL = the workspace
  // owner's; a user id = that member's own connection (their Gmail, etc.).
  member_user_id: uuid("member_user_id"),
}, (t) => [index("integrations_ws_idx").on(t.workspace_id)]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // Operator Lite: whose plane this task belongs to. NULL = the workspace owner's;
  // a user id = that member's own task slice (their approvals/today/agent output).
  member_user_id: uuid("member_user_id"),
  category: text("category").$type<Category>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  rationale: text("rationale").notNull().default(""),
  status: text("status").$type<TaskStatus>().notNull().default("new"),
  risk_level: text("risk_level").$type<RiskLevel>().notNull().default("low"),
  priority: text("priority").$type<Priority>().notNull().default("medium"),
  due_at: timestamp("due_at", { withTimezone: true }),
  /** When set (+ execution_status "queued"), the task auto-executes at this
   *  instant via the scheduler instead of on the approval click. */
  scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
  /** Project orchestration — set when a task is a materialized project step. */
  project_id: uuid("project_id"),
  project_phase: integer("project_phase"),
  project_step_kind: text("project_step_kind").$type<"deliverable" | "action" | "page">(),
  agent_id: uuid("agent_id"),
  /** When a task was created from a Team meeting's action items (owner/advisor
   *  items route to the owner's board as tasks), the meeting it came from — lets
   *  the Meetings view roll up every task created from a meeting, not just the
   *  teammate assignments. Teammate items link via team_assignments.ref_id. */
  source_meeting_id: uuid("source_meeting_id"),
  created_by_type: text("created_by_type").$type<CreatedByType>().notNull().default("agent"),
  requires_approval: boolean("requires_approval").notNull().default(true),
  approval_status: text("approval_status").$type<ApprovalStatus>().notNull().default("pending"),
  execution_status: text("execution_status").$type<ExecutionStatus>().notNull().default("none"),
  affected_systems: text("affected_systems").array().notNull().default([]),
  proposed_actions: integer("proposed_actions").notNull().default(0),
  impact_score: integer("impact_score").notNull().default(30),
  /** Archived tasks are hidden from the board (kept for history) — used to clear
   *  out done/handled tasks so columns don't pile up. */
  archived: boolean("archived").notNull().default(false),
  /** Executive triage output (null until "Plan my day" runs): the group label a
   *  task was batched into, its rank in the plan, and a human-readable suggested
   *  time block (guidance only — never auto-executes). */
  plan_group: text("plan_group"),
  plan_rank: integer("plan_rank"),
  suggested_time: text("suggested_time"),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [
  index("tasks_ws_created_idx").on(t.workspace_id, t.created_at),
  index("tasks_ws_status_idx").on(t.workspace_id, t.status),
  index("tasks_ws_project_idx").on(t.workspace_id, t.project_id),
  index("tasks_ws_meeting_idx").on(t.workspace_id, t.source_meeting_id),
]);

/**
 * The latest Executive triage of the Approval Center — an ordered, grouped plan
 * of action over the open tasks. One current plan per workspace (latest by date).
 */
export const taskPlans = pgTable(
  "task_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    summary: text("summary").notNull().default(""),
    groups: jsonb("groups")
      .$type<{ name: string; note: string; priority: string; task_ids: string[] }[]>()
      .notNull()
      .default([]),
    task_count: integer("task_count").notNull().default(0),
    created_at: createdAt,
  },
  (t) => [index("task_plans_ws_idx").on(t.workspace_id, t.created_at)],
);

export const taskAssets = pgTable("task_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  task_id: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  asset_type: text("asset_type").$type<AssetType>().notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  metadata: jsonb("metadata").$type<Record<string, string | number>>(),
}, (t) => [index("task_assets_task_idx").on(t.task_id)]);

export const approvalDecisions = pgTable("approval_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  task_id: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  decided_by: text("decided_by").notNull(),
  decision_type: text("decision_type").$type<DecisionType>().notNull(),
  comment: text("comment"),
  created_at: createdAt,
}, (t) => [index("approval_decisions_task_idx").on(t.task_id)]);

export const executionRuns = pgTable("execution_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  task_id: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  started_at: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  status: text("status").$type<ExecutionStatus>().notNull().default("executing"),
  error_message: text("error_message"),
  affected_systems: text("affected_systems").array().notNull().default([]),
  result_summary: text("result_summary"),
  steps: jsonb("steps").$type<ExecutionStep[]>().notNull().default([]),
}, (t) => [index("execution_runs_task_idx").on(t.task_id)]);

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  task_id: uuid("task_id"),
  event_type: text("event_type").$type<EventType>().notNull(),
  actor_type: text("actor_type").$type<"agent" | "human" | "system">().notNull(),
  actor_id: text("actor_id").notNull(),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").$type<Record<string, string | number>>(),
  created_at: createdAt,
}, (t) => [index("activity_events_ws_created_idx").on(t.workspace_id, t.created_at)]);

/** Which Gmail messages have already been triaged (per workspace), so repeat
 *  and background runs skip seen mail and process only genuinely new email. */
export const triagedEmails = pgTable(
  "triaged_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    gmail_message_id: text("gmail_message_id").notNull(),
    created_at: createdAt,
  },
  (t) => [uniqueIndex("triaged_emails_ws_msg_uniq").on(t.workspace_id, t.gmail_message_id)],
);

/**
 * Email Manager — one row per inbox message the Admin agent has triaged. Backs the
 * Email Manager page (render the agent's read + editable draft without re-triaging)
 * AND serves as the dedup set so repeat/background runs skip mail already processed.
 * Cascades with the workspace.
 */
export const emailTriage = pgTable(
  "email_triage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    gmail_message_id: text("gmail_message_id").notNull(),
    thread_id: text("thread_id").notNull().default(""),
    // RFC 5322 Message-ID of the source email — used to thread the reply.
    source_message_id: text("source_message_id").notNull().default(""),
    from_name: text("from_name").notNull().default(""),
    from_email: text("from_email").notNull().default(""),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    // Triage classification (see lib/ai/triage.ts).
    category: text("category").notNull().default(""),
    urgency: text("urgency").notNull().default(""),
    action_type: text("action_type").notNull().default(""),
    summary: text("summary").notNull().default(""),
    // Editable drafted reply; empty when no reply was warranted.
    draft_reply: text("draft_reply").notNull().default(""),
    // Lifecycle: triaged | sent | archived | trashed.
    status: text("status").notNull().default("triaged"),
    // Operator Lite: whose inbox this belongs to. NULL = owner's; a user id = that
    // member's own triaged mail (from their own connected mailbox).
    member_user_id: uuid("member_user_id"),
    triaged_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [
    uniqueIndex("email_triage_ws_msg_uniq").on(t.workspace_id, t.gmail_message_id),
    index("email_triage_ws_triaged_idx").on(t.workspace_id, t.triaged_at),
  ],
);

/**
 * Outbound Email Composer — the AI-drafted, human-approved OUTBOUND emails from
 * a short natural-language intent ("email Jane for a follow-up"). Distinct from
 * inbound `email_triage`: no source message, and a resolved recipient the user
 * confirms before send. One explicit human click sends each; nothing auto-fires.
 */
export const outboundDrafts = pgTable(
  "outbound_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // The founder's one-line ask.
    intent: text("intent").notNull().default(""),
    // Who the agent thinks this is for + the resolved address (editable by the user).
    recipient_name: text("recipient_name").notNull().default(""),
    to_email: text("to_email").notNull().default(""),
    // How the address was found: explicit | hubspot | gmail | manual | none.
    recipient_source: text("recipient_source").notNull().default("none"),
    // Other addresses the resolver found for this name (the user can pick among them).
    candidates: jsonb("candidates").$type<RecipientCandidate[]>(),
    // Optional cc / bcc (comma-separated addresses).
    cc: text("cc").notNull().default(""),
    bcc: text("bcc").notNull().default(""),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    // Files attached to the email (stored in Supabase Storage; included on send).
    attachments: jsonb("attachments")
      .$type<{ id: string; name: string; path: string; mime: string; size: number }[]>()
      .notNull()
      .default([]),
    // Operator Lite: whose outbox this belongs to. NULL = owner's; a user id = that
    // member's own drafted mail (sent from their own connected mailbox).
    member_user_id: uuid("member_user_id"),
    // Lifecycle: draft | sending | sent | failed.
    status: text("status").notNull().default("draft"),
    error: text("error").notNull().default(""),
    // When set (and in the future), the cron scheduler sends it at this time.
    scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
    created_at: createdAt,
    updated_at: updatedAt,
    sent_at: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbound_drafts_ws_idx").on(t.workspace_id, t.status)],
);

/**
 * Operator Lite: per-member email settings (signature, reply style, auto-triage
 * cadence). The OWNER's live on the business brief; each team member gets their own
 * row here so their inbox/outbound is personalized in their OWN voice. `last_run_at`
 * lets the cron sweep a member's own auto-triage cadence independently.
 */
export const emailSettings = pgTable(
  "email_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    member_user_id: uuid("member_user_id").notNull(),
    signature: text("signature").notNull().default(""),
    reply_style: text("reply_style").notNull().default(""),
    // off | hourly | daily
    cadence: text("cadence").notNull().default("off"),
    last_run_at: timestamp("last_run_at", { withTimezone: true }),
    updated_at: updatedAt,
  },
  (t) => [uniqueIndex("email_settings_ws_member_uniq").on(t.workspace_id, t.member_user_id)],
);

/**
 * The Boardroom — a standing board of specialized AI advisors (a domain lens per
 * seat, modeled after blue-chip VC wisdom) whose mandate is to drive the company
 * to a $10B valuation, fast, biased to action. Members deliberate + debate; the
 * Chair delivers a verdict. Distinct from the worker `agents` and the Executive.
 */
export const boardMembers = pgTable(
  "board_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // finance | marketing | product | strategy | technology | chair | custom.
    role: text("role").notNull().default("custom"),
    name: text("name").notNull().default(""),
    // The seat's persona / VC lens / directives.
    mandate: text("mandate").notNull().default(""),
    emoji: text("emoji").notNull().default("🧑‍⚖️"),
    accent: text("accent").notNull().default("slate"),
    seat: integer("seat").notNull().default(0),
    active: boolean("active").notNull().default(true),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("board_members_ws_idx").on(t.workspace_id)],
);

export const boardSessions = pgTable(
  "board_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    // user | assessment | research (what convened the board).
    trigger: text("trigger").notNull().default("user"),
    // opening_pending | rebuttal_pending | verdict_pending | complete | failed.
    status: text("status").notNull().default("opening_pending"),
    // Assembled company + market context, reused across the deliberation steps.
    context: text("context").notNull().default(""),
    // The founder's response to the debate, captured before the board rules.
    founder_input: text("founder_input").notNull().default(""),
    // The Chair's synthesis.
    verdict: text("verdict").notNull().default(""),
    disagreements: jsonb("disagreements").$type<string[]>(),
    recommendations: jsonb("recommendations").$type<BoardRecommendation[]>(),
    accountability: text("accountability").notNull().default(""),
    // The project spawned when the verdict was handed to the Executive.
    project_id: uuid("project_id"),
    error: text("error").notNull().default(""),
    created_at: createdAt,
    completed_at: timestamp("completed_at", { withTimezone: true }),
    // The founder accepted the verdict as final — locks it + enables the handoff.
    // Null while the founder is still discussing/correcting it with the board.
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [index("board_sessions_ws_idx").on(t.workspace_id, t.created_at)],
);

export const boardContributions = pgTable(
  "board_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => boardSessions.id, { onDelete: "cascade" }),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Member snapshot (kept on the row so edits/deletes don't rewrite history).
    member_id: uuid("member_id"),
    member_name: text("member_name").notNull().default(""),
    member_role: text("member_role").notNull().default("custom"),
    member_emoji: text("member_emoji").notNull().default(""),
    // opening | rebuttal | verdict.
    round: text("round").notNull().default("opening"),
    content: text("content").notNull().default(""),
    seq: integer("seq").notNull().default(0),
    created_at: createdAt,
  },
  (t) => [index("board_contributions_session_idx").on(t.session_id)],
);

/**
 * Post-verdict discussion on a deliberation: the founder pushes back, asks a
 * question, or corrects a mistake, and the Chair responds — and may revise the
 * verdict — until the founder accepts it. Distinct from the pre-verdict
 * `founder_input` pause and from the per-member `board_contributions` transcript.
 */
export const boardDiscussion = pgTable(
  "board_discussion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => boardSessions.id, { onDelete: "cascade" }),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // founder | board
    role: text("role").notNull().default("founder"),
    author: text("author").notNull().default(""),
    content: text("content").notNull().default(""),
    // A board turn that revised the verdict (vs. one that held its position).
    revised: boolean("revised").notNull().default(false),
    seq: integer("seq").notNull().default(0),
    created_at: createdAt,
  },
  (t) => [index("board_discussion_session_idx").on(t.session_id, t.seq)],
);

/** An unprompted finding the board raised during an autonomous research scan. */
export const boardAlerts = pgTable(
  "board_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    member_id: uuid("member_id"),
    member_name: text("member_name").notNull().default(""),
    member_role: text("member_role").notNull().default("custom"),
    member_emoji: text("member_emoji").notNull().default(""),
    // info | attention | urgent.
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull().default(""),
    detail: text("detail").notNull().default(""),
    suggested_action: text("suggested_action").notNull().default(""),
    // new | read | dismissed | actioned.
    status: text("status").notNull().default("new"),
    created_at: createdAt,
    read_at: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("board_alerts_ws_idx").on(t.workspace_id, t.status)],
);

/** Per-workspace autonomous-scan settings (cadence + last run). */
export const boardSettings = pgTable(
  "board_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // off | daily | weekly.
    cadence: text("cadence").notNull().default("daily"),
    // The board's mission/goal ("" = use the default $10B goal).
    mission: text("mission").notNull().default(""),
    last_scan_at: timestamp("last_scan_at", { withTimezone: true }),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [uniqueIndex("board_settings_ws_uniq").on(t.workspace_id)],
);

/** A commitment the board is tracking — a recommendation the founder put into
 *  motion — so the board can follow up on what actually got done (accountability). */
export const boardDirectives = pgTable(
  "board_directives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Survives deletion of the deliberation it came from.
    session_id: uuid("session_id").references(() => boardSessions.id, { onDelete: "set null" }),
    title: text("title").notNull().default(""),
    detail: text("detail").notNull().default(""),
    // open | in_motion | done | dropped.
    status: text("status").notNull().default("open"),
    project_id: uuid("project_id"),
    created_at: createdAt,
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("board_directives_ws_idx").on(t.workspace_id, t.status)],
);

/**
 * Ads Manager — the Growth agent turns an objective into launch-ready ad packages
 * per platform (Meta / Google / X / LinkedIn). P0 is a campaign studio: creative +
 * targeting + budget, no external ad-platform APIs yet (direct placement is later).
 */
export const adCampaigns = pgTable(
  "ad_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    objective: text("objective").notNull().default(""),
    audience: text("audience").notNull().default(""),
    daily_budget_cents: integer("daily_budget_cents").notNull().default(0),
    // Where ad clicks should land; UTM tags are derived from it per platform.
    destination_url: text("destination_url").notNull().default(""),
    // draft | launched (any creative marked live). Later: pending_approval | live | paused.
    status: text("status").notNull().default("draft"),
    created_at: createdAt,
  },
  (t) => [index("ad_campaigns_ws_idx").on(t.workspace_id, t.created_at)],
);

export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaign_id: uuid("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // meta | google | x | linkedin.
    platform: text("platform").notNull().default("meta"),
    format: text("format").notNull().default(""),
    headline: text("headline").notNull().default(""),
    primary_text: text("primary_text").notNull().default(""),
    description: text("description").notNull().default(""),
    cta: text("cta").notNull().default(""),
    keywords: jsonb("keywords").$type<string[]>(),
    audience: text("audience").notNull().default(""),
    geo: text("geo").notNull().default(""),
    image_url: text("image_url").notNull().default(""),
    image_alt: text("image_alt").notNull().default(""),
    // draft | launched — tracked per platform so the founder knows what's live.
    status: text("status").notNull().default("draft"),
    // Founder's own reference for where it went live (e.g. the platform's campaign id).
    placement_ref: text("placement_ref").notNull().default(""),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("ad_creatives_campaign_idx").on(t.campaign_id)],
);

/**
 * One row per attempt to place a creative on an external ad platform (X first).
 * Tracks the platform-side ids + status so campaigns are monitored in one spot.
 * status: planned (dry-run, nothing sent) | paused (created on-platform, $0 spend)
 *        | active (live, spending) | failed. Nothing here ever spends until a human
 * explicitly activates a paused placement.
 */
export const adPlacements = pgTable(
  "ad_placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    creative_id: uuid("creative_id")
      .notNull()
      .references(() => adCreatives.id, { onDelete: "cascade" }),
    campaign_id: uuid("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("x"),
    // planned | paused | active | failed.
    status: text("status").notNull().default("planned"),
    external_campaign_id: text("external_campaign_id").notNull().default(""),
    external_line_item_id: text("external_line_item_id").notNull().default(""),
    external_tweet_id: text("external_tweet_id").notNull().default(""),
    // Human-readable note: dry-run reason, error, or last sync detail.
    detail: text("detail").notNull().default(""),
    spend_cents: integer("spend_cents").notNull().default(0),
    last_synced_at: timestamp("last_synced_at", { withTimezone: true }),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [
    index("ad_placements_ws_idx").on(t.workspace_id, t.created_at),
    index("ad_placements_creative_idx").on(t.creative_id),
  ],
);

/**
 * Team Room — a person on the owner's team. Shares the workspace so the Executive
 * and Boardroom can reason about them in business context. `user_id` is bound when
 * the member accepts an invite + signs up (Slice 2); null = profile-only for now.
 * status: active | inactive | invited (invited reserved for the login flow).
 */
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    user_id: uuid("user_id"),
    name: text("name").notNull().default(""),
    email: text("email").notNull().default(""),
    role_title: text("role_title").notNull().default(""),
    // What they do — read by the Executive/Boardroom as team context.
    description: text("description").notNull().default(""),
    skills: text("skills").array().notNull().default([]),
    // Stored as text (MM-DD or YYYY-MM-DD) to avoid timezone drift on a date-only value.
    birthday: text("birthday").notNull().default(""),
    start_date: text("start_date").notNull().default(""),
    timezone: text("timezone").notNull().default(""),
    emoji: text("emoji").notNull().default(""),
    accent: text("accent").notNull().default("indigo"),
    status: text("status").notNull().default("active"),
    // Phase 1 org hierarchy: in-team rank + who they report to. manager_id points
    // to another team_members.id (no DB FK — app enforces validity); null = reports
    // to the owner. Both sit INSIDE the "member" access tier — the owner/member wall
    // in workspace_members is unchanged.
    team_role: text("team_role").$type<"manager" | "contributor">().notNull().default("contributor"),
    manager_id: uuid("manager_id"),
    // Roster kind: an operational "teammate" (day-to-day, in the org hierarchy) or an
    // "advisor" (strategic network — advice, intros, startup-level tasks; not daily ops).
    member_type: text("member_type").$type<"teammate" | "advisor">().notNull().default("teammate"),
    // Operator Lite: which app pages this member can access (route keys, e.g. "/email").
    // Empty = the member defaults (see lib/access/pages.ts). Owner-set.
    page_access: text("page_access").array().notNull().default([]),
    // The workspace owner's own roster entry (their profile + assignable self). One
    // per workspace, auto-created; can't be removed. The owner/member wall in
    // workspace_members is unchanged — this is just a roster/profile representation.
    is_owner: boolean("is_owner").notNull().default(false),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [
    index("team_members_ws_idx").on(t.workspace_id),
    index("team_members_ws_user_idx").on(t.workspace_id, t.user_id),
  ],
);

/**
 * Team Room — a handoff of work to a team member. Optionally links to an existing
 * project/task/note (ref_type + ref_id); null ref = a standalone handoff created in
 * the Team room. status: assigned | in_progress | blocked | done.
 */
export const teamAssignments = pgTable(
  "team_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    member_id: uuid("member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
    // project | task | note | null (standalone).
    ref_type: text("ref_type"),
    ref_id: uuid("ref_id"),
    title: text("title").notNull().default(""),
    handoff_note: text("handoff_note").notNull().default(""),
    status: text("status").notNull().default("assigned"),
    deadline: timestamp("deadline", { withTimezone: true }),
    // Phase 2: optional link to a human_projects container (null = standalone) and
    // who delegated it (a manager's member id; null = owner-created).
    project_id: uuid("project_id"),
    created_by_member_id: uuid("created_by_member_id"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [
    index("team_assignments_ws_idx").on(t.workspace_id, t.created_at),
    index("team_assignments_member_idx").on(t.member_id),
  ],
);

/**
 * Team Room Phase 2 — a human-owned project (the team plane). Either created in
 * the app (source "manual") or projected from an AI project through the sanitized
 * handoff gate (source "ai_handoff", carrying only title/summary/deadline — never
 * the AI project's plan, rationale, or agent context). lead/manager point to
 * team_members (app-enforced, no DB FK); null lead = owner-led.
 */
export const humanProjects = pgTable(
  "human_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    summary: text("summary").notNull().default(""),
    status: text("status").$type<"active" | "on_hold" | "done">().notNull().default("active"),
    deadline: timestamp("deadline", { withTimezone: true }),
    lead_member_id: uuid("lead_member_id"),
    manager_member_id: uuid("manager_member_id"),
    source: text("source").$type<"manual" | "ai_handoff">().notNull().default("manual"),
    source_project_id: uuid("source_project_id"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("human_projects_ws_idx").on(t.workspace_id, t.created_at)],
);

/**
 * Team Room Phase 3 — a team goal (team plane). Horizon week/month/quarter;
 * scope "team" (whole team) or "individual" (member_id, app-enforced, no DB FK).
 * Owner sets any; a manager sets team goals + goals for their direct reports.
 */
export const teamGoals = pgTable(
  "team_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    detail: text("detail").notNull().default(""),
    horizon: text("horizon").$type<"week" | "month" | "quarter">().notNull().default("month"),
    scope: text("scope").$type<"team" | "individual">().notNull().default("team"),
    // Legacy single assignee (pre-refinement); member_ids is the source of truth now.
    member_id: uuid("member_id"),
    member_ids: uuid("member_ids").array().notNull().default([]),
    status: text("status").$type<"active" | "done">().notNull().default("active"),
    created_by_member_id: uuid("created_by_member_id"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("team_goals_ws_idx").on(t.workspace_id)],
);

/** Team Room Phase 4 — a shared team document: a link or an inline note the whole
 *  team can see. created_by_name is denormalized (the owner has no team_members row). */
export const teamDocuments = pgTable(
  "team_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    kind: text("kind").$type<"link" | "note">().notNull().default("link"),
    url: text("url").notNull().default(""),
    content: text("content").notNull().default(""),
    created_by_member_id: uuid("created_by_member_id"),
    created_by_name: text("created_by_name").notNull().default(""),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("team_documents_ws_idx").on(t.workspace_id, t.created_at)],
);

/** Team Room Phase 5 — an in-platform chat channel (owner + all team members). */
export const chatChannels = pgTable(
  "chat_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    created_by_member_id: uuid("created_by_member_id"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("chat_channels_ws_idx").on(t.workspace_id, t.created_at)],
);

/** Team Room Phase 5 — a chat message. sender_name is denormalized for display. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel_id: uuid("channel_id").notNull(),
    sender_user_id: uuid("sender_user_id"),
    sender_member_id: uuid("sender_member_id"),
    sender_name: text("sender_name").notNull().default(""),
    body: text("body").notNull().default(""),
    created_at: createdAt,
  },
  (t) => [index("chat_messages_channel_idx").on(t.workspace_id, t.channel_id, t.created_at)],
);

/** Team Room Phase 6 — a message in a member's private Team Assistant conversation
 *  (per member, keyed by user_id). The assistant runs on Haiku, scoped to team data. */
export const teamAssistantMessages = pgTable(
  "team_assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull().default("user"),
    content: text("content").notNull().default(""),
    created_at: createdAt,
  },
  (t) => [index("team_assistant_msgs_idx").on(t.workspace_id, t.user_id, t.created_at)],
);

/** Per-user, per-channel read marker — powers chat unread badges. */
export const chatReads = pgTable(
  "chat_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    channel_id: uuid("channel_id").notNull(),
    last_read_at: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_reads_idx").on(t.workspace_id, t.user_id, t.channel_id)],
);

/** Team calendar — recurring meetings, 1:1s (member_id), and one-off events. */
export const teamEvents = pgTable(
  "team_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    detail: text("detail").notNull().default(""),
    kind: text("kind").$type<"meeting" | "one_on_one" | "event">().notNull().default("meeting"),
    starts_at: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    // Recurrence rule keyword: "" | none | daily | weekly | biweekly | monthly.
    recurrence: text("recurrence").notNull().default(""),
    // How long the event runs, in minutes — drives the block height in the grid.
    duration_minutes: integer("duration_minutes").notNull().default(60),
    // When a recurring event stops repeating (null = one-off or no end).
    recurrence_until: timestamp("recurrence_until", { withTimezone: true }),
    // Legacy single attendee (1:1 "with"); attendee_ids is the source of truth now.
    member_id: uuid("member_id"),
    // Meeting attendees — team_members ids (app-enforced, no DB FK).
    attendee_ids: uuid("attendee_ids").array().notNull().default([]),
    // Whole-team event (all-hands): attendees resolve to every member at read time.
    all_team: boolean("all_team").notNull().default(false),
    created_by_member_id: uuid("created_by_member_id"),
    // Two-way Google Calendar: the linked Google event id (null = not synced to Google).
    google_event_id: text("google_event_id"),
    // Video/meeting join link (Zoom auto-created, or a manually pasted link).
    meeting_link: text("meeting_link").notNull().default(""),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("team_events_ws_idx").on(t.workspace_id, t.starts_at)],
);

/** A notification for a team member (e.g. "you were added to a meeting"). Shown in
 *  the member portal; Slack/email are sent separately at creation, best-effort. */
export const teamNotifications = pgTable(
  "team_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Recipient team_member (app-enforced, no DB FK).
    member_id: uuid("member_id").notNull(),
    kind: text("kind").notNull().default("info"),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    ref_type: text("ref_type"),
    ref_id: uuid("ref_id"),
    read_at: timestamp("read_at", { withTimezone: true }),
    created_at: createdAt,
  },
  (t) => [index("team_notifications_member_idx").on(t.workspace_id, t.member_id, t.created_at)],
);

/** A meeting record — notes now; action-items → tasks come in a later pass. */
export const teamMeetings = pgTable(
  "team_meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    meeting_date: timestamp("meeting_date", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes").notNull().default(""),
    attendee_ids: uuid("attendee_ids").array().notNull().default([]),
    created_by_member_id: uuid("created_by_member_id"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("team_meetings_ws_idx").on(t.workspace_id, t.meeting_date)],
);

/** Small key/value settings for the team plane (e.g. the shared Google Drive folder). */
export const teamSettings = pgTable(
  "team_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
    updated_at: updatedAt,
  },
  (t) => [index("team_settings_ws_idx").on(t.workspace_id, t.key)],
);

/**
 * Team Room — a pending invitation for someone to join the workspace as a member.
 * The owner enters their profile + email; a Supabase invite email is sent; on
 * accept, a workspace_members row (role=member) is created + team_members.user_id
 * is bound. status: pending | accepted | revoked.
 */
export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    member_id: uuid("member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"),
    invited_by: uuid("invited_by"),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    created_at: createdAt,
  },
  (t) => [index("team_invites_ws_idx").on(t.workspace_id), uniqueIndex("team_invites_token_uniq").on(t.token)],
);

/**
 * One row per Claude (Anthropic) API call — the AI usage meter. Records the token
 * usage returned by every response, attributed to a workspace (null = a call made
 * outside any workspace context). Powers the operator usage report (which workspaces
 * cost the most in AI). workspace_id is nullable so nothing is ever dropped; cascades
 * when a workspace is deleted.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    // What the call was for (e.g. "email-triage", "agent-task", "executive-chat").
    operation: text("operation").notNull().default(""),
    model: text("model").notNull().default(""),
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    created_at: createdAt,
  },
  (t) => [index("ai_usage_ws_created_idx").on(t.workspace_id, t.created_at)],
);

/**
 * Command Center — the user's own goals workspace (monthly/weekly/daily/parking grid
 * + year/future/moonshot horizons). One free-form JSON doc per workspace; the user
 * authors it, agents never auto-populate it. Cascades with the workspace.
 */
export const commandCenter = pgTable(
  "command_center",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Operator Lite: whose goals doc this is. NULL = owner's; a user id = that
    // member's own Command Center. One doc per (workspace, plane).
    member_user_id: uuid("member_user_id"),
    doc: jsonb("doc").$type<CommandCenterDoc>().notNull(),
    updated_at: updatedAt,
  },
  (t) => [
    // The owner's single doc (partial unique on the NULL plane).
    uniqueIndex("command_center_ws_uniq").on(t.workspace_id).where(sql`${t.member_user_id} IS NULL`),
    // One doc per member.
    uniqueIndex("command_center_ws_member_uniq")
      .on(t.workspace_id, t.member_user_id)
      .where(sql`${t.member_user_id} IS NOT NULL`),
  ],
);

/** Notion refs already triaged — page-version markers + per-item hashes — so
 *  re-runs skip unchanged pages and never re-create the same action item. */
export const triagedNotion = pgTable(
  "triaged_notion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    created_at: createdAt,
  },
  (t) => [uniqueIndex("triaged_notion_ws_ref_uniq").on(t.workspace_id, t.ref)],
);

/** CRM Radar dedup — one row per HubSpot signal (e.g. "deal:123:stale",
 *  "contact:456:new") already turned into a task, so sweeps never re-surface it. */
export const triagedCrm = pgTable(
  "triaged_crm",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    created_at: createdAt,
  },
  (t) => [uniqueIndex("triaged_crm_ws_ref_uniq").on(t.workspace_id, t.ref)],
);

/** Images attached to a post/task. Binaries live in Supabase Storage; this row
 *  holds the metadata + a public URL. Server-authoritative. */
export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  task_id: uuid("task_id"),
  source: text("source").$type<"upload" | "stock" | "ai">().notNull().default("upload"),
  storage_path: text("storage_path").notNull(),
  public_url: text("public_url").notNull().default(""),
  mime_type: text("mime_type").notNull().default("image/jpeg"),
  alt_text: text("alt_text").notNull().default(""),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  byte_size: integer("byte_size").notNull().default(0),
  /** Attribution string for stock images (e.g. "Photo by … on Pexels"). */
  attribution: text("attribution"),
  created_at: createdAt,
});

/** Agent-authored documents/deliverables shown in the file manager. Durable and
 *  server-authoritative — never part of the client bundle save. */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agent_id: uuid("agent_id"),
  author_name: text("author_name").notNull().default(""),
  task_id: uuid("task_id"),
  task_title: text("task_title").notNull().default(""),
  name: text("name").notNull(),
  content: text("content").notNull().default(""),
  folder: text("folder").notNull().default(""),
  doc_type: text("doc_type").$type<AssetType>().notNull().default("document"),
  /** Set once the document has been exported to Notion. */
  notion_url: text("notion_url"),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [index("documents_ws_created_idx").on(t.workspace_id, t.created_at)]);

/** Freeform notes the user jots down. A note can be handed to the Executive,
 *  which proposes a project or tasks from it; `status` flips to "actioned" and
 *  `spawned_project_id` links to what it created (tasks link back via note_id). */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // Operator Lite: whose notes these are. NULL = owner's; a user id = that member's.
  member_user_id: uuid("member_user_id"),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  /** "draft" until handed to the Executive and approved → "actioned". */
  status: text("status").notNull().default("draft"),
  spawned_project_id: uuid("spawned_project_id"),
  spawned_task_count: integer("spawned_task_count").notNull().default(0),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [index("notes_ws_updated_idx").on(t.workspace_id, t.updated_at)]);

/** A multi-step project a leadership agent (Manager/Executive) plans and runs:
 *  a goal decomposed into a phased plan whose steps become tasks over time. */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  goal: text("goal").notNull(),
  title: text("title").notNull().default(""),
  summary: text("summary").notNull().default(""),
  status: text("status").$type<ProjectStatus>().notNull().default("planning"),
  owner_kind: text("owner_kind").$type<"manager" | "executive">().notNull().default("manager"),
  owner_agent_id: uuid("owner_agent_id"),
  /** null (standard project) | "growth" (a follower-growth campaign). */
  kind: text("kind"),
  /** The phased blueprint the leadership agent authored (steps → tasks). */
  plan: jsonb("plan").$type<ProjectPlan>().notNull().default({ phases: [] }),
  /** 0-based index of the phase currently being worked. */
  current_phase: integer("current_phase").notNull().default(0),
  created_by_type: text("created_by_type").$type<"agent" | "human">().notNull().default("human"),
  // Team Room: the full project can be assigned to a team member — it then shows
  // in their portal, where they approve its deliverables (scoped to assignment).
  // These point to team_members (app-enforced, no DB FK); null = owner-run.
  assigned_member_id: uuid("assigned_member_id"),
  assigned_manager_id: uuid("assigned_manager_id"),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [
  index("projects_ws_created_idx").on(t.workspace_id, t.created_at),
  index("projects_ws_status_idx").on(t.workspace_id, t.status),
]);

/** Follower-count snapshots for a growth campaign — the progress trend vs goal. */
export const followerSnapshots = pgTable("follower_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  project_id: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  followers: integer("followers").notNull().default(0),
  created_at: createdAt,
}, (t) => [index("follower_snapshots_ws_created_idx").on(t.workspace_id, t.created_at)]);

/** A sellable offer — what a buy button charges for (Stripe price = price_cents). */
export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  price_cents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [index("products_ws_created_idx").on(t.workspace_id, t.created_at)]);

/** A generated page with a buy button — landing / product / blog. Hosted in-app
 *  at /p/[slug]; the atomic unit of the Builder growth loop. */
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    project_id: uuid("project_id"),
    product_id: uuid("product_id"),
    slug: text("slug").notNull(),
    title: text("title").notNull().default(""),
    status: text("status").$type<PageStatus>().notNull().default("draft"),
    page_type: text("page_type").$type<PageType>().notNull().default("landing"),
    content: jsonb("content")
      .$type<PageContent>()
      .notNull()
      .default({ headline: "", subheadline: "", cta_label: "Buy now", sections: [] }),
    created_by_type: text("created_by_type").$type<"agent" | "human">().notNull().default("human"),
    agent_id: uuid("agent_id"),
    /** When set (+ status "draft"), the publish cron flips the page to published
     *  at this instant — scheduled blog releases. */
    publish_at: timestamp("publish_at", { withTimezone: true }),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [uniqueIndex("pages_slug_uniq").on(t.slug)],
);

/** The content engine's longform master — one canonical markdown draft that gets
 *  boosted, packaged, and distributed to many channels (see post_channels). */
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  project_id: uuid("project_id"),
  title: text("title").notNull().default(""),
  dek: text("dek").notNull().default(""),
  body_md: text("body_md").notNull().default(""),
  hero_image_url: text("hero_image_url"),
  status: text("status").$type<PostStatus>().notNull().default("draft"),
  boosted: boolean("boosted").notNull().default(false),
  created_by_type: text("created_by_type").$type<"agent" | "human">().notNull().default("human"),
  agent_id: uuid("agent_id"),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [index("posts_ws_created_idx").on(t.workspace_id, t.created_at)]);

/** A packaged variant of a post for one destination + its distribution status. */
export const postChannels = pgTable("post_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  post_id: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  channel: text("channel").$type<ChannelKind>().notNull(),
  status: text("status").$type<ChannelStatus>().notNull().default("packaged"),
  variant: jsonb("variant").$type<PackagedVariant>().notNull().default({}),
  /** The page_id or task_id this channel created downstream, if any. */
  ref_id: uuid("ref_id"),
  url: text("url"),
  scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [index("post_channels_ws_post_idx").on(t.workspace_id, t.post_id)]);

/** Accounts the owner watches for reply opportunities — the "reply radar" watchlist. */
export const xTargets = pgTable(
  "x_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Normalized @handle, stored without the leading @. */
    handle: text("handle").notNull(),
    /** Resolved X user id (best-effort; null until first lookup succeeds). */
    x_user_id: text("x_user_id"),
    note: text("note").notNull().default(""),
    active: boolean("active").notNull().default(true),
    last_checked_at: timestamp("last_checked_at", { withTimezone: true }),
    /** Newest tweet id seen last check — used as since_id for incremental pulls. */
    last_seen_tweet_id: text("last_seen_tweet_id"),
    created_at: createdAt,
  },
  (t) => [uniqueIndex("x_targets_ws_handle_uniq").on(t.workspace_id, t.handle)],
);

/** A scored reply opportunity surfaced by the radar (someone else's tweet worth
 *  replying to), with pre-drafted reply options for the owner to review. */
export const replyOpportunities = pgTable(
  "reply_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    target_id: uuid("target_id").references(() => xTargets.id, { onDelete: "cascade" }),
    tweet_id: text("tweet_id").notNull(),
    tweet_url: text("tweet_url").notNull().default(""),
    author_handle: text("author_handle").notNull().default(""),
    tweet_text: text("tweet_text").notNull().default(""),
    score: integer("score").notNull().default(0),
    reason: text("reason").notNull().default(""),
    suggested_replies: jsonb("suggested_replies")
      .$type<{ reply: string; note: string }[]>()
      .notNull()
      .default([]),
    status: text("status").$type<"new" | "dismissed" | "replied">().notNull().default("new"),
    reply_url: text("reply_url"),
    created_at: createdAt,
  },
  (t) => [uniqueIndex("reply_opps_ws_tweet_uniq").on(t.workspace_id, t.tweet_id)],
);

/** A checkout attempt / sale against a product (via Stripe Checkout). */
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  page_id: uuid("page_id"),
  product_id: uuid("product_id"),
  stripe_session_id: text("stripe_session_id"),
  status: text("status").$type<"pending" | "paid" | "failed">().notNull().default("pending"),
  amount_cents: integer("amount_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  customer_email: text("customer_email"),
  created_at: createdAt,
}, (t) => [index("orders_ws_created_idx").on(t.workspace_id, t.created_at)]);

/* ------------------------------ talent / hiring -------------------------- */

/** A job opening. Hosted publicly at /jobs/[slug] while status = "open"; the
 *  owner's applicant pipeline hangs off it. */
export const jobPosts = pgTable(
  "job_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    location: text("location").notNull().default(""),
    employment_type: text("employment_type").$type<EmploymentType>().notNull().default("full_time"),
    // Stores MARKDOWN (rendered to safe HTML via markdownToHtml on the public page).
    // Physical column is "description_html" (from migration 0070); the JS key is the
    // honest "description_md" — Drizzle maps the two.
    description_md: text("description_html").notNull().default(""),
    // Compensation (integer cents; salary = annual, hourly = per-hour).
    pay_type: text("pay_type").$type<PayType>().notNull().default("unspecified"),
    pay_min: integer("pay_min"),
    pay_max: integer("pay_max"),
    pay_currency: text("pay_currency").notNull().default("usd"),
    // Standard HR/compliance block (markdown); pre-filled from the workspace default.
    compliance_md: text("compliance_md").notNull().default(""),
    status: text("status").$type<JobStatus>().notNull().default("draft"),
    slug: text("slug").notNull(),
    screening_questions: jsonb("screening_questions")
      .$type<ScreeningQuestion[]>()
      .notNull()
      .default([]),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [
    uniqueIndex("job_posts_slug_uniq").on(t.slug),
    index("job_posts_ws_created_idx").on(t.workspace_id, t.created_at),
  ],
);

/** A person in the talent pool — applied through a public form or sourced by the
 *  owner. One row per (workspace, email); their résumé lives in a private bucket. */
export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone"),
    /** Private-bucket storage path (viewed via a short-lived signed URL). */
    resume_path: text("resume_path"),
    links: text("links").array().notNull().default([]),
    source: text("source").$type<CandidateSource>().notNull().default("applied"),
    created_at: createdAt,
  },
  (t) => [uniqueIndex("candidates_ws_email_uniq").on(t.workspace_id, t.email)],
);

/** A candidate's application to one job — the per-job pipeline row (stage + AI eval). */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => jobPosts.id, { onDelete: "cascade" }),
    candidate_id: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    stage: text("stage").$type<ApplicationStage>().notNull().default("applied"),
    cover_note: text("cover_note").notNull().default(""),
    answers: jsonb("answers").$type<{ question: string; answer: string }[]>().notNull().default([]),
    /** AI screening (null until scored): 0-100 fit score, one-line summary, a
     *  recommend-for-interview flag, and structured strengths/concerns. */
    ai_score: integer("ai_score"),
    ai_summary: text("ai_summary").notNull().default(""),
    ai_recommend: boolean("ai_recommend"),
    ai_eval: jsonb("ai_eval").$type<ApplicationEval>().notNull().default({ strengths: [], concerns: [] }),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [
    index("applications_ws_job_idx").on(t.workspace_id, t.job_id),
    uniqueIndex("applications_job_candidate_uniq").on(t.job_id, t.candidate_id),
  ],
);

/* --------------------------- quotes / sourcing --------------------------- */

/** A request to source quotes for a product/service. */
export const quoteRequests = pgTable(
  "quote_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    spec: text("spec").notNull().default(""),
    target_count: integer("target_count").notNull().default(3),
    status: text("status").$type<QuoteRequestStatus>().notNull().default("sourcing"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("quote_requests_ws_idx").on(t.workspace_id, t.created_at)],
);

/** A supplier approached for a quote (the per-supplier RFQ + result). */
export const quoteSuppliers = pgTable(
  "quote_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    request_id: uuid("request_id")
      .notNull()
      .references(() => quoteRequests.id, { onDelete: "cascade" }),
    company: text("company").notNull().default(""),
    website: text("website"),
    contact_email: text("contact_email"),
    /** How to reach them for a quote: "email" | "form" | "none", + the form/contact URL. */
    contact_method: text("contact_method").$type<SupplierContactMethod>().notNull().default("none"),
    contact_url: text("contact_url"),
    source: text("source").notNull().default("research"),
    status: text("status").$type<SupplierStatus>().notNull().default("found"),
    /** The Email Manager outbound draft staged for this supplier. */
    outbound_draft_id: uuid("outbound_draft_id"),
    note: text("note").notNull().default(""),
    quote_price: text("quote_price").notNull().default(""),
    quote_lead_time: text("quote_lead_time").notNull().default(""),
    quote_notes: text("quote_notes").notNull().default(""),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("quote_suppliers_ws_request_idx").on(t.workspace_id, t.request_id)],
);

/* -------------------------------- outreach ------------------------------- */

/** An outreach campaign — an idea + the roles to reach, owning a set of contacts. */
export const outreachCampaigns = pgTable(
  "outreach_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    /** Comma-separated decision-maker roles to look for. */
    target_roles: text("target_roles").notNull().default(""),
    target_count: integer("target_count").notNull().default(5),
    /** When true, sourcing auto-spends Hunter credits to find emails; default off. */
    auto_find_emails: boolean("auto_find_emails").notNull().default(false),
    status: text("status").$type<OutreachCampaignStatus>().notNull().default("sourcing"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("outreach_campaigns_ws_idx").on(t.workspace_id, t.created_at)],
);

/** A person approached in a campaign (the per-contact outreach draft + its outcome). */
export const outreachContacts = pgTable(
  "outreach_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaign_id: uuid("campaign_id")
      .notNull()
      .references(() => outreachCampaigns.id, { onDelete: "cascade" }),
    company: text("company").notNull().default(""),
    website: text("website"),
    person_name: text("person_name").notNull().default(""),
    title: text("title").notNull().default(""),
    contact_email: text("contact_email"),
    /** How to reach them: "email" | "profile" | "none", + the profile/contact URL. */
    contact_method: text("contact_method").$type<OutreachContactMethod>().notNull().default("none"),
    contact_url: text("contact_url"),
    source: text("source").notNull().default("research"),
    status: text("status").$type<OutreachStatus>().notNull().default("found"),
    /** The Email Manager outbound draft staged for this contact. */
    outbound_draft_id: uuid("outbound_draft_id"),
    note: text("note").notNull().default(""),
    /** JSON: Hunter result detail {score, status, sources[], found_via, verify_*}. */
    email_meta: text("email_meta"),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("outreach_contacts_ws_campaign_idx").on(t.workspace_id, t.campaign_id)],
);

/* ------------------------------- marketing ------------------------------- */

/** A marketing campaign — an objective + window owning a set of content items. */
export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    objective: text("objective").notNull().default(""),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    starts_at: timestamp("starts_at", { withTimezone: true }),
    ends_at: timestamp("ends_at", { withTimezone: true }),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("marketing_campaigns_ws_idx").on(t.workspace_id, t.created_at)],
);

/** One piece of marketing content on the content calendar — belongs to a
 *  campaign or stands alone. On schedule/publish it materializes into the
 *  existing rails (an X task / a hosted blog page); LinkedIn stays manual
 *  (draft → preview → copy). */
export const marketingItems = pgTable(
  "marketing_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaign_id: uuid("campaign_id").references(() => marketingCampaigns.id, { onDelete: "set null" }),
    channel: text("channel").$type<MarketingChannel>().notNull(),
    title: text("title").notNull().default(""),
    body_md: text("body_md").notNull().default(""),
    image_url: text("image_url"),
    status: text("status").$type<MarketingItemStatus>().notNull().default("drafted"),
    scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
    /** When materialized into a real task/page (X/blog): what it points to. */
    ref_type: text("ref_type").$type<"task" | "page">(),
    ref_id: uuid("ref_id"),
    ref_url: text("ref_url"),
    posted_at: timestamp("posted_at", { withTimezone: true }),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [
    index("marketing_items_ws_sched_idx").on(t.workspace_id, t.scheduled_at),
    index("marketing_items_ws_campaign_idx").on(t.workspace_id, t.campaign_id),
  ],
);

/* ---------------------------- executive office --------------------------- */

/** The conversation with the Executive Agent (Chief of Staff). */
export const executiveMessages = pgTable("executive_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  // The conversation thread this message belongs to (nullable for legacy rows).
  thread_id: uuid("thread_id"),
  role: text("role").$type<ExecRole>().notNull(),
  content: text("content").notNull().default(""),
  /** Tool calls the agent made while producing an assistant turn. */
  actions: jsonb("actions").$type<ExecAction[]>().notNull().default([]),
  /** Archived when the owner starts a new chat — hidden, kept for history. */
  archived: boolean("archived").notNull().default(false),
  created_at: createdAt,
}, (t) => [
  index("executive_messages_ws_archived_idx").on(t.workspace_id, t.archived, t.created_at),
  index("executive_messages_thread_idx").on(t.workspace_id, t.thread_id, t.created_at),
]);

/** A saved conversation thread with the Executive — groups executive_messages so the
 *  founder can return to any past conversation and keep chatting in it. */
export const executiveThreads = pgTable(
  "executive_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    created_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [index("executive_threads_ws_idx").on(t.workspace_id, t.updated_at)],
);

/** Durable things the Executive Agent knows about the business. */
export const executiveMemory = pgTable("executive_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  kind: text("kind").$type<MemoryKind>().notNull().default("fact"),
  source: text("source").$type<"user" | "agent">().notNull().default("agent"),
  pinned: boolean("pinned").notNull().default(false),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [index("executive_memory_ws_idx").on(t.workspace_id, t.pinned, t.created_at)]);

/** A chat message the founder saved to revisit. The Executive can organize + title
 *  these (category), and any one can be promoted into executive_memory. */
export const executiveSavedMessages = pgTable(
  "executive_saved_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // The source chat message (app-enforced; content is copied so it survives archive).
    message_id: uuid("message_id"),
    role: text("role").$type<ExecRole>().notNull().default("assistant"),
    content: text("content").notNull().default(""),
    // Agent-assigned when organizing.
    title: text("title").notNull().default(""),
    category: text("category").notNull().default(""),
    pinned: boolean("pinned").notNull().default(false),
    created_at: createdAt,
  },
  (t) => [index("executive_saved_ws_idx").on(t.workspace_id, t.created_at)],
);

/** A generated monthly investor / stakeholder update (outward-facing). */
// Holds stakeholder updates for every audience (investor / team / advisor);
// the `audience` column discriminates. Table name is historical.
export const investorUpdates = pgTable("investor_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  audience: text("audience").$type<UpdateAudience>().notNull().default("investor"),
  content: jsonb("content")
    .$type<InvestorUpdateContent>()
    .notNull()
    .default({ period: "", tldr: "", highlights: [], metrics: [], lowlights: [], whats_next: [], asks: [], closing: "" }),
  archived: boolean("archived").notNull().default(false),
  created_at: createdAt,
}, (t) => [index("investor_updates_ws_created_idx").on(t.workspace_id, t.created_at)]);

/** A Deep Dive run — ingests company material (docs/text; later email/Notion) and
 *  synthesizes the Company Context Pack. Runnable anytime, not just at onboarding. */
export const deepDives = pgTable("deep_dives", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  status: text("status").$type<DeepDiveStatus>().notNull().default("queued"),
  stage_detail: text("stage_detail").notNull().default(""),
  progress: jsonb("progress").$type<DeepDiveProgress>().notNull().default({ done: 0, total: 0 }),
  usage: jsonb("usage")
    .$type<DeepDiveUsage>()
    .notNull()
    .default({ input_tokens: 0, output_tokens: 0, est_cost_cents: 0, calls: 0 }),
  error: text("error"),
  // Worker lock so overlapping cron ticks never double-process one run.
  worker_locked_at: timestamp("worker_locked_at", { withTimezone: true }),
  started_at: timestamp("started_at", { withTimezone: true }),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  created_at: createdAt,
}, (t) => [index("deep_dives_ws_created_idx").on(t.workspace_id, t.created_at)]);

/** One ingested unit for a Deep Dive. `status` is the resumable distill cursor;
 *  `raw_text` is purged once the run completes (we keep only the distillation). */
export const deepDiveSources = pgTable("deep_dive_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  deep_dive_id: uuid("deep_dive_id")
    .notNull()
    .references(() => deepDives.id, { onDelete: "cascade" }),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").$type<DeepDiveSourceKind>().notNull().default("upload"),
  title: text("title").notNull().default(""),
  raw_text: text("raw_text"),
  char_count: integer("char_count").notNull().default(0),
  status: text("status").$type<DeepDiveSourceStatus>().notNull().default("pending"),
  distilled: jsonb("distilled").$type<SourceDistillation>(),
  error: text("error"),
  created_at: createdAt,
}, (t) => [index("deep_dive_sources_deepdive_status_idx").on(t.deep_dive_id, t.status)]);

/** The synthesized understanding of the company (the "Context Pack"). Versioned
 *  and cumulative — each Deep Dive builds on the prior current pack; one row is
 *  is_current per workspace and feeds every agent through getPlanningContext. */
export const companyContext = pgTable("company_context", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  deep_dive_id: uuid("deep_dive_id").references(() => deepDives.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  is_current: boolean("is_current").notNull().default(true),
  summary: text("summary").notNull().default(""),
  pack: jsonb("pack")
    .$type<CompanyContextPack>()
    .notNull()
    .default({ people: [], timeline: [], themes: [], decisions: [], open_threads: [], risks: [], products: [] }),
  created_at: createdAt,
}, (t) => [index("company_context_ws_current_idx").on(t.workspace_id, t.is_current)]);

/** A per-workspace opportunity scanner (grant / conference / event / competition).
 *  Runs on a cadence and surfaces ranked opportunities; one row per (workspace, type). */
export const opportunityScanners = pgTable(
  "opportunity_scanners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").$type<OpportunityType>().notNull(),
    enabled: boolean("enabled").notNull().default(false),
    cadence: text("cadence").$type<ScannerCadence>().notNull().default("weekly"),
    // The autonomy phase: scan | scan_draft | approve.
    mode: text("mode").$type<ScannerMode>().notNull().default("scan"),
    scope: text("scope").$type<ScannerScope>().notNull().default("state"),
    sources: text("sources").array().notNull().default([]),
    status: text("status").$type<ScannerStatus>().notNull().default("idle"),
    last_error: text("last_error"),
    usage: jsonb("usage")
      .$type<ScanUsage>()
      .notNull()
      .default({ input_tokens: 0, output_tokens: 0, searches: 0, est_cost_cents: 0, runs: 0 }),
    // Cron cursor + atomic lock so overlapping ticks never double-run a scan.
    worker_locked_at: timestamp("worker_locked_at", { withTimezone: true }),
    last_run_at: timestamp("last_run_at", { withTimezone: true }),
    next_run_at: timestamp("next_run_at", { withTimezone: true }),
    created_at: createdAt,
  },
  (t) => ({ wsTypeUniq: uniqueIndex("opportunity_scanners_ws_type_uniq").on(t.workspace_id, t.type) }),
);

/** A found opportunity, ranked for fit. Deduped by (workspace, url) across rescans. */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspace_id: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scanner_id: uuid("scanner_id")
      .notNull()
      .references(() => opportunityScanners.id, { onDelete: "cascade" }),
    type: text("type").$type<OpportunityType>().notNull(),
    title: text("title").notNull().default(""),
    org: text("org").notNull().default(""),
    url: text("url").notNull().default(""),
    summary: text("summary").notNull().default(""),
    deadline: text("deadline").notNull().default(""),
    amount: text("amount").notNull().default(""),
    location: text("location").notNull().default(""),
    fit_score: integer("fit_score").notNull().default(0),
    fit_rationale: text("fit_rationale").notNull().default(""),
    requirements: text("requirements").notNull().default(""),
    status: text("status").$type<OpportunityStatus>().notNull().default("new"),
    project_id: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    created_at: createdAt,
  },
  (t) => ({
    wsUrlUniq: uniqueIndex("opportunities_ws_url_uniq").on(t.workspace_id, t.url),
    wsStatus: index("opportunities_ws_status_idx").on(t.workspace_id, t.status),
  }),
);

/** A generated daily executive brief (synthesized snapshot of the business). */
export const executiveBriefs = pgTable("executive_briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").$type<BriefKind>().notNull().default("daily"),
  content: jsonb("content")
    .$type<ExecBriefContent>()
    .notNull()
    .default({ headline: "", kpi_review: "", shipped: [], in_motion: [], next: [], insights: [], suggestions: [] }),
  created_at: createdAt,
}, (t) => [index("executive_briefs_ws_kind_idx").on(t.workspace_id, t.kind, t.created_at)]);

/** Company-wide goals the owner sets with the Executive Agent. */
export const companyGoals = pgTable("company_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  detail: text("detail").notNull().default(""),
  metric: text("metric").notNull().default(""),
  target: text("target").notNull().default(""),
  status: text("status").$type<GoalStatus>().notNull().default("active"),
  /** Time horizon — month/quarter goals are cascaded into the weekly + daily briefs. */
  horizon: text("horizon").$type<GoalHorizon>().notNull().default("ongoing"),
  /** Optional live-metric link for computed progress. */
  metric_key: text("metric_key").$type<GoalMetric>(),
  target_number: integer("target_number"),
  created_at: createdAt,
  updated_at: updatedAt,
}, (t) => [index("company_goals_ws_created_idx").on(t.workspace_id, t.created_at)]);
