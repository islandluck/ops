"use client";

import { cn } from "@/lib/cn";
import { Dot } from "@/components/ui/badge";
import { STATUS_META } from "@/lib/constants";
import { TaskCard } from "@/components/board/task-card";
import type { Task, TaskStatus } from "@/lib/types";

export function BoardColumn({
  status,
  tasks,
  agentName,
  selectedId,
  onOpen,
  draggingId,
  setDraggingId,
  onDrop,
  isOver,
  setOver,
}: {
  status: TaskStatus;
  tasks: Task[];
  agentName: (id: string) => string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onDrop: (id: string, status: TaskStatus) => void;
  isOver: boolean;
  setOver: (status: TaskStatus | null) => void;
}) {
  const meta = STATUS_META[status];

  return (
    <div className="flex h-full w-[298px] shrink-0 flex-col">
      {/* Header */}
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <Dot className={meta.dot} />
        <h3 className={cn("text-[13px] font-semibold", meta.headerText)}>{meta.label}</h3>
        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      {/* Drop area */}
      <div
        onDragOver={(e) => {
          if (draggingId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOver(status);
          }
        }}
        onDragLeave={(e) => {
          // Only clear when leaving the column entirely.
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain") || draggingId;
          if (id) onDrop(id, status);
          setOver(null);
          setDraggingId(null);
        }}
        className={cn(
          "min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-xl border-2 border-dashed p-1.5 transition-colors",
          isOver
            ? "border-primary/40 bg-primary/5"
            : "border-transparent",
        )}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            agentName={agentName(task.agent_id)}
            selected={selectedId === task.id}
            onOpen={() => onOpen(task.id)}
            onDragStart={() => setDraggingId(task.id)}
            onDragEnd={() => setDraggingId(null)}
            dragging={draggingId === task.id}
          />
        ))}

        {tasks.length === 0 && (
          <div
            className={cn(
              "flex h-24 flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-3 text-center",
              isOver && "border-primary/40",
            )}
          >
            <p className="text-[12px] font-medium text-muted-foreground/80">
              {isOver ? "Drop here" : "Nothing here"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              {meta.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
