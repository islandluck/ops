"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { getPortalDataAction, updateMyAssignmentStatusAction } from "@/app/actions";
import type { AssignmentStatus, TeamAssignment, TeamMember } from "@/lib/types";

const STATUSES: { key: AssignmentStatus; label: string }[] = [
  { key: "assigned", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function PortalPage() {
  const [member, setMember] = useState<TeamMember | null>(null);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [reports, setReports] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPortalDataAction().then((d) => {
      setMember(d.member);
      setAssignments(d.assignments);
      setReports(d.reports);
      setLoading(false);
    });
  }, []);

  async function setStatus(id: string, status: AssignmentStatus) {
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    await updateMyAssignmentStatusAction(id, status);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const open = assignments.filter((a) => a.status !== "done");
  const done = assignments.filter((a) => a.status === "done");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {member ? `Hi, ${member.name.split(" ")[0]}` : "Your work"}
          </h1>
          {member?.team_role === "manager" && (
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-semibold text-primary">Manager</span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {member?.role_title ? `${member.role_title} · ` : ""}
          {open.length > 0 ? `${open.length} open item${open.length === 1 ? "" : "s"}` : "You're all caught up 🎉"}
          {member?.manager_name ? ` · Reports to ${member.manager_name}` : ""}
        </p>
      </div>

      {assignments.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 opacity-40" />
          <p className="text-sm">Nothing has been handed to you yet. Check back soon.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {[...open, ...done].map((a) => (
            <Card key={a.id} className={cn("flex flex-col gap-2 p-4", a.status === "done" && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium leading-snug">{a.title}</div>
                  {a.handoff_note && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.handoff_note}</p>}
                </div>
                <Select
                  value={a.status}
                  onChange={(e) => setStatus(a.id, e.target.value as AssignmentStatus)}
                  className="h-8 w-32 shrink-0 text-xs"
                >
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              {a.deadline && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" /> Due {fmtDate(a.deadline)}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {reports.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" /> Your team
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {reports.map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {r.emoji || r.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.role_title || "—"}</div>
                </div>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Delegating work to your team arrives in the next update.</p>
        </div>
      )}
    </div>
  );
}
