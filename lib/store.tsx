"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { STORAGE_KEY, type SortKey } from "./constants";
import { createSeedState } from "./seed";
import { makeId } from "./format";
import { hasSupabaseClientEnv } from "./config";
import {
  connectStripeAction,
  createTaskAction,
  advanceMyProjectsAction,
  disconnectIntegrationAction,
  generateDraft,
  loadWorkspace,
  resetWorkspace,
  runAgentAction,
  runEmailTriageAction,
  runNotionTriageAction,
  runTaskAction,
  runTaskExecutionAction,
  approveScheduledPostAction,
  scheduleTaskAction,
  unscheduleTaskAction,
  saveWorkspace,
  sendDocumentToNotionAction,
  setIntegrationModeAction,
  signOutAction,
} from "@/app/actions";
import type {
  ActivityEvent,
  Agent,
  AppState,
  ApprovalDecision,
  AssetType,
  BusinessBrief,
  Category,
  DraftRequest,
  ExecutionRun,
  ExecutionStep,
  PermissionMode,
  RiskLevel,
  Task,
  TaskStatus,
} from "./types";

/* ------------------------------------------------------------------ */
/* UI state: filters + toasts                                          */
/* ------------------------------------------------------------------ */

export interface BoardFilters {
  search: string;
  categories: Category[];
  risks: RiskLevel[];
  agentId: string | null;
  due: "all" | "overdue" | "soon" | "none";
  statuses: TaskStatus[] | null;
  sort: SortKey;
  view: "board" | "list";
  savedView: string | null;
  /** When true, the board shows ONLY archived tasks (the archive view). */
  showArchived: boolean;
}

export const DEFAULT_FILTERS: BoardFilters = {
  search: "",
  categories: [],
  risks: [],
  agentId: null,
  due: "all",
  statuses: null,
  sort: "urgency",
  view: "board",
  savedView: null,
  showArchived: false,
};

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: "info" | "success" | "error" | "working";
}

export interface CreateTaskInput {
  title: string;
  category?: Category;
  description?: string;
  risk_level?: RiskLevel;
  requires_approval?: boolean;
}

export interface CreateAgentInput {
  name: string;
  description: string;
  instructions: string;
  category: Category;
  permissions_mode?: PermissionMode;
  background_enabled?: boolean;
  allowed_integrations?: string[];
  folder?: string;
  log_activity?: boolean;
  emoji?: string;
  accent?: string;
}

export interface OnboardingPayload {
  company_name: string;
  website_url: string;
  business_description: string;
  ideal_customer_profile: string;
  goals: string[];
  voice_rules: string[];
  approvalDefault: PermissionMode;
  user_name: string;
  user_email: string;
  connected: string[];
}

interface StoreContext {
  hydrated: boolean;
  state: AppState | null;
  loadError: boolean;
  reloadWorkspace: () => void;
  /** Task currently executing live on the server (transient). */
  busyTaskId: string | null;

  // selection / drawer
  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;

  // filters
  filters: BoardFilters;
  setFilters: (patch: Partial<BoardFilters>) => void;
  resetFilters: () => void;
  applySavedView: (id: string | null) => void;

  // toasts
  toasts: Toast[];
  dismissToast: (id: string) => void;

  // task actions
  approve: (id: string, comment?: string, withEdits?: boolean) => void;
  requestChanges: (id: string, comment: string) => void;
  draftTask: (id: string) => void;
  workTask: (id: string) => Promise<void>;
  reject: (id: string, comment?: string) => void;
  /** Delete a task entirely (removes it + its decisions/runs). */
  deleteTask: (id: string) => void;
  /** Archive a task — hidden from the board, kept for history. */
  archiveTask: (id: string) => void;
  /** Restore an archived task to the board. */
  unarchiveTask: (id: string) => void;
  /** Bulk-archive every done task (clear the Done column). */
  archiveDone: () => void;
  snooze: (id: string) => void;
  /** Approve now, but auto-execute at `whenISO`. `label` is the time shown in
   *  the user's timezone (for toasts + the activity log). */
  scheduleTask: (id: string, whenISO: string, label?: string) => void;
  /** Cancel a scheduled task and return it to the board for review. */
  unscheduleTask: (id: string) => void;
  reassign: (id: string, agentId: string) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  createTask: (input: CreateTaskInput) => Promise<void>;
  retry: (id: string) => void;

  // integrations / agents / brief
  connectIntegration: (id: string) => void;
  disconnectIntegration: (id: string) => void;
  setIntegrationMode: (id: string, mode: PermissionMode) => void;
  setAgentMode: (id: string, mode: PermissionMode) => void;
  createAgent: (input: CreateAgentInput) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  deleteAgent: (id: string) => void;
  runAgent: (id: string) => Promise<void>;
  runTriage: () => Promise<void>;
  runNotionTriage: () => Promise<void>;
  sendToNotion: (id: string) => Promise<void>;
  updateBrief: (patch: Partial<BusinessBrief>) => void;

  // session
  login: (name?: string, email?: string) => void;
  logout: () => void;
  enterDemo: () => void;
  completeOnboarding: (payload: OnboardingPayload) => void;
  resetDemo: () => void;
}

const Ctx = createContext<StoreContext | null>(null);

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<BoardFilters>(DEFAULT_FILTERS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loadError, setLoadError] = useState(false);
  // Transient (not persisted): a task running real server-side execution.
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Server mode (Supabase configured) persists to Postgres via server actions;
  // demo mode persists to localStorage. Selected at runtime from env.
  const serverMode = hasSupabaseClientEnv;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFirstSave = useRef(true);

  // Always-current snapshot for async actions (AI drafting) that must read
  // the latest task/brief at call time, not a stale closure.
  const latest = useRef<AppState | null>(null);
  latest.current = state;

  // Load the workspace bundle in server mode, retrying transient failures
  // (e.g. a cold connection-pool start) before surfacing an error state.
  const loadServer = useCallback(async () => {
    setLoadError(false);
    setHydrated(false);
    // Before loading, revive any execution wedged by a crash/restart and advance
    // (or close) projects whose current phase just finished — so completing a
    // task anywhere progresses its project, not only on the Projects page.
    try {
      await advanceMyProjectsAction();
    } catch {
      /* best-effort — never block the load */
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const loaded = await loadWorkspace();
        skipFirstSave.current = true;
        setState(loaded ?? null);
        setLoadError(!loaded);
        setHydrated(true);
        return;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    setLoadError(true);
    setHydrated(true);
  }, []);

  /* hydrate (server bundle or localStorage) ------------------------- */
  useEffect(() => {
    if (serverMode) {
      void loadServer();
      return;
    }
    let next: AppState;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      next = raw ? (JSON.parse(raw) as AppState) : createSeedState(Date.now());
    } catch {
      next = createSeedState(Date.now());
    }
    setState(next);
    setHydrated(true);
  }, [serverMode, loadServer]);

  /* persist ---------------------------------------------------------- */
  useEffect(() => {
    if (!hydrated || !state) return;
    if (serverMode) {
      // Skip persisting the freshly-loaded bundle; debounce real edits.
      if (skipFirstSave.current) {
        skipFirstSave.current = false;
        return;
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveWorkspace(state).then((r) => {
          if (!r.ok && r.error) {
            const id = makeId();
            setToasts((prev) =>
              [...prev, { id, tone: "error" as const, title: "Couldn't save changes", description: r.error }].slice(-3),
            );
            setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
          }
        });
      }, 800);
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [state, hydrated, serverMode]);

  /* clear timers on unmount ----------------------------------------- */
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  /* toasts ----------------------------------------------------------- */
  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = makeId("toast");
    // Keep at most the three most recent toasts on screen.
    setToasts((prev) => [...prev, { ...t, id }].slice(-3));
    const ttl = t.tone === "working" ? 6000 : 4200;
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), ttl);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  /* helpers ---------------------------------------------------------- */
  const patchState = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => (prev ? fn(prev) : prev));
  }, []);

  const logEvent = useCallback(
    (
      s: AppState,
      task_id: string | null,
      event_type: ActivityEvent["event_type"],
      actor_type: ActivityEvent["actor_type"],
      actor_id: string,
      summary: string,
    ): ActivityEvent[] => {
      const event: ActivityEvent = {
        id: makeId("ae"),
        workspace_id: s.workspace.id,
        task_id,
        event_type,
        actor_type,
        actor_id,
        summary,
        created_at: new Date().toISOString(),
      };
      return [event, ...s.activity];
    },
    [],
  );

  const updateTask = useCallback(
    (s: AppState, id: string, patch: Partial<Task>): Task[] =>
      s.tasks.map((t) =>
        t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t,
      ),
    [],
  );

  const agentForTask = useCallback(
    (s: AppState, taskId: string): Agent | undefined => {
      const task = s.tasks.find((t) => t.id === taskId);
      return s.agents.find((a) => a.id === task?.agent_id);
    },
    [],
  );

  /* ---------------- execution engine (simulated) ------------------- */

  const runExecution = useCallback(
    (taskId: string) => {
      let task: Task | undefined;
      let disconnected: string | null = null;

      setState((prev) => {
        if (!prev) return prev;
        task = prev.tasks.find((t) => t.id === taskId);
        if (!task) return prev;

        // Demo only: surface a disconnected system as a failure (the LinkedIn
        // story). In server mode this simulated path runs only for tasks with no
        // live integration, and should simply succeed.
        disconnected = serverMode
          ? null
          : (task.affected_systems.find((name) => {
              const integ = prev.integrations.find((i) => i.name === name);
              return integ ? !integ.connected : false;
            }) ?? null);

        const steps: ExecutionStep[] = buildSteps(task);
        steps[0].status = "running";
        const run: ExecutionRun = {
          id: makeId("run"),
          task_id: taskId,
          started_at: new Date().toISOString(),
          status: "executing",
          affected_systems: task.affected_systems,
          steps,
        };
        return {
          ...prev,
          tasks: updateTask(prev, taskId, {
            status: "approved",
            execution_status: "executing",
          }),
          runs: [run, ...prev.runs.filter((r) => r.task_id !== taskId)],
          activity: logEvent(
            prev,
            taskId,
            "execution_started",
            "system",
            "sys",
            `Execution started: ${task.title}.`,
          ),
        };
      });

      pushToast({
        tone: "working",
        title: "Execution started",
        description: task ? task.title : undefined,
      });

      // Step 1 → 2
      schedule(() => {
        setState((prev) => {
          if (!prev) return prev;
          return { ...prev, runs: advanceRun(prev.runs, taskId, 0) };
        });
      }, 900);

      // Step 2 (the system-touching step): fail here if a system is disconnected
      schedule(() => {
        setState((prev) => {
          if (!prev) return prev;
          const t = prev.tasks.find((x) => x.id === taskId);
          if (!t) return prev;
          if (disconnected) {
            const err = `${disconnected} is not connected. Operator couldn't authenticate. Connect ${disconnected} in Integrations, then retry.`;
            pushToast({
              tone: "error",
              title: "Execution failed",
              description: `${disconnected} is not connected.`,
            });
            return {
              ...prev,
              tasks: updateTask(prev, taskId, { execution_status: "failed" }),
              runs: failRun(prev.runs, taskId, 1, err),
              activity: logEvent(
                prev,
                taskId,
                "execution_failed",
                "system",
                "sys",
                `Execution failed: ${disconnected} is not connected.`,
              ),
            };
          }
          return { ...prev, runs: advanceRun(prev.runs, taskId, 1) };
        });
      }, 1800);

      // Complete
      schedule(() => {
        setState((prev) => {
          if (!prev) return prev;
          const t = prev.tasks.find((x) => x.id === taskId);
          if (!t || t.execution_status === "failed") return prev;
          const summary = resultSummary(t);
          let activity = logEvent(
            prev,
            taskId,
            "execution_completed",
            "system",
            "sys",
            `Execution completed: ${t.title}.`,
          );
          const stateForTouch: AppState = { ...prev, activity };
          activity = logEvent(
            stateForTouch,
            taskId,
            "integration_touched",
            "system",
            "sys",
            `Updated ${t.affected_systems.join(", ")}.`,
          );
          pushToast({
            tone: "success",
            title: "Task completed",
            description: summary,
          });
          return {
            ...prev,
            tasks: updateTask(prev, taskId, {
              status: "done",
              execution_status: "completed",
            }),
            runs: completeRun(prev.runs, taskId, summary),
            activity,
          };
        });
      }, 2700);
    },
    [schedule, pushToast, updateTask, logEvent],
  );

  /* ----------------------- task actions ---------------------------- */

  // Approve + execute for real on the server when a connected integration is
  // involved (no client bundle writes — the server owns the execution audit).
  const executeLive = useCallback(
    (id: string, working: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current); // don't clobber server writes
      setBusyTaskId(id);
      pushToast({ tone: "working", title: working });
      void runTaskExecutionAction(id)
        .then(async (res) => {
          await loadServer();
          setBusyTaskId(null);
          if (res.ok) {
            pushToast({ tone: "success", title: "Task completed", description: res.summary });
          } else {
            pushToast({ tone: "error", title: "Execution failed", description: res.error });
          }
        })
        .catch(() => {
          setBusyTaskId(null);
          pushToast({ tone: "error", title: "Execution failed" });
        });
    },
    [pushToast, loadServer],
  );

  const approve = useCallback(
    (id: string, comment?: string, withEdits = false) => {
      const snap = latest.current;
      // A post already queued for a future time (bulk composer / growth campaign)
      // must stay scheduled — approving it flips sign-off only; the cron publishes
      // it at its time. Executing live here would fire it early.
      const t = snap?.tasks.find((task) => task.id === id);
      if (
        serverMode &&
        t &&
        t.execution_status === "queued" &&
        t.scheduled_at &&
        new Date(t.scheduled_at).getTime() > Date.now()
      ) {
        setBusyTaskId(id);
        pushToast({ tone: "working", title: "Approving — staying scheduled…" });
        void approveScheduledPostAction(id)
          .then(async (res) => {
            await loadServer();
            setBusyTaskId(null);
            if (res.ok) pushToast({ tone: "success", title: "Approved — it'll auto-publish on schedule" });
            else pushToast({ tone: "error", title: "Couldn't approve", description: res.error });
          })
          .catch(() => {
            setBusyTaskId(null);
            pushToast({ tone: "error", title: "Couldn't approve" });
          });
        return;
      }
      if (serverMode && snap && taskUsesLiveIntegration(snap, id)) {
        executeLive(id, "Approved — executing live…");
        return;
      }
      patchState((prev) => {
        const decision: ApprovalDecision = {
          id: makeId("dec"),
          task_id: id,
          decided_by: prev.session.user_name,
          decision_type: withEdits ? "approve_with_edits" : "approve",
          comment,
          created_at: new Date().toISOString(),
        };
        const task = prev.tasks.find((t) => t.id === id);
        return {
          ...prev,
          tasks: updateTask(prev, id, {
            approval_status: "approved",
            status: "approved",
          }),
          decisions: [decision, ...prev.decisions],
          activity: logEvent(
            prev,
            id,
            withEdits ? "approved_with_edits" : "approved",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} approved ${withEdits ? "(with edits) " : ""}“${task?.title ?? "task"}”.`,
          ),
        };
      });
      // Kick off execution on the next tick so state has settled.
      schedule(() => runExecution(id), 350);
    },
    [serverMode, executeLive, patchState, updateTask, logEvent, schedule, runExecution, pushToast, loadServer],
  );

  /* ---------------- AI drafting (Phase 2, server mode) ------------- */

  const applyAiDraft = useCallback(
    (id: string, content: string, isRevision: boolean) => {
      patchState((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        if (!task) return prev;
        const agentName = prev.agents.find((a) => a.id === task.agent_id)?.name ?? "The agent";
        const assets = task.assets.length
          ? task.assets.map((a, i) => (i === 0 ? { ...a, content } : a))
          : [
              {
                id: makeId(),
                task_id: id,
                asset_type: assetTypeFor(task.category),
                title: "Drafted by Claude",
                content,
              },
            ];
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  assets,
                  status: "ready",
                  approval_status: "pending",
                  execution_status: "none",
                  updated_at: new Date().toISOString(),
                }
              : t,
          ),
          agents: prev.agents.map((a) =>
            a.id === task.agent_id ? { ...a, status: "waiting" } : a,
          ),
          activity: logEvent(
            prev,
            id,
            isRevision ? "agent_revised" : "agent_updated_draft",
            "agent",
            task.agent_id,
            isRevision
              ? `${agentName} revised the draft with Claude and moved it back to Ready for Approval.`
              : `${agentName} drafted this with Claude and moved it to Ready for Approval.`,
          ),
        };
      });
    },
    [patchState, logEvent],
  );

  const draftTask = useCallback(
    (id: string) => {
      const s = latest.current;
      if (!s || !s.session.ai_enabled) return;
      const task = s.tasks.find((t) => t.id === id);
      if (!task) return;
      pushToast({ tone: "working", title: "Drafting with Claude…", description: task.title });
      patchState((prev) => ({
        ...prev,
        agents: prev.agents.map((a) =>
          a.id === task.agent_id ? { ...a, status: "working" } : a,
        ),
      }));
      void generateDraft(buildDraftRequest(s, task)).then((res) => {
        if (res.content) {
          applyAiDraft(id, res.content, task.assets.length > 0);
          pushToast({ tone: "success", title: "Draft ready", description: "Claude prepared it — review and approve." });
        } else {
          pushToast({ tone: "error", title: "Couldn't draft", description: res.error });
          patchState((prev) => ({
            ...prev,
            agents: prev.agents.map((a) =>
              a.id === task.agent_id ? { ...a, status: "idle" } : a,
            ),
          }));
        }
      });
    },
    [pushToast, patchState, applyAiDraft],
  );

  // Server-side "agent does the task": drafts the deliverable, files it as a
  // document, and moves the task to Ready. Falls back to the client draft in demo.
  const workTask = useCallback(
    async (id: string): Promise<void> => {
      const s = latest.current;
      const task = s?.tasks.find((t) => t.id === id);
      const who = s?.agents.find((a) => a.id === task?.agent_id)?.name ?? "The agent";
      if (!serverMode) {
        draftTask(id);
        return;
      }
      pushToast({ tone: "working", title: `${who} is drafting this…`, description: task?.title });
      try {
        const res = await runTaskAction(id);
        if (res.ok) {
          await loadServer();
          pushToast({ tone: "success", title: "Draft ready to review", description: res.title });
        } else {
          pushToast({ tone: "error", title: "Couldn't draft this", description: res.error });
        }
      } catch {
        pushToast({ tone: "error", title: "Couldn't draft this" });
      }
    },
    [serverMode, draftTask, pushToast, loadServer],
  );

  const requestChanges = useCallback(
    (id: string, comment: string) => {
      patchState((prev) => {
        const decision: ApprovalDecision = {
          id: makeId("dec"),
          task_id: id,
          decided_by: prev.session.user_name,
          decision_type: "request_changes",
          comment,
          created_at: new Date().toISOString(),
        };
        const task = prev.tasks.find((t) => t.id === id);
        const agent = prev.agents.find((a) => a.id === task?.agent_id);
        return {
          ...prev,
          tasks: updateTask(prev, id, {
            approval_status: "changes_requested",
            status: "changes_requested",
          }),
          agents: prev.agents.map((a) =>
            a.id === agent?.id ? { ...a, status: "working" } : a,
          ),
          decisions: [decision, ...prev.decisions],
          activity: logEvent(
            prev,
            id,
            "changes_requested",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} requested changes: “${comment}”`,
          ),
        };
      });
      const snapshot = latest.current;
      const aiOn = Boolean(snapshot?.session.ai_enabled);
      pushToast({
        tone: "info",
        title: "Sent back for changes",
        description: aiOn ? "Claude is revising the draft…" : "The agent is revising the draft…",
      });

      if (aiOn && snapshot) {
        const task = snapshot.tasks.find((t) => t.id === id);
        if (task) {
          const existing = task.assets[0]?.content ?? "";
          void generateDraft(buildDraftRequest(snapshot, task, comment, existing)).then((res) => {
            if (res.content) {
              applyAiDraft(id, res.content, true);
              pushToast({ tone: "success", title: "Draft revised", description: "Claude updated it — ready for another look." });
            } else {
              pushToast({ tone: "error", title: "Revision failed", description: res.error });
            }
          });
          return;
        }
      }

      // Demo / no-AI fallback: simulate the agent revising and returning to Ready.
      schedule(() => {
        setState((prev) => {
          if (!prev) return prev;
          const task = prev.tasks.find((t) => t.id === id);
          if (!task || task.status !== "changes_requested") return prev;
          const agent = prev.agents.find((a) => a.id === task.agent_id);
          pushToast({
            tone: "success",
            title: "Draft revised",
            description: `${agent?.name ?? "The agent"} updated the draft — ready for another look.`,
          });
          return {
            ...prev,
            tasks: updateTask(prev, id, {
              approval_status: "pending",
              status: "ready",
            }),
            agents: prev.agents.map((a) =>
              a.id === agent?.id ? { ...a, status: "waiting" } : a,
            ),
            activity: logEvent(
              prev,
              id,
              "agent_revised",
              "agent",
              task.agent_id,
              `${agent?.name ?? "Agent"} revised the draft based on your note and moved it back to Ready for Approval.`,
            ),
          };
        });
      }, 3800);
    },
    [patchState, updateTask, logEvent, schedule, pushToast, applyAiDraft],
  );

  const reject = useCallback(
    (id: string, comment?: string) => {
      patchState((prev) => {
        const decision: ApprovalDecision = {
          id: makeId("dec"),
          task_id: id,
          decided_by: prev.session.user_name,
          decision_type: "reject",
          comment,
          created_at: new Date().toISOString(),
        };
        const task = prev.tasks.find((t) => t.id === id);
        return {
          ...prev,
          tasks: updateTask(prev, id, {
            approval_status: "rejected",
            status: "done",
            execution_status: "none",
          }),
          decisions: [decision, ...prev.decisions],
          activity: logEvent(
            prev,
            id,
            "rejected",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} rejected “${task?.title ?? "task"}”.${comment ? ` Note: ${comment}` : ""}`,
          ),
        };
      });
      pushToast({ tone: "info", title: "Task rejected", description: "Nothing was executed." });
    },
    [patchState, updateTask, logEvent, pushToast],
  );

  // Remove a task entirely (and its decisions/runs). State is client-authoritative,
  // so the debounced bundle-save persists the deletion.
  const deleteTask = useCallback(
    (id: string) => {
      patchState((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== id),
        decisions: prev.decisions.filter((d) => d.task_id !== id),
        runs: prev.runs.filter((r) => r.task_id !== id),
      }));
      setSelectedTaskId((cur) => (cur === id ? null : cur));
      pushToast({ tone: "info", title: "Task deleted" });
    },
    [patchState, pushToast],
  );

  // Archive hides a task from the board (kept for history) to declutter columns.
  const archiveTask = useCallback(
    (id: string) => {
      patchState((prev) => ({ ...prev, tasks: updateTask(prev, id, { archived: true }) }));
      setSelectedTaskId((cur) => (cur === id ? null : cur));
      pushToast({ tone: "info", title: "Task archived" });
    },
    [patchState, updateTask, pushToast],
  );

  const unarchiveTask = useCallback(
    (id: string) => {
      patchState((prev) => ({ ...prev, tasks: updateTask(prev, id, { archived: false }) }));
      pushToast({ tone: "info", title: "Task restored" });
    },
    [patchState, updateTask, pushToast],
  );

  // Bulk-archive every done task — the one-click "clear the Done column".
  const archiveDone = useCallback(() => {
    const snap = latest.current;
    const n = snap ? snap.tasks.filter((t) => t.status === "done" && !t.archived).length : 0;
    patchState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.status === "done" && !t.archived ? { ...t, archived: true } : t)),
    }));
    pushToast({
      tone: n ? "success" : "info",
      title: n ? `Archived ${n} done task${n === 1 ? "" : "s"}` : "No done tasks to archive",
    });
  }, [patchState, pushToast]);

  const snooze = useCallback(
    (id: string) => {
      patchState((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        const base = task?.due_at ? new Date(task.due_at).getTime() : Date.now();
        const due = new Date(Math.max(base, Date.now()) + 24 * 60 * 60 * 1000).toISOString();
        return {
          ...prev,
          tasks: updateTask(prev, id, { due_at: due }),
          activity: logEvent(
            prev,
            id,
            "snoozed",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} snoozed “${task?.title ?? "task"}” for a day.`,
          ),
        };
      });
      pushToast({ tone: "info", title: "Snoozed", description: "Pushed out by one day." });
    },
    [patchState, updateTask, logEvent, pushToast],
  );

  const scheduleTask = useCallback(
    (id: string, whenISO: string, label?: string) => {
      if (serverMode) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        setBusyTaskId(id);
        pushToast({ tone: "working", title: "Scheduling…" });
        void scheduleTaskAction(id, whenISO, label)
          .then(async (res) => {
            await loadServer();
            setBusyTaskId(null);
            if (res.ok)
              pushToast({
                tone: "success",
                title: "Scheduled",
                description: label ? `Publishes ${label}.` : "Queued to auto-publish.",
              });
            else pushToast({ tone: "error", title: "Couldn't schedule", description: res.error });
          })
          .catch(() => {
            setBusyTaskId(null);
            pushToast({ tone: "error", title: "Couldn't schedule" });
          });
        return;
      }
      // Prototype mode (no backend): optimistic only.
      patchState((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        return {
          ...prev,
          tasks: updateTask(prev, id, {
            approval_status: "approved",
            status: "approved",
            execution_status: "queued",
            scheduled_at: whenISO,
          }),
          activity: logEvent(
            prev,
            id,
            "approved",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} scheduled “${task?.title ?? "task"}”${label ? ` to publish ${label}` : ""}.`,
          ),
        };
      });
      pushToast({
        tone: "success",
        title: "Scheduled",
        description: label ? `Publishes ${label}.` : undefined,
      });
    },
    [serverMode, pushToast, loadServer, patchState, updateTask, logEvent],
  );

  const unscheduleTask = useCallback(
    (id: string) => {
      if (serverMode) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        setBusyTaskId(id);
        void unscheduleTaskAction(id)
          .then(async (res) => {
            await loadServer();
            setBusyTaskId(null);
            if (res.ok)
              pushToast({ tone: "info", title: "Unscheduled", description: "Back on the board." });
            else pushToast({ tone: "error", title: "Couldn't unschedule", description: res.error });
          })
          .catch(() => {
            setBusyTaskId(null);
            pushToast({ tone: "error", title: "Couldn't unschedule" });
          });
        return;
      }
      patchState((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        return {
          ...prev,
          tasks: updateTask(prev, id, {
            approval_status: "pending",
            status: "ready",
            execution_status: "none",
            scheduled_at: null,
          }),
          activity: logEvent(
            prev,
            id,
            "status_changed",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} unscheduled “${task?.title ?? "task"}”.`,
          ),
        };
      });
      pushToast({ tone: "info", title: "Unscheduled" });
    },
    [serverMode, pushToast, loadServer, patchState, updateTask, logEvent],
  );

  const reassign = useCallback(
    (id: string, agentId: string) => {
      patchState((prev) => {
        const agent = prev.agents.find((a) => a.id === agentId);
        const task = prev.tasks.find((t) => t.id === id);
        return {
          ...prev,
          tasks: updateTask(prev, id, {
            agent_id: agentId,
            category: agent?.category ?? task?.category ?? "admin",
          }),
          activity: logEvent(
            prev,
            id,
            "status_changed",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} reassigned “${task?.title ?? "task"}” to ${agent?.name ?? "another agent"}.`,
          ),
        };
      });
    },
    [patchState, updateTask, logEvent],
  );

  const moveTask = useCallback(
    (id: string, status: TaskStatus) => {
      patchState((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        if (!task || task.status === status) return prev;
        return {
          ...prev,
          tasks: updateTask(prev, id, { status }),
          activity: logEvent(
            prev,
            id,
            "status_changed",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} moved “${task.title}” to ${labelForStatus(status)}.`,
          ),
        };
      });
    },
    [patchState, updateTask, logEvent],
  );

  const createTask = useCallback(
    async (input: CreateTaskInput): Promise<void> => {
      // Server mode: Operator plans the task (intent → integrations → draft)
      // before it lands, so it's ready to review and execute for real.
      if (serverMode) {
        pushToast({
          tone: "working",
          title: "Operator is planning this task…",
          description: input.title,
        });
        try {
          const res = await createTaskAction({ title: input.title, notes: input.description });
          await loadServer();
          if (res.ok) {
            pushToast({ tone: "success", title: "Task ready to review", description: res.title });
          } else {
            pushToast({ tone: "error", title: "Couldn't create task", description: res.error });
          }
        } catch {
          pushToast({ tone: "error", title: "Couldn't create task" });
        }
        return;
      }

      // Demo mode: local-only task (no server-side planning available).
      const category = input.category ?? "growth";
      patchState((prev) => {
        const agent = prev.agents.find((a) => a.category === category);
        const id = makeId("t");
        const task: Task = {
          id,
          workspace_id: prev.workspace.id,
          category,
          title: input.title,
          description: input.description ?? "Created by you.",
          rationale: "Added manually from the Approval Center.",
          status: "new",
          risk_level: input.risk_level ?? "low",
          priority: "medium",
          due_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          agent_id: agent?.id ?? prev.agents[0].id,
          created_by_type: "human",
          requires_approval: input.requires_approval ?? true,
          approval_status: "pending",
          execution_status: "none",
          affected_systems: [],
          proposed_actions: 0,
          impact_score: 30,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          assets: [],
        };
        return {
          ...prev,
          tasks: [task, ...prev.tasks],
          activity: logEvent(
            prev,
            id,
            "task_created",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} created “${input.title}”.`,
          ),
        };
      });
      pushToast({ tone: "success", title: "Task created" });
    },
    [serverMode, patchState, logEvent, pushToast, loadServer],
  );

  const retry = useCallback(
    (id: string) => {
      const snap = latest.current;
      if (serverMode && snap && taskUsesLiveIntegration(snap, id)) {
        executeLive(id, "Retrying execution…");
        return;
      }
      // Reset to a clean approved state and run execution again.
      patchState((prev) => ({
        ...prev,
        tasks: updateTask(prev, id, { execution_status: "queued" }),
        activity: logEvent(
          prev,
          id,
          "execution_started",
          "human",
          prev.session.user_name,
          `${prev.session.user_name} retried execution.`,
        ),
      }));
      schedule(() => runExecution(id), 250);
    },
    [serverMode, executeLive, patchState, updateTask, logEvent, schedule, runExecution],
  );

  /* ----------------- integrations / agents / brief ---------------- */

  const connectIntegration = useCallback(
    (id: string) => {
      const s = latest.current;
      const integ = s?.integrations.find((i) => i.id === id);
      if (serverMode && integ) {
        const provider = integ.oauth_provider;
        // All OAuth providers (Google, HubSpot, Notion) use the same connect route;
        // Stripe (api key) is handled separately below.
        if (provider && provider !== "stripe") {
          if (!integ.configured) {
            pushToast({
              tone: "error",
              title: `${integ.name} needs setup`,
              description: "Add this provider's OAuth credentials to the server env (see PHASE3.md).",
            });
            return;
          }
          // Full-page redirect into the OAuth consent flow.
          window.location.href = `/api/integrations/${provider}/connect`;
          return;
        }
        if (provider === "stripe") {
          if (!integ.configured) {
            pushToast({ tone: "error", title: "Stripe needs setup", description: "Set STRIPE_SECRET_KEY on the server (see PHASE3.md)." });
            return;
          }
          pushToast({ tone: "working", title: "Connecting Stripe…" });
          void connectStripeAction().then((res) => {
            if (res.ok) {
              void loadServer();
              pushToast({ tone: "success", title: "Stripe connected", description: res.account });
            } else {
              pushToast({ tone: "error", title: "Couldn't connect Stripe", description: res.error });
            }
          });
          return;
        }
        pushToast({ tone: "info", title: `${integ.name} isn't wired yet`, description: "This connector is coming in a future update." });
        return;
      }
      // Demo mode: local mock connect.
      patchState((prev) => ({
        ...prev,
        integrations: prev.integrations.map((i) =>
          i.id === id ? { ...i, connected: true, account: i.account ?? "Connected account" } : i,
        ),
        activity: logEvent(
          prev,
          null,
          "integration_touched",
          "human",
          prev.session.user_name,
          `${prev.session.user_name} connected ${integ?.name ?? "an integration"}.`,
        ),
      }));
      pushToast({ tone: "success", title: "Integration connected" });
    },
    [serverMode, patchState, logEvent, pushToast, loadServer],
  );

  const disconnectIntegration = useCallback(
    (id: string) => {
      patchState((prev) => {
        const provider = prev.integrations.find((i) => i.id === id)?.oauth_provider;
        return {
          ...prev,
          integrations: prev.integrations.map((i) =>
            i.id === id || (provider && i.oauth_provider === provider)
              ? { ...i, connected: false, account: undefined }
              : i,
          ),
        };
      });
      if (serverMode) {
        void disconnectIntegrationAction(id);
        pushToast({ tone: "info", title: "Disconnected" });
      }
    },
    [serverMode, patchState, pushToast],
  );

  const setIntegrationMode = useCallback(
    (id: string, mode: PermissionMode) => {
      patchState((prev) => ({
        ...prev,
        integrations: prev.integrations.map((i) =>
          i.id === id ? { ...i, permission_mode: mode } : i,
        ),
      }));
      if (serverMode) void setIntegrationModeAction(id, mode);
    },
    [serverMode, patchState],
  );

  const setAgentMode = useCallback(
    (id: string, mode: PermissionMode) => {
      patchState((prev) => ({
        ...prev,
        agents: prev.agents.map((a) =>
          a.id === id ? { ...a, permissions_mode: mode } : a,
        ),
      }));
      pushToast({ tone: "info", title: "Permission updated" });
    },
    [patchState, pushToast],
  );

  /* ------------------- agent personas (build / edit) -------------- */

  const createAgent = useCallback(
    (input: CreateAgentInput) => {
      patchState((prev) => {
        const agent: Agent = {
          id: makeId(),
          workspace_id: prev.workspace.id,
          name: input.name.trim() || "New Agent",
          category: input.category,
          status: "idle",
          permissions_mode: input.permissions_mode ?? "approval",
          description: input.description,
          last_run_at: new Date().toISOString(),
          tasks_prepared: 0,
          instructions: input.instructions,
          folder: input.folder?.trim() || input.name.trim() || "General",
          background_enabled: input.background_enabled ?? false,
          allowed_integrations: input.allowed_integrations ?? [],
          log_activity: input.log_activity ?? true,
          tier: "worker",
          premium: false,
          created_by_type: "user",
          emoji: input.emoji || "🤖",
          accent: input.accent || "indigo",
          archived: false,
        };
        return { ...prev, agents: [...prev.agents, agent] };
      });
      pushToast({ tone: "success", title: "Agent created", description: input.name });
    },
    [patchState, pushToast],
  );

  const updateAgent = useCallback(
    (id: string, patch: Partial<Agent>) => {
      patchState((prev) => ({
        ...prev,
        agents: prev.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    [patchState],
  );

  const deleteAgent = useCallback(
    (id: string) => {
      patchState((prev) => {
        const a = prev.agents.find((x) => x.id === id);
        if (!a || a.created_by_type !== "user") return prev; // only custom agents
        return { ...prev, agents: prev.agents.filter((x) => x.id !== id) };
      });
      pushToast({ tone: "info", title: "Agent removed" });
    },
    [patchState, pushToast],
  );

  const runAgent = useCallback(
    async (id: string) => {
      const s = latest.current;
      const agent = s?.agents.find((a) => a.id === id);
      if (!agent || agent.premium) {
        pushToast({ tone: "info", title: "Premium agent", description: "Manager & Executive are coming soon." });
        return;
      }
      if (!serverMode) {
        // Demo: create a local placeholder task so the flow is visible.
        patchState((prev) => {
          const taskId = makeId();
          const task: Task = {
            id: taskId,
            workspace_id: prev.workspace.id,
            category: agent.category,
            title: `${agent.name}: prepared a new task`,
            description: "A task this agent would prepare. Connect the backend + AI to generate real work.",
            rationale: "Generated on demand from this agent.",
            status: "ready",
            risk_level: "low",
            priority: "medium",
            due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
            agent_id: agent.id,
            created_by_type: "agent",
            requires_approval: agent.permissions_mode !== "auto",
            approval_status: "pending",
            execution_status: "none",
            affected_systems: agent.allowed_integrations,
            proposed_actions: 1,
            impact_score: 40,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            assets: [],
          };
          return { ...prev, tasks: [task, ...prev.tasks] };
        });
        pushToast({ tone: "success", title: `${agent.name} prepared a task` });
        return;
      }
      // Server: real AI generation + persistence.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pushToast({ tone: "working", title: `${agent.name} is working…` });
      try {
        const res = await runAgentAction(id);
        await loadServer();
        if (res.ok) {
          pushToast({
            tone: "success",
            title: `${agent.name} prepared a task`,
            description: res.shipped ? `${res.taskTitle} — shipped automatically.` : res.taskTitle,
          });
        } else {
          pushToast({ tone: "error", title: "Agent couldn't run", description: res.error });
        }
      } catch {
        pushToast({ tone: "error", title: "Agent couldn't run" });
      }
    },
    [serverMode, patchState, pushToast, loadServer],
  );

  const runTriage = useCallback(async (): Promise<void> => {
    if (!serverMode) {
      pushToast({ tone: "info", title: "Email triage needs the live backend." });
      return;
    }
    pushToast({ tone: "working", title: "Admin agent is triaging your inbox…" });
    try {
      const res = await runEmailTriageAction();
      await loadServer();
      if (res.ok) {
        const parts: string[] = [];
        if (res.replyTasks) parts.push(`${res.replyTasks} reply draft${res.replyTasks === 1 ? "" : "s"}`);
        if (res.actionTasks) parts.push(`${res.actionTasks} task${res.actionTasks === 1 ? "" : "s"}`);
        if (res.remaining) parts.push(`${res.remaining} more to triage`);
        pushToast({
          tone: "success",
          title: res.triaged
            ? `Triaged ${res.triaged} email${res.triaged === 1 ? "" : "s"}`
            : "No new email to triage",
          description: parts.join(" · ") || (res.triaged ? "See the triage digest on your board." : undefined),
        });
      } else {
        pushToast({ tone: "error", title: "Triage failed", description: res.error });
      }
    } catch {
      pushToast({ tone: "error", title: "Triage failed" });
    }
  }, [serverMode, pushToast, loadServer]);

  const runNotionTriage = useCallback(async (): Promise<void> => {
    if (!serverMode) {
      pushToast({ tone: "info", title: "Notion triage needs the live backend." });
      return;
    }
    pushToast({ tone: "working", title: "Reading your Notion pages…" });
    try {
      const res = await runNotionTriageAction();
      await loadServer();
      if (res.ok) {
        pushToast({
          tone: "success",
          title: res.actions
            ? `Created ${res.actions} task${res.actions === 1 ? "" : "s"} from Notion`
            : "No new action items in Notion",
          description: res.actions
            ? `${res.drafted ?? 0} came with a ready draft — see your board.`
            : res.pages
              ? `Scanned ${res.pages} page${res.pages === 1 ? "" : "s"}, nothing new to do.`
              : undefined,
        });
      } else {
        pushToast({ tone: "error", title: "Notion triage failed", description: res.error });
      }
    } catch {
      pushToast({ tone: "error", title: "Notion triage failed" });
    }
  }, [serverMode, pushToast, loadServer]);

  const sendToNotion = useCallback(
    async (id: string): Promise<void> => {
      if (!serverMode) {
        pushToast({ tone: "info", title: "Send to Notion needs the live backend." });
        return;
      }
      pushToast({ tone: "working", title: "Sending to Notion…" });
      try {
        const res = await sendDocumentToNotionAction(id);
        if (res.ok) {
          await loadServer();
          pushToast({ tone: "success", title: "Sent to Notion", description: "Open it from the document." });
        } else {
          pushToast({ tone: "error", title: "Couldn't send to Notion", description: res.error });
        }
      } catch {
        pushToast({ tone: "error", title: "Couldn't send to Notion" });
      }
    },
    [serverMode, pushToast, loadServer],
  );

  const updateBrief = useCallback(
    (patch: Partial<BusinessBrief>) => {
      patchState((prev) => ({
        ...prev,
        brief: { ...prev.brief, ...patch, updated_at: new Date().toISOString() },
      }));
      pushToast({ tone: "success", title: "Business brief saved" });
    },
    [patchState, pushToast],
  );

  /* --------------------------- session ----------------------------- */

  const login = useCallback(
    (name?: string, email?: string) => {
      patchState((prev) => ({
        ...prev,
        session: {
          ...prev.session,
          authenticated: true,
          user_name: name?.trim() || prev.session.user_name,
          user_email: email?.trim() || prev.session.user_email,
        },
      }));
    },
    [patchState],
  );

  const logout = useCallback(() => {
    if (serverMode) {
      void signOutAction();
      return;
    }
    patchState((prev) => ({
      ...prev,
      session: { ...prev.session, authenticated: false },
    }));
  }, [patchState, serverMode]);

  const enterDemo = useCallback(() => {
    patchState((prev) => ({
      ...prev,
      session: { ...prev.session, authenticated: true, onboarded: true },
    }));
  }, [patchState]);

  const completeOnboarding = useCallback(
    (p: OnboardingPayload) => {
      patchState((prev) => ({
        ...prev,
        session: {
          ...prev.session,
          authenticated: true,
          onboarded: true,
          user_name: p.user_name || prev.session.user_name,
          user_email: p.user_email || prev.session.user_email,
        },
        brief: {
          ...prev.brief,
          company_name: p.company_name || prev.brief.company_name,
          website_url: p.website_url || prev.brief.website_url,
          business_description: p.business_description || prev.brief.business_description,
          ideal_customer_profile:
            p.ideal_customer_profile || prev.brief.ideal_customer_profile,
          goals: p.goals.length ? p.goals : prev.brief.goals,
          voice_rules: p.voice_rules.length ? p.voice_rules : prev.brief.voice_rules,
          connected_systems: p.connected.length ? p.connected : prev.brief.connected_systems,
          updated_at: new Date().toISOString(),
        },
        agents: prev.agents.map((a) => ({ ...a, permissions_mode: p.approvalDefault })),
        integrations: prev.integrations.map((i) =>
          p.connected.includes(i.name) ? { ...i, connected: true } : i,
        ),
      }));
    },
    [patchState],
  );

  const resetDemo = useCallback(() => {
    if (serverMode) {
      skipFirstSave.current = true;
      void resetWorkspace().then((fresh) => {
        if (fresh) {
          setState(fresh);
          setSelectedTaskId(null);
          setFiltersState(DEFAULT_FILTERS);
        }
        pushToast({ tone: "success", title: "Workspace reset" });
      });
      return;
    }
    const fresh = createSeedState(Date.now());
    setState(fresh);
    setSelectedTaskId(null);
    setFiltersState(DEFAULT_FILTERS);
    pushToast({ tone: "success", title: "Demo data reset" });
  }, [pushToast, serverMode]);

  /* --------------------------- filters ----------------------------- */

  const setFilters = useCallback((patch: Partial<BoardFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch, savedView: patch.savedView ?? null }));
  }, []);

  const resetFilters = useCallback(() => setFiltersState(DEFAULT_FILTERS), []);

  const applySavedView = useCallback((id: string | null) => {
    setFiltersState(() => {
      const base = { ...DEFAULT_FILTERS, savedView: id };
      switch (id) {
        case "needs_approval":
          return { ...base, statuses: ["ready"], view: "list", sort: "urgency" };
        case "high_risk":
          return { ...base, risks: ["high"], sort: "urgency" };
        case "due_soon":
          return { ...base, due: "soon", sort: "urgency" };
        case "in_motion":
          return { ...base, statuses: ["agent_working", "approved"] };
        case "recently_done":
          return { ...base, statuses: ["done"], view: "list", sort: "newest" };
        default:
          return DEFAULT_FILTERS;
      }
    });
  }, []);

  const value: StoreContext = useMemo(
    () => ({
      hydrated,
      state,
      loadError,
      reloadWorkspace: loadServer,
      busyTaskId,
      selectedTaskId,
      selectTask: setSelectedTaskId,
      filters,
      setFilters,
      resetFilters,
      applySavedView,
      toasts,
      dismissToast,
      approve,
      requestChanges,
      draftTask,
      workTask,
      reject,
      deleteTask,
      archiveTask,
      unarchiveTask,
      archiveDone,
      snooze,
      scheduleTask,
      unscheduleTask,
      reassign,
      moveTask,
      createTask,
      retry,
      connectIntegration,
      disconnectIntegration,
      setIntegrationMode,
      setAgentMode,
      createAgent,
      updateAgent,
      deleteAgent,
      runAgent,
      runTriage,
      runNotionTriage,
      sendToNotion,
      updateBrief,
      login,
      logout,
      enterDemo,
      completeOnboarding,
      resetDemo,
    }),
    [
      hydrated, state, loadError, loadServer, busyTaskId, selectedTaskId, filters, toasts, setFilters, resetFilters,
      applySavedView, dismissToast, approve, requestChanges, draftTask, workTask, reject,
      deleteTask, archiveTask, unarchiveTask, archiveDone, snooze,
      scheduleTask, unscheduleTask, reassign,
      moveTask, createTask, retry, connectIntegration, disconnectIntegration,
      setIntegrationMode, setAgentMode, createAgent, updateAgent, deleteAgent, runAgent, runTriage, runNotionTriage, sendToNotion, updateBrief, login, logout, enterDemo,
      completeOnboarding, resetDemo,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Pure execution helpers                                              */
/* ------------------------------------------------------------------ */

function buildSteps(task: Task): ExecutionStep[] {
  const systems = task.affected_systems.length
    ? task.affected_systems.join(" & ")
    : "connected systems";
  const verb =
    task.category === "finance"
      ? "Process"
      : task.category === "content"
        ? "Publish"
        : "Run";
  return [
    { label: "Verify everything is still current", status: "pending" },
    {
      label: `${verb} ${task.proposed_actions > 0 ? `${task.proposed_actions} ` : ""}${task.proposed_actions === 1 || task.proposed_actions === 0 ? "action" : "actions"}`,
      status: "pending",
    },
    { label: `Log results to ${systems}`, status: "pending" },
  ];
}

function advanceRun(runs: ExecutionRun[], taskId: string, doneIdx: number): ExecutionRun[] {
  return runs.map((r) => {
    if (r.task_id !== taskId) return r;
    const steps = r.steps.map((s, i) => {
      if (i === doneIdx) return { ...s, status: "done" as const };
      if (i === doneIdx + 1) return { ...s, status: "running" as const };
      return s;
    });
    return { ...r, steps };
  });
}

function failRun(
  runs: ExecutionRun[],
  taskId: string,
  failIdx: number,
  error: string,
): ExecutionRun[] {
  return runs.map((r) => {
    if (r.task_id !== taskId) return r;
    const steps = r.steps.map((s, i) =>
      i === failIdx ? { ...s, status: "failed" as const } : s,
    );
    return {
      ...r,
      status: "failed",
      error_message: error,
      completed_at: new Date().toISOString(),
      steps,
    };
  });
}

function completeRun(runs: ExecutionRun[], taskId: string, summary: string): ExecutionRun[] {
  return runs.map((r) => {
    if (r.task_id !== taskId) return r;
    return {
      ...r,
      status: "completed",
      completed_at: new Date().toISOString(),
      result_summary: summary,
      steps: r.steps.map((s) => ({ ...s, status: "done" as const })),
    };
  });
}

function resultSummary(task: Task): string {
  const n = task.proposed_actions;
  switch (task.category) {
    case "growth":
      return n > 0 ? `${n} actions sent and logged to your CRM.` : "Completed and logged to your CRM.";
    case "finance":
      return n > 0 ? `${n} items processed via Stripe.` : "Processed successfully.";
    case "content":
      return "Published and recorded in the activity log.";
    case "admin":
      return n > 0 ? `${n} items handled.` : "Handled successfully.";
    default:
      return "Completed successfully.";
  }
}

function labelForStatus(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    new: "New",
    agent_working: "Agent Working",
    ready: "Ready for Approval",
    changes_requested: "Changes Requested",
    approved: "Approved",
    done: "Done",
  };
  return map[status];
}

/** Does the task touch an integration that is connected AND provider-configured? */
function taskUsesLiveIntegration(s: AppState, taskId: string): boolean {
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return false;
  return task.affected_systems.some((name) => {
    const integ = s.integrations.find((i) => i.name === name);
    return Boolean(integ?.connected && integ?.configured);
  });
}

function assetTypeFor(category: Category): AssetType {
  if (category === "content") return "document";
  if (category === "research") return "summary";
  return "email";
}

function buildDraftRequest(
  s: AppState,
  task: Task,
  instruction?: string,
  existingDraft?: string,
): DraftRequest {
  const agent = s.agents.find((a) => a.id === task.agent_id);
  return {
    category: task.category,
    title: task.title,
    description: task.description,
    rationale: task.rationale,
    instruction,
    existingDraft,
    companyName: s.brief.company_name,
    companyContext: `${s.brief.business_description} ${s.brief.core_offer}`.trim(),
    idealCustomer: s.brief.ideal_customer_profile,
    voiceRules: s.brief.voice_rules,
    restrictedPhrases: s.brief.restricted_phrases,
    xPost: task.affected_systems.includes("X (Twitter)"),
    agentName: agent?.name,
    agentInstructions: agent?.instructions,
  };
}
