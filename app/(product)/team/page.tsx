"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  createAssignmentAction,
  createTeamMemberAction,
  deleteAssignmentAction,
  deleteTeamMemberAction,
  inviteTeamMemberAction,
  listAssignmentsAction,
  listInvitesAction,
  listTeamMembersAction,
  setTeamMemberOrgAction,
  updateAssignmentAction,
  updateTeamMemberAction,
} from "@/app/actions";
import type { AssignmentStatus, TeamAssignment, TeamMember, TeamRole } from "@/lib/types";

const ACCENTS = ["indigo", "sky", "emerald", "amber", "rose", "violet", "slate"] as const;
const ACCENT_BG: Record<string, string> = {
  indigo: "bg-indigo-500",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};

const STATUSES: { key: AssignmentStatus; label: string; tint: string }[] = [
  { key: "assigned", label: "Assigned", tint: "text-muted-foreground" },
  { key: "in_progress", label: "In progress", tint: "text-sky-600 dark:text-sky-400" },
  { key: "blocked", label: "Blocked", tint: "text-amber-600 dark:text-amber-400" },
  { key: "done", label: "Done", tint: "text-success" },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({ member, size = "md" }: { member: Pick<TeamMember, "name" | "emoji" | "accent">; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-8 w-8 text-xs" : "h-11 w-11 text-sm";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        dim,
        ACCENT_BG[member.accent] ?? ACCENT_BG.indigo,
      )}
    >
      {member.emoji || initials(member.name) || "?"}
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

// ── Member dialog ───────────────────────────────────────────────────────────

type MemberDraft = {
  name: string;
  role_title: string;
  email: string;
  description: string;
  skills: string;
  birthday: string;
  emoji: string;
  accent: string;
  team_role: TeamRole;
  manager_id: string;
};

const EMPTY_MEMBER: MemberDraft = {
  name: "",
  role_title: "",
  email: "",
  description: "",
  skills: "",
  birthday: "",
  emoji: "",
  accent: "indigo",
  team_role: "contributor",
  manager_id: "",
};

function MemberDialog({
  open,
  member,
  allMembers,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: TeamMember | null;
  allMembers: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const managers = useMemo(
    () => allMembers.filter((mm) => mm.team_role === "manager" && mm.id !== member?.id),
    [allMembers, member],
  );
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_MEMBER);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendInvite, setSendInvite] = useState(true);
  const [result, setResult] = useState<{ accept_url: string; note?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setCopied(false);
    setSendInvite(true);
    setDraft(
      member
        ? {
            name: member.name,
            role_title: member.role_title,
            email: member.email,
            description: member.description,
            skills: member.skills.join(", "),
            birthday: member.birthday,
            emoji: member.emoji,
            accent: member.accent || "indigo",
            team_role: member.team_role,
            manager_id: member.manager_id ?? "",
          }
        : EMPTY_MEMBER,
    );
  }, [open, member]);

  async function save() {
    if (!draft.name.trim()) {
      setError("A name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name,
      role_title: draft.role_title,
      email: draft.email,
      description: draft.description,
      skills: draft.skills.split(",").map((s) => s.trim()).filter(Boolean),
      birthday: draft.birthday,
      emoji: draft.emoji,
      accent: draft.accent,
    };

    // New member + invite → create the profile AND send a join invite.
    if (!member && sendInvite) {
      if (!draft.email.trim()) {
        setSaving(false);
        setError("An email is required to send an invite.");
        return;
      }
      const r = await inviteTeamMemberAction({ email: draft.email, profile: payload });
      setSaving(false);
      if ("ok" in r && r.ok) {
        onSaved();
        if (r.emailed) onClose();
        else setResult({ accept_url: r.accept_url, note: r.note }); // show the link to share
      } else {
        setError("error" in r ? r.error : "Couldn't send the invite.");
      }
      return;
    }

    if (member) {
      // Save the profile, then the org role/manager (owner-gated on the server).
      const r = await updateTeamMemberAction(member.id, payload);
      if (!("ok" in r) || !r.ok) {
        setSaving(false);
        setError("error" in r ? r.error : "Couldn't save.");
        return;
      }
      const orgRes = await setTeamMemberOrgAction(member.id, {
        team_role: draft.team_role,
        manager_id: draft.team_role === "manager" ? null : draft.manager_id || null,
      });
      setSaving(false);
      if (!("ok" in orgRes) || !orgRes.ok) {
        setError("error" in orgRes ? orgRes.error : "Saved the profile, but couldn't update the role.");
        return;
      }
      onSaved();
      onClose();
      return;
    }

    const r = await createTeamMemberAction(payload);
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't save.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={member ? "Edit team member" : "Add team member"}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <div className="w-20">
            <Label>Emoji</Label>
            <Input
              value={draft.emoji}
              onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
              placeholder="🙂"
              maxLength={4}
            />
          </div>
          <div className="flex-1">
            <Label>Name *</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Jordan Rivera" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Role</Label>
            <Input
              value={draft.role_title}
              onChange={(e) => setDraft({ ...draft, role_title: e.target.value })}
              placeholder="Marketing Lead"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="jordan@company.com"
            />
          </div>
        </div>
        <div>
          <Label>What they do (the AI reads this as context)</Label>
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Owns paid + organic growth; runs the content calendar and weekly reporting."
          />
        </div>
        <div>
          <Label>Skills (comma-separated)</Label>
          <Input
            value={draft.skills}
            onChange={(e) => setDraft({ ...draft, skills: e.target.value })}
            placeholder="copywriting, paid ads, analytics"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Birthday</Label>
            <Input type="date" value={draft.birthday} onChange={(e) => setDraft({ ...draft, birthday: e.target.value })} />
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setDraft({ ...draft, accent: a })}
                  className={cn(
                    "h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition",
                    ACCENT_BG[a],
                    draft.accent === a && "ring-2 ring-foreground",
                  )}
                  aria-label={a}
                />
              ))}
            </div>
          </div>
        </div>
        {member && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div>
              <Label>Team role</Label>
              <Segmented
                options={[
                  { value: "contributor", label: "Contributor" },
                  { value: "manager", label: "Manager" },
                ]}
                value={draft.team_role}
                onChange={(v) => setDraft({ ...draft, team_role: v as TeamRole })}
              />
            </div>
            {draft.team_role === "contributor" && (
              <div>
                <Label>Reports to</Label>
                <Select value={draft.manager_id} onChange={(e) => setDraft({ ...draft, manager_id: e.target.value })}>
                  <option value="">Owner (you)</option>
                  {managers.map((mm) => (
                    <option key={mm.id} value={mm.id}>
                      {mm.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}
        {!member && !result && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
              className="h-4 w-4"
            />
            <Mail className="h-4 w-4 text-muted-foreground" />
            Email them an invite to join the workspace
          </label>
        )}

        {result ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">
              {result.note ?? "Invite created — share this link so they can join:"}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.accept_url} className="text-xs" onFocus={(e) => e.target.select()} />
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.accept_url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {member ? "Save" : sendInvite ? "Send invite" : "Add member"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Handoff dialog ──────────────────────────────────────────────────────────

function HandoffDialog({
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
  const [memberId, setMemberId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(members[0]?.id ?? "");
    setTitle("");
    setNote("");
    setDeadline("");
    setError(null);
  }, [open, members]);

  async function save() {
    if (!memberId) {
      setError("Pick a team member.");
      return;
    }
    if (!title.trim()) {
      setError("Give the handoff a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createAssignmentAction({
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
      setError("error" in r ? r.error : "Couldn't create the handoff.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Hand off work">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Assign to</Label>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.role_title ? ` — ${m.role_title}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>What needs doing *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Draft the Q3 launch email sequence" />
        </div>
        <div>
          <Label>Handoff note</Label>
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
            Hand off
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const [view, setView] = useState<"roster" | "board">("roster");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [invites, setInvites] = useState<{ id: string; member_id: string; accept_url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [memberDialog, setMemberDialog] = useState<{ open: boolean; member: TeamMember | null }>({
    open: false,
    member: null,
  });
  const [handoffOpen, setHandoffOpen] = useState(false);

  async function refresh() {
    const [m, a, inv] = await Promise.all([
      listTeamMembersAction(),
      listAssignmentsAction(),
      listInvitesAction(),
    ]);
    setMembers(m);
    setAssignments(a);
    setInvites(inv);
    setLoading(false);
  }

  const inviteByMember = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of invites) map.set(i.member_id, i.accept_url);
    return map;
  }, [invites]);

  async function copyInviteLink(memberId: string) {
    const url = inviteByMember.get(memberId);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(memberId);
      setTimeout(() => setCopiedId(null), 1400);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const byStatus = useMemo(() => {
    const map: Record<AssignmentStatus, TeamAssignment[]> = {
      assigned: [],
      in_progress: [],
      blocked: [],
      done: [],
    };
    for (const a of assignments) map[a.status]?.push(a);
    return map;
  }, [assignments]);

  async function removeMember(m: TeamMember) {
    if (!confirm(`Remove ${m.name} from the team? Their handoffs will be deleted too.`)) return;
    await deleteTeamMemberAction(m.id);
    refresh();
  }

  async function setAssignmentStatus(id: string, status: AssignmentStatus) {
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    await updateAssignmentAction(id, { status });
  }

  async function removeAssignment(id: string) {
    setAssignments((prev) => prev.filter((a) => a.id !== id));
    await deleteAssignmentAction(id);
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Your team's profiles and the work handed off to them."
        actions={
          <div className="flex items-center gap-2">
            <Segmented
              options={[
                { value: "roster", label: "Roster" },
                { value: "board", label: "Handoffs" },
              ]}
              value={view}
              onChange={(v) => setView(v as "roster" | "board")}
            />
            {view === "roster" ? (
              <Button size="sm" onClick={() => setMemberDialog({ open: true, member: null })}>
                <UserPlus className="h-4 w-4" /> Add member
              </Button>
            ) : (
              <Button size="sm" onClick={() => setHandoffOpen(true)} disabled={!members.length}>
                <Plus className="h-4 w-4" /> Hand off
              </Button>
            )}
          </div>
        }
      />
      <PageBody className="max-w-6xl">
        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-center text-muted-foreground">
            <UsersRound className="h-10 w-10 opacity-40" />
            <p className="max-w-sm text-sm">
              Add your team members and the Executive and Boardroom will understand who does what — then hand off
              projects, tasks, and notes with deadlines.
            </p>
            <Button onClick={() => setMemberDialog({ open: true, member: null })}>
              <UserPlus className="h-4 w-4" /> Add your first member
            </Button>
          </div>
        ) : view === "roster" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => {
              const open = assignments.filter((a) => a.member_id === m.id && a.status !== "done").length;
              return (
                <Card key={m.id} className="group flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar member={m} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{m.name}</span>
                        {m.team_role === "manager" && (
                          <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            Manager
                          </span>
                        )}
                        {m.status === "invited" && (
                          <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            Invited
                          </span>
                        )}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{m.role_title || "—"}</div>
                      {m.manager_name && (
                        <div className="truncate text-xs text-muted-foreground">↳ reports to {m.manager_name}</div>
                      )}
                    </div>
                    <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <Button variant="ghost" size="icon" onClick={() => setMemberDialog({ open: true, member: m })}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeMember(m)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                  {m.description && <p className="line-clamp-3 text-sm text-muted-foreground">{m.description}</p>}
                  {m.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.skills.map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {open > 0 ? `${open} open handoff${open === 1 ? "" : "s"}` : "No open handoffs"}
                    </span>
                    {m.status === "invited" && inviteByMember.has(m.id) ? (
                      <button
                        type="button"
                        onClick={() => copyInviteLink(m.id)}
                        className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                      >
                        {copiedId === m.id ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                        {copiedId === m.id ? "Copied" : "Invite link"}
                      </button>
                    ) : (
                      m.email && <span className="truncate">{m.email}</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STATUSES.map((col) => (
              <div key={col.key} className="flex flex-col gap-2">
                <div className={cn("flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide", col.tint)}>
                  {col.label}
                  <span className="text-muted-foreground">{byStatus[col.key].length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {byStatus[col.key].map((a) => (
                    <Card key={a.id} className="group flex flex-col gap-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium leading-snug">{a.title}</div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                          onClick={() => removeAssignment(a.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                      {a.handoff_note && <p className="line-clamp-3 text-xs text-muted-foreground">{a.handoff_note}</p>}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate font-medium text-foreground">{a.member_name}</span>
                        {a.deadline && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" /> {fmtDate(a.deadline)}
                          </span>
                        )}
                      </div>
                      <Select
                        value={a.status}
                        onChange={(e) => setAssignmentStatus(a.id, e.target.value as AssignmentStatus)}
                        className="h-8 text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </Card>
                  ))}
                  {byStatus[col.key].length === 0 && (
                    <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                      —
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>

      <MemberDialog
        open={memberDialog.open}
        member={memberDialog.member}
        allMembers={members}
        onClose={() => setMemberDialog({ open: false, member: null })}
        onSaved={refresh}
      />
      <HandoffDialog open={handoffOpen} members={members} onClose={() => setHandoffOpen(false)} onSaved={refresh} />
    </>
  );
}
