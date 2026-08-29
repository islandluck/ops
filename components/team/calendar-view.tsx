"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  createTeamEventAction,
  deleteTeamEventAction,
  getNotifyChannelsAction,
  getTeamCalendarAction,
  getTeamCalendarRangeAction,
  getTeamEventAction,
  updateTeamEventAction,
} from "@/app/actions";
import type { CalendarItem, TeamEvent, TeamEventKind, TeamMember } from "@/lib/types";

/* ------------------------------- grid config ------------------------------- */

const START_HOUR = 7;
const END_HOUR = 21; // last line = 9 PM
const ROW_H = 56;
const DAY_COUNT = 7; // full week so weekend entries are visible + editable
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const TOTAL_H = HOURS.length * ROW_H;
const GRID_COLS = `52px repeat(${DAY_COUNT}, minmax(0, 1fr))`;

const EVENT_BG: Record<"meeting" | "one_on_one" | "event", string> = {
  meeting: "bg-sky-600 hover:bg-sky-700 text-white",
  one_on_one: "bg-violet-600 hover:bg-violet-700 text-white",
  event: "bg-emerald-600 hover:bg-emerald-700 text-white",
};
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

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480];
const REPEATS = [
  { v: "none", l: "Does not repeat" },
  { v: "daily", l: "Daily" },
  { v: "weekly", l: "Weekly" },
  { v: "biweekly", l: "Every 2 weeks" },
  { v: "monthly", l: "Monthly" },
];

/* --------------------------------- helpers --------------------------------- */

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
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
  return `${h % 12 === 0 ? 12 : h % 12} ${ap}`;
}
function timeStr(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
function timeRange(iso: string, durMin: number): string {
  const s = new Date(iso);
  const e = new Date(s.getTime() + Math.max(durMin, 0) * 60000);
  const o = { hour: "numeric", minute: "2-digit" } as const;
  return `${s.toLocaleTimeString("en-US", o)} – ${e.toLocaleTimeString("en-US", o)}`;
}
function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
function fullDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
function durationLabel(min: number): string {
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? "" : "s"}`;
  if (min > 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${min} min`;
}
function weekRangeLabel(monday: Date): string {
  const end = addDays(monday, DAY_COUNT - 1);
  const md = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return monday.getMonth() === end.getMonth() ? `${md(monday)} – ${end.getDate()}` : `${md(monday)} – ${md(end)}`;
}
function repeatLabel(rule: string): string {
  return REPEATS.find((r) => r.v === freqValue(rule))?.l ?? "";
}
function freqValue(rule: string): string {
  const s = (rule || "").toLowerCase();
  if (/bi.?week|every other|fortnight|2\s*week/.test(s)) return "biweekly";
  if (/week/.test(s)) return "weekly";
  if (/dail|day/.test(s)) return "daily";
  if (/month/.test(s)) return "monthly";
  return "none";
}
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toLocalDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function topFor(iso: string): number {
  const d = new Date(iso);
  const hrs = d.getHours() + d.getMinutes() / 60;
  return Math.max(0, Math.min((hrs - START_HOUR) * ROW_H, TOTAL_H - 20));
}
function heightFor(iso: string, durMin: number): number {
  const top = topFor(iso);
  const raw = (Math.max(durMin, 15) / 60) * ROW_H;
  return Math.max(18, Math.min(raw, TOTAL_H - top) - 2);
}

/** Side-by-side lanes for events that overlap in time, per day. */
function layoutDay(dayItems: CalendarItem[]): Map<string, { lane: number; lanes: number }> {
  const evs = dayItems
    .map((it) => {
      const start = new Date(it.when).getTime();
      return { id: it.id, start, end: start + Math.max(it.duration_min || 60, 15) * 60000 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let clusterMaxEnd = -Infinity;
  const laneEnd: number[] = [];
  const flush = () => {
    const lanes = laneEnd.length;
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes });
    cluster = [];
    laneEnd.length = 0;
    clusterMaxEnd = -Infinity;
  };
  for (const ev of evs) {
    if (cluster.length && ev.start >= clusterMaxEnd) flush();
    let lane = laneEnd.findIndex((e) => e <= ev.start);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = ev.end;
    cluster.push({ id: ev.id, lane });
    clusterMaxEnd = Math.max(clusterMaxEnd, ev.end);
  }
  if (cluster.length) flush();
  return out;
}

/* ------------------------------ add / edit form ---------------------------- */

function EventFormDialog({
  open,
  event,
  defaultDate,
  members,
  channels,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: TeamEvent | null;
  defaultDate: Date;
  members: TeamMember[];
  channels: { slack: boolean; email: boolean };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TeamEventKind>("meeting");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(60);
  const [repeats, setRepeats] = useState("none");
  const [until, setUntil] = useState("");
  const [memberId, setMemberId] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [allTeam, setAllTeam] = useState(false);
  const [detail, setDetail] = useState("");
  const [notifyOn, setNotifyOn] = useState(true);
  const [notifySlack, setNotifySlack] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotifySlack(false);
    setNotifyEmail(false);
    if (event) {
      setTitle(event.title);
      setKind(event.kind);
      setWhen(toLocalInput(new Date(event.starts_at)));
      setDuration(event.duration_minutes || 60);
      setRepeats(freqValue(event.recurrence));
      setUntil(event.recurrence_until ? toLocalDate(new Date(event.recurrence_until)) : "");
      setMemberId(event.member_id ?? members[0]?.id ?? "");
      setAttendeeIds(event.all_team ? [] : event.attendee_ids ?? []);
      setAllTeam(event.all_team);
      setDetail(event.detail);
      setNotifyOn(false); // don't spam attendees on every edit — opt in
    } else {
      const d = new Date(defaultDate);
      d.setHours(9, 0, 0, 0);
      setTitle("");
      setKind("meeting");
      setWhen(toLocalInput(d));
      setDuration(60);
      setRepeats("none");
      setUntil("");
      setMemberId(members[0]?.id ?? "");
      setAttendeeIds([]);
      setAllTeam(false);
      setDetail("");
      setNotifyOn(true);
    }
  }, [open, event, defaultDate, members]);

  const hasRecipients = kind === "one_on_one" ? !!memberId : allTeam || attendeeIds.length > 0;

  function toggleAttendee(id: string) {
    setAttendeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!title.trim()) return setError("Give the entry a title.");
    if (!when) return setError("Pick a date and time.");
    setSaving(true);
    setError(null);
    const payload = {
      title,
      detail,
      kind,
      starts_at: new Date(when).toISOString(),
      duration_minutes: duration,
      recurrence: repeats === "none" ? "" : repeats,
      recurrence_until: repeats !== "none" && until ? new Date(`${until}T23:59:59`).toISOString() : null,
      member_id: kind === "one_on_one" ? memberId || null : null,
      attendee_ids: kind === "one_on_one" ? [] : attendeeIds,
      all_team: kind === "one_on_one" ? false : allTeam,
      notify: notifyOn && hasRecipients ? { inApp: true, slack: notifySlack, email: notifyEmail } : undefined,
    };
    const r = event ? await updateTeamEventAction(event.id, payload) : await createTeamEventAction(payload);
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't save the entry.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={event ? "Edit entry" : "Add to the calendar"}>
      <div className="flex max-h-[74vh] flex-col gap-3 overflow-y-auto pr-1">
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
        <div>
          <Label>Starts *</Label>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Duration</Label>
            <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {durationLabel(m)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Repeats</Label>
            <Select value={repeats} onChange={(e) => setRepeats(e.target.value)}>
              {REPEATS.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.l}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {repeats !== "none" && (
          <div>
            <Label>Repeat until (optional)</Label>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-full" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leave blank to repeat indefinitely. Set a date so the series stops.
            </p>
          </div>
        )}

        {kind === "one_on_one" ? (
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
        ) : (
          <div>
            <Label>Attendees</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setAllTeam((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                  allTeam ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:border-foreground",
                )}
              >
                <Users className="h-3.5 w-3.5" /> Whole team
              </button>
              {members.map((m) => {
                const on = !allTeam && attendeeIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={allTeam}
                    onClick={() => toggleAttendee(m.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition",
                      allTeam
                        ? "cursor-not-allowed border-border text-muted-foreground/50"
                        : on
                          ? "border-primary bg-primary/12 text-primary"
                          : "border-border text-muted-foreground hover:border-foreground",
                    )}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
            {allTeam && <p className="mt-1 text-[11px] text-muted-foreground">Everyone on the team is invited.</p>}
          </div>
        )}

        <div>
          <Label>Details (optional)</Label>
          <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Agenda, location, or notes." />
        </div>

        {hasRecipients && (
          <div className="rounded-lg border border-border bg-muted/20 p-2.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={notifyOn} onChange={(e) => setNotifyOn(e.target.checked)} className="h-4 w-4 accent-primary" />
              Notify attendees{event ? " of changes" : ""}
            </label>
            {notifyOn && (
              <div className="mt-2 flex flex-col gap-1.5 pl-6 text-[13px]">
                <span className="text-muted-foreground">They&apos;ll get an in-app notification.</span>
                {channels.slack && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={notifySlack} onChange={(e) => setNotifySlack(e.target.checked)} className="h-4 w-4 accent-primary" />
                    Also post to Slack
                  </label>
                )}
                {channels.email && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="h-4 w-4 accent-primary" />
                    Also email attendees
                  </label>
                )}
                {!channels.slack && !channels.email && (
                  <span className="text-[11px] text-muted-foreground">Connect Slack or Gmail in Integrations to also notify there.</span>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {event ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------- details view ----------------------------- */

function EventViewDialog({
  item,
  canManage,
  onClose,
  onEdit,
  onDelete,
}: {
  item: CalendarItem;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState<"edit" | "delete" | null>(null);
  const isDeadline = item.kind === "deadline";
  return (
    <Dialog open onClose={onClose} title={item.title}>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", MARK[item.kind])} />
          <span className="text-muted-foreground">{KIND_LABEL[item.kind]}</span>
        </div>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span>{fullDate(item.when)}</span>
        </div>
        {!isDeadline && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              {timeRange(item.when, item.duration_min)} · {durationLabel(item.duration_min)}
            </span>
          </div>
        )}
        {item.recurrence && freqValue(item.recurrence) !== "none" && (
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-muted-foreground" />
            <span>Repeats {repeatLabel(item.recurrence).toLowerCase()}</span>
          </div>
        )}
        {item.all_team ? (
          <div className="flex items-start gap-2">
            <Users className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span>Whole team</span>
          </div>
        ) : item.attendees.length > 0 ? (
          <div className="flex items-start gap-2">
            <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span>{item.attendees.join(", ")}</span>
          </div>
        ) : item.who ? (
          <div className="flex items-start gap-2">
            <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <span>{item.who}</span>
          </div>
        ) : null}
        {item.detail && (
          <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-2.5 text-[13px]">
            {item.detail}
          </div>
        )}
        {isDeadline && (
          <p className="text-[12px] text-muted-foreground">
            This deadline comes from a project or task. Manage it from Projects or the member&apos;s work.
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          {canManage && !isDeadline && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setBusy("delete");
                  onDelete();
                }}
                disabled={busy !== null}
              >
                {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </Button>
              <Button
                onClick={() => {
                  setBusy("edit");
                  onEdit();
                }}
                disabled={busy !== null}
              >
                {busy === "edit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                Edit
              </Button>
            </>
          )}
          {(!canManage || isDeadline) && (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
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
  const [viewing, setViewing] = useState<CalendarItem | null>(null);
  const [form, setForm] = useState<{ open: boolean; event: TeamEvent | null; defaultDate: Date }>({
    open: false,
    event: null,
    defaultDate: new Date(),
  });
  const [channels, setChannels] = useState<{ slack: boolean; email: boolean }>({ slack: false, email: false });
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
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = (8 - START_HOUR) * ROW_H;
  }, []);
  useEffect(() => {
    if (canManage) getNotifyChannelsAction().then(setChannels).catch(() => {});
  }, [canManage]);

  function refreshAll() {
    loadGrid(weekStart);
    loadUpcoming();
  }

  async function removeEvent(sourceId: string) {
    setGrid((prev) => prev.filter((i) => i.source_id !== sourceId));
    setUpcoming((prev) => prev.filter((i) => i.source_id !== sourceId));
    setViewing(null);
    await deleteTeamEventAction(sourceId);
  }

  async function openEdit(item: CalendarItem) {
    const ev = await getTeamEventAction(item.source_id);
    setViewing(null);
    if (ev) setForm({ open: true, event: ev, defaultDate: new Date() });
  }

  const today = new Date();
  const days = Array.from({ length: DAY_COUNT }, (_, i) => addDays(weekStart, i));
  const isThisWeek = sameDay(weekStart, startOfWeekMonday(today));
  const addDefaultDate = isThisWeek ? today : weekStart;

  const timedForDay = (day: Date) =>
    grid.filter((i) => i.kind !== "deadline" && sameDay(new Date(i.when), day));
  const deadlinesForDay = (day: Date) =>
    grid.filter((i) => i.kind === "deadline" && sameDay(new Date(i.when), day));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Your team&apos;s meetings, 1:1s, and deadlines. Click any entry for details. Everything coming up is on the
          right.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setForm({ open: true, event: null, defaultDate: addDefaultDate })}>
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
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant={isThisWeek ? "secondary" : "outline"} size="sm" className="h-8" onClick={() => setWeekStart(startOfWeekMonday(new Date()))}>
                Today
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Next week">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              {/* one scroll box holds sticky headers + the hours body, so columns always align */}
              <div ref={bodyRef} className="max-h-[520px] overflow-y-auto">
                <div className="sticky top-0 z-20 bg-card">
                  {/* day headers */}
                  <div className="grid border-b border-border" style={{ gridTemplateColumns: GRID_COLS }}>
                    <div className="border-r border-border bg-muted/40" />
                    {days.map((day) => {
                      const isToday = sameDay(day, today);
                      return (
                        <div
                          key={day.toISOString()}
                          className={cn(
                            "border-r border-border px-1 py-2 text-center last:border-r-0",
                            isToday ? "bg-primary/10" : "bg-muted/40",
                          )}
                        >
                          <div className={cn("text-[10px] font-medium uppercase tracking-wide", isToday ? "text-primary" : "text-muted-foreground")}>
                            {day.toLocaleDateString("en-US", { weekday: "short" })}
                          </div>
                          <div className={cn("text-[13px] font-semibold", isToday && "text-primary")}>
                            {day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* deadline band */}
                  <div className="grid border-b border-border bg-muted/20" style={{ gridTemplateColumns: GRID_COLS }}>
                    <div className="flex items-center justify-end border-r border-border px-1.5 py-1 text-[9px] uppercase text-muted-foreground">
                      Due
                    </div>
                    {days.map((day) => (
                      <div
                        key={day.toISOString()}
                        className={cn("min-h-[26px] space-y-1 border-r border-border p-1 last:border-r-0", sameDay(day, today) && "bg-primary/[0.05]")}
                      >
                        {deadlinesForDay(day).map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            title={it.title}
                            onClick={() => setViewing(it)}
                            className="block w-full truncate rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-left text-[10px] font-medium text-amber-700 dark:text-amber-300"
                          >
                            {it.title}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* hours body */}
                <div className="grid" style={{ gridTemplateColumns: GRID_COLS, height: TOTAL_H }}>
                  <div className="relative border-r border-border">
                    {HOURS.map((h) => (
                      <div key={h} style={{ height: ROW_H }} className="relative border-t border-border/60">
                        <span className="absolute -top-2 right-1.5 bg-card px-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {hourLabel(h)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {days.map((day) => {
                    const isToday = sameDay(day, today);
                    const dayEvents = timedForDay(day);
                    const lay = layoutDay(dayEvents);
                    return (
                      <div key={day.toISOString()} className={cn("relative border-r border-border last:border-r-0", isToday && "bg-primary/[0.05]")}>
                        {HOURS.map((h) => (
                          <div key={h} style={{ height: ROW_H }} className="border-t border-border/60" />
                        ))}
                        {dayEvents.map((it) => {
                          const kind = it.kind as "meeting" | "one_on_one" | "event";
                          const p = lay.get(it.id) ?? { lane: 0, lanes: 1 };
                          const w = 100 / p.lanes;
                          return (
                            <button
                              key={it.id}
                              type="button"
                              title={it.title}
                              onClick={() => setViewing(it)}
                              style={{
                                top: topFor(it.when),
                                height: heightFor(it.when, it.duration_min),
                                left: `calc(${p.lane * w}% + 2px)`,
                                width: `calc(${w}% - 4px)`,
                              }}
                              className={cn(
                                "absolute flex flex-col overflow-hidden rounded-md px-1.5 py-1 text-left shadow-sm transition",
                                EVENT_BG[kind],
                              )}
                            >
                              <span className="flex items-center gap-1 truncate text-[11px] font-semibold leading-tight">
                                {it.recurrence && freqValue(it.recurrence) !== "none" && (
                                  <Repeat className="h-2.5 w-2.5 shrink-0 opacity-90" />
                                )}
                                <span className="truncate">{it.title}</span>
                              </span>
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
          <div className="max-h-[560px] flex-1 overflow-y-auto p-2">
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
                <CalendarClock className="h-8 w-8 opacity-40" />
                <p className="text-xs">Nothing coming up. Add a meeting or set deadlines on projects and tasks.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {upcoming.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setViewing(it)}
                    className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition hover:border-primary/40"
                  >
                    <span className={cn("h-7 w-1.5 shrink-0 rounded-full", MARK[it.kind])} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 truncate text-[13px] font-medium">
                        {it.recurrence && freqValue(it.recurrence) !== "none" && (
                          <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{it.title}</span>
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {shortDate(it.when)}
                        {it.kind === "deadline" ? "" : ` · ${timeStr(it.when)}`}
                        {it.who ? ` · ${it.who}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{KIND_LABEL[it.kind]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {viewing && (
        <EventViewDialog
          item={viewing}
          canManage={canManage}
          onClose={() => setViewing(null)}
          onEdit={() => openEdit(viewing)}
          onDelete={() => removeEvent(viewing.source_id)}
        />
      )}
      <EventFormDialog
        open={form.open}
        event={form.event}
        defaultDate={form.defaultDate}
        members={members}
        channels={channels}
        onClose={() => setForm((f) => ({ ...f, open: false }))}
        onSaved={refreshAll}
      />
    </div>
  );
}
