"use client";

import { Board } from "@/components/board/board";
import { ListView } from "@/components/board/list-view";
import { PlanBanner } from "@/components/board/plan-banner";
import { TopBar } from "@/components/board/top-bar";
import { useStore } from "@/lib/store";

export default function ApprovalsPage() {
  const { filters } = useStore();

  return (
    <>
      <TopBar />
      <PlanBanner />

      {filters.view === "list" ? (
        <ListView />
      ) : (
        <>
          {/* Desktop: kanban board */}
          <div className="hidden min-h-0 flex-1 sm:block">
            <Board />
          </div>
          {/* Mobile: vertical list (PRD mobile requirement) */}
          <div className="flex min-h-0 flex-1 flex-col sm:hidden">
            <ListView />
          </div>
        </>
      )}
    </>
  );
}
