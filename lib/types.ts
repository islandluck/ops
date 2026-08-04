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
  /** For email tasks: the real recipient address, ONLY if explicitly given —
   *  null when unknown (never invented). Drives a real send vs. drafted-only. */
  recipient?: string | null;
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

export type MemoryKind = "fact" | "preference" | "decision" | "insight";

/** A durable thing the Executive Agent knows about the business. */
export interface ExecMemory {
  id: string;
  content: string;
  kind: MemoryKind;
  source: "user" | "agent";
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
