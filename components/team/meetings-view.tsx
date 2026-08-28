"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Loader2, NotebookPen, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  createTeamMeetingAction,
  deleteTeamMeetingAction,
  listTeamMeetingsAction,
  updateTeamMeetingAction,
} from "@/app/actions";
import type { TeamMeeting, TeamMember } from "@/lib/types";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function MeetingDialog({
  open,
  meeting,
  members,
  canManage,
  onClose,
  onSaved,
}: {
  open: boolean;
  meeting: TeamMeeting | null;
  members: TeamMember[];
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(meeting?.title ?? "");
    setDate(meeting?.meeting_date ? meeting.meeting_date.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setNotes(meeting?.notes ?? "");
    setAttendeeIds(meeting?.attendee_ids ?? []);
  }, [open, meeting]);

  async function save() {
    if (!title.trim()) {
      setError("Give the meeting a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = { title, notes, meeting_date: new Date(date).toISOString(), attendee_ids: attendeeIds };
    const r = meeting ? await updateTeamMeetingAction(meeting.id, payload) : await createTeamMeetingAction(payload);
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't save the meeting.");
    }
  }

  if (!canManage) {
    return (
      <Dialog open={open} onClose={onClose} title={meeting?.title ?? "Meeting"}>
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">{meeting ? fmtDate(meeting.meeting_date) : ""}</div>
          {meeting?.attendee_names.length ? (
            <div className="text-xs text-muted-foreground">Attendees: {meeting.attendee_names.join(", ")}</div>
          ) : null}
          <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {meeting?.notes || "No notes."}
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title={meeting ? "Meeting notes" : "New meeting"}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly sync" />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Attendees</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = attendeeIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAttendeeIds((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition",
                    on
                      ? "border-primary bg-primary/12 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground",
                  )}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea
            rows={10}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={"Discussion, decisions, and action items per person."}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Tip: jot action items per person — turning them into tasks automatically is coming next.
          </p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {meeting ? "Save" : "Add meeting"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function MeetingsView({ canManage, members }: { canManage: boolean; members: TeamMember[] }) {
  const [meetings, setMeetings] = useState<TeamMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; meeting: TeamMeeting | null }>({ open: false, meeting: null });

  async function refresh() {
    setMeetings(await listTeamMeetingsAction());
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function remove(m: TeamMeeting) {
    if (!window.confirm(`Delete the notes for "${m.title}"?`)) return;
    setMeetings((prev) => prev.filter((x) => x.id !== m.id));
    await deleteTeamMeetingAction(m.id);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Notes from your meetings. (Auto-creating tasks from action items is coming in a later pass.)
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setDialog({ open: true, meeting: null })}>
            <Plus className="h-4 w-4" /> New meeting
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : meetings.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
          <NotebookPen className="h-9 w-9 opacity-40" />
          <p className="max-w-sm text-sm">No meeting notes yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {meetings.map((m) => (
            <Card key={m.id} className="group flex items-start gap-3 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <NotebookPen className="h-4 w-4" />
              </div>
              <button className="min-w-0 flex-1 text-left" onClick={() => setDialog({ open: true, meeting: m })}>
                <div className="truncate text-sm font-medium">{m.title}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CalendarDays className="h-3 w-3" /> {fmtDate(m.meeting_date)}
                  {m.attendee_names.length > 0 && <span>· {m.attendee_names.join(", ")}</span>}
                </div>
                {m.notes && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.notes}</p>}
              </button>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-0 transition group-hover:opacity-100"
                  onClick={() => remove(m)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <MeetingDialog
        open={dialog.open}
        meeting={dialog.meeting}
        members={members}
        canManage={canManage}
        onClose={() => setDialog({ open: false, meeting: null })}
        onSaved={refresh}
      />
    </div>
  );
}
