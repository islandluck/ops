"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Copy,
  Link2,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Sparkles,
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
  createHumanProjectAction,
  createTeamMemberAction,
  deleteAssignmentAction,
  deleteHumanProjectAction,
  deleteTeamMemberAction,
  getAssignedProjectsAction,
  inviteTeamMemberAction,
  listAssignmentsAction,
  listHumanProjectsAction,
  getMemberWorkloadsAction,
  listInvitesAction,
  listTeamMembersAction,
  setMemberPageAccessAction,
  setTeamMemberOrgAction,
  updateAssignmentAction,
  updateHumanProjectAction,
  updateTeamMemberAction,
} from "@/app/actions";
import { MEMBER_DEFAULT_KEYS, MEMBER_TOGGLEABLE } from "@/lib/access/pages";
import type {
  AssignmentStatus,
  HumanProject,
  HumanProjectStatus,
  Project,
  TeamAssignment,
  MemberType,
  TeamMember,
  TeamRole,
} from "@/lib/types";
import { GoalsView } from "./goals-view";
import { DocsView } from "@/components/team/docs-view";
import { ChatView } from "@/components/team/chat-view";
import { CalendarView } from "@/components/team/calendar-view";
import { MeetingsView } from "@/components/team/meetings-view";

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
  member_type: MemberType;
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
  member_type: "teammate",
};

/** Owner-toggleable pages, grouped for the access editor (Operator Lite). */
const ACCESS_GROUPS: { title: string; items: typeof MEMBER_TOGGLEABLE }[] = (() => {
  const order = ["Command", "Create", "Intelligence", "Setup"];
  const byGroup = new Map<string, typeof MEMBER_TOGGLEABLE>();
  for (const p of MEMBER_TOGGLEABLE) {
    const arr = byGroup.get(p.group) ?? [];
    arr.push(p);
    byGroup.set(p.group, arr);
  }
  return order.filter((g) => byGroup.has(g)).map((g) => ({ title: g, items: byGroup.get(g)! }));
})();

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
  // Operator Lite: the pages this teammate can open. Defaults until the owner edits.
  const [pageAccess, setPageAccess] = useState<Set<string>>(new Set(MEMBER_DEFAULT_KEYS));
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
            member_type: member.member_type,
          }
        : EMPTY_MEMBER,
    );
    setPageAccess(
      new Set(member?.page_access && member.page_access.length ? member.page_access : MEMBER_DEFAULT_KEYS),
    );
  }, [open, member]);

  async function save() {
    if (!draft.name.trim()) {
      setError("A name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const isAdvisor = draft.member_type === "advisor";
    const payload = {
      name: draft.name,
      role_title: draft.role_title,
      email: draft.email,
      description: draft.description,
      skills: draft.skills.split(",").map((s) => s.trim()).filter(Boolean),
      birthday: draft.birthday,
      emoji: draft.emoji,
      accent: draft.accent,
      member_type: draft.member_type,
    };

    // New member + invite → create the profile AND send a join invite. Advisors are
    // external network — a profile only, no workspace invite.
    if (!member && sendInvite && !isAdvisor) {
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
      // Save the profile, then (teammates only) the org role/manager.
      const r = await updateTeamMemberAction(member.id, payload);
      if (!("ok" in r) || !r.ok) {
        setSaving(false);
        setError("error" in r ? r.error : "Couldn't save.");
        return;
      }
      if (!isAdvisor) {
        const orgRes = await setTeamMemberOrgAction(member.id, {
          team_role: draft.team_role,
          manager_id: draft.team_role === "manager" ? null : draft.manager_id || null,
        });
        if (!("ok" in orgRes) || !orgRes.ok) {
          setSaving(false);
          setError("error" in orgRes ? orgRes.error : "Saved the profile, but couldn't update the role.");
          return;
        }
        // Operator Lite page access (best-effort — don't block the profile save on it).
        const accessRes = await setMemberPageAccessAction(member.id, [...pageAccess]);
        if (!("ok" in accessRes) || !accessRes.ok) {
          setSaving(false);
          setError("error" in accessRes ? accessRes.error : "Saved the profile, but couldn't update page access.");
          return;
        }
      }
      setSaving(false);
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

  const isAdvisor = draft.member_type === "advisor";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={member ? (isAdvisor ? "Edit advisor" : "Edit team member") : "Add to your team"}
    >
      <div className="flex flex-col gap-3">
        <div>
          <Label>Type</Label>
          <Segmented
            options={[
              { value: "teammate", label: "Teammate" },
              { value: "advisor", label: "Advisor" },
            ]}
            value={draft.member_type}
            onChange={(v) => setDraft({ ...draft, member_type: v as MemberType })}
          />
          <p className="mt-1 text-[12px] text-muted-foreground">
            {isAdvisor
              ? "A strategic advisor in your network — for advice, intros, and startup-level tasks. They don't get workspace access."
              : "A teammate who works in the platform on day-to-day operations."}
          </p>
        </div>
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
            <Label>{isAdvisor ? "Advisory focus" : "Role"}</Label>
            <Input
              value={draft.role_title}
              onChange={(e) => setDraft({ ...draft, role_title: e.target.value })}
              placeholder={isAdvisor ? "GTM Advisor · ex-Stripe" : "Marketing Lead"}
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
          <Label>
            {isAdvisor ? "How they help + their network (the AI reads this)" : "What they do (the AI reads this as context)"}
          </Label>
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder={
              isAdvisor
                ? "Ex-Stripe VP Sales. Can open doors to enterprise buyers and Series A investors; sharp on GTM + pricing."
                : "Owns paid + organic growth; runs the content calendar and weekly reporting."
            }
          />
        </div>
        <div>
          <Label>{isAdvisor ? "Areas of expertise (comma-separated)" : "Skills (comma-separated)"}</Label>
          <Input
            value={draft.skills}
            onChange={(e) => setDraft({ ...draft, skills: e.target.value })}
            placeholder={isAdvisor ? "fundraising, GTM, enterprise sales" : "copywriting, paid ads, analytics"}
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
        {member && !isAdvisor && (
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

        {member && !isAdvisor && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <Label>Operator Lite — page access</Label>
              {!member.linked && (
                <span className="text-[11px] text-muted-foreground">Applies when they join</span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              They get the same app as you, scoped to their own data — with just these pages.
            </p>
            <div className="mt-2.5 space-y-2.5">
              {ACCESS_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {group.title}
                  </p>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                    {group.items.map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={pageAccess.has(p.key)}
                          onChange={(e) =>
                            setPageAccess((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(p.key);
                              else next.delete(p.key);
                              return next;
                            })
                          }
                        />
                        <span className="flex-1">{p.label}</span>
                        {p.member === "default" && (
                          <span className="text-[10px] text-muted-foreground/70">default</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!member && !result && !isAdvisor && (
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

// ── Human project dialog ─────────────────────────────────────────────────────

const PROJECT_STATUSES: { key: HumanProjectStatus; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "on_hold", label: "On hold" },
  { key: "done", label: "Done" },
];
const PROJECT_STATUS_LABEL: Record<HumanProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  done: "Done",
};
const PROJECT_STATUS_TINT: Record<HumanProjectStatus, string> = {
  active: "text-sky-600 dark:text-sky-400",
  on_hold: "text-amber-600 dark:text-amber-400",
  done: "text-success",
};

function HumanProjectDialog({
  open,
  project,
  members,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: HumanProject | null;
  members: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const managers = useMemo(() => members.filter((m) => m.team_role === "manager"), [members]);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<HumanProjectStatus>("active");
  const [deadline, setDeadline] = useState("");
  const [lead, setLead] = useState("");
  const [manager, setManager] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(project?.title ?? "");
    setSummary(project?.summary ?? "");
    setStatus(project?.status ?? "active");
    setDeadline(project?.deadline ? project.deadline.slice(0, 10) : "");
    setLead(project?.lead_member_id ?? "");
    setManager(project?.manager_member_id ?? "");
  }, [open, project]);

  async function save() {
    if (!title.trim()) {
      setError("Give the project a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      title,
      summary,
      status,
      deadline: deadline || null,
      lead_member_id: lead || null,
      manager_member_id: manager || null,
    };
    const r = project
      ? await updateHumanProjectAction(project.id, payload)
      : await createHumanProjectAction(payload);
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r ? r.error : "Couldn't save the project.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={project ? "Edit project" : "New project"}>
      <div className="flex flex-col gap-3">
        <div>
          <Label>Title *</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q3 product launch" />
        </div>
        <div>
          <Label>What it is / the goal</Label>
          <Textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Ship the launch: landing page, email sequence, and press outreach."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Lead (owns it)</Label>
            <Select value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">Owner (you)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Manager (oversees)</Label>
            <Select value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">— none —</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as HumanProjectStatus)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Deadline</Label>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {project ? "Save" : "Create project"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Board cards ──────────────────────────────────────────────────────────────

function aiStatusLabel(s: Project["status"]): string {
  return s === "planning"
    ? "Plan review"
    : s === "active"
      ? "In progress"
      : s === "done"
        ? "Complete"
        : s === "blocked"
          ? "Blocked"
          : "Cancelled";
}

/** An assigned AI project on the board — live progress; click opens it in Projects. */
function AssignedProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const prog = project.progress ?? { total: 0, done: 0 };
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const phases = project.plan.phases.length;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{project.title}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            <Sparkles className="h-2.5 w-2.5" /> AI
          </span>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {prog.done}/{prog.total}
        </span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{aiStatusLabel(project.status)}</span>
        {project.status === "active" && phases > 0 && (
          <span>
            Phase {Math.min(project.current_phase + 1, phases)}/{phases}
          </span>
        )}
      </div>
    </button>
  );
}

/** A manual team project on the board. */
function TeamHumanProjectCard({
  project,
  onEdit,
  onDelete,
}: {
  project: HumanProject;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-medium">{project.title}</span>
        <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={cn("font-semibold uppercase tracking-wide", PROJECT_STATUS_TINT[project.status])}>
          {PROJECT_STATUS_LABEL[project.status]}
        </span>
        <span className="text-muted-foreground">
          {project.open_tasks}/{project.total_tasks} tasks
        </span>
      </div>
      {project.deadline && (
        <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarClock className="h-3 w-3" /> Due {fmtDate(project.deadline)}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const router = useRouter();
  const [view, setView] = useState<
    "roster" | "projects" | "board" | "goals" | "docs" | "chat" | "calendar" | "meetings"
  >("roster");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [projects, setProjects] = useState<HumanProject[]>([]);
  const [assignedProjects, setAssignedProjects] = useState<Project[]>([]);
  const [invites, setInvites] = useState<{ id: string; member_id: string; accept_url: string }[]>([]);
  // Operator Lite oversight: each linked member's open-work + email-connected status.
  const [workloads, setWorkloads] = useState<Record<string, { openTasks: number; hasEmail: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [memberDialog, setMemberDialog] = useState<{ open: boolean; member: TeamMember | null }>({
    open: false,
    member: null,
  });
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; project: HumanProject | null }>({
    open: false,
    project: null,
  });

  async function refresh() {
    const [m, a, inv, p, ap, wl] = await Promise.all([
      listTeamMembersAction(),
      listAssignmentsAction(),
      listInvitesAction(),
      listHumanProjectsAction(),
      getAssignedProjectsAction(),
      getMemberWorkloadsAction(),
    ]);
    setMembers(m);
    setAssignments(a);
    setInvites(inv);
    setProjects(p);
    setAssignedProjects(ap);
    setWorkloads(wl);
    setLoading(false);
  }

  async function removeProject(p: HumanProject) {
    if (!confirm(`Delete "${p.title}"? Its tasks will be kept but detached from the project.`)) return;
    await deleteHumanProjectAction(p.id);
    refresh();
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

  const teammates = members.filter((m) => m.member_type !== "advisor");
  const advisors = members.filter((m) => m.member_type === "advisor");

  const renderMemberCard = (m: TeamMember) => {
    const open = assignments.filter((a) => a.member_id === m.id && a.status !== "done").length;
    return (
      <Card key={m.id} className="group flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Avatar member={m} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{m.name}</span>
              {m.is_owner ? (
                <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  You
                </span>
              ) : m.member_type === "advisor" ? (
                <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                  Advisor
                </span>
              ) : (
                m.team_role === "manager" && (
                  <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    Manager
                  </span>
                )
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
            {m.linked && !m.is_owner && m.member_type !== "advisor" && (
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  Operator Lite
                </span>
                <span>{workloads[m.id]?.openTasks ?? 0} open</span>
                <span>· email {workloads[m.id]?.hasEmail ? "connected" : "not connected"}</span>
              </div>
            )}
          </div>
          <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
            <Button variant="ghost" size="icon" onClick={() => setMemberDialog({ open: true, member: m })}>
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
            {!m.is_owner && (
              <Button variant="ghost" size="icon" onClick={() => removeMember(m)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
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
            {m.member_type === "advisor"
              ? "Strategic advisor"
              : open > 0
                ? `${open} open handoff${open === 1 ? "" : "s"}`
                : "No open handoffs"}
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
  };

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
                { value: "projects", label: "Board" },
                { value: "goals", label: "Goals" },
                { value: "calendar", label: "Calendar" },
                { value: "meetings", label: "Meetings" },
                { value: "chat", label: "Chat" },
                { value: "docs", label: "Docs" },
                { value: "board", label: "Handoffs" },
              ]}
              value={view}
              onChange={(v) =>
                setView(
                  v as "roster" | "projects" | "board" | "goals" | "docs" | "chat" | "calendar" | "meetings",
                )
              }
            />
            {view === "roster" ? (
              <Button size="sm" onClick={() => setMemberDialog({ open: true, member: null })}>
                <UserPlus className="h-4 w-4" /> Add member
              </Button>
            ) : view === "projects" ? (
              <Button size="sm" onClick={() => setProjectDialog({ open: true, project: null })}>
                <Plus className="h-4 w-4" /> New project
              </Button>
            ) : view === "goals" ||
              view === "docs" ||
              view === "chat" ||
              view === "calendar" ||
              view === "meetings" ? null : (
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
        ) : view === "goals" ? (
          <GoalsView members={members} />
        ) : view === "docs" ? (
          <DocsView canManage isOwner />
        ) : view === "chat" ? (
          <ChatView canManage />
        ) : view === "calendar" ? (
          <CalendarView canManage members={members} googleCalendar />
        ) : view === "meetings" ? (
          <MeetingsView canManage members={members} />
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
          <div className="flex flex-col gap-6">
            {teammates.length > 0 && (
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Team · {teammates.length}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {teammates.map(renderMemberCard)}
                </div>
              </div>
            )}
            {advisors.length > 0 && (
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Advisors · {advisors.length}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {advisors.map(renderMemberCard)}
                </div>
              </div>
            )}
          </div>
        ) : view === "projects" ? (
          <div className="flex flex-col gap-6">
            <p className="text-xs text-muted-foreground">
              Every project your team is running — assigned AI projects (live progress) and manual team projects —
              grouped by who owns it. Click an AI project to open it.
            </p>
            {members
              .filter((m) => m.status !== "inactive")
              .map((m) => {
                const ai = assignedProjects.filter((p) => p.assigned_member_id === m.id);
                const human = projects.filter((hp) => hp.lead_member_id === m.id || hp.manager_member_id === m.id);
                const count = ai.length + human.length;
                return (
                  <div key={m.id} className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar member={m} size="sm" />
                      <span className="font-semibold">{m.name}</span>
                      {m.team_role === "manager" && (
                        <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          Manager
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        · {count} project{count === 1 ? "" : "s"}
                      </span>
                    </div>
                    {count === 0 ? (
                      <p className="pl-1 text-xs text-muted-foreground">Nothing assigned yet.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {ai.map((p) => (
                          <AssignedProjectCard
                            key={p.id}
                            project={p}
                            onOpen={() => router.push(`/projects?open=${p.id}`)}
                          />
                        ))}
                        {human.map((hp) => (
                          <TeamHumanProjectCard
                            key={hp.id}
                            project={hp}
                            onEdit={() => setProjectDialog({ open: true, project: hp })}
                            onDelete={() => removeProject(hp)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            {(() => {
              const ownerRun = projects.filter((hp) => !hp.lead_member_id && !hp.manager_member_id);
              if (!ownerRun.length) return null;
              return (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      —
                    </div>
                    <span className="font-semibold">Owner-run</span>
                    <span className="text-xs text-muted-foreground">
                      · {ownerRun.length} project{ownerRun.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {ownerRun.map((hp) => (
                      <TeamHumanProjectCard
                        key={hp.id}
                        project={hp}
                        onEdit={() => setProjectDialog({ open: true, project: hp })}
                        onDelete={() => removeProject(hp)}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
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
      <HumanProjectDialog
        open={projectDialog.open}
        project={projectDialog.project}
        members={members}
        onClose={() => setProjectDialog({ open: false, project: null })}
        onSaved={refresh}
      />
    </>
  );
}
