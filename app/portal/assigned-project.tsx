"use client";

import { useState } from "react";
import { ArrowLeft, Ban, Check, CheckCircle2, Loader2, Sparkles, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  memberAdvanceProjectAction,
  memberApproveTaskAction,
  memberRejectTaskAction,
  memberRunTaskAction,
  memberUpdateTaskAssetAction,
} from "@/app/actions";
import type { MemberProjectDetail, MemberProjectTask } from "@/lib/types";

type TaskState = "draft" | "review" | "running" | "done" | "rejected";

function taskState(t: MemberProjectTask): TaskState {
  if (t.approval_status === "rejected") return "rejected";
  if (t.status === "done" || t.execution_status === "completed") return "done";
  if (t.status === "approved" || t.execution_status === "executing") return "running";
  if (t.deliverable || t.status === "ready" || t.status === "changes_requested") return "review";
  return "draft";
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}

function TaskRow({
  task,
  busy,
  onRun,
  onApprove,
  onReject,
  onSaveDeliverable,
}: {
  task: MemberProjectTask;
  busy: boolean;
  onRun: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSaveDeliverable: (assetId: string, content: string) => Promise<void>;
}) {
  const state = taskState(task);
  const isDeliverable = task.step_kind === "deliverable" || task.step_kind === null;
  const [draft, setDraft] = useState(task.deliverable?.content ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!task.deliverable) return;
    setSaving(true);
    await onSaveDeliverable(task.deliverable.id, draft);
    setSaving(false);
    setEditing(false);
  }

  return (
    <Card className={cn("flex flex-col gap-2 p-3", state === "done" && "opacity-70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {task.step_kind === "action" && <User className="h-3.5 w-3.5 text-amber-600" />}
            <span>{task.title}</span>
          </div>
          {task.description && !task.deliverable && (
            <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
          )}
        </div>
        <StateBadge state={state} />
      </div>

      {task.deliverable && (
        <div className="rounded-lg border border-border bg-muted/30 p-2">
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-xs" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-foreground/90">
                {task.deliverable.content || "(empty draft)"}
              </p>
              {(state === "review" || state === "running") && (
                <button
                  onClick={() => {
                    setDraft(task.deliverable?.content ?? "");
                    setEditing(true);
                  }}
                  className="mt-1 text-[11px] font-medium text-primary hover:underline"
                >
                  Edit
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {state === "draft" && isDeliverable && (
          <Button size="sm" variant="outline" onClick={onRun} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Have the agent draft this
          </Button>
        )}
        {(state === "review" || (state === "draft" && !isDeliverable)) && (
          <>
            <Button size="sm" variant="success" onClick={onApprove} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {isDeliverable ? "Approve" : "Mark done"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
              <Ban className="h-3.5 w-3.5" /> Reject
            </Button>
          </>
        )}
        {state === "running" && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sky-700 dark:text-sky-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Approved — running…
          </span>
        )}
        {state === "done" && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Done
          </span>
        )}
        {state === "rejected" && <span className="text-[12px] font-medium text-muted-foreground">Rejected</span>}
      </div>
    </Card>
  );
}

function StateBadge({ state }: { state: TaskState }) {
  const meta: Record<TaskState, { label: string; cls: string }> = {
    draft: { label: "To draft", cls: "text-muted-foreground" },
    review: { label: "Needs you", cls: "text-amber-600 dark:text-amber-400" },
    running: { label: "Running", cls: "text-sky-600 dark:text-sky-400" },
    done: { label: "Done", cls: "text-success" },
    rejected: { label: "Rejected", cls: "text-muted-foreground" },
  };
  const m = meta[state];
  return <span className={cn("shrink-0 text-[11px] font-semibold uppercase tracking-wide", m.cls)}>{m.label}</span>;
}

export function AssignedProjectView({
  detail,
  onBack,
  onRefresh,
}: {
  detail: MemberProjectDetail;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { project, tasks } = detail;
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progress = project.progress ?? { total: 0, done: 0 };

  async function act(taskId: string, fn: () => Promise<{ ok: boolean; error?: string }>, advance = false) {
    setBusyTask(taskId);
    setError(null);
    const r = await fn();
    if (!r.ok) {
      setError(r.error ?? "That didn't work.");
      setBusyTask(null);
      return;
    }
    // Approving/rejecting the last task of a phase can unlock the next one.
    if (advance) await memberAdvanceProjectAction(project.id);
    await onRefresh();
    setBusyTask(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to projects
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{project.title}</h1>
        {project.summary && <p className="mt-0.5 text-sm text-muted-foreground">{project.summary}</p>}
        <div className="mt-3">
          <ProgressBar done={progress.done} total={progress.total} />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {project.status === "planning" ? (
        <Card className="p-4 text-sm text-muted-foreground">
          This project's plan is still being reviewed by the owner. Once it's approved, its tasks appear here.
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {project.plan.phases.map((phase, pi) => {
            const phaseTasks = tasks.filter((t) => t.project_phase === pi);
            const isCurrent = project.status === "active" && pi === project.current_phase;
            const isPast = project.status === "done" || pi < project.current_phase;
            const locked = pi > project.current_phase && project.status === "active";
            return (
              <div
                key={pi}
                className={cn(
                  "rounded-xl border p-3",
                  isCurrent ? "border-primary/40 bg-primary/5" : "border-border",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                      isPast
                        ? "bg-emerald-100 text-emerald-700"
                        : isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isPast ? <Check className="h-3 w-3" /> : pi + 1}
                  </span>
                  <h3 className="text-sm font-semibold">{phase.title}</h3>
                  {isCurrent && <span className="ml-auto text-[11px] font-medium text-primary">Current phase</span>}
                </div>
                {phase.summary && <p className="mt-1 pl-7 text-xs text-muted-foreground">{phase.summary}</p>}

                <div className="mt-2.5 flex flex-col gap-2 pl-7">
                  {locked ? (
                    <p className="text-xs text-muted-foreground">Unlocks when the current phase is done.</p>
                  ) : phaseTasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Tasks are being prepared…</p>
                  ) : (
                    phaseTasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        busy={busyTask === t.id}
                        onRun={() => act(t.id, () => memberRunTaskAction(t.id))}
                        onApprove={() => act(t.id, () => memberApproveTaskAction(t.id), true)}
                        onReject={() => act(t.id, () => memberRejectTaskAction(t.id), true)}
                        onSaveDeliverable={async (assetId, content) => {
                          await memberUpdateTaskAssetAction(assetId, content);
                          await onRefresh();
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
