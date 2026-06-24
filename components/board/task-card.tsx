"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  Loader2,
  MessageSquareDashed,
} from "lucide-react";
import { CategoryIcon } from "@/components/badges";
import { Dot } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { CATEGORY_META, RISK_META } from "@/lib/constants";
import { dueLabel } from "@/lib/format";
import type { Task } from "@/lib/types";

const DUE_TONE: Record<string, string> = {
  overdue: "text-red-600",
  soon: "text-amber-600",
  muted: "text-muted-foreground",
  none: "text-muted-foreground",
};

export function TaskCard({
  task,
  agentName,
  selected,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  task: Task;
  agentName: string;
  selected?: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging?: boolean;
}) {
  const cat = CATEGORY_META[task.category];
  const due = dueLabel(task.due_at);
  const isReady = task.status === "ready";
  const executing = task.execution_status === "executing";
  const failed = task.execution_status === "failed";
  const rejected = task.approval_status === "rejected";
  const completed = task.status === "done" && task.execution_status === "completed";

  return (
    <article
      role="button"
      tabIndex={0}
      draggable
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "card-interactive group cursor-pointer rounded-xl border bg-card p-3 text-left shadow-card outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        selected ? "border-primary/60 ring-2 ring-primary/30" : "border-border",
        isReady && !selected && "border-l-[3px] border-l-amber-400",
        dragging && "opacity-40",
      )}
    >
      {/* Top row */}
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", cat.text)}>
          <CategoryIcon category={task.category} className="h-3.5 w-3.5" />
          {cat.label}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {task.proposed_actions > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground"
              title={`${task.proposed_actions} proposed actions`}
            >
              <Layers className="h-3 w-3" />
              {task.proposed_actions}
            </span>
          )}
          <span className={cn("h-2 w-2 rounded-full", RISK_META[task.risk_level].dot)} title={RISK_META[task.risk_level].label} />
        </span>
      </div>

      {/* Title */}
      <h4 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-foreground">
        {task.title}
      </h4>

      {/* Rationale */}
      <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
        {task.rationale}
      </p>

      {/* Execution state strip */}
      {executing && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-[11.5px] font-medium text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Executing…
        </div>
      )}
      {failed && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-[11.5px] font-medium text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          Execution failed
        </div>
      )}
      {rejected && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1.5 text-[11.5px] font-medium text-slate-500">
          Rejected — not executed
        </div>
      )}

      {/* Footer */}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", cat.iconBg)}>
            <CategoryIcon category={task.category} className="h-3 w-3" />
          </span>
          <span className="truncate text-[11px] font-medium text-muted-foreground">{agentName}</span>
        </span>

        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px]">
          {completed ? (
            <span className="inline-flex items-center gap-1 text-teal-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Done
            </span>
          ) : task.status === "changes_requested" ? (
            <span className="inline-flex items-center gap-1 text-orange-600">
              <MessageSquareDashed className="h-3.5 w-3.5" /> Revising
            </span>
          ) : (
            <span className={cn("font-medium", DUE_TONE[due.tone])}>{due.text}</span>
          )}
        </span>
      </div>
    </article>
  );
}
