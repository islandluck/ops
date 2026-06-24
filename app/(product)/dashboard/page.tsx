"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  CategoryIcon,
  CategoryIconChip,
  StatusPill,
} from "@/components/badges";
import { EmptyState } from "@/components/app/empty-state";
import { useStore } from "@/lib/store";
import { categoryCounts } from "@/lib/filters";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/constants";
import { dueLabel, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

const AGENT_DOT: Record<string, string> = {
  working: "bg-emerald-500",
  waiting: "bg-amber-500",
  idle: "bg-slate-300",
  paused: "bg-slate-400",
};

export default function DashboardPage() {
  const { state, selectTask } = useStore();
  if (!state) return null;
  const now = Date.now();

  const tasks = state.tasks;
  const ready = tasks.filter((t) => t.status === "ready");
  const inMotion = tasks.filter(
    (t) => t.status === "approved" || t.execution_status === "executing",
  );
  const done = tasks.filter((t) => t.status === "done" && t.execution_status === "completed");
  const overdue = tasks.filter(
    (t) => t.status !== "done" && t.due_at && new Date(t.due_at).getTime() < now,
  );
  const counts = categoryCounts(tasks);

  const stats = [
    { label: "Ready for approval", value: ready.length, icon: ClipboardCheck, tone: "text-amber-600 bg-amber-50" },
    { label: "In motion", value: inMotion.length, icon: Loader2, tone: "text-primary bg-primary/10" },
    { label: "Completed", value: done.length, icon: CheckCircle2, tone: "text-teal-600 bg-teal-50" },
    { label: "Overdue", value: overdue.length, icon: TriangleAlert, tone: "text-red-600 bg-red-50" },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${state.session.user_name.split(" ")[0]}`}
        description="A 10-second read on what your agents have prepared."
        actions={
          <Link href="/approvals" className={buttonVariants({ size: "sm" })}>
            Open Approval Center
            <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />
      <PageBody>
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", s.tone)}>
                <s.icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{s.value}</p>
              <p className="text-[13px] text-muted-foreground">{s.label}</p>
            </Card>
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Needs approval */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Needs your approval</h2>
              <Link href="/approvals" className="text-[13px] font-medium text-primary hover:underline">
                View board
              </Link>
            </div>
            {ready.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={CheckCircle2}
                  title="You're all caught up"
                  description="Nothing is waiting on you right now. Agents will surface new work here as it's ready."
                />
              </div>
            ) : (
              <ul>
                {ready.slice(0, 5).map((task, i) => {
                  const cat = CATEGORY_META[task.category];
                  const due = dueLabel(task.due_at, now);
                  return (
                    <li key={task.id}>
                      <button
                        onClick={() => selectTask(task.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/60",
                          i > 0 && "border-t border-border",
                        )}
                      >
                        <CategoryIconChip category={task.category} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold">{task.title}</p>
                          <p className="truncate text-[12px] text-muted-foreground">{task.rationale}</p>
                        </div>
                        <span className={cn("shrink-0 text-[12px] font-medium", due.tone === "overdue" ? "text-red-600" : due.tone === "soon" ? "text-amber-600" : "text-muted-foreground")}>
                          {due.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Right column */}
          <div className="space-y-5">
            {/* Agents */}
            <Card className="overflow-hidden">
              <div className="border-b border-border px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">Agents</h2>
              </div>
              <ul className="divide-y divide-border">
                {state.agents.map((agent) => (
                  <li key={agent.id} className="flex items-center gap-3 px-5 py-2.5">
                    <CategoryIcon category={agent.category} className={cn("h-4 w-4", CATEGORY_META[agent.category].text)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{agent.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Last run {relativeTime(agent.last_run_at)}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] capitalize text-muted-foreground">
                      <span className={cn("h-2 w-2 rounded-full", AGENT_DOT[agent.status])} />
                      {agent.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {/* By category */}
            <Card className="overflow-hidden">
              <div className="border-b border-border px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">By category</h2>
              </div>
              <ul className="divide-y divide-border">
                {CATEGORY_ORDER.map((c) => {
                  const cc = counts[c];
                  return (
                    <li key={c} className="flex items-center gap-3 px-5 py-2.5">
                      <CategoryIcon category={c} className={cn("h-4 w-4", CATEGORY_META[c].text)} />
                      <span className="flex-1 text-[13px] font-medium">{CATEGORY_META[c].label}</span>
                      {cc.ready > 0 && (
                        <span className="inline-flex h-5 items-center rounded-full bg-amber-100 px-2 text-[11px] font-semibold text-amber-700">
                          {cc.ready} ready
                        </span>
                      )}
                      <span className="w-10 text-right text-[12px] tabular-nums text-muted-foreground">
                        {cc.active} active
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>

        {/* Recent activity */}
        <Card className="mt-5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            <Link href="/activity" className="text-[13px] font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {state.activity.slice(0, 6).map((ev) => (
              <li key={ev.id} className="flex items-center gap-3 px-5 py-2.5">
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">{ev.summary}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(ev.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </PageBody>
    </>
  );
}
