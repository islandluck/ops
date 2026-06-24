import type {
  Category,
  PermissionMode,
  Priority,
  RiskLevel,
  TaskStatus,
} from "./types";

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export interface CategoryMeta {
  key: Category;
  label: string;
  blurb: string;
  /** Soft tag styles (used sparingly, per PRD). */
  tag: string;
  dot: string;
  text: string;
  ring: string;
  softBg: string;
  iconBg: string;
}

export const CATEGORY_ORDER: Category[] = [
  "growth",
  "admin",
  "content",
  "research",
  "finance",
];

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  growth: {
    key: "growth",
    label: "Growth",
    blurb: "Outreach, leads, pipeline",
    tag: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    softBg: "bg-emerald-50",
    iconBg: "bg-emerald-100 text-emerald-700",
  },
  admin: {
    key: "admin",
    label: "Admin",
    blurb: "Scheduling, inbox, ops",
    tag: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "bg-sky-500",
    text: "text-sky-700",
    ring: "ring-sky-200",
    softBg: "bg-sky-50",
    iconBg: "bg-sky-100 text-sky-700",
  },
  content: {
    key: "content",
    label: "Content",
    blurb: "Copy, newsletters, social",
    tag: "bg-violet-50 text-violet-700 border-violet-200",
    dot: "bg-violet-500",
    text: "text-violet-700",
    ring: "ring-violet-200",
    softBg: "bg-violet-50",
    iconBg: "bg-violet-100 text-violet-700",
  },
  research: {
    key: "research",
    label: "Research",
    blurb: "Market, competitors, insight",
    tag: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    text: "text-amber-700",
    ring: "ring-amber-200",
    softBg: "bg-amber-50",
    iconBg: "bg-amber-100 text-amber-700",
  },
  finance: {
    key: "finance",
    label: "Finance",
    blurb: "Invoices, reminders, books",
    tag: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    text: "text-rose-700",
    ring: "ring-rose-200",
    softBg: "bg-rose-50",
    iconBg: "bg-rose-100 text-rose-700",
  },
};

/* ------------------------------------------------------------------ */
/* Statuses (board columns)                                            */
/* ------------------------------------------------------------------ */

export interface StatusMeta {
  key: TaskStatus;
  label: string;
  short: string;
  description: string;
  dot: string;
  headerText: string;
  accentBar: string;
}

export const STATUS_ORDER: TaskStatus[] = [
  "new",
  "agent_working",
  "ready",
  "changes_requested",
  "approved",
  "done",
];

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  new: {
    key: "new",
    label: "New",
    short: "New",
    description: "Detected by an agent, not yet started",
    dot: "bg-slate-400",
    headerText: "text-slate-600",
    accentBar: "bg-slate-300",
  },
  agent_working: {
    key: "agent_working",
    label: "Agent Working",
    short: "Working",
    description: "An agent is preparing the draft",
    dot: "bg-indigo-500",
    headerText: "text-indigo-600",
    accentBar: "bg-indigo-400",
  },
  ready: {
    key: "ready",
    label: "Ready for Approval",
    short: "Ready",
    description: "Awaiting your decision",
    dot: "bg-amber-500",
    headerText: "text-amber-600",
    accentBar: "bg-amber-400",
  },
  changes_requested: {
    key: "changes_requested",
    label: "Changes Requested",
    short: "Changes",
    description: "Sent back to the agent to revise",
    dot: "bg-orange-500",
    headerText: "text-orange-600",
    accentBar: "bg-orange-400",
  },
  approved: {
    key: "approved",
    label: "Approved",
    short: "Approved",
    description: "Approved — executing or queued",
    dot: "bg-emerald-500",
    headerText: "text-emerald-600",
    accentBar: "bg-emerald-400",
  },
  done: {
    key: "done",
    label: "Done",
    short: "Done",
    description: "Executed and complete",
    dot: "bg-teal-600",
    headerText: "text-teal-700",
    accentBar: "bg-teal-500",
  },
};

/* ------------------------------------------------------------------ */
/* Risk + priority                                                     */
/* ------------------------------------------------------------------ */

export const RISK_META: Record<
  RiskLevel,
  { label: string; tag: string; dot: string }
> = {
  low: {
    label: "Low risk",
    tag: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
  },
  medium: {
    label: "Medium risk",
    tag: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  high: {
    label: "High risk",
    tag: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
  },
};

export const PRIORITY_META: Record<
  Priority,
  { label: string; tag: string; weight: number }
> = {
  low: { label: "Low", tag: "text-slate-500", weight: 1 },
  medium: { label: "Medium", tag: "text-slate-600", weight: 2 },
  high: { label: "High", tag: "text-orange-600", weight: 3 },
  urgent: { label: "Urgent", tag: "text-red-600", weight: 4 },
};

/* ------------------------------------------------------------------ */
/* Permission modes                                                    */
/* ------------------------------------------------------------------ */

export const PERMISSION_META: Record<
  PermissionMode,
  { label: string; description: string; tag: string }
> = {
  suggest: {
    label: "Suggest only",
    description: "Agent surfaces ideas. Nothing runs without you building it out.",
    tag: "bg-slate-100 text-slate-600 border-slate-200",
  },
  approval: {
    label: "Approval required",
    description: "Agent prepares the work and waits for your one-click approval.",
    tag: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  auto: {
    label: "Auto-run within guardrails",
    description: "Low-risk actions run automatically inside the limits you set.",
    tag: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export const STORAGE_KEY = "operator.state.v1";

export const APP_NAME = "Operator";
export const APP_TAGLINE = "Run the repetitive parts of your business from one place.";

export type SortKey = "newest" | "urgency" | "impact";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "urgency", label: "Urgency" },
  { key: "impact", label: "Impact" },
  { key: "newest", label: "Newest" },
];
