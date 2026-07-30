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
  requires_approval: boolean;
  rationale: string;
  /** Ready-to-use content the owner reviews (email, doc, page, etc.). */
  draft: string;
  /** Subset of affected_systems that isn't connected yet. */
  needs_connection: string[];
}

/** Payload persisted when a user completes guided onboarding (server mode). */
export interface OnboardingInput {
  user_name: string;
  company_name: string;
  website_url: string;
  business_description: string;
  ideal_customer_profile: string;
  goals: string[];
  voice_rules: string[];
  approvalDefault: PermissionMode;
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
  status: "pending" | "running" | "done" | "failed";
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
  project_step_kind?: "deliverable" | "action" | null;
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
  created_at: string;
  updated_at: string;
  /** Denormalised for convenience in the prototype store. */
  assets: TaskAsset[];
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
  /** What to produce (deliverable) or do (action). */
  brief: string;
  /** The worker department that owns it, or "human" for an owner action. */
  assignee: Category | "human";
  kind: "deliverable" | "action";
}

export interface ProjectPhase {
  title: string;
  summary: string;
  steps: ProjectStep[];
}

export interface ProjectPlan {
  phases: ProjectPhase[];
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
  plan: ProjectPlan;
  /** Index of the phase currently being worked (0-based). */
  current_phase: number;
  created_by_type: CreatedByType;
  created_at: string;
  updated_at: string;
  /** Denormalised progress, assembled at load. */
  progress?: { total: number; done: number };
}

/* --------------------------- pages & commerce ---------------------------- */

export type PageStatus = "draft" | "published";
export type PageType = "landing" | "product" | "blog";

/** The structured content of a generated page (a page with a buy button). */
export interface PageContent {
  headline: string;
  subheadline: string;
  cta_label: string;
  sections: { heading: string; body: string }[];
  features?: { title: string; body: string }[];
  footer_note?: string;
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
