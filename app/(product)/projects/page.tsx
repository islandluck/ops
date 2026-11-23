"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Ban,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Compass,
  Crown,
  FileDown,
  FileText,
  Globe,
  Loader2,
  MessageCircle,
  Plus,
  Repeat2,
  Search,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { CATEGORY_META } from "@/lib/constants";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  approveAllCampaignPostsAction,
  approveScheduledPostAction,
  cancelProjectAction,
  createGrowthCampaignAction,
  createProjectAction,
  deleteProjectAction,
  getCampaignDataAction,
  getProjectPacketAction,
  getProjectsAction,
  assignProjectToMemberAction,
  listTeamMembersAction,
  createWorkspaceProjectAction,
  listWorkstreamsAction,
  addWorkstreamAction,
  updateWorkstreamAction,
  deleteWorkstreamAction,
  proposeWorkstreamAction,
  cancelProposalAction,
  runWorkstreamAction,
  closeWorkspaceProjectAction,
} from "@/app/actions";
import { escapeHtml, markdownToHtml } from "@/lib/content/format";
import type { ProjectPacket } from "@/lib/agents/project";
import type {
  CampaignData,
  CampaignPost,
  Category,
  Project,
  ProjectStatus,
  ProjectWorkstream,
  TeamMember,
  WorkstreamDelegateKind,
  WorkstreamStatus,
} from "@/lib/types";

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
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The board reads the global store; refresh it after project actions so newly
  // materialized tasks show up without a hard reload.
  const { state, reloadWorkspace } = useStore();
  // Operator Lite: members see + work the projects assigned to them, but the owner
  // is the one who spins up new projects and assigns them.
  const isMember = !!state?.viewer?.isMember;

  // Phase build state, derived from the board's tasks. "building" = the next
  // phase's task rows don't exist yet (or the finished phase is about to
  // advance); "drafting" = the rows exist as Agent Working cards and the agents
  // are writing their deliverables. Growth campaigns run on their own weekly
  // engine, so they're excluded.
  const phaseBuildState = useCallback(
    (p: Project): "building" | "drafting" | null => {
      if (p.status !== "active" || p.kind === "growth") return null;
      const cur = (state?.tasks ?? []).filter(
        (t) => t.project_id === p.id && t.project_phase === p.current_phase,
      );
      if (cur.length === 0) return "building";
      if (cur.some((t) => t.status === "agent_working")) return "drafting";
      return cur.every((t) => t.status === "done" || t.approval_status === "rejected") ? "building" : null;
    },
    [state],
  );
  const anyBuilding = projects.some((p) => phaseBuildState(p) !== null);

  // While a phase is building/drafting, poll lightly so its Agent Working cards
  // appear within seconds and flip to Ready as each draft completes. One tick at
  // a time (skipped if the previous is still in flight — stacked polls behind a
  // slow call are what made the app feel stuck), refreshing BOTH the project
  // list and the board (loads are fast + in-place now).
  useEffect(() => {
    if (!anyBuilding) return;
    let inFlight = false;
    const t = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void getProjectsAction()
        .then(setProjects)
        .catch(() => {})
        .finally(() => {
          reloadWorkspace();
          inFlight = false;
        });
    }, 5000);
    return () => {
      clearInterval(t);
      // Build finished (or page left): one last refresh so the board shows the
      // final state of the new phase.
      reloadWorkspace();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyBuilding]);

  async function reload() {
    try {
      // Show the current state immediately — NEVER block the page on advancing
      // (materializing a phase can be slow).
      setProjects(await getProjectsAction());
    } finally {
      setLoading(false);
    }
    // Then heal wedged executions + advance/close finished phases in the
    // background via the ROUTE (a fetch runs in parallel with server actions,
    // so a slow materialization can't freeze the app), refreshing once it lands.
    void fetch("/api/projects/advance", { method: "POST" })
      .then((r) => (r.ok ? (r.json() as Promise<{ advanced?: number; healed?: number }>) : null))
      .then((adv) => {
        if (adv && ((adv.advanced ?? 0) > 0 || (adv.healed ?? 0) > 0)) {
          void getProjectsAction().then(setProjects);
          reloadWorkspace();
        }
      })
      .catch(() => {});
  }
  useEffect(() => {
    void reload();
  }, []);

  // Deep-link from the Team board: /projects?open=<id> opens that project's drawer.
  useEffect(() => {
    const openId = new URLSearchParams(window.location.search).get("open");
    if (openId) {
      setSelectedId(openId);
      window.history.replaceState(null, "", "/projects");
    }
  }, []);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          isMember
            ? "The projects assigned to you. Work through each phase and approve the deliverables as they’re ready."
            : "Set a goal. A Manager or Executive agent plans it, delegates the work across your team, and runs it to completion — you approve the plan and each deliverable."
        }
        actions={
          isMember ? undefined : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setCreatingCampaign(true)}>
                <TrendingUp className="h-4 w-4" />
                Growth campaign
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </div>
          )
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
                {isMember
                  ? "When the owner assigns you a project, it shows up here with its plan and deliverables to work through."
                  : "Hand a leadership agent a big goal — “build our website”, “launch the new offer” — and it breaks it into a phased plan your team executes."}
              </p>
            </div>
            {!isMember && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                Start a project
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                building={phaseBuildState(p)}
                onOpen={() => setSelectedId(p.id)}
                onDeleted={async () => {
                  await reload();
                  reloadWorkspace();
                }}
              />
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
      {creatingCampaign && (
        <NewCampaignDrawer
          onClose={() => setCreatingCampaign(false)}
          onCreated={async (id) => {
            setCreatingCampaign(false);
            await reload();
            setSelectedId(id);
          }}
        />
      )}
      {selected &&
        (selected.kind === "workspace" ? (
          <WorkstreamDrawer
            project={selected}
            onClose={() => setSelectedId(null)}
            onChanged={async () => {
              await reload();
            }}
            onDeleted={async () => {
              setSelectedId(null);
              await reload();
              reloadWorkspace();
            }}
          />
        ) : (
          <ProjectDrawer
            project={selected}
            building={phaseBuildState(selected)}
            onClose={() => setSelectedId(null)}
            onChanged={async () => {
              await reload();
              reloadWorkspace(); // refresh the board with newly materialized tasks
            }}
            onDeleted={async () => {
              setSelectedId(null);
              await reload();
              reloadWorkspace();
            }}
          />
        ))}
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

function ProjectCard({
  project,
  building,
  onOpen,
  onDeleted,
}: {
  project: Project;
  building: "building" | "drafting" | null;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const st = STATUS_META[project.status];
  const isGrowth = project.kind === "growth";
  const isWorkbench = project.kind === "workspace";
  const phases = project.plan.phases.length;
  const unit = isGrowth ? "Week" : "Phase";
  const progress = project.progress ?? { total: 0, done: 0 };
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function del(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    await deleteProjectAction(project.id);
    onDeleted();
  }

  return (
    <Card className="card-interactive group relative flex cursor-pointer flex-col p-4" onClick={onOpen}>
      {confirming ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-card/95 p-5 text-center backdrop-blur-[1px]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[12.5px] text-foreground/80">
            Delete this {isGrowth ? "campaign" : "project"}? Its tasks and any scheduled posts are discarded.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={del} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          className="absolute right-2 top-2 z-10 rounded-lg p-1.5 text-muted-foreground/50 opacity-0 transition hover:bg-accent hover:text-destructive group-hover:opacity-100"
          aria-label="Delete project"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="flex items-start justify-between gap-2 pr-6">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
          {st.label}
        </span>
        {isGrowth ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
            <TrendingUp className="h-3 w-3" />
            Growth
          </span>
        ) : isWorkbench ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
            <Compass className="h-3 w-3" />
            You&apos;re driving
          </span>
        ) : (
          <span className="text-[11px] capitalize text-muted-foreground">{project.owner_kind}</span>
        )}
      </div>
      <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug">{project.title}</h3>
      <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{project.summary || project.goal}</p>
      {isGrowth && project.plan.growth && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-violet-700">
          <Users className="h-3 w-3" />+{project.plan.growth.follower_goal_per_week} followers/week goal
        </p>
      )}
      <div className="mt-3 flex-1" />
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {isWorkbench ? (
          <p className="text-[11px] text-muted-foreground">
            {project.status === "done"
              ? "Closed — direction chosen"
              : "Open to lay out directions and hand parts to the Executive →"}
          </p>
        ) : project.status === "planning" ? (
          <p className="text-[12px] font-medium text-amber-700">
            {isGrowth ? "Review the campaign plan →" : "Review the plan →"}
          </p>
        ) : (
          <>
            <ProgressBar done={progress.done} total={progress.total} />
            {building ? (
              <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-700">
                <Loader2 className="h-3 w-3 animate-spin" />
                {building === "drafting" ? "Agents drafting deliverables…" : "Building next phase…"}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {project.status === "done"
                  ? isGrowth
                    ? "Campaign complete"
                    : "All phases complete"
                  : `${unit} ${Math.min(project.current_phase + 1, phases)} of ${phases}`}
              </p>
            )}
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
  const [driver, setDriver] = useState<"agent" | "me">("agent");
  const [goal, setGoal] = useState("");
  const [owner, setOwner] = useState<"manager" | "executive">("manager");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = driver === "agent" ? goal.trim().length > 0 : title.trim().length > 0;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError("");
    if (driver === "me") {
      const res = await createWorkspaceProjectAction({ title: title.trim(), goal: notes.trim() || undefined });
      setBusy(false);
      if (res.ok && res.projectId) onCreated(res.projectId);
      else setError(res.error ?? "Couldn't create the project.");
      return;
    }
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
          <h2 className="text-[17px] font-semibold">{driver === "me" ? "Start a project you drive" : "Set a goal"}</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">Who drives this?</label>
          <Segmented
            options={[
              { value: "agent", label: "An agent runs it" },
              { value: "me", label: "I drive it" },
            ]}
            value={driver}
            onChange={(v) => setDriver(v as "agent" | "me")}
          />
          <p className="text-[11.5px] text-muted-foreground">
            {driver === "agent"
              ? "A leadership agent plans the phases, delegates the work, and runs it to completion — you approve the plan and each deliverable."
              : "You lay out the directions you're weighing and work through them. Hand any one to the Executive to research, source quotes, or run outreach — it reports back; nothing sends without you."}
          </p>
        </div>

        {driver === "agent" ? (
          <>
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
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium">Project name</label>
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Framing for the reactor"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium">
                What are you trying to decide or get done? <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[80px]"
                placeholder="e.g. Settle how to build the frame — weld it, machine aluminum, or buy off-the-shelf."
              />
              <p className="text-[11.5px] text-muted-foreground">
                You&apos;ll add the directions you&apos;re weighing as workstreams once it&apos;s created.
              </p>
            </div>
          </>
        )}
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3.5">
        <Button variant="success" className="flex-1" onClick={submit} disabled={busy || !ready}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : driver === "me" ? (
            <Compass className="h-4 w-4" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {busy ? (driver === "me" ? "Creating…" : "Planning the project…") : driver === "me" ? "Create project" : "Draft the plan"}
        </Button>
      </div>
    </Drawer>
  );
}

function NewCampaignDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [goal, setGoal] = useState("");
  const [perWeek, setPerWeek] = useState(100);
  const [weeks, setWeeks] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await createGrowthCampaignAction({
      goal: goal.trim() || `Grow our X following by ${perWeek} followers a week`,
      weeks,
      followerGoalPerWeek: perWeek,
    });
    setBusy(false);
    if (res.ok && res.projectId) onCreated(res.projectId);
    else setError(res.error ?? "Couldn't plan the campaign.");
  }

  return (
    <Drawer open onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-violet-600">
            <TrendingUp className="h-3.5 w-3.5" />
            Growth campaign
          </p>
          <h2 className="text-[17px] font-semibold">Set a follower goal</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3.5">
          <p className="text-[12.5px] leading-relaxed text-violet-900/80">
            Your Executive agent turns a follower goal into a weekly plan — a realistic cadence of original
            tweets, replies, and blogs — then <span className="font-medium">auto-drafts and schedules each week's
            content for you to approve.</span> It tracks your follower count against the goal as it runs.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">The goal</label>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Gain</span>
            <Input
              type="number"
              min={1}
              value={perWeek}
              onChange={(e) => setPerWeek(Math.max(1, Number(e.target.value) || 0))}
              className="w-24 text-center tabular-nums"
            />
            <span className="text-[13px] text-muted-foreground">new followers / week, for</span>
            <Input
              type="number"
              min={1}
              max={12}
              value={weeks}
              onChange={(e) => setWeeks(Math.max(1, Math.min(12, Number(e.target.value) || 0)))}
              className="w-20 text-center tabular-nums"
            />
            <span className="text-[13px] text-muted-foreground">weeks</span>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Target: <span className="font-medium text-foreground">+{perWeek * weeks} followers</span> over{" "}
            {weeks} week{weeks === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">Anything to steer the content? (optional)</label>
          <Textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="min-h-[80px]"
            placeholder="e.g. Grow among [your ideal audience]; lean into the topics they care about most."
          />
          <p className="text-[11.5px] text-muted-foreground">
            The agent already knows your business and voice — add anything specific about who you want to reach.
          </p>
        </div>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3.5">
        <Button variant="success" className="flex-1" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Planning the campaign…" : "Draft the campaign plan"}
        </Button>
      </div>
    </Drawer>
  );
}

/** Owner action: assign this FULL project to a team member — plan, phases, and
 *  agent execution move into their portal, where they approve each deliverable.
 *  The intelligence surfaces (Executive, KPIs, CRM, inbox) stay owner-only. */
function AssignToTeamPanel({ project, onChanged }: { project: Project; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [member, setMember] = useState(project.assigned_member_id ?? "");
  const [manager, setManager] = useState(project.assigned_manager_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const managers = members.filter((m) => m.team_role === "manager");
  const assignedName = members.find((m) => m.id === project.assigned_member_id)?.name ?? null;

  async function openPanel() {
    setOpen(true);
    setError("");
    setMember(project.assigned_member_id ?? "");
    setManager(project.assigned_manager_id ?? "");
    if (!members.length) setMembers(await listTeamMembersAction());
  }

  async function submit() {
    setBusy(true);
    setError("");
    const res = await assignProjectToMemberAction(project.id, {
      member_id: member || null,
      manager_id: member ? manager || null : null,
    });
    setBusy(false);
    if ("ok" in res && res.ok) {
      setOpen(false);
      await onChanged();
    } else {
      setError("error" in res ? res.error : "Couldn't assign the project.");
    }
  }

  if (!open) {
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={openPanel}>
          <Users className="h-3.5 w-3.5" />
          {project.assigned_member_id ? "Reassign" : "Assign to team member"}
        </Button>
        {project.assigned_member_id && (
          <span className="text-[11.5px] font-medium text-emerald-700">
            Assigned{assignedName ? ` to ${assignedName}` : ""} — running in their portal
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-xl border border-border p-3">
      <p className="text-[12px] font-medium">Assign this project to a team member</p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
        The whole project — plan, phases, and agent execution — moves into their portal. They approve each
        deliverable and own the result. Your Executive, KPIs, CRM, and inbox stay private.
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Assign to</label>
          <Select value={member} onChange={(e) => setMember(e.target.value)}>
            <option value="">— unassigned (you run it) —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Overseeing manager</label>
          <Select value={manager} onChange={(e) => setManager(e.target.value)} disabled={!member}>
            <option value="">— none —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" variant="success" disabled={busy} onClick={submit}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          {member ? "Assign" : "Unassign"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ProjectDrawer({
  project,
  building,
  onClose,
  onChanged,
  onDeleted,
}: {
  project: Project;
  building: "building" | "drafting" | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Assemble every drafted deliverable (with the owner's edits) into one Word
  // document — e.g. the grant application packet. Download only; submitting is
  // always the human's step.
  async function exportPacket() {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const packet = await getProjectPacketAction(project.id);
      const count = packet?.phases.reduce((n, ph) => n + ph.items.length, 0) ?? 0;
      if (!packet || count === 0) {
        setError("No drafted documents to export yet — approve some deliverables first.");
        return;
      }
      const md = packetToMarkdown(packet);
      const base = `${slugify(project.title)}-packet-${new Date().toISOString().slice(0, 10)}`;
      downloadBlob(
        `${base}.doc`,
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(packet.title)}</title></head><body>${markdownToHtml(md)}</body></html>`,
        "application/msword",
      );
    } catch {
      setError("Couldn't assemble the packet.");
    } finally {
      setExporting(false);
    }
  }
  const st = STATUS_META[project.status];
  const progress = project.progress ?? { total: 0, done: 0 };
  const isGrowth = project.kind === "growth";

  async function discard() {
    setDeleting(true);
    setError("");
    const res = await deleteProjectAction(project.id);
    if (res.ok) {
      await onDeleted();
    } else {
      setDeleting(false);
      setError(res.error ?? "Couldn't delete the project.");
    }
  }

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
        {isGrowth && <GrowthPanel project={project} />}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">Goal</p>
          <p className="text-[13px] text-foreground/90">{project.goal}</p>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {isGrowth ? "The weekly arc" : "The plan"}
          </p>
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
                        {step.kind === "page" ? (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                            <Globe className="h-2.5 w-2.5" /> Page
                          </span>
                        ) : (
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
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {project.status === "active" && !isGrowth && (
          <p className="rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
            The current phase's tasks are on your <span className="font-medium text-foreground">Approval Center</span> board —
            approve each deliverable there. When the phase is done, the next one is released automatically.
          </p>
        )}

        {/* Discard */}
        <div className="border-t border-border pt-4">
          {confirmDelete ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-[12px] leading-relaxed text-foreground/80">
                Delete this {isGrowth ? "campaign" : "project"} permanently? Its tasks and any scheduled posts are
                discarded. Published pages stay live — remove those from Pages.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Button size="sm" variant="destructive" onClick={discard} disabled={deleting}>
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete permanently
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete this {isGrowth ? "campaign" : "project"}
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-5 py-3.5">
        {error && <p className="mb-2 text-[12.5px] text-destructive">{error}</p>}
        {building && project.status === "active" && (
          <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-sky-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {building === "drafting"
              ? "The next phase's tasks are on the board — agents are writing their deliverables now."
              : "Building the next phase — its tasks will appear on the board in a few seconds."}
          </p>
        )}
        {!isGrowth && project.status !== "cancelled" && <AssignToTeamPanel project={project} onChanged={onChanged} />}
        {!isGrowth && (project.status === "active" || project.status === "done") && (
          <div className="mb-2">
            <Button size="sm" variant="outline" disabled={exporting} onClick={exportPacket}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              Export packet (.doc)
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2">
        {project.status === "planning" ? (
          <>
            <Button
              variant="success"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                // Via the ROUTE so the minutes of phase-drafting never block
                // the tab. The project flips to active within ~2s; its tasks
                // land on the board as Agent Working cards and fill in as each
                // draft completes (the build poll keeps everything fresh).
                void fetch("/api/projects/approve", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ projectId: project.id }),
                })
                  .then(async (r) => {
                    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
                    if (!r.ok || j?.ok === false) setError(j?.error ?? "Couldn't approve the plan.");
                    await onChanged();
                  })
                  .catch(() => setError("Couldn't approve the plan."));
                // Don't hold the button hostage for the whole build — show the
                // now-active project as soon as it flips.
                setTimeout(() => {
                  void onChanged().finally(() => setBusy(false));
                }, 1500);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isGrowth ? "Approve & launch campaign" : "Approve plan & start"}
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
              onClick={() =>
                act(async () => {
                  // Via the ROUTE, not a server action: materializing the next
                  // phase can take a while, and a slow action would freeze
                  // every other action in the tab. fetch runs in parallel.
                  const r = await fetch("/api/projects/advance", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ projectId: project.id }),
                  });
                  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
                  return { ok: Boolean(r.ok && j?.ok !== false), error: j?.error };
                })
              }
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {isGrowth ? "Refresh progress" : "Check for progress"}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => act(() => cancelProjectAction(project.id))}>
              {isGrowth ? "End campaign" : "Cancel project"}
            </Button>
          </>
        ) : project.status === "done" ? (
          <span className="inline-flex items-center gap-2 text-[13px] font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {isGrowth ? "Campaign complete" : "Project complete"}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">Project {project.status}.</span>
        )}
        </div>
      </div>
    </Drawer>
  );
}

function fmtDay(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** The campaign cockpit inside a growth project's drawer: follower progress vs
 *  goal, the running cadence, and this week's scheduled posts to approve. */
function GrowthPanel({ project }: { project: Project }) {
  const { state } = useStore();
  const tz = state?.brief?.timezone;
  const growth = project.plan.growth;
  const [data, setData] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await getCampaignDataAction(project.id));
    } finally {
      setLoading(false);
    }
  }, [project.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!growth) return null;

  const followers = data?.followers ?? [];
  const baseline = followers[0]?.followers ?? null;
  const current = followers[followers.length - 1]?.followers ?? null;
  const gained = baseline != null && current != null ? current - baseline : null;
  const target = growth.follower_goal_per_week * growth.weeks;
  const pct = gained != null && target > 0 ? Math.max(0, Math.min(100, Math.round((gained / target) * 100))) : 0;

  const posts = data?.posts ?? [];
  const pending = posts.filter((p) => p.approval_status === "pending" && p.execution_status === "queued");
  const currentWeekPosts = posts.filter((p) => p.phase === project.current_phase);
  const pendingThisWeek = currentWeekPosts.filter(
    (p) => p.approval_status === "pending" && p.execution_status === "queued",
  );
  const cad = growth.cadence;

  async function approveOne(id: string) {
    setBusyId(id);
    try {
      await approveScheduledPostAction(id);
      await reload();
    } finally {
      setBusyId(null);
    }
  }
  async function approveAll() {
    setBulkBusy(true);
    try {
      await approveAllCampaignPostsAction(project.id);
      await reload();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50/70 to-transparent p-4">
      {/* Follower progress */}
      <div>
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700/80">
            <Users className="h-3.5 w-3.5" /> Followers
          </p>
          <span className="text-[11px] text-muted-foreground">
            Goal +{target.toLocaleString()} over {growth.weeks} wk
          </span>
        </div>
        {baseline == null ? (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Connect X on the <span className="font-medium text-foreground">Integrations</span> page to track your
            follower count against the goal.
          </p>
        ) : (
          <>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-[24px] font-semibold leading-none tabular-nums">
                {current?.toLocaleString()}
              </span>
              {gained != null && (
                <span
                  className={cn(
                    "mb-0.5 inline-flex items-center gap-0.5 text-[12.5px] font-medium",
                    gained >= 0 ? "text-emerald-600" : "text-muted-foreground",
                  )}
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  {gained >= 0 ? "+" : ""}
                  {gained.toLocaleString()} since start
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-violet-100">
                <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] font-medium tabular-nums text-violet-700">{pct}%</span>
            </div>
          </>
        )}
      </div>

      {/* Running cadence */}
      <div className="flex flex-wrap gap-2">
        <CadencePill icon={<MessageCircle className="h-3.5 w-3.5" />} label={`${cad.tweets_per_day}/day tweets`} />
        <CadencePill icon={<Repeat2 className="h-3.5 w-3.5" />} label={`${cad.replies_per_day}/day replies`} />
        <CadencePill
          icon={<FileText className="h-3.5 w-3.5" />}
          label={`${cad.blogs_per_week}/wk blog${cad.blogs_per_week === 1 ? "" : "s"}`}
        />
      </div>

      {/* This week's scheduled posts */}
      {project.status === "active" && (
        <div>
          <div className="flex items-center justify-between">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700/80">
              <CalendarClock className="h-3.5 w-3.5" /> This week's posts
            </p>
            {pendingThisWeek.length > 0 && (
              <Button size="sm" variant="success" disabled={bulkBusy} onClick={approveAll}>
                {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approve all {pending.length}
              </Button>
            )}
          </div>
          {loading ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : currentWeekPosts.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              Drafting this week's posts… check back in a moment.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {currentWeekPosts.map((p) => (
                <PostRow key={p.id} post={p} tz={tz} busy={busyId === p.id} onApprove={() => approveOne(p.id)} />
              ))}
            </div>
          )}
          {pending.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Pending posts won't publish until you approve them. Approved posts auto-publish at their scheduled time.
            </p>
          )}
        </div>
      )}
      {project.status === "planning" && (
        <p className="rounded-lg border border-dashed border-violet-200 p-3 text-[12px] text-violet-900/70">
          Approve the campaign below to generate and schedule week 1's content for your review.
        </p>
      )}
    </div>
  );
}

function CadencePill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white/70 px-2.5 py-1 text-[11.5px] font-medium text-violet-800">
      {icon}
      {label}
    </span>
  );
}

function PostRow({
  post,
  tz,
  busy,
  onApprove,
}: {
  post: CampaignPost;
  tz?: string;
  busy: boolean;
  onApprove: () => void;
}) {
  const posted = post.execution_status === "completed";
  const approved = post.approval_status === "approved";
  return (
    <div className="rounded-xl border border-border bg-white/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <CalendarClock className="h-3 w-3" />
          {post.scheduled_at ? fmtDay(post.scheduled_at, tz) : "Unscheduled"}
        </span>
        {posted ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> Posted
          </span>
        ) : approved ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
            <Check className="h-3 w-3" /> Approved
          </span>
        ) : (
          <Button size="sm" variant="success" disabled={busy} onClick={onApprove}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve
          </Button>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">{post.text}</p>
    </div>
  );
}

/* --------------------------- packet export ------------------------------ */

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project"
  );
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Assemble the packet as Markdown: cover, then each phase's documents in order. */
function packetToMarkdown(p: ProjectPacket): string {
  const out: string[] = [];
  out.push(`# ${p.title}`);
  if (p.goal) out.push(`**Goal:** ${p.goal}`);
  if (p.summary) out.push(p.summary);
  out.push(
    `_Assembled ${new Date().toLocaleDateString()}. Review everything before submitting — submission is always your step, never the platform's._`,
  );
  p.phases.forEach((ph, i) => {
    if (!ph.items.length) return;
    out.push(`## ${i + 1}. ${ph.title}`);
    ph.items.forEach((it) => {
      out.push(`### ${it.task}`);
      out.push(it.content.trim());
    });
  });
  return out.join("\n\n").trim() + "\n";
}

/* ------------------- owner-led projects: workstream board ---------------- */

const WS_STATUS: Record<WorkstreamStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  proposed: { label: "Proposal ready", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  delegated: { label: "Executive working", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  answered: { label: "Answered", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  chosen: { label: "Chosen", cls: "bg-emerald-600 text-white border-emerald-600" },
  parked: { label: "Parked", cls: "bg-slate-100 text-slate-400 border-slate-200" },
};

const DELEGATE_META: Record<WorkstreamDelegateKind, { label: string; icon: typeof Search; hint: string }> = {
  research: { label: "Research it", icon: Search, hint: "Live web research → a summary here" },
  quotes: { label: "Get quotes", icon: FileText, hint: "Source suppliers → RFQ drafts in the Email Manager" },
  outreach: { label: "Reach out", icon: Send, hint: "Find the right contacts → outreach drafts in the Email Manager" },
};

function refHrefFor(type: ProjectWorkstream["delegate_ref_type"], id: string | null): string | null {
  if (!type || !id) return null;
  return type === "quote_request" ? `/quotes?open=${id}` : `/outreach?open=${id}`;
}

function WorkstreamDrawer({
  project,
  onClose,
  onChanged,
  onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<ProjectWorkstream[] | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [busyClose, setBusyClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setItems(await listWorkstreamsAction(project.id));
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = project.status === "done";
  const all = items ?? [];
  const active = all.filter((w) => w.status !== "parked");
  const parkedCount = all.filter((w) => w.status === "parked").length;
  const chosen = all.find((w) => w.status === "chosen") ?? null;

  async function add() {
    const t = newTitle.trim();
    if (!t) return;
    setAdding(true);
    const res = await addWorkstreamAction(project.id, { title: t });
    setAdding(false);
    if (res.ok) {
      setNewTitle("");
      await load();
    }
  }

  async function pickWinner(workstreamId: string) {
    await closeWorkspaceProjectAction(project.id, { chosenWorkstreamId: workstreamId });
    await load();
    await onChanged();
  }

  async function del() {
    setDeleting(true);
    await deleteProjectAction(project.id);
    await onDeleted();
  }

  return (
    <Drawer open onClose={onClose}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
              <Compass className="h-3 w-3" /> You&apos;re driving
            </span>
            {done && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Closed
              </span>
            )}
          </div>
          <h2 className="mt-2 truncate text-[17px] font-semibold">{project.title}</h2>
          {project.goal && project.goal !== project.title && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{project.goal}</p>
          )}
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {done && project.summary && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Outcome</p>
            <p className="mt-1 text-[13px] text-foreground/80">{project.summary}</p>
          </div>
        )}

        {items === null ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-[13px] font-medium">No directions yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">
              Add the directions you&apos;re weighing — e.g. for a reactor frame: &ldquo;weld it&rdquo;, &ldquo;machine
              aluminum&rdquo;, &ldquo;buy off-the-shelf&rdquo;. Hand any one to the Executive to accelerate it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map((w) => (
              <WorkstreamCard
                key={w.id}
                w={w}
                done={done}
                onPickWinner={pickWinner}
                onChanged={async () => {
                  await load();
                  await onChanged();
                }}
              />
            ))}
          </div>
        )}

        {!done && (
          <div className="flex items-center gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              placeholder="Add a direction you're weighing…"
            />
            <Button size="sm" onClick={add} disabled={adding || !newTitle.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </div>
        )}

        {parkedCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {parkedCount} parked direction{parkedCount === 1 ? "" : "s"} hidden.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3.5">
        {confirmDelete ? (
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[12px] text-muted-foreground">Delete this project and all its directions?</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="destructive" onClick={del} disabled={deleting}>
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </Button>
            </div>
          </div>
        ) : done ? (
          <>
            <span className="truncate text-[12px] text-muted-foreground">{chosen ? `Chosen: ${chosen.title}` : "Closed"}</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </>
        ) : closing ? (
          <div className="w-full space-y-2">
            <Textarea
              autoFocus
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="min-h-[60px]"
              placeholder="What did you decide? (optional — recorded on the project)"
            />
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setClosing(false)} disabled={busyClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="success"
                onClick={async () => {
                  setBusyClose(true);
                  await closeWorkspaceProjectAction(project.id, { outcome: outcome.trim() || undefined });
                  setBusyClose(false);
                  setClosing(false);
                  await load();
                  await onChanged();
                }}
                disabled={busyClose}
              >
                {busyClose ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Close project
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
            <Button size="sm" variant="outline" onClick={() => setClosing(true)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Close project
            </Button>
          </>
        )}
      </div>
    </Drawer>
  );
}

function WorkstreamCard({
  w,
  done,
  onChanged,
  onPickWinner,
}: {
  w: ProjectWorkstream;
  done: boolean;
  onChanged: () => Promise<void>;
  onPickWinner: (id: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(w.notes);
  const [editingNotes, setEditingNotes] = useState(false);
  const [busy, setBusy] = useState("");
  const status = WS_STATUS[w.status];
  const href = refHrefFor(w.delegate_ref_type, w.delegate_ref_id);

  async function saveNotes() {
    setEditingNotes(false);
    if (notes === w.notes) return;
    await updateWorkstreamAction(w.id, { notes });
    await onChanged();
  }
  async function propose(kind: WorkstreamDelegateKind) {
    setBusy("propose");
    await proposeWorkstreamAction(w.id, kind);
    setBusy("");
    await onChanged();
  }
  async function runIt() {
    setBusy("run");
    await runWorkstreamAction(w.id);
    setBusy("");
    await onChanged();
  }
  async function cancelIt() {
    setBusy("cancel");
    await cancelProposalAction(w.id);
    setBusy("");
    await onChanged();
  }
  async function setStatus(s: WorkstreamStatus) {
    setBusy("status");
    await updateWorkstreamAction(w.id, { status: s });
    setBusy("");
    await onChanged();
  }
  async function remove() {
    setBusy("delete");
    await deleteWorkstreamAction(w.id);
    await onChanged();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-[13.5px] font-semibold">{w.title}</h4>
          <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium", status.cls)}>
            {w.status === "delegated" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            {status.label}
            {w.delegate_kind && w.status !== "open" ? ` · ${DELEGATE_META[w.delegate_kind].label}` : ""}
          </span>
        </div>
        {!done && w.status !== "chosen" && (
          <button
            onClick={remove}
            disabled={busy === "delete"}
            className="rounded-lg p-1 text-muted-foreground/50 hover:bg-accent hover:text-destructive"
            aria-label="Remove direction"
          >
            {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <div className="mt-2">
        {editingNotes ? (
          <Textarea
            autoFocus
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            className="min-h-[60px] text-[12.5px]"
            placeholder="Your notes on this direction…"
          />
        ) : w.notes ? (
          <p
            className={cn("whitespace-pre-wrap text-[12.5px] text-foreground/75", !done && "cursor-text")}
            onClick={() => !done && setEditingNotes(true)}
          >
            {w.notes}
          </p>
        ) : !done ? (
          <button onClick={() => setEditingNotes(true)} className="text-[12px] text-muted-foreground hover:text-foreground">
            + Add notes
          </button>
        ) : null}
      </div>

      {w.status === "proposed" && w.proposal && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            <Sparkles className="h-3 w-3" /> Executive proposes
          </p>
          <p className="mt-1 text-[12.5px] text-foreground/80">{w.proposal.approach}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button size="sm" variant="success" onClick={runIt} disabled={busy === "run"}>
              {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              Approve &amp; run
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelIt} disabled={busy === "cancel"}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-[10.5px] text-muted-foreground">Sources &amp; drafts only — nothing sends. Drafts land in the Email Manager.</p>
        </div>
      )}

      {(w.status === "delegated" || w.status === "answered") && w.findings && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Findings</p>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-foreground/80">{w.findings}</p>
          {href && (
            <a href={href} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
              {w.delegate_ref_type === "quote_request" ? "Track quotes" : "Track replies"}
              <ChevronRight className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {!done && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {w.status === "open" && (
            <>
              <span className="text-[11px] text-muted-foreground">Hand to Executive:</span>
              {(Object.keys(DELEGATE_META) as WorkstreamDelegateKind[]).map((k) => {
                const m = DELEGATE_META[k];
                const Icon = m.icon;
                return (
                  <Button key={k} size="sm" variant="outline" onClick={() => propose(k)} disabled={busy === "propose"} title={m.hint}>
                    {busy === "propose" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                    {m.label}
                  </Button>
                );
              })}
            </>
          )}
          {w.status === "delegated" && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("answered")} disabled={busy === "status"}>
              <Check className="h-3.5 w-3.5" /> Mark answered
            </Button>
          )}
          {(w.status === "open" || w.status === "delegated" || w.status === "answered") && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("parked")} disabled={busy === "status"}>
              <Ban className="h-3.5 w-3.5" /> Park
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => onPickWinner(w.id)} disabled={busy !== ""}>
            <Crown className="h-3.5 w-3.5" /> This is the one
          </Button>
        </div>
      )}
    </div>
  );
}
