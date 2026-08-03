/**
 * Drizzle schema — the production Postgres model (Supabase-compatible).
 *
 * Column JS keys deliberately mirror the domain field names in lib/types.ts
 * (snake_case) so mapping rows → domain objects is near-identity; only dates
 * (Date → ISO string) and nested relations are assembled in lib/db/queries.ts.
 */
import {
  boolean,
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
  Category,
  ChannelKind,
  ChannelStatus,
  CreatedByType,
  DecisionType,
  EventType,
  ExecutionStatus,
  ExecutionStep,
  PackagedVariant,
  PageContent,
  PageStatus,
  PageType,
  PermissionMode,
  PostStatus,
  Priority,
  ProjectPlan,
  ProjectStatus,
  RiskLevel,
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
  approval_rules: jsonb("approval_rules").$type<ApprovalRule[]>().notNull().default([]),
  budget_limits: jsonb("budget_limits")
    .$type<{ label: string; amount: number; period: string }[]>()
    .notNull()
    .default([]),
  working_hours: text("working_hours").notNull().default(""),
  timezone: text("timezone").notNull().default(""),
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
