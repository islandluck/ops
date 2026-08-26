"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ListChecks, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { PRIORITY_META } from "@/lib/constants";
import { getTaskPlanAction, planApprovalCenterAction } from "@/app/actions";
import type { TaskPlan } from "@/lib/types";

/**
 * "Plan my day" — the Executive triages the open Approval Center tasks: assigns
 * priority/risk, batches similar work, and lays out an ordered plan of action.
 */
export function PlanBanner() {
  const { reloadWorkspace } = useStore();
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [open, setOpen] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTaskPlanAction().then(setPlan);
  }, []);

  async function runPlan() {
    setPlanning(true);
    setError(null);
    const r = await planApprovalCenterAction();
    setPlanning(false);
    if ("ok" in r && r.ok) {
      setPlan(r.plan);
      setOpen(true);
      reloadWorkspace(); // pull the freshly-triaged priorities/groups onto the board
    } else {
      setError("error" in r ? r.error : "Couldn't build the plan.");
    }
  }

  return (
    <div className="shrink-0 border-b border-border bg-card px-5 py-2.5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          {plan ? (
            <span className="truncate">
              <span className="font-medium text-foreground">Today's plan</span>
              <span className="text-muted-foreground"> · {plan.task_count} tasks triaged</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              Overwhelmed? Let the Executive prioritize and group your open tasks.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {plan && (
            <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Show"} plan
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </Button>
          )}
          <Button size="sm" onClick={runPlan} disabled={planning}>
            {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
            {planning ? "Planning…" : plan ? "Re-plan" : "Plan my day"}
          </Button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {plan && open && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
          {plan.summary && <p className="text-sm leading-snug">{plan.summary}</p>}
          {plan.groups.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plan.groups.map((g, i) => (
                <div key={i} className="rounded-md border border-border bg-background p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {i + 1}. {g.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[10px] font-semibold uppercase tracking-wide",
                        PRIORITY_META[g.priority].tag,
                      )}
                    >
                      {PRIORITY_META[g.priority].label}
                    </span>
                  </div>
                  {g.note && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{g.note}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {g.task_ids.length} task{g.task_ids.length === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
