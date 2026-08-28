"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderKanban,
  Loader2,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  createDelegatedTaskAction,
  getMyAssignedProjectsAction,
  getMyProjectDetailAction,
  getPortalDataAction,
  updateMyAssignmentStatusAction,
} from "@/app/actions";
import type {
  AssignmentStatus,
  HumanProject,
  MemberProjectDetail,
  Project,
  TeamAssignment,
  TeamMember,
} from "@/lib/types";
import { AssignedProjectView } from "./assigned-project";
import { GoalsSection } from "./goals-section";
import { DocsView } from "@/components/team/docs-view";
import { ChatView } from "@/components/team/chat-view";
import { AssistantView } from "./assistant-view";

const STATUSES: { key: AssignmentStatus; label: string }[] = [
  { key: "assigned", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

const PROJECT_STATUS_TINT: Record<HumanProject["status"], string> = {
  active: "text-sky-600 dark:text-sky-400",
  on_hold: "text-amber-600 dark:text-amber-400",
  done: "text-success",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

// ── Delegate dialog (managers assign a task to a direct report) ───────────────

function DelegateDialog({
  open,
  reports,
  onClose,
  onSaved,
}: {
  open: boolean;
  reports: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(reports[0]?.id ?? "");
    setTitle("");
    setNote("");
    setDeadline("");
    setError(null);
  }, [open, reports]);

  async function save() {
    if (!memberId) {
      setError("Pick a team member.");
      return;
    }
    if (!title.trim()) {
      setError("Give the task a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createDelegatedTaskAction({
      member_id: memberId,
      title,
      handoff_note: note,
      deadline: deadline || null,
    });
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't create the task.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Delegate a task">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Assign to</Label>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.role_title ? ` — ${r.role_title}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>What needs doing *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Draft the weekly report" />
        </div>
        <div>
          <Label>Note</Label>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Context, links, what done looks like…"
          />
        </div>
        <div className="w-48">
          <Label>Deadline</Label>
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Assign
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function PortalPage() {
  const [member, setMember] = useState<TeamMember | null>(null);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [reports, setReports] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<HumanProject[]>([]);
  const [assignedProjects, setAssignedProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemberProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<"work" | "chat" | "assistant">("work");

  async function load() {
    const [d, ap] = await Promise.all([getPortalDataAction(), getMyAssignedProjectsAction()]);
    setMember(d.member);
    setAssignments(d.assignments);
    setReports(d.reports);
    setProjects(d.projects);
    setAssignedProjects(ap);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function openProject(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(await getMyProjectDetailAction(id));
    setDetailLoading(false);
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const [d, ap] = await Promise.all([getMyProjectDetailAction(selectedId), getMyAssignedProjectsAction()]);
    setDetail(d);
    setAssignedProjects(ap);
  }

  function backToList() {
    setSelectedId(null);
    setDetail(null);
    void load();
  }

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

  // Detail view: a member opened one of their assigned projects to run it.
  if (selectedId) {
    return (
      <div className="flex flex-col gap-4">
        {detailLoading ? (
          <div className="flex justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : detail ? (
          <AssignedProjectView detail={detail} onBack={backToList} onRefresh={refreshDetail} />
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={backToList}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back to projects
            </button>
            <Card className="p-4 text-sm text-muted-foreground">This project isn&apos;t available.</Card>
          </div>
        )}
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

      <div className="flex gap-1">
        {(["work", "chat", "assistant"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-lg px-3 py-1 text-sm font-medium transition",
              tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "work" ? "My work" : t === "chat" ? "Chat" : "Assistant"}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <ChatView canManage={member?.team_role === "manager"} />
      ) : tab === "assistant" ? (
        <AssistantView />
      ) : (
        <>
          <GoalsSection isManager={member?.team_role === "manager"} reports={reports} />

      {assignedProjects.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-muted-foreground" /> Assigned projects
          </div>
          <div className="flex flex-col gap-2">
            {assignedProjects.map((p) => {
              const prog = p.progress ?? { total: 0, done: 0 };
              const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
              return (
                <button
                  key={p.id}
                  onClick={() => openProject(p.id)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.title}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {prog.done}/{prog.total}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {p.status === "planning" ? "Plan review" : p.status === "done" ? "Complete" : p.status}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Open a project to draft, review, and approve its deliverables.</p>
        </div>
      )}

      {projects.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <FolderKanban className="h-4 w-4 text-muted-foreground" /> My projects
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <Card key={p.id} className="flex flex-col gap-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="truncate font-medium">{p.title}</div>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-semibold uppercase tracking-wide",
                      PROJECT_STATUS_TINT[p.status],
                    )}
                  >
                    {p.status === "on_hold" ? "On hold" : p.status}
                  </span>
                </div>
                {p.summary && <p className="line-clamp-2 text-xs text-muted-foreground">{p.summary}</p>}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{p.lead_member_id === member?.id ? "You lead this" : "You manage this"}</span>
                  <span className="inline-flex items-center gap-2">
                    <span>
                      {p.open_tasks}/{p.total_tasks} tasks
                    </span>
                    {p.deadline && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" /> {fmtDate(p.deadline)}
                      </span>
                    )}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">My tasks</div>
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
                    {a.project_title && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FolderKanban className="h-3 w-3" /> {a.project_title}
                      </div>
                    )}
                    {a.handoff_note && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.handoff_note}</p>
                    )}
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
      </div>

      {reports.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Users className="h-4 w-4 text-muted-foreground" /> Your team
            </div>
            <Button size="sm" variant="secondary" onClick={() => setDelegateOpen(true)}>
              <Plus className="h-4 w-4" /> Delegate a task
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {reports.map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {r.emoji || r.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.role_title || "—"}</div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <FileText className="h-4 w-4 text-muted-foreground" /> Documents
            </div>
            <DocsView canManage={member?.team_role === "manager"} />
          </div>
        </>
      )}

      <DelegateDialog open={delegateOpen} reports={reports} onClose={() => setDelegateOpen(false)} onSaved={load} />
    </div>
  );
}
