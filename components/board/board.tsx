"use client";

import { useMemo, useState } from "react";
import { BoardColumn } from "@/components/board/board-column";
import { useStore } from "@/lib/store";
import { groupByStatus, visibleTasks } from "@/lib/filters";
import { STATUS_ORDER } from "@/lib/constants";
import type { TaskStatus } from "@/lib/types";

export function Board() {
  const { state, filters, selectedTaskId, selectTask, moveTask } = useStore();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);

  const now = Date.now();

  const grouped = useMemo(() => {
    if (!state) return null;
    const vis = visibleTasks(state.tasks, filters, now);
    return groupByStatus(vis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, filters]);

  const agentName = useMemo(() => {
    const map = new Map(state?.agents.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? "Agent";
  }, [state]);

  if (!state || !grouped) return null;

  const columns = filters.statuses
    ? STATUS_ORDER.filter((s) => filters.statuses!.includes(s))
    : STATUS_ORDER;

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-5 py-4 sm:px-7">
      {columns.map((status) => (
        <BoardColumn
          key={status}
          status={status}
          tasks={grouped[status]}
          agentName={agentName}
          selectedId={selectedTaskId}
          onOpen={selectTask}
          draggingId={draggingId}
          setDraggingId={setDraggingId}
          onDrop={(id, s) => moveTask(id, s)}
          isOver={overStatus === status}
          setOver={setOverStatus}
        />
      ))}
    </div>
  );
}
