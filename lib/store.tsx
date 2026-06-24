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
  generateDraft,
  loadWorkspace,
  resetWorkspace,
  saveWorkspace,
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
};

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: "info" | "success" | "error" | "working";
}

export interface CreateTaskInput {
  title: string;
  category: Category;
  description?: string;
  risk_level?: RiskLevel;
  requires_approval?: boolean;
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
  reject: (id: string, comment?: string) => void;
  snooze: (id: string) => void;
  reassign: (id: string, agentId: string) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  createTask: (input: CreateTaskInput) => void;
  retry: (id: string) => void;

  // integrations / agents / brief
  connectIntegration: (id: string) => void;
  disconnectIntegration: (id: string) => void;
  setIntegrationMode: (id: string, mode: PermissionMode) => void;
  setAgentMode: (id: string, mode: PermissionMode) => void;
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

        // Which affected system, if any, is not connected?
        disconnected =
          task.affected_systems.find((name) => {
            const integ = prev.integrations.find((i) => i.name === name);
            return integ ? !integ.connected : false;
          }) ?? null;

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

  const approve = useCallback(
    (id: string, comment?: string, withEdits = false) => {
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
    [patchState, updateTask, logEvent, schedule, runExecution],
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
    (input: CreateTaskInput) => {
      patchState((prev) => {
        const agent = prev.agents.find((a) => a.category === input.category);
        const id = makeId("t");
        const task: Task = {
          id,
          workspace_id: prev.workspace.id,
          category: input.category,
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
    [patchState, logEvent, pushToast],
  );

  const retry = useCallback(
    (id: string) => {
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
    [patchState, updateTask, logEvent, schedule, runExecution],
  );

  /* ----------------- integrations / agents / brief ---------------- */

  const connectIntegration = useCallback(
    (id: string) => {
      patchState((prev) => {
        const integ = prev.integrations.find((i) => i.id === id);
        return {
          ...prev,
          integrations: prev.integrations.map((i) =>
            i.id === id
              ? { ...i, connected: true, account: i.account ?? "Connected account" }
              : i,
          ),
          activity: logEvent(
            prev,
            null,
            "integration_touched",
            "human",
            prev.session.user_name,
            `${prev.session.user_name} connected ${integ?.name ?? "an integration"}.`,
          ),
        };
      });
      pushToast({ tone: "success", title: "Integration connected" });
    },
    [patchState, logEvent, pushToast],
  );

  const disconnectIntegration = useCallback(
    (id: string) => {
      patchState((prev) => ({
        ...prev,
        integrations: prev.integrations.map((i) =>
          i.id === id ? { ...i, connected: false } : i,
        ),
      }));
    },
    [patchState],
  );

  const setIntegrationMode = useCallback(
    (id: string, mode: PermissionMode) => {
      patchState((prev) => ({
        ...prev,
        integrations: prev.integrations.map((i) =>
          i.id === id ? { ...i, permission_mode: mode } : i,
        ),
      }));
    },
    [patchState],
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
      reject,
      snooze,
      reassign,
      moveTask,
      createTask,
      retry,
      connectIntegration,
      disconnectIntegration,
      setIntegrationMode,
      setAgentMode,
      updateBrief,
      login,
      logout,
      enterDemo,
      completeOnboarding,
      resetDemo,
    }),
    [
      hydrated, state, loadError, loadServer, selectedTaskId, filters, toasts, setFilters, resetFilters,
      applySavedView, dismissToast, approve, requestChanges, draftTask, reject, snooze, reassign,
      moveTask, createTask, retry, connectIntegration, disconnectIntegration,
      setIntegrationMode, setAgentMode, updateBrief, login, logout, enterDemo,
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
  };
}
