/**
 * Drizzle schema — the production Postgres model (Supabase-compatible).
 *
 * Column JS keys deliberately mirror the domain field names in lib/types.ts
 * (snake_case) so mapping rows → domain objects is near-identity; only dates
 * (Date → ISO string) and nested relations are assembled in lib/db/queries.ts.
 */
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
  CommandCenterDoc,
  ChannelKind,
  ChannelStatus,
  CompanyContextPack,
  CreatedByType,
  DecisionType,
  DeepDiveProgress,
  DeepDiveSourceKind,
  DeepDiveSourceStatus,
  DeepDiveStatus,
  DeepDiveUsage,
  EventType,
  ExecAction,
  ExecBriefContent,
  ExecRole,
  ExecutionStatus,
  ExecutionStep,
  GoalHorizon,
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
  PermissionMode,
  PostStatus,
  Priority,
  ProjectPlan,
  ProjectStatus,
  RecipientCandidate,
  RiskLevel,
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
  created_at: createdAt,
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  owner_id: uuid("owner_id").notNull(),
  plan: text("plan").notNull().default("Operator Pro"),
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
});

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
  updated_at: updatedAt,
});

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
});

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
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
  created_at: createdAt,
  updated_at: updatedAt,
});

export const taskAssets = pgTable("task_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  task_id: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  asset_type: text("asset_type").$type<AssetType>().notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  metadata: jsonb("metadata").$type<Record<string, string | number>>(),
});

export const approvalDecisions = pgTable("approval_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  task_id: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  decided_by: text("decided_by").notNull(),
  decision_type: text("decision_type").$type<DecisionType>().notNull(),
  comment: text("comment"),
  created_at: createdAt,
});

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
});

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
});

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
    triaged_at: createdAt,
    updated_at: updatedAt,
  },
  (t) => [uniqueIndex("email_triage_ws_msg_uniq").on(t.workspace_id, t.gmail_message_id)],
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
    doc: jsonb("doc").$type<CommandCenterDoc>().notNull(),
    updated_at: updatedAt,
  },
  (t) => [uniqueIndex("command_center_ws_uniq").on(t.workspace_id)],
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
});

/** Freeform notes the user jots down. A note can be handed to the Executive,
 *  which proposes a project or tasks from it; `status` flips to "actioned" and
 *  `spawned_project_id` links to what it created (tasks link back via note_id). */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  content: text("content").notNull().default(""),
  /** "draft" until handed to the Executive and approved → "actioned". */
  status: text("status").notNull().default("draft"),
  spawned_project_id: uuid("spawned_project_id"),
  spawned_task_count: integer("spawned_task_count").notNull().default(0),
  created_at: createdAt,
  updated_at: updatedAt,
});

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
  created_at: createdAt,
  updated_at: updatedAt,
});

/** Follower-count snapshots for a growth campaign — the progress trend vs goal. */
export const followerSnapshots = pgTable("follower_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  project_id: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  followers: integer("followers").notNull().default(0),
  created_at: createdAt,
});

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
});

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
});

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
});

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
});

/* ---------------------------- executive office --------------------------- */

/** The conversation with the Executive Agent (Chief of Staff). */
export const executiveMessages = pgTable("executive_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspace_id: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  role: text("role").$type<ExecRole>().notNull(),
  content: text("content").notNull().default(""),
  /** Tool calls the agent made while producing an assistant turn. */
  actions: jsonb("actions").$type<ExecAction[]>().notNull().default([]),
  /** Archived when the owner starts a new chat — hidden, kept for history. */
  archived: boolean("archived").notNull().default(false),
  created_at: createdAt,
});

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
});

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
});

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
});

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
});

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
});

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
  (t) => ({ wsUrlUniq: uniqueIndex("opportunities_ws_url_uniq").on(t.workspace_id, t.url) }),
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
});

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
});
