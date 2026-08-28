"use client";

import { useEffect, useState } from "react";
import { AlarmClock, CalendarClock, Loader2, Plus, Repeat, Trash2, User, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { createTeamEventAction, deleteTeamEventAction, getTeamCalendarAction } from "@/app/actions";
import type { CalendarItem, TeamEventKind, TeamMember } from "@/lib/types";

const KIND_META: Record<CalendarItem["kind"], { label: string; tint: string }> = {
  meeting: { label: "Meeting", tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400" },
  one_on_one: { label: "1:1", tint: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  event: { label: "Event", tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  deadline: { label: "Deadline", tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
};

function KindIcon({ kind }: { kind: CalendarItem["kind"] }) {
  if (kind === "one_on_one") return <User className="h-4 w-4" />;
  if (kind === "meeting") return <Users className="h-4 w-4" />;
  if (kind === "deadline") return <AlarmClock className="h-4 w-4" />;
  return <CalendarClock className="h-4 w-4" />;
}

function dayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
function timeStr(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

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
    setTitle("");
    setKind("meeting");
    setWhen("");
    setRecurrence("");
    setMemberId(members[0]?.id ?? "");
    setError(null);
  }, [open, members]);

  async function save() {
    if (!title.trim()) {
      setError("Give the entry a title.");
      return;
    }
    if (!when) {
      setError("Pick a date and time.");
      return;
    }
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

export function CalendarView({ canManage, members }: { canManage: boolean; members: TeamMember[] }) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    setItems(await getTeamCalendarAction());
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function removeEvent(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await deleteTeamEventAction(id);
  }

  // Group by day (items already sorted ascending by the server).
  const groups: { day: string; items: CalendarItem[] }[] = [];
  for (const it of items) {
    const day = dayLabel(it.when);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Upcoming meetings, 1:1s, and deadlines from your team&apos;s projects and tasks.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
          <CalendarClock className="h-9 w-9 opacity-40" />
          <p className="max-w-sm text-sm">Nothing on the calendar. Add a meeting, a 1:1, or set deadlines on projects.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.day} className="flex flex-col gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.day}</div>
              {g.items.map((it) => {
                const meta = KIND_META[it.kind];
                const deletable = canManage && it.kind !== "deadline";
                return (
                  <Card key={it.id} className="group flex items-center gap-3 p-2.5">
                    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.tint)}>
                      <KindIcon kind={it.kind} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.title}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <span>{timeStr(it.when)}</span>
                        <span>· {meta.label}</span>
                        {it.who && <span>· {it.who}</span>}
                        {it.recurrence && (
                          <span className="inline-flex items-center gap-0.5">
                            · <Repeat className="h-2.5 w-2.5" /> {it.recurrence}
                          </span>
                        )}
                      </div>
                    </div>
                    {deletable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 opacity-0 transition group-hover:opacity-100"
                        onClick={() => removeEvent(it.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <EventDialog open={dialogOpen} members={members} onClose={() => setDialogOpen(false)} onSaved={refresh} />
    </div>
  );
}
