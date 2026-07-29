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
  CreatedByType,
  DecisionType,
  EventType,
  ExecutionStatus,
  ExecutionStep,
  PermissionMode,
  Priority,
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
  agent_id: uuid("agent_id"),
  created_by_type: text("created_by_type").$type<CreatedByType>().notNull().default("agent"),
  requires_approval: boolean("requires_approval").notNull().default(true),
  approval_status: text("approval_status").$type<ApprovalStatus>().notNull().default("pending"),
  execution_status: text("execution_status").$type<ExecutionStatus>().notNull().default("none"),
  affected_systems: text("affected_systems").array().notNull().default([]),
  proposed_actions: integer("proposed_actions").notNull().default(0),
  impact_score: integer("impact_score").notNull().default(30),
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
