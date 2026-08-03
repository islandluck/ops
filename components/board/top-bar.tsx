"use client";

import { useState } from "react";
import {
  Archive,
  ArrowUpDown,
  LayoutGrid,
  ListFilter,
  Plus,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { CreateTaskDialog } from "@/components/board/create-task-dialog";
import { CategoryIcon } from "@/components/badges";
import { useStore } from "@/lib/store";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  RISK_META,
  SORT_OPTIONS,
} from "@/lib/constants";
import { countReady } from "@/lib/filters";
import { cn } from "@/lib/cn";
import type { Category, RiskLevel } from "@/lib/types";

const DUE_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "overdue", label: "Overdue" },
  { value: "soon", label: "Due soon" },
  { value: "none", label: "No date" },
] as const;

export function TopBar() {
  const { state, filters, setFilters, resetFilters } = useStore();
  const [createOpen, setCreateOpen] = useState(false);

  const ready = state ? countReady(state.tasks) : 0;

  const activeCount =
    (filters.categories.length ? 1 : 0) +
    (filters.risks.length ? 1 : 0) +
    (filters.agentId ? 1 : 0) +
    (filters.due !== "all" ? 1 : 0) +
    (filters.statuses ? 1 : 0);

  function toggleCategory(c: Category) {
    const has = filters.categories.includes(c);
    setFilters({
      categories: has
        ? filters.categories.filter((x) => x !== c)
        : [...filters.categories, c],
    });
  }
  function toggleRisk(r: RiskLevel) {
    const has = filters.risks.includes(r);
    setFilters({
      risks: has ? filters.risks.filter((x) => x !== r) : [...filters.risks, r],
    });
  }

  const hasChips =
    filters.categories.length > 0 ||
    filters.risks.length > 0 ||
    filters.agentId !== null ||
    filters.due !== "all" ||
    filters.statuses !== null ||
    filters.search.trim() !== "";

  return (
    <div className="shrink-0 border-b border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 sm:px-7">
        {/* Title + ready count */}
        <div className="mr-1 hidden items-baseline gap-2 sm:flex">
          <h1 className="text-lg font-semibold tracking-tight">Approval Center</h1>
        </div>
        {ready > 0 && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 text-[12px] font-semibold text-amber-700 ring-1 ring-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {ready} ready for approval
          </span>
        )}

        {/* Search */}
        <div className="relative ml-auto w-full sm:w-auto sm:min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Search tasks…"
            className="h-9 pl-9"
          />
        </div>

        {/* Filters popover */}
        <Popover
          align="end"
          className="inline-flex"
          trigger={
            <span
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                activeCount
                  ? "border-primary/40 bg-primary/5 text-primary"
                  : "border-input bg-background text-foreground hover:bg-accent",
              )}
            >
              <ListFilter className="h-4 w-4" />
              Filters
              {activeCount > 0 && (
                <span className="inline-flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
                  {activeCount}
                </span>
              )}
            </span>
          }
          panelClassName="w-[280px]"
        >
          <div className="space-y-4">
            <FilterGroup label="Category">
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_ORDER.map((c) => {
                  const on = filters.categories.includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() => toggleCategory(c)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors",
                        on
                          ? CATEGORY_META[c].tag
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      <CategoryIcon category={c} className="h-3 w-3" />
                      {CATEGORY_META[c].label}
                    </button>
                  );
                })}
              </div>
            </FilterGroup>

            <FilterGroup label="Risk">
              <div className="flex flex-wrap gap-1.5">
                {(["low", "medium", "high"] as RiskLevel[]).map((r) => {
                  const on = filters.risks.includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => toggleRisk(r)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium capitalize transition-colors",
                        on ? RISK_META[r].tag : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", RISK_META[r].dot)} />
                      {r}
                    </button>
                  );
                })}
              </div>
            </FilterGroup>

            <FilterGroup label="Due">
              <div className="grid grid-cols-2 gap-1.5">
                {DUE_OPTIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setFilters({ due: d.value })}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[12px] font-medium transition-colors",
                      filters.due === d.value
                        ? "border-primary/40 bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </FilterGroup>

            <FilterGroup label="Agent">
              <select
                value={filters.agentId ?? ""}
                onChange={(e) => setFilters({ agentId: e.target.value || null })}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[13px]"
              >
                <option value="">Any agent</option>
                {state?.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </FilterGroup>

            <button
              onClick={resetFilters}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Clear all filters
            </button>
          </div>
        </Popover>

        {/* Sort */}
        <Popover
          align="end"
          className="inline-flex"
          trigger={
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium hover:bg-accent">
              <ArrowUpDown className="h-4 w-4" />
              <span className="hidden sm:inline">
                {SORT_OPTIONS.find((s) => s.key === filters.sort)?.label}
              </span>
            </span>
          }
        >
          {(close) => (
            <div className="min-w-[160px]">
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => {
                    setFilters({ sort: s.key });
                    close();
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent",
                    filters.sort === s.key && "font-semibold text-primary",
                  )}
                >
                  {s.label}
                  {filters.sort === s.key && <span className="text-primary">✓</span>}
                </button>
              ))}
            </div>
          )}
        </Popover>

        {/* View toggle */}
        <Segmented
          options={[
            { value: "board", label: <LayoutGrid className="h-4 w-4" />, title: "Board view" },
            { value: "list", label: <Rows3 className="h-4 w-4" />, title: "List view" },
          ]}
          value={filters.view}
          onChange={(v) => setFilters({ view: v })}
          className="hidden sm:inline-flex"
        />

        {/* Archived toggle */}
        <button
          onClick={() => setFilters({ showArchived: !filters.showArchived })}
          title={filters.showArchived ? "Back to active tasks" : "Show archived tasks"}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
            filters.showArchived
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-input bg-background text-foreground hover:bg-accent",
          )}
        >
          <Archive className="h-4 w-4" />
          <span className="hidden sm:inline">Archived</span>
        </button>

        {/* Create */}
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New task</span>
        </Button>
      </div>

      {/* Active filter chips */}
      {hasChips && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-5 py-2 sm:px-7">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Filters
          </span>
          {filters.search.trim() && (
            <Chip onClear={() => setFilters({ search: "" })}>
              “{filters.search.trim()}”
            </Chip>
          )}
          {filters.categories.map((c) => (
            <Chip key={c} onClear={() => toggleCategory(c)}>
              {CATEGORY_META[c].label}
            </Chip>
          ))}
          {filters.risks.map((r) => (
            <Chip key={r} onClear={() => toggleRisk(r)}>
              {RISK_META[r].label}
            </Chip>
          ))}
          {filters.agentId && (
            <Chip onClear={() => setFilters({ agentId: null })}>
              {state?.agents.find((a) => a.id === filters.agentId)?.name}
            </Chip>
          )}
          {filters.due !== "all" && (
            <Chip onClear={() => setFilters({ due: "all" })}>
              {DUE_OPTIONS.find((d) => d.value === filters.due)?.label}
            </Chip>
          )}
          {filters.statuses && (
            <Chip onClear={() => setFilters({ statuses: null })}>
              Status view
            </Chip>
          )}
          <button
            onClick={resetFilters}
            className="ml-1 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <CreateTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2.5 pr-1 text-[12px] font-medium">
      {children}
      <button
        onClick={onClear}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Remove filter"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
