"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  NotebookPen,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  createTeamMeetingAction,
  deleteTeamMeetingAction,
  importNotionMeetingAction,
  listMeetingAssignmentsAction,
  listNotionMeetingPagesAction,
  listTeamMeetingsAction,
  previewNotionMeetingAction,
  stageOutboundDraftAction,
  updateTeamMeetingAction,
} from "@/app/actions";
import type { TeamMeeting, TeamMember } from "@/lib/types";

type NotionPage = Awaited<ReturnType<typeof listNotionMeetingPagesAction>>["pages"][number];
type ActionRow = {
  title: string;
  detail: string;
  owner_name: string | null;
  member_id: string | null;
  due: string | null;
  include: boolean;
};

type BriefTask = { title: string; assignee: string | null; due: string | null };

/**
 * Format a meeting's action items + summary as an email body — ACTION ITEMS FIRST
 * (assignee + deadline), then the meeting summary — ready to copy or send to the team.
 */
function buildMeetingEmail(input: {
  title: string;
  date: string;
  summary: string;
  tasks: BriefTask[];
}): { subject: string; body: string } {
  const dateLabel = input.date ? fmtDate(input.date) : "";
  const lines: string[] = [];
  lines.push("Hi team,");
  lines.push("");
  lines.push(`Here are the action items and notes from ${input.title}${dateLabel ? ` (${dateLabel})` : ""}.`);
  lines.push("");
  if (input.tasks.length) {
    lines.push("ACTION ITEMS");
    for (const t of input.tasks) {
      const bits: string[] = [];
      if (t.assignee) bits.push(t.assignee);
      if (t.due) bits.push(`due ${fmtDate(t.due)}`);
      lines.push(`• ${t.title}${bits.length ? ` — ${bits.join(", ")}` : ""}`);
    }
    lines.push("");
  }
  if (input.summary.trim()) {
    lines.push("MEETING SUMMARY");
    lines.push(input.summary.trim());
    lines.push("");
  }
  lines.push("Thanks");
  return { subject: `Action items & notes — ${input.title}`, body: lines.join("\n") };
}

/**
 * Review + send a meeting brief as an email: an editable preview (tasks first, then
 * summary), pre-addressed to the attendees. Copy it, or stage it as a draft in the
 * Email Manager to review and send there. Nothing sends from here.
 */
function EmailBriefDialog({
  open,
  onClose,
  meeting,
  tasks,
  recipients,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  meeting: { title: string; date: string; summary: string };
  tasks: BriefTask[];
  recipients: { name: string; email: string }[];
  loading: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!open || loading) return;
    const e = buildMeetingEmail({ title: meeting.title, date: meeting.date, summary: meeting.summary, tasks });
    setSubject(e.subject);
    setBody(e.body);
    setCopied(false);
    setResult(null);
  }, [open, loading, meeting.title, meeting.date, meeting.summary, tasks]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setResult({ ok: false, msg: "Couldn't copy — select the text and copy manually." });
    }
  }

  async function draft() {
    setDrafting(true);
    setResult(null);
    const to = recipients[0]?.email ?? "";
    const cc = recipients.slice(1).map((r) => r.email).join(", ");
    const r = await stageOutboundDraftAction({
      to,
      cc,
      subject,
      body,
      recipientName: recipients.map((x) => x.name).join(", "),
    });
    setDrafting(false);
    if ("ok" in r && r.ok) setResult({ ok: true, msg: "Drafted in the Email Manager — review recipients and send there." });
    else setResult({ ok: false, msg: "error" in r ? r.error : "Couldn't create the draft." });
  }

  return (
    <Dialog open={open} onClose={onClose} title="Email the team" className="max-w-2xl">
      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="flex max-h-[75vh] flex-col gap-3 overflow-y-auto pr-1">
          <div>
            <Label>To</Label>
            {recipients.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {recipients.map((r) => (
                  <span
                    key={r.email}
                    className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
                    title={r.email}
                  >
                    {r.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No attendee emails on file — you can add recipients in the Email Manager after drafting.
              </p>
            )}
          </div>
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label>Message (action items first, then the summary)</Label>
            <Textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-[12.5px]" />
          </div>

          {result && (
            <div
              className={cn(
                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px]",
                result.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
              )}
            >
              <span>{result.msg}</span>
              {result.ok && (
                <Button size="sm" variant="outline" onClick={() => router.push("/email")}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open Email Manager
                </Button>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" onClick={draft} disabled={drafting}>
              {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Draft in Email Manager
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Pull the trailing 32-hex page id out of a Notion page URL (or accept a raw id). */
function parseNotionPageId(input: string): string | null {
  const runs = input.replace(/[^0-9a-fA-F]/g, " ").match(/[0-9a-fA-F]{32}/g);
  return runs ? runs[runs.length - 1] : null;
}

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
                  {m.is_owner ? " (You)" : m.member_type === "advisor" ? " · Advisor" : ""}
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
            Tip: to auto-create tasks from action items, use “Import from Notion” instead of typing notes here.
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

function NotionImportDialog({
  open,
  members,
  onClose,
  onImported,
}: {
  open: boolean;
  members: TeamMember[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<"pick" | "review">("pick");
  const [loadingPages, setLoadingPages] = useState(false);
  const [connected, setConnected] = useState(true);
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Review-step state (the confirmed, editable meeting).
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setManualUrl("");
    setErr(null);
    setPageErr(null);
    setTitle("");
    setDate("");
    setSummary("");
    setNotes("");
    setAttendeeIds([]);
    setRows([]);
    setCopied(false);
    void loadPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadPages() {
    setLoadingPages(true);
    const r = await listNotionMeetingPagesAction();
    setConnected(r.connected);
    setPages(r.pages);
    setPageErr(r.error ?? null);
    setLoadingPages(false);
  }

  async function analyze(pageId: string, pageTitle?: string) {
    setAnalyzing(true);
    setErr(null);
    const p = await previewNotionMeetingAction(pageId, pageTitle);
    setAnalyzing(false);
    if (!p.ok) {
      setErr(p.error ?? "Couldn't read that meeting.");
      return;
    }
    setTitle(p.title);
    setDate(p.date ?? new Date().toISOString().slice(0, 10));
    setSummary(p.summary ?? "");
    setNotes(p.summary ? `${p.summary}\n\n${p.notes}` : p.notes);
    setAttendeeIds(p.attendee_ids);
    setRows(p.actions.map((a) => ({ ...a, include: true })));
    setStep("review");
  }

  function analyzeManual() {
    const id = parseNotionPageId(manualUrl);
    if (!id) {
      setErr("Paste a valid Notion page link.");
      return;
    }
    void analyze(id);
  }

  function patchRow(i: number, patch: Partial<ActionRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function doImport() {
    if (!title.trim()) {
      setErr("Give the meeting a title.");
      return;
    }
    setSaving(true);
    setErr(null);
    const r = await importNotionMeetingAction({
      title,
      meeting_date: new Date(date || new Date().toISOString().slice(0, 10)).toISOString(),
      notes,
      attendee_ids: attendeeIds,
      actions: rows
        .filter((row) => row.include && row.title.trim())
        .map((row) => ({ title: row.title, detail: row.detail, member_id: row.member_id, deadline: row.due })),
    });
    setSaving(false);
    if ("ok" in r && r.ok) {
      onImported();
      onClose();
    } else {
      setErr("error" in r ? r.error : "Couldn't import the meeting.");
    }
  }

  /** Copy the action items + summary for pasting into an email — before importing. */
  async function copyForEmail() {
    const tasks: BriefTask[] = rows
      .filter((r) => r.include && r.title.trim())
      .map((r) => ({
        title: r.title,
        assignee: r.member_id ? members.find((m) => m.id === r.member_id)?.name ?? null : r.owner_name || null,
        due: r.due,
      }));
    const { subject, body } = buildMeetingEmail({ title, date, summary: summary || notes, tasks });
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const assignedCount = rows.filter((r) => r.include && r.member_id).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={step === "pick" ? "Import a meeting from Notion" : "Review & assign"}
      className={step === "review" ? "max-w-2xl" : undefined}
    >
      {step === "pick" ? (
        <div className="flex flex-col gap-3">
          {analyzing ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Reading the meeting and pulling out action items…</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Pull a meeting transcript from Notion. We&apos;ll structure it, then you confirm who attended and assign
                the action items as tasks.
              </p>

              {!connected ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  Notion isn&apos;t connected.{" "}
                  <a href="/integrations" className="font-medium text-primary underline">
                    Connect it in Integrations
                  </a>{" "}
                  and share your meeting-notes page with the Operator integration.
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="Paste a Notion page link"
                      className="text-sm"
                    />
                    <Button onClick={analyzeManual} disabled={!manualUrl.trim()}>
                      Analyze
                    </Button>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Recent Notion pages
                    </div>
                    {loadingPages ? (
                      <div className="flex justify-center py-6 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    ) : pages.length === 0 ? (
                      <p className="py-2 text-xs text-muted-foreground">
                        No pages found. In Notion, share your meeting-notes page with the Operator integration.
                      </p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                        {pages.map((pg) => (
                          <button
                            key={pg.id}
                            onClick={() => analyze(pg.id, pg.title)}
                            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-accent"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{pg.title}</span>
                            {pg.last_edited && (
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {fmtDate(pg.last_edited)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              {(err || pageErr) && <p className="text-sm text-red-600">{err || pageErr}</p>}
            </>
          )}
        </div>
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <Label>Title *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
                    onClick={() =>
                      setAttendeeIds((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                    }
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
            <div className="flex items-center justify-between">
              <Label>Action items</Label>
              <span className="text-[11px] text-muted-foreground">
                {assignedCount} will be assigned as task{assignedCount === 1 ? "" : "s"}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No action items were found in this meeting.</p>
            ) : (
              <div className="mt-1 flex flex-col gap-2">
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border border-border p-2 transition",
                      !row.include && "opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={row.include}
                        onChange={(e) => patchRow(i, { include: e.target.checked })}
                        className="mt-1.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Input
                          value={row.title}
                          onChange={(e) => patchRow(i, { title: e.target.value })}
                          className="text-sm"
                        />
                        {row.detail && (
                          <p className="line-clamp-2 text-[11px] text-muted-foreground">{row.detail}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={row.member_id ?? ""}
                            onChange={(e) => patchRow(i, { member_id: e.target.value || null })}
                            className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
                          >
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                                {m.is_owner ? " (You)" : m.member_type === "advisor" ? " · Advisor" : ""}
                              </option>
                            ))}
                          </select>
                          <Input
                            type="date"
                            value={row.due ?? ""}
                            onChange={(e) => patchRow(i, { due: e.target.value || null })}
                            className="w-auto text-xs"
                          />
                          {row.owner_name && !row.member_id && (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400">
                              said: {row.owner_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("pick")}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={copyForEmail} title="Copy the tasks + summary to paste into an email">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy for email"}
              </Button>
              <Button onClick={doImport} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Import meeting{assignedCount > 0 ? ` + ${assignedCount} task${assignedCount === 1 ? "" : "s"}` : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function MeetingsView({ canManage, members }: { canManage: boolean; members: TeamMember[] }) {
  const [meetings, setMeetings] = useState<TeamMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; meeting: TeamMeeting | null }>({ open: false, meeting: null });
  const [importing, setImporting] = useState(false);
  const [brief, setBrief] = useState<{
    open: boolean;
    loading: boolean;
    meeting: { title: string; date: string; summary: string };
    tasks: BriefTask[];
    recipients: { name: string; email: string }[];
  }>({ open: false, loading: false, meeting: { title: "", date: "", summary: "" }, tasks: [], recipients: [] });

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

  /** Open the email brief for a saved meeting — fetch its assigned tasks + resolve
   *  attendee emails (excluding you), then hand it to the EmailBriefDialog. */
  async function openEmailBrief(m: TeamMeeting) {
    const recipients = m.attendee_ids
      .map((id) => members.find((mem) => mem.id === id))
      .filter((mem): mem is TeamMember => !!mem && !mem.is_owner && !!mem.email && !!mem.email.trim())
      .map((mem) => ({ name: mem.name, email: mem.email.trim() }));
    setBrief({
      open: true,
      loading: true,
      meeting: { title: m.title, date: m.meeting_date, summary: m.notes ?? "" },
      tasks: [],
      recipients,
    });
    const rows = await listMeetingAssignmentsAction(m.id);
    setBrief((prev) => ({
      ...prev,
      loading: false,
      tasks: rows.map((a) => ({ title: a.title, assignee: a.member_name || null, due: a.deadline })),
    }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Notes from your meetings. Import a transcript from Notion to turn action items into assigned tasks.
        </p>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              <Sparkles className="h-4 w-4" /> Import from Notion
            </Button>
            <Button size="sm" onClick={() => setDialog({ open: true, meeting: null })}>
              <Plus className="h-4 w-4" /> New meeting
            </Button>
          </div>
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
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => openEmailBrief(m)}
                    title="Email the action items + summary to the team"
                  >
                    <Mail className="h-3.5 w-3.5" /> Email
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 transition group-hover:opacity-100"
                    onClick={() => remove(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
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

      <NotionImportDialog
        open={importing}
        members={members}
        onClose={() => setImporting(false)}
        onImported={refresh}
      />

      <EmailBriefDialog
        open={brief.open}
        loading={brief.loading}
        meeting={brief.meeting}
        tasks={brief.tasks}
        recipients={brief.recipients}
        onClose={() => setBrief((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
