import { PRIORITY_META, type SortKey } from "./constants";
import type { BoardFilters } from "./store";
import type { Category, Task, TaskStatus } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export function matchesFilters(
  task: Task,
  f: BoardFilters,
  now: number,
): boolean {
  // Archived tasks are hidden from the board. The "Archived" view flips this to
  // show only archived tasks (for review / restore).
  if (f.showArchived) {
    if (!task.archived) return false;
  } else if (task.archived) {
    return false;
  }

  if (f.categories.length && !f.categories.includes(task.category)) return false;
  if (f.risks.length && !f.risks.includes(task.risk_level)) return false;
  if (f.agentId && task.agent_id !== f.agentId) return false;
  if (f.statuses && !f.statuses.includes(task.status)) return false;

  if (f.due !== "all") {
    const due = task.due_at ? new Date(task.due_at).getTime() : null;
    if (f.due === "none" && due !== null) return false;
    if (f.due === "overdue" && !(due !== null && due < now)) return false;
    if (f.due === "soon" && !(due !== null && due >= now && due - now < DAY))
      return false;
  }

  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    const hay = [
      task.title,
      task.description,
      task.rationale,
      task.category,
      ...task.affected_systems,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function urgencyScore(task: Task, now: number): number {
  // Higher = more urgent. Overdue dominates, then soonest due, then priority.
  const pr = PRIORITY_META[task.priority].weight * 1000;
  if (!task.due_at) return pr;
  const diff = new Date(task.due_at).getTime() - now;
  if (diff < 0) return 1_000_000 + pr + Math.min(-diff / 60000, 100000);
  return pr + Math.max(0, 200000 - diff / 60000);
}

export function sortTasks(tasks: Task[], sort: SortKey, now: number): Task[] {
  const copy = [...tasks];
  switch (sort) {
    case "impact":
      copy.sort((a, b) => b.impact_score - a.impact_score);
      break;
    case "newest":
      copy.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      break;
    case "urgency":
    default:
      copy.sort((a, b) => urgencyScore(b, now) - urgencyScore(a, now));
      break;
  }
  return copy;
}

export function visibleTasks(
  tasks: Task[],
  f: BoardFilters,
  now: number,
): Task[] {
  return sortTasks(
    tasks.filter((t) => matchesFilters(t, f, now)),
    f.sort,
    now,
  );
}

export function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const out: Record<TaskStatus, Task[]> = {
    new: [],
    agent_working: [],
    ready: [],
    changes_requested: [],
    approved: [],
    done: [],
  };
  for (const t of tasks) out[t.status].push(t);
  return out;
}

export interface CategoryCount {
  active: number;
  ready: number;
  done: number;
  total: number;
}

export function categoryCounts(tasks: Task[]): Record<Category, CategoryCount> {
  const base: Record<Category, CategoryCount> = {
    growth: { active: 0, ready: 0, done: 0, total: 0 },
    admin: { active: 0, ready: 0, done: 0, total: 0 },
    content: { active: 0, ready: 0, done: 0, total: 0 },
    research: { active: 0, ready: 0, done: 0, total: 0 },
    finance: { active: 0, ready: 0, done: 0, total: 0 },
  };
  for (const t of tasks) {
    if (t.archived) continue;
    const c = base[t.category];
    c.total += 1;
    if (t.status === "done") c.done += 1;
    else c.active += 1;
    if (t.status === "ready") c.ready += 1;
  }
  return base;
}

export function countReady(tasks: Task[]): number {
  return tasks.filter((t) => t.status === "ready" && !t.archived).length;
}
