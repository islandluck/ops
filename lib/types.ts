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
export interface AppState {
  workspace: Workspace;
  brief: BusinessBrief;
  agents: Agent[];
  tasks: Task[];
  integrations: Integration[];
  decisions: ApprovalDecision[];
  runs: ExecutionRun[];
  activity: ActivityEvent[];
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
  /** The acting agent's persona (Phase 4 — editable agents). */
  agentName?: string;
  agentInstructions?: string;
}
