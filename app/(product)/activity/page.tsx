"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FilePlus2,
  MessageSquareDashed,
  Plug,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Segmented } from "@/components/ui/segmented";
import { useStore } from "@/lib/store";
import { formatTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ActivityEvent, EventType } from "@/lib/types";

const EVENT_STYLE: Record<EventType, { icon: LucideIcon; tone: string }> = {
  task_created: { icon: FilePlus2, tone: "text-slate-500 bg-slate-100" },
  agent_updated_draft: { icon: Sparkles, tone: "text-violet-600 bg-violet-50" },
  agent_revised: { icon: Bot, tone: "text-violet-600 bg-violet-50" },
  task_opened: { icon: Sparkles, tone: "text-slate-500 bg-slate-100" },
  approved: { icon: ThumbsUp, tone: "text-emerald-600 bg-emerald-50" },
  approved_with_edits: { icon: ThumbsUp, tone: "text-emerald-600 bg-emerald-50" },
  changes_requested: { icon: MessageSquareDashed, tone: "text-orange-600 bg-orange-50" },
  rejected: { icon: ThumbsDown, tone: "text-red-600 bg-red-50" },
  snoozed: { icon: RotateCcw, tone: "text-slate-500 bg-slate-100" },
  status_changed: { icon: RotateCcw, tone: "text-slate-500 bg-slate-100" },
  execution_started: { icon: Zap, tone: "text-primary bg-primary/10" },
  execution_completed: { icon: CheckCircle2, tone: "text-teal-600 bg-teal-50" },
  execution_failed: { icon: Zap, tone: "text-red-600 bg-red-50" },
  integration_touched: { icon: Plug, tone: "text-sky-600 bg-sky-50" },
  output_created: { icon: FilePlus2, tone: "text-slate-500 bg-slate-100" },
};

type FilterKey = "all" | "approvals" | "executions" | "agents";

const FILTER_TYPES: Record<FilterKey, EventType[] | null> = {
  all: null,
  approvals: ["approved", "approved_with_edits", "changes_requested", "rejected"],
  executions: ["execution_started", "execution_completed", "execution_failed", "integration_touched"],
  agents: ["agent_updated_draft", "agent_revised", "task_created"],
};

function dayKey(iso: string, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  const yesterday = new Date(now - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function ActivityPage() {
  const { state, selectTask } = useStore();
  const [filter, setFilter] = useState<FilterKey>("all");
  const now = Date.now();

  const groups = useMemo(() => {
    if (!state) return [];
    const types = FILTER_TYPES[filter];
    const events = state.activity.filter((e) => !types || types.includes(e.event_type));
    const out: { day: string; events: ActivityEvent[] }[] = [];
    for (const ev of events) {
      const day = dayKey(ev.created_at, now);
      const last = out[out.length - 1];
      if (last && last.day === day) last.events.push(ev);
      else out.push({ day, events: [ev] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, filter]);

  if (!state) return null;

  return (
    <>
      <PageHeader
        title="Activity log"
        description="A complete, readable record of everything your agents and you have done."
      />
      <PageBody>
        <div className="mb-5">
          <Segmented
            options={[
              { value: "all", label: "All" },
              { value: "approvals", label: "Approvals" },
              { value: "executions", label: "Executions" },
              { value: "agents", label: "Agents" },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as FilterKey)}
          />
        </div>

        <div className="space-y-7">
          {groups.map((group) => (
            <div key={group.day}>
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {group.day}
              </h2>
              <ol className="space-y-1">
                {group.events.map((ev) => {
                  const style = EVENT_STYLE[ev.event_type];
                  const Icon = style.icon;
                  const clickable = Boolean(ev.task_id);
                  return (
                    <li key={ev.id}>
                      <button
                        disabled={!clickable}
                        onClick={() => ev.task_id && selectTask(ev.task_id)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                          clickable ? "hover:bg-card" : "cursor-default",
                        )}
                      >
                        <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", style.tone)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] leading-snug text-foreground/90">{ev.summary}</p>
                          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                            <span className="capitalize">{ev.actor_type}</span> · {formatTime(ev.created_at)} · {relativeTime(ev.created_at, now)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}
