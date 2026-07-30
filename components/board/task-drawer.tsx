"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  GitCompare,
  Image as ImageIcon,
  Layers,
  ListChecks,
  Loader2,
  Mail,
  Megaphone,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw,
  Search,
  Sparkles,
  Table2,
  Undo2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { CategoryIconChip, RiskBadge, StatusPill } from "@/components/badges";
import { Kbd } from "@/components/ui/misc";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  CATEGORY_META,
  PRIORITY_META,
} from "@/lib/constants";
import { formatDateTime, relativeTime } from "@/lib/format";
import {
  attachStockImageAction,
  getPostImagesAction,
  removePostImageAction,
  searchStockAction,
  uploadPostImageAction,
} from "@/app/actions";
import type { AssetType, PostImage, Task, TaskAsset } from "@/lib/types";
import type { StockImage } from "@/lib/ai/stock";

const ASSET_ICON: Record<AssetType, typeof Mail> = {
  email: Mail,
  email_batch: Mail,
  invoice_batch: Mail,
  document: FileText,
  summary: FileText,
  copy_diff: GitCompare,
  spreadsheet: Table2,
  social_post: Megaphone,
  calendar_event: CalendarClock,
  checklist: ListChecks,
};

const ASSET_LABEL: Record<AssetType, string> = {
  email: "Email draft",
  email_batch: "Email batch",
  invoice_batch: "Invoice reminders",
  document: "Document",
  summary: "Summary",
  copy_diff: "Copy change",
  spreadsheet: "Spreadsheet",
  social_post: "Social post",
  calendar_event: "Calendar update",
  checklist: "Plan",
};

/** Quick-pick publish times, computed in the viewer's local timezone. */
function schedulePresets(): { label: string; when: Date }[] {
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  if (evening.getTime() <= now.getTime() + 30 * 60 * 1000) evening.setDate(evening.getDate() + 1);
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(now.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  return [
    { label: "In 1 hour", when: inHour },
    { label: "This evening", when: evening },
    { label: "Tomorrow 9 AM", when: tomorrow9 },
  ];
}

/** Format a Date as a `datetime-local` value ("YYYY-MM-DDTHH:mm") in local time. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TaskDrawer() {
  const {
    state,
    selectedTaskId,
    selectTask,
    approve,
    requestChanges,
    workTask,
    reject,
    retry,
    snooze,
    scheduleTask,
    unscheduleTask,
    setAgentMode,
    busyTaskId,
  } = useStore();

  const [mode, setMode] = useState<"idle" | "changes" | "reject" | "schedule">("idle");
  const [note, setNote] = useState("");
  const [customWhen, setCustomWhen] = useState("");
  const [drafting, setDrafting] = useState(false);

  const task = state?.tasks.find((t) => t.id === selectedTaskId) ?? null;
  const open = Boolean(task);
  const aiEnabled = Boolean(state?.session.ai_enabled);

  // Reset action panel whenever a different task opens.
  useEffect(() => {
    setMode("idle");
    setNote("");
    setCustomWhen("");
    setDrafting(false);
  }, [selectedTaskId]);

  // Keyboard shortcuts: A = approve, R = request changes.
  useEffect(() => {
    if (!open || !task) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (mode !== "idle") return;
      const actionable = task.approval_status === "pending" && task.status !== "done";
      if (!actionable) return;
      if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        doApprove();
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        setMode("changes");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, mode]);

  if (!state || !task) return <Drawer open={false} onClose={() => selectTask(null)}>{null}</Drawer>;

  const agent = state.agents.find((a) => a.id === task.agent_id);
  // A task already has a deliverable if it carries any content asset that isn't
  // a pure "Context —" reference (which is all a triage action task starts with).
  const hasDeliverable = task.assets.some(
    (a) => a.content.trim().length > 0 && !/^context\b/i.test(a.title),
  );
  const cat = CATEGORY_META[task.category];
  const run = state.runs.find((r) => r.task_id === task.id);
  const taskActivity = state.activity.filter((a) => a.task_id === task.id);
  const lastChangeNote = state.decisions
    .filter((d) => d.task_id === task.id && d.decision_type === "request_changes")
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];

  const busy = busyTaskId === task.id;
  const executing = task.execution_status === "executing";
  const scheduled = task.execution_status === "queued";
  const failed = task.execution_status === "failed";
  const completed = task.status === "done" && task.execution_status === "completed";
  const rejected = task.approval_status === "rejected";
  const revising = task.status === "changes_requested";
  const actionable = task.approval_status === "pending" && task.status !== "done" && !executing;

  function close() {
    selectTask(null);
  }
  function doApprove(auto = false) {
    if (!task) return;
    approve(task.id);
    if (auto && agent) setAgentMode(agent.id, "auto");
    setMode("idle");
  }
  function doSchedule(when: Date) {
    if (!task) return;
    scheduleTask(task.id, when.toISOString(), formatDateTime(when.toISOString()));
    setMode("idle");
    setCustomWhen("");
  }
  function doRequestChanges() {
    if (!task || !note.trim()) return;
    requestChanges(task.id, note.trim());
    setNote("");
    setMode("idle");
  }
  function doReject() {
    if (!task) return;
    reject(task.id, note.trim() || undefined);
    setNote("");
    setMode("idle");
  }

  return (
    <Drawer open={open} onClose={close} labelledBy="drawer-title">
      {/* Header ------------------------------------------------------- */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <CategoryIconChip category={task.category} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("text-[12px] font-semibold", cat.text)}>{cat.label}</span>
              <span className="text-muted-foreground/40">·</span>
              <StatusPill status={task.status} />
            </div>
            <h2 id="drawer-title" className="mt-1 text-[17px] font-semibold leading-snug tracking-tight">
              {task.title}
            </h2>
          </div>
          <button
            onClick={close}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Body --------------------------------------------------------- */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {/* Execution banners */}
        {busy && (
          <Banner tone="info" icon={Loader2} spin title="Executing live on the server…">
            <p className="text-[13px] text-primary/90">
              Operator is performing the real actions on your connected tools. This may take a few seconds.
            </p>
          </Banner>
        )}
        {executing && run && (
          <Banner tone="info" icon={Loader2} spin title="Executing now">
            <ExecutionSteps run={run} />
          </Banner>
        )}
        {failed && run && (
          <Banner tone="error" icon={AlertTriangle} title="Execution failed">
            <p className="text-[13px] text-red-700">{run.error_message}</p>
            <ExecutionSteps run={run} />
            <div className="mt-3">
              <Button size="sm" variant="primary" onClick={() => retry(task.id)}>
                <RotateCcw className="h-3.5 w-3.5" />
                Retry execution
              </Button>
            </div>
          </Banner>
        )}
        {completed && (
          <Banner tone="success" icon={CheckCircle2} title="Completed">
            <p className="text-[13px] text-emerald-800">
              {run?.result_summary ?? "This task executed successfully."}
            </p>
            {run?.completed_at && (
              <p className="mt-1 text-[12px] text-emerald-700/80">
                Finished {relativeTime(run.completed_at)}.
              </p>
            )}
          </Banner>
        )}
        {revising && (
          <Banner tone="warning" icon={Loader2} spin title="Agent is revising">
            <p className="text-[13px] text-orange-800">
              You sent this back with a note. {agent?.name ?? "The agent"} is updating
              the draft and will return it to Ready for Approval.
            </p>
          </Banner>
        )}
        {rejected && (
          <Banner tone="neutral" icon={X} title="Rejected">
            <p className="text-[13px] text-slate-600">
              This task was rejected and nothing was executed.
            </p>
          </Banner>
        )}

        {/* Why now */}
        <Field icon={Sparkles} label="Why this surfaced now">
          <p className="text-[13.5px] leading-relaxed text-foreground/90">{task.rationale}</p>
        </Field>

        {/* Summary */}
        <Field icon={FileText} label="Suggested action">
          <p className="text-[13.5px] leading-relaxed text-foreground/90">{task.description}</p>
        </Field>

        {/* Latest change note */}
        {lastChangeNote && revising && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
              Your note to the agent
            </p>
            <p className="mt-1 text-[13px] text-orange-900">“{lastChangeNote.comment}”</p>
          </div>
        )}

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
          <Meta label="Agent owner">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", cat.dot)} />
              {agent?.name ?? "—"}
            </span>
          </Meta>
          <Meta label="Risk level">
            <RiskBadge risk={task.risk_level} />
          </Meta>
          <Meta label="Priority">
            <span className={cn("font-semibold capitalize", PRIORITY_META[task.priority].tag)}>
              {PRIORITY_META[task.priority].label}
            </span>
          </Meta>
          <Meta label="Due">
            {task.due_at ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {relativeTime(task.due_at)}
              </span>
            ) : (
              <span className="text-muted-foreground">No due date</span>
            )}
          </Meta>
        </div>

        {/* Affected systems */}
        <Field icon={Zap} label="Systems affected after execution">
          {task.affected_systems.length ? (
            <div className="flex flex-wrap gap-1.5">
              {task.affected_systems.map((name) => {
                const integ = state.integrations.find((i) => i.name === name);
                const connected = integ?.connected ?? false;
                return (
                  <span
                    key={name}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium",
                      connected
                        ? "border-border bg-background text-foreground"
                        : "border-red-200 bg-red-50 text-red-700",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-red-500")} />
                    {name}
                    {!connected && " · not connected"}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">No external systems will be changed.</p>
          )}
        </Field>

        {/* Draft assets */}
        {task.assets.length > 0 && (
          <div className="space-y-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              <Layers className="h-3.5 w-3.5" />
              Draft output ({task.assets.length})
              {aiEnabled && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-primary">
                  <Sparkles className="h-3 w-3" /> Claude
                </span>
              )}
            </p>
            {task.assets.map((asset) => (
              <AssetBlock key={asset.id} asset={asset} />
            ))}
          </div>
        )}
        {!hasDeliverable && !completed && !rejected && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-[13px] text-muted-foreground">
              {aiEnabled
                ? `No deliverable yet — have ${agent?.name ?? "the agent"} draft it (button below), grounded in the task context and your business brief.`
                : `${agent?.name ?? "The agent"} is preparing the draft for this task.`}
            </p>
          </div>
        )}

        {task.category === "content" && (
          <PostImages taskId={task.id} isX={task.affected_systems.includes("X (Twitter)")} />
        )}

        {/* History */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            <Clock className="h-3.5 w-3.5" />
            Change history
          </p>
          <ol className="relative space-y-3 border-l border-border pl-4">
            {taskActivity.map((ev) => (
              <li key={ev.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-slate-300" />
                <p className="text-[13px] leading-snug text-foreground/90">{ev.summary}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {relativeTime(ev.created_at)} · {formatDateTime(ev.created_at)}
                </p>
              </li>
            ))}
            {taskActivity.length === 0 && (
              <li className="text-[13px] text-muted-foreground">No history yet.</li>
            )}
          </ol>
        </div>
      </div>

      {/* Footer: approval actions ------------------------------------- */}
      <div className="shrink-0 border-t border-border bg-card px-5 py-3.5">
        {mode === "changes" ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should the agent change? e.g. “Make the tone less salesy.”"
              className="min-h-[72px]"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setNote(""); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={doRequestChanges} disabled={!note.trim()}>
                <MessageSquarePlus className="h-4 w-4" />
                Send back to agent
              </Button>
            </div>
          </div>
        ) : mode === "reject" ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional: why are you rejecting this?"
              className="min-h-[64px]"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setNote(""); }}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={doReject}>
                Confirm reject
              </Button>
            </div>
          </div>
        ) : mode === "schedule" ? (
          <div className="space-y-2.5">
            <p className="text-[12px] font-medium text-muted-foreground">
              When should this publish?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {schedulePresets().map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => doSchedule(p.when)}
                  className="rounded-full border border-input bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-accent"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={customWhen}
                min={toLocalInput(new Date())}
                onChange={(e) => setCustomWhen(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-[13px] outline-none focus:border-ring"
              />
              <Button
                size="sm"
                disabled={!customWhen || new Date(customWhen).getTime() <= Date.now()}
                onClick={() => doSchedule(new Date(customWhen))}
              >
                <CalendarClock className="h-4 w-4" />
                Schedule
              </Button>
            </div>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMode("idle");
                  setCustomWhen("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : executing || busy ? (
          <Button size="lg" className="w-full" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
            Executing…
          </Button>
        ) : scheduled ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
              <p className="min-w-0 text-[13px]">
                <span className="font-medium">Scheduled</span>
                {task.scheduled_at && (
                  <span className="text-muted-foreground">
                    {" "}
                    · publishes {formatDateTime(task.scheduled_at)}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                disabled={busy}
                onClick={() => approve(task.id)}
              >
                <Zap className="h-4.5 w-4.5" />
                Publish now
              </Button>
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => unscheduleTask(task.id)}
              >
                <X className="h-4 w-4" />
                Unschedule
              </Button>
            </div>
          </div>
        ) : failed ? (
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={() => retry(task.id)}>
              <RotateCcw className="h-4 w-4" />
              Retry
            </Button>
            <Button variant="destructive" size="lg" onClick={() => setMode("reject")}>
              Reject
            </Button>
          </div>
        ) : completed ? (
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Approved &amp; executed
            </span>
            <Button variant="ghost" size="sm" onClick={() => retry(task.id)}>
              <Undo2 className="h-4 w-4" />
              Run again
            </Button>
          </div>
        ) : rejected ? (
          <Button variant="outline" size="lg" className="w-full" onClick={() => approve(task.id)}>
            Reopen &amp; approve
          </Button>
        ) : actionable && !hasDeliverable && agent && aiEnabled ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={drafting}
            onClick={async () => {
              setDrafting(true);
              try {
                await workTask(task.id);
              } finally {
                setDrafting(false);
              }
            }}
          >
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {drafting ? `${agent.name} is drafting…` : `Have ${agent.name} do this`}
          </Button>
        ) : actionable && task.requires_approval ? (
          <div className="flex items-center gap-2">
            <Button variant="success" size="lg" className="flex-1" onClick={() => doApprove()}>
              <Check className="h-4.5 w-4.5" />
              Approve
              <Kbd>A</Kbd>
            </Button>
            <Button variant="outline" size="lg" onClick={() => setMode("changes")}>
              <MessageSquarePlus className="h-4 w-4" />
              <span className="hidden sm:inline">Request changes</span>
              <span className="sm:hidden">Changes</span>
            </Button>
            <Button variant="destructive" size="lg" onClick={() => setMode("reject")} title="Reject">
              Reject
            </Button>
            <Popover
              align="end"
              className="inline-flex"
              trigger={
                <span className="inline-flex h-11 w-10 items-center justify-center rounded-lg border border-input bg-background hover:bg-accent">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              }
            >
              {(closeMenu) => (
                <div className="min-w-[220px] space-y-0.5">
                  <MenuItem
                    icon={CalendarClock}
                    onClick={() => { setMode("schedule"); closeMenu(); }}
                    title="Schedule…"
                    subtitle="Approve now, publish at a set time"
                  />
                  <MenuItem
                    icon={Zap}
                    onClick={() => { doApprove(true); closeMenu(); }}
                    title="Approve & auto-run similar"
                    subtitle={`Set ${agent?.name ?? "agent"} to auto-run`}
                  />
                  <MenuItem
                    icon={Clock}
                    onClick={() => { snooze(task.id); closeMenu(); }}
                    title="Snooze 1 day"
                  />
                </div>
              )}
            </Popover>
          </div>
        ) : actionable && !task.requires_approval ? (
          <div className="flex items-center gap-2">
            <Button variant="primary" size="lg" className="flex-1" onClick={() => doApprove()}>
              <Zap className="h-4.5 w-4.5" />
              Run now
            </Button>
            <Button variant="outline" size="lg" onClick={() => setMode("reject")}>
              Dismiss
            </Button>
          </div>
        ) : (
          <p className="text-center text-[13px] text-muted-foreground">No actions available.</p>
        )}
      </div>
    </Drawer>
  );
}

/* ---------------------------- subcomponents ------------------------- */

/** Images attached to a post — upload your own or pick from the stock library.
 *  Drawer-local state (fetched per open); mutations go straight to the server. */
function PostImages({ taskId, isX }: { taskId: string; isX: boolean }) {
  const [images, setImages] = useState<PostImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [stockOff, setStockOff] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    getPostImagesAction(taskId)
      .then((imgs) => alive && setImages(imgs))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [taskId]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadPostImageAction(taskId, fd);
    setBusy(false);
    if (res.ok && res.image) setImages((p) => [...p, res.image as PostImage]);
    else setError(res.error ?? "Upload failed.");
  }

  async function onRemove(id: string) {
    setImages((p) => p.filter((i) => i.id !== id));
    await removePostImageAction(id);
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    const res = await searchStockAction(query.trim());
    setSearching(false);
    setStockOff(!res.configured);
    setResults(res.images);
  }

  async function pickStock(s: StockImage) {
    setBusy(true);
    setError("");
    const res = await attachStockImageAction(taskId, {
      url: s.url,
      alt: s.alt,
      width: s.width,
      height: s.height,
      attribution: s.attribution,
    });
    setBusy(false);
    if (res.ok && res.image) {
      setImages((p) => [...p, res.image as PostImage]);
      setPicking(false);
      setResults([]);
      setQuery("");
    } else setError(res.error ?? "Couldn't attach that image.");
  }

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <ImageIcon className="h-3.5 w-3.5" /> Images
        {isX && (
          <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
            · attach to the X post
          </span>
        )}
      </p>

      {images.length > 0 && (
        <div className="mb-2 grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative aspect-video overflow-hidden rounded-lg border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt_text} className="h-full w-full object-cover" />
              <button
                onClick={() => onRemove(img.id)}
                className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                title="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              {img.source === "stock" && img.attribution && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[9px] text-white/90">
                  {img.attribution}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {!picking ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={onUpload}
          />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setPicking(true)}>
            <ImageIcon className="h-4 w-4" />
            Stock
          </Button>
          {isX && images.length > 0 && (
            <span className="text-[11px] text-muted-foreground">Up to 4 attach on publish</span>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Search stock photos…"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
              autoFocus
            />
            <Button size="sm" disabled={searching || !query.trim()} onClick={runSearch}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPicking(false);
                setResults([]);
              }}
            >
              Cancel
            </Button>
          </div>
          {stockOff && (
            <p className="text-[11.5px] text-muted-foreground">
              Stock search needs a Pexels API key (<code>PEXELS_API_KEY</code>). Uploads work without it.
            </p>
          )}
          {results.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {results.map((s, i) => (
                <button
                  key={i}
                  disabled={busy}
                  onClick={() => pickStock(s)}
                  className="group relative aspect-video overflow-hidden rounded-md border border-border hover:ring-2 hover:ring-primary/40"
                  title={s.attribution}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumb} alt={s.alt} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-[11.5px] text-destructive">{error}</p>}
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      {children}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </p>
      <div className="mt-1 text-[13px] font-medium text-foreground">{children}</div>
    </div>
  );
}

function AssetBlock({ asset }: { asset: TaskAsset }) {
  const [open, setOpen] = useState(true);
  const Icon = ASSET_ICON[asset.asset_type];
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-background text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{asset.title}</span>
          <span className="block text-[11px] text-muted-foreground">{ASSET_LABEL[asset.asset_type]}</span>
        </span>
        {asset.metadata &&
          Object.entries(asset.metadata).slice(0, 1).map(([k, v]) => (
            <span key={k} className="hidden rounded-md bg-background px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground sm:inline">
              {formatMetaValue(k, v)}
            </span>
          ))}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap border-t border-border bg-card px-3.5 py-3 font-mono text-[12px] leading-relaxed text-foreground/90">
          {asset.content}
        </pre>
      )}
    </div>
  );
}

function formatMetaValue(key: string, value: string | number): string {
  if (key.includes("total") || key.includes("outstanding")) {
    return typeof value === "number" ? `$${value.toLocaleString()}` : String(value);
  }
  if (key === "recipients") return `${value} recipients`;
  return String(value);
}

function ExecutionSteps({ run }: { run: { steps: { label: string; status: string }[] } }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {run.steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2 text-[12.5px]">
          {s.status === "done" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : s.status === "running" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : s.status === "failed" ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-full border-2 border-border" />
          )}
          <span
            className={cn(
              s.status === "done" && "text-foreground/70 line-through decoration-1",
              s.status === "pending" && "text-muted-foreground",
              s.status === "failed" && "font-medium text-red-700",
            )}
          >
            {s.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

const BANNER_TONES = {
  info: "border-primary/20 bg-primary/5",
  success: "border-emerald-200 bg-emerald-50",
  error: "border-red-200 bg-red-50",
  warning: "border-orange-200 bg-orange-50",
  neutral: "border-border bg-muted/50",
} as const;

const BANNER_ICON_TONES = {
  info: "text-primary",
  success: "text-emerald-600",
  error: "text-red-600",
  warning: "text-orange-600",
  neutral: "text-slate-500",
} as const;

function Banner({
  tone,
  icon: Icon,
  title,
  spin,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: typeof Mail;
  title: string;
  spin?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border p-3.5", BANNER_TONES[tone])}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4.5 w-4.5", BANNER_ICON_TONES[tone], spin && "animate-spin")} />
        <p className="text-[13.5px] font-semibold text-foreground">{title}</p>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: typeof Mail;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        {subtitle && <span className="block text-[11px] text-muted-foreground">{subtitle}</span>}
      </span>
    </button>
  );
}
