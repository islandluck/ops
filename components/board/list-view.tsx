"use client";

import { useMemo } from "react";
import { ChevronRight, Layers } from "lucide-react";
import { CategoryIconChip, CategoryIcon, StatusPill } from "@/components/badges";
import { EmptyState } from "@/components/app/empty-state";
import { useStore } from "@/lib/store";
import { groupByStatus, visibleTasks } from "@/lib/filters";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  RISK_META,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/constants";
import { dueLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

const DUE_TONE: Record<string, string> = {
  overdue: "text-red-600",
  soon: "text-amber-600",
  muted: "text-muted-foreground",
  none: "text-muted-foreground",
};

export function ListView() {
  const { state, filters, setFilters, selectedTaskId, selectTask } = useStore();
  const now = Date.now();

  const grouped = useMemo(() => {
    if (!state) return null;
    return groupByStatus(visibleTasks(state.tasks, filters, now));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, filters]);

  const agentName = useMemo(() => {
    const map = new Map(state?.agents.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? "Agent";
  }, [state]);

  if (!state || !grouped) return null;

  const statuses = (filters.statuses
    ? STATUS_ORDER.filter((s) => filters.statuses!.includes(s))
    : STATUS_ORDER
  ).filter((s) => grouped[s].length > 0);

  const total = statuses.reduce((a, s) => a + grouped[s].length, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Mobile category tabs */}
      <div className="no-scrollbar sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-border bg-canvas/95 px-4 py-2.5 backdrop-blur sm:hidden">
        <Tab
          active={filters.categories.length === 0}
          onClick={() => setFilters({ categories: [], statuses: null })}
        >
          All
        </Tab>
        {CATEGORY_ORDER.map((c) => (
          <Tab
            key={c}
            active={filters.categories.length === 1 && filters.categories[0] === c}
            onClick={() => setFilters({ categories: [c], statuses: null })}
          >
            <CategoryIcon category={c} className="h-3.5 w-3.5" />
            {CATEGORY_META[c].label}
          </Tab>
        ))}
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
        {total === 0 ? (
          <EmptyState
            title="No tasks match your filters"
            description="Try clearing a filter or switching saved views."
            actionLabel="Clear filters"
            onAction={() => setFilters({ categories: [], risks: [], agentId: null, due: "all", statuses: null, search: "" })}
          />
        ) : (
          <div className="space-y-6">
            {statuses.map((status) => (
              <section key={status}>
                <div className="mb-2 flex items-center gap-2">
                  <StatusPill status={status} />
                  <span className="text-[12px] text-muted-foreground">
                    {grouped[status].length}
                  </span>
                  <span className="ml-2 hidden text-[12px] text-muted-foreground/70 sm:inline">
                    {STATUS_META[status].description}
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  {grouped[status].map((task, i) => {
                    const cat = CATEGORY_META[task.category];
                    const due = dueLabel(task.due_at, now);
                    return (
                      <button
                        key={task.id}
                        onClick={() => selectTask(task.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/60",
                          i > 0 && "border-t border-border",
                          selectedTaskId === task.id && "bg-primary/5",
                        )}
                      >
                        <CategoryIconChip category={task.category} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-foreground">
                            {task.title}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
                            <span className={cn("font-medium", cat.text)}>{cat.label}</span>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="truncate">{agentName(task.agent_id)}</span>
                          </p>
                        </div>
                        <div className="hidden shrink-0 items-center gap-3 sm:flex">
                          {task.proposed_actions > 0 && (
                            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                              <Layers className="h-3.5 w-3.5" />
                              {task.proposed_actions}
                            </span>
                          )}
                          <span
                            className={cn("h-2 w-2 rounded-full", RISK_META[task.risk_level].dot)}
                            title={RISK_META[task.risk_level].label}
                          />
                          <span className={cn("w-20 text-right text-[12px] font-medium", DUE_TONE[due.tone])}>
                            {due.text}
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
