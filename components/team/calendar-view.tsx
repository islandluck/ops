"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  createTeamEventAction,
  deleteTeamEventAction,
  getTeamCalendarAction,
  getTeamCalendarRangeAction,
} from "@/app/actions";
import type { CalendarItem, TeamEventKind, TeamMember } from "@/lib/types";

/* ------------------------------- grid config ------------------------------- */

const START_HOUR = 7; // first row (7 AM)
const END_HOUR = 20; // last line (8 PM)
const ROW_H = 56; // px per hour
const DAY_COUNT = 5; // Mon–Fri work week (matches the design)
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const TOTAL_H = HOURS.length * ROW_H;
const GRID_COLS = `56px repeat(${DAY_COUNT}, minmax(0, 1fr))`;

/** Solid block color for a timed event, by kind. */
const EVENT_BG: Record<"meeting" | "one_on_one" | "event", string> = {
  meeting: "bg-sky-600 hover:bg-sky-700 text-white",
  one_on_one: "bg-violet-600 hover:bg-violet-700 text-white",
  event: "bg-emerald-600 hover:bg-emerald-700 text-white",
};
/** Left-marker color in the Upcoming list, by kind. */
const MARK: Record<CalendarItem["kind"], string> = {
  meeting: "bg-sky-500",
  one_on_one: "bg-violet-500",
  event: "bg-emerald-500",
  deadline: "bg-amber-500",
};
const KIND_LABEL: Record<CalendarItem["kind"], string> = {
  meeting: "Meeting",
  one_on_one: "1:1",
  event: "Event",
  deadline: "Deadline",
};

/* --------------------------------- helpers --------------------------------- */

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function hourLabel(h: number): string {
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${ap}`;
}
function timeStr(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
function weekRangeLabel(monday: Date): string {
  const end = addDays(monday, DAY_COUNT - 1);
  const sameMonth = monday.getMonth() === end.getMonth();
  const md = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return sameMonth
    ? `${md(monday)} – ${end.getDate()}`
    : `${md(monday)} – ${md(end)}`;
}
/** `YYYY-MM-DDTHH:mm` in LOCAL time (for <input type=datetime-local>). */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Top offset (px) for an event's start time within the hours body. */
function topFor(iso: string): number {
  const d = new Date(iso);
  const hrs = d.getHours() + d.getMinutes() / 60;
  return Math.max(0, Math.min((hrs - START_HOUR) * ROW_H, TOTAL_H - 22));
}

/* ------------------------------- add dialog -------------------------------- */

function EventDialog({
  open,
  members,
  onClose,
  onSaved,
}: {
  open: boolean;
  members: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TeamEventKind>("meeting");
  const [when, setWhen] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [memberId, setMemberId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    setTitle("");
    setKind("meeting");
    setWhen(toLocalInput(d));
    setRecurrence("");
    setMemberId(members[0]?.id ?? "");
    setError(null);
  }, [open, members]);

  async function save() {
    if (!title.trim()) return setError("Give the entry a title.");
    if (!when) return setError("Pick a date and time.");
    setSaving(true);
    setError(null);
    const r = await createTeamEventAction({
      title,
      kind,
      starts_at: new Date(when).toISOString(),
      recurrence,
      member_id: kind === "one_on_one" ? memberId || null : null,
    });
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't add the entry.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add to the calendar">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Type</Label>
          <Segmented
            options={[
              { value: "meeting", label: "Meeting" },
              { value: "one_on_one", label: "1:1" },
              { value: "event", label: "Event" },
            ]}
            value={kind}
            onChange={(v) => setKind(v as TeamEventKind)}
          />
        </div>
        <div>
          <Label>Title *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly team sync" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>When *</Label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <Label>Repeats (optional)</Label>
            <Input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="Weekly" />
          </div>
        </div>
        {kind === "one_on_one" && (
          <div>
            <Label>With</Label>
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------- view ------------------------------------ */

export function CalendarView({ canManage, members }: { canManage: boolean; members: TeamMember[] }) {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [grid, setGrid] = useState<CalendarItem[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarItem[]>([]);
  const [loadingGrid, setLoadingGrid] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadGrid = useCallback((ws: Date) => {
    setLoadingGrid(true);
    getTeamCalendarRangeAction(ws.toISOString(), addDays(ws, 7).toISOString())
      .then((items) => setGrid(items))
      .catch(() => setGrid([]))
      .finally(() => setLoadingGrid(false));
  }, []);

  const loadUpcoming = useCallback(() => {
    getTeamCalendarAction()
      .then(setUpcoming)
      .catch(() => setUpcoming([]));
  }, []);

  useEffect(() => {
    loadGrid(weekStart);
  }, [weekStart, loadGrid]);
  useEffect(() => {
    loadUpcoming();
  }, [loadUpcoming]);

  // Open scrolled to ~8 AM so the workday is in view without hunting for it.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = (8 - START_HOUR) * ROW_H;
  }, []);

  function refreshAll() {
    loadGrid(weekStart);
    loadUpcoming();
  }

  async function removeEvent(id: string) {
    setGrid((prev) => prev.filter((i) => i.id !== id));
    setUpcoming((prev) => prev.filter((i) => i.id !== id));
    await deleteTeamEventAction(id);
  }

  const today = new Date();
  const days = Array.from({ length: DAY_COUNT }, (_, i) => addDays(weekStart, i));
  const isThisWeek = sameDay(weekStart, startOfWeekMonday(today));

  // Timed events (not deadlines) that fall on a given day.
  const timedForDay = (day: Date) =>
    grid.filter((i) => i.kind !== "deadline" && sameDay(new Date(i.when), day));
  const deadlinesForDay = (day: Date) =>
    grid.filter((i) => i.kind === "deadline" && sameDay(new Date(i.when), day));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Your team&apos;s meetings, 1:1s, and deadlines. The week&apos;s schedule is on the left; everything coming up
          is on the right.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
        {/* ---------------------------- week grid ---------------------------- */}
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight">{weekRangeLabel(weekStart)}</h3>
              {loadingGrid && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => setWeekStart((w) => addDays(w, -7))}
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant={isThisWeek ? "secondary" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => setWeekStart((w) => addDays(w, 7))}
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[660px]">
              {/* day headers */}
              <div className="grid border-b border-border" style={{ gridTemplateColumns: GRID_COLS }}>
                <div className="border-r border-border bg-muted/40" />
                {days.map((day) => {
                  const isToday = sameDay(day, today);
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "border-r border-border px-2 py-2 text-center last:border-r-0",
                        isToday ? "bg-primary/10" : "bg-muted/40",
                      )}
                    >
                      <div
                        className={cn(
                          "text-[11px] font-medium uppercase tracking-wide",
                          isToday ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {day.toLocaleDateString("en-US", { weekday: "short" })}
                      </div>
                      <div className={cn("text-sm font-semibold", isToday && "text-primary")}>
                        {day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* all-day / deadline band */}
              <div
                className="grid border-b border-border bg-muted/20"
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <div className="flex items-center justify-end border-r border-border px-1.5 py-1 text-[10px] uppercase text-muted-foreground">
                  Due
                </div>
                {days.map((day) => {
                  const dl = deadlinesForDay(day);
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "min-h-[28px] space-y-1 border-r border-border p-1 last:border-r-0",
                        sameDay(day, today) && "bg-primary/[0.04]",
                      )}
                    >
                      {dl.map((it) => (
                        <div
                          key={it.id}
                          title={it.title}
                          className="truncate rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                        >
                          {it.title}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* scrollable hours body */}
              <div ref={bodyRef} className="max-h-[460px] overflow-y-auto">
                <div className="grid" style={{ gridTemplateColumns: GRID_COLS, height: TOTAL_H }}>
                  {/* time gutter */}
                  <div className="relative border-r border-border">
                    {HOURS.map((h) => (
                      <div key={h} style={{ height: ROW_H }} className="relative border-t border-border/60">
                        <span className="absolute -top-2 right-1.5 bg-card px-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {hourLabel(h)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* day columns */}
                  {days.map((day) => {
                    const isToday = sameDay(day, today);
                    return (
                      <div
                        key={day.toISOString()}
                        className={cn(
                          "relative border-r border-border last:border-r-0",
                          isToday && "bg-primary/[0.04]",
                        )}
                      >
                        {HOURS.map((h) => (
                          <div key={h} style={{ height: ROW_H }} className="border-t border-border/60" />
                        ))}
                        {timedForDay(day).map((it) => {
                          const kind = it.kind as "meeting" | "one_on_one" | "event";
                          return (
                            <button
                              key={it.id}
                              type="button"
                              title={canManage ? "Click to remove" : it.title}
                              onClick={() => {
                                if (canManage && window.confirm(`Remove “${it.title}” from the calendar?`))
                                  void removeEvent(it.id);
                              }}
                              style={{ top: topFor(it.when), height: ROW_H - 4 }}
                              className={cn(
                                "absolute left-1 right-1 flex flex-col overflow-hidden rounded-md px-1.5 py-1 text-left shadow-sm transition",
                                EVENT_BG[kind],
                              )}
                            >
                              <span className="truncate text-[11px] font-semibold leading-tight">{it.title}</span>
                              <span className="truncate text-[10px] opacity-90">{timeStr(it.when)}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ---------------------------- upcoming ----------------------------- */}
        <Card className="flex flex-col overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-[15px] font-semibold tracking-tight">Upcoming</h3>
          </div>
          <div className="max-h-[540px] flex-1 overflow-y-auto p-2">
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
                <CalendarClock className="h-8 w-8 opacity-40" />
                <p className="text-xs">Nothing coming up. Add a meeting or set deadlines on projects and tasks.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {upcoming.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2"
                  >
                    <span className={cn("h-7 w-1.5 shrink-0 rounded-full", MARK[it.kind])} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{it.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {shortDate(it.when)}
                        {it.kind === "deadline" ? "" : ` · ${timeStr(it.when)}`}
                        {it.who ? ` · ${it.who}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{KIND_LABEL[it.kind]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <EventDialog open={dialogOpen} members={members} onClose={() => setDialogOpen(false)} onSaved={refreshAll} />
    </div>
  );
}
