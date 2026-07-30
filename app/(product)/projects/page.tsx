"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
  User,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { CATEGORY_META } from "@/lib/constants";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  advanceProjectAction,
  approveProjectPlanAction,
  cancelProjectAction,
  createProjectAction,
  getProjectsAction,
} from "@/app/actions";
import type { Category, Project, ProjectStatus } from "@/lib/types";

const STATUS_META: Record<ProjectStatus, { label: string; cls: string; dot: string }> = {
  planning: { label: "Plan ready to review", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  active: { label: "In progress", cls: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" },
  blocked: { label: "Blocked", cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  done: { label: "Complete", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-400" },
};

function assigneeLabel(a: Category | "human"): string {
  return a === "human" ? "You" : CATEGORY_META[a]?.label ?? a;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The board reads the global store; refresh it after project actions so newly
  // materialized tasks show up without a hard reload.
  const { reloadWorkspace } = useStore();

  async function reload() {
    try {
      setProjects(await getProjectsAction());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Set a goal. A Manager or Executive agent plans it, delegates the work across your team, and runs it to completion — you approve the plan and each deliverable."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold">No projects yet</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                Hand a leadership agent a big goal — “build our website”, “launch the new offer” — and it breaks it
                into a phased plan your team executes.
              </p>
            </div>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Start a project
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={() => setSelectedId(p.id)} />
            ))}
          </div>
        )}
      </PageBody>

      {creating && (
        <NewProjectDrawer
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await reload();
            setSelectedId(id);
          }}
        />
      )}
      {selected && (
        <ProjectDrawer
          project={selected}
          onClose={() => setSelectedId(null)}
          onChanged={async () => {
            await reload();
            reloadWorkspace(); // refresh the board with newly materialized tasks
          }}
        />
      )}
    </>
  );
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

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const st = STATUS_META[project.status];
  const phases = project.plan.phases.length;
  const progress = project.progress ?? { total: 0, done: 0 };
  return (
    <Card className="card-interactive flex cursor-pointer flex-col p-4" onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
          {st.label}
        </span>
        <span className="text-[11px] capitalize text-muted-foreground">{project.owner_kind}</span>
      </div>
      <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug">{project.title}</h3>
      <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{project.summary || project.goal}</p>
      <div className="mt-3 flex-1" />
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {project.status === "planning" ? (
          <p className="text-[12px] font-medium text-amber-700">Review the plan →</p>
        ) : (
          <>
            <ProgressBar done={progress.done} total={progress.total} />
            <p className="text-[11px] text-muted-foreground">
              {project.status === "done"
                ? "All phases complete"
                : `Phase ${Math.min(project.current_phase + 1, phases)} of ${phases}`}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function NewProjectDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [goal, setGoal] = useState("");
  const [owner, setOwner] = useState<"manager" | "executive">("manager");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!goal.trim()) return;
    setBusy(true);
    setError("");
    const res = await createProjectAction(goal.trim(), owner);
    setBusy(false);
    if (res.ok && res.projectId) onCreated(res.projectId);
    else setError(res.error ?? "Couldn't plan that project.");
  }

  return (
    <Drawer open onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="text-[12px] font-medium text-muted-foreground">New project</p>
          <h2 className="text-[17px] font-semibold">Set a goal</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">What do you want to accomplish?</label>
          <Textarea
            autoFocus
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="min-h-[110px]"
            placeholder="e.g. Build and launch a landing page for our new offer, with copy, a launch email, and social teasers."
          />
          <p className="text-[11.5px] text-muted-foreground">
            Describe the outcome. The agent decides the steps, who does each, and which parts are yours.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">Who should run it?</label>
          <Segmented
            options={[
              { value: "manager", label: "Manager" },
              { value: "executive", label: "Executive" },
            ]}
            value={owner}
            onChange={(v) => setOwner(v as "manager" | "executive")}
          />
          <p className="text-[11.5px] text-muted-foreground">
            {owner === "manager"
              ? "Manager — hands-on, for operational projects (a launch, a campaign, a site)."
              : "Executive — strategic, for company-scale initiatives (a new product, a market push)."}
          </p>
        </div>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3.5">
        <Button variant="success" className="flex-1" onClick={submit} disabled={busy || !goal.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Planning the project…" : "Draft the plan"}
        </Button>
      </div>
    </Drawer>
  );
}

function ProjectDrawer({
  project,
  onClose,
  onChanged,
}: {
  project: Project;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const st = STATUS_META[project.status];
  const progress = project.progress ?? { total: 0, done: 0 };

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError("");
    try {
      const res = await fn();
      if (res && res.ok === false) {
        setError(res.error ?? "That action didn't complete.");
        return;
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose}>
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
            {st.label}
          </span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
            ✕
          </button>
        </div>
        <h2 className="mt-2 text-[17px] font-semibold leading-snug">{project.title}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{project.summary}</p>
        <p className="mt-2 text-[11px] capitalize text-muted-foreground">
          Run by the {project.owner_kind} Agent
        </p>
        {project.status !== "planning" && (
          <div className="mt-3">
            <ProgressBar done={progress.done} total={progress.total} />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">Goal</p>
          <p className="text-[13px] text-foreground/90">{project.goal}</p>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">The plan</p>
          {project.plan.phases.map((phase, pi) => {
            const isCurrent = project.status === "active" && pi === project.current_phase;
            const isPast = project.status === "done" || (project.status === "active" && pi < project.current_phase);
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
                      isPast ? "bg-emerald-100 text-emerald-700" : isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isPast ? <Check className="h-3 w-3" /> : pi + 1}
                  </span>
                  <h4 className="text-[13.5px] font-semibold">{phase.title}</h4>
                  {isCurrent && (
                    <span className="ml-auto text-[10.5px] font-medium text-primary">Underway</span>
                  )}
                </div>
                {phase.summary && <p className="mt-1 pl-7 text-[12px] text-muted-foreground">{phase.summary}</p>}
                <ul className="mt-2 space-y-1.5 pl-7">
                  {phase.steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2 text-[12.5px]">
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      <span className="flex-1">
                        {step.title}
                        <span
                          className={cn(
                            "ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                            step.assignee === "human"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {step.assignee === "human" && <User className="h-2.5 w-2.5" />}
                          {assigneeLabel(step.assignee)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {project.status === "active" && (
          <p className="rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
            The current phase's tasks are on your <span className="font-medium text-foreground">Approval Center</span> board —
            approve each deliverable there. When the phase is done, the next one is released automatically.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-5 py-3.5">
        {error && <p className="mb-2 text-[12.5px] text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
        {project.status === "planning" ? (
          <>
            <Button
              variant="success"
              className="flex-1"
              disabled={busy}
              onClick={() => act(() => approveProjectPlanAction(project.id))}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve plan &amp; start
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => act(() => cancelProjectAction(project.id))}>
              <Ban className="h-4 w-4" />
              Discard
            </Button>
          </>
        ) : project.status === "active" ? (
          <>
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => act(() => advanceProjectAction(project.id))}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Check for progress
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => act(() => cancelProjectAction(project.id))}>
              Cancel project
            </Button>
          </>
        ) : project.status === "done" ? (
          <span className="inline-flex items-center gap-2 text-[13px] font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Project complete
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">Project {project.status}.</span>
        )}
        </div>
      </div>
    </Drawer>
  );
}
