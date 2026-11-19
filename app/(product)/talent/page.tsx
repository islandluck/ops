"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  CalendarClock,
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  createJobAction,
  deleteJobAction,
  draftCandidateEmailAction,
  draftJobAction,
  getCareersLinkAction,
  getResumeUrlAction,
  getWorkspaceComplianceAction,
  listApplicationsAction,
  listJobsAction,
  moveApplicationStageAction,
  scheduleInterviewAction,
  screenApplicationAction,
  screenJobApplicantsAction,
  setJobStatusAction,
  setWorkspaceComplianceAction,
  updateJobAction,
} from "@/app/actions";
import type { Application, ApplicationStage, EmploymentType, JobPost, PayType, ScreeningQuestion } from "@/lib/types";
import { STANDARD_COMPLIANCE, defaultPayType, formatPay } from "@/lib/talent/format";

const EMPLOYMENT: { value: EmploymentType; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
  { value: "temporary", label: "Temporary" },
];
const EMPLOYMENT_LABEL = Object.fromEntries(EMPLOYMENT.map((e) => [e.value, e.label])) as Record<EmploymentType, string>;

const STAGES: { key: ApplicationStage; label: string; tint: string }[] = [
  { key: "applied", label: "Applied", tint: "text-slate-500" },
  { key: "screening", label: "Screening", tint: "text-sky-600 dark:text-sky-400" },
  { key: "interview", label: "Interview", tint: "text-violet-600 dark:text-violet-400" },
  { key: "offer", label: "Offer", tint: "text-amber-600 dark:text-amber-400" },
  { key: "hired", label: "Hired", tint: "text-emerald-600 dark:text-emerald-400" },
  { key: "rejected", label: "Rejected", tint: "text-muted-foreground" },
];

/** Color band for an AI fit score chip. */
function scoreTone(score: number): string {
  if (score >= 85) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (score >= 60) return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "border-border bg-muted/60 text-muted-foreground";
}

const STATUS_META: Record<JobPost["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-border bg-muted/50 text-muted-foreground" },
  open: { label: "Open", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  closed: { label: "Closed", cls: "border-border bg-muted/50 text-muted-foreground" },
};

function jobUrl(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/jobs/${slug}`;
}

const PAY_TYPES: { value: PayType; label: string }[] = [
  { value: "salary", label: "Salary range" },
  { value: "hourly", label: "Hourly rate" },
  { value: "unspecified", label: "Don't show pay" },
];

/** Cents → a dollars string for the editor input (hourly keeps cents). */
function centsToInput(cents: number | null, payType: PayType): string {
  if (cents == null) return "";
  return payType === "hourly" ? (cents / 100).toFixed(2) : String(Math.round(cents / 100));
}
/** A dollars string from the editor → integer cents (null when empty/invalid). */
function inputToCents(s: string): number | null {
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/* ------------------------------ job dialog ------------------------------- */

function emptyQuestion(): ScreeningQuestion {
  return { id: `q${Math.random().toString(36).slice(2, 7)}`, prompt: "", required: false };
}

function JobDialog({
  open,
  job,
  complianceDefault,
  onClose,
  onSaved,
}: {
  open: boolean;
  job: JobPost | null;
  complianceDefault: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [employment, setEmployment] = useState<EmploymentType>("full_time");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<ScreeningQuestion[]>([]);
  const [notes, setNotes] = useState("");
  const [payType, setPayType] = useState<PayType>("salary");
  const [payTouched, setPayTouched] = useState(false);
  const [payMin, setPayMin] = useState("");
  const [payMax, setPayMax] = useState("");
  const [compliance, setCompliance] = useState("");
  const [saveComplianceDefault, setSaveComplianceDefault] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotes("");
    setSaveComplianceDefault(false);
    setPayTouched(false);
    setTitle(job?.title ?? "");
    setLocation(job?.location ?? "");
    const emp = job?.employment_type ?? "full_time";
    setEmployment(emp);
    setDescription(job?.description_md ?? "");
    setQuestions(job?.screening_questions ?? []);
    const pt = job?.pay_type ?? defaultPayType(emp);
    setPayType(pt);
    setPayMin(job ? centsToInput(job.pay_min, pt) : "");
    setPayMax(job ? centsToInput(job.pay_max, pt) : "");
    setCompliance(job ? job.compliance_md : complianceDefault);
  }, [open, job, complianceDefault]);

  // New roles: follow the employment type's natural pay model until the user picks one.
  function changeEmployment(emp: EmploymentType) {
    setEmployment(emp);
    if (!job && !payTouched) setPayType(defaultPayType(emp));
  }

  const payPreview =
    payType === "unspecified"
      ? null
      : formatPay({ pay_type: payType, pay_min: inputToCents(payMin), pay_max: inputToCents(payMax), pay_currency: "usd" });

  async function draft() {
    if (!title.trim()) {
      setError("Add a role title first, then draft with AI.");
      return;
    }
    setDrafting(true);
    setError(null);
    const r = await draftJobAction({ title, location, employmentType: employment, notes });
    setDrafting(false);
    if (r.ok) {
      setDescription(r.draft.description_md);
      setQuestions(r.draft.screening_questions);
      if (!location.trim()) setLocation(r.draft.location);
      setEmployment(r.draft.employment_type);
      if (!title.trim()) setTitle(r.draft.title);
    } else {
      setError(r.error);
    }
  }

  async function save() {
    if (!title.trim()) {
      setError("Give the role a title.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      title,
      location,
      employment_type: employment,
      description_md: description,
      screening_questions: questions.filter((q) => q.prompt.trim()),
      pay_type: payType,
      pay_min: payType === "unspecified" ? null : inputToCents(payMin),
      pay_max: payType === "unspecified" ? null : inputToCents(payMax),
      pay_currency: "usd",
      compliance_md: compliance,
    };
    if (saveComplianceDefault) await setWorkspaceComplianceAction(compliance);
    const r = job ? await updateJobAction(job.id, payload) : await createJobAction(payload);
    setSaving(false);
    if ("ok" in r && r.ok) {
      onSaved();
      onClose();
    } else {
      setError("error" in r && r.error ? r.error : "Couldn't save the job.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={job ? "Edit role" : "New role"} className="max-w-2xl">
      <div className="flex max-h-[72vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <Label>Role title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Process Engineer" />
          </div>
          <div>
            <Label>Type</Label>
            <select
              value={employment}
              onChange={(e) => changeEmployment(e.target.value as EmploymentType)}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            >
              {EMPLOYMENT.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label>Location</Label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote · Boston, MA" />
        </div>

        <div>
          <Label>Compensation</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              value={payType}
              onChange={(e) => {
                setPayTouched(true);
                setPayType(e.target.value as PayType);
              }}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            >
              {PAY_TYPES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {payType !== "unspecified" && (
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  value={payMin}
                  onChange={(e) => setPayMin(e.target.value)}
                  inputMode="decimal"
                  placeholder={payType === "hourly" ? "45.00" : "90000"}
                  className="w-24 text-sm"
                />
                <span className="text-xs text-muted-foreground">to $</span>
                <Input
                  value={payMax}
                  onChange={(e) => setPayMax(e.target.value)}
                  inputMode="decimal"
                  placeholder={payType === "hourly" ? "60.00" : "120000"}
                  className="w-24 text-sm"
                />
                <span className="text-xs text-muted-foreground">{payType === "hourly" ? "/hr" : "/yr"}</span>
              </div>
            )}
          </div>
          {payType !== "unspecified" && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {payPreview
                ? `Candidates see: ${payPreview}`
                : "Enter a minimum; leave the max blank for a single figure."}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5 dark:border-violet-500/30 dark:bg-violet-500/10">
          <Label>Draft with AI</Label>
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            Optional notes on the role (must-haves, responsibilities) — the AI drafts the description + screening
            questions from your business brief.
          </p>
          <div className="flex gap-2">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 5+ yrs reactor design, PhD preferred" />
            <Button size="sm" variant="secondary" onClick={draft} disabled={drafting || !title.trim()}>
              {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Draft
            </Button>
          </div>
        </div>

        <div>
          <Label>Description (markdown)</Label>
          <Textarea
            rows={12}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="## About the role…"
            className="font-mono text-[12.5px]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label>Screening questions</Label>
            <button
              type="button"
              onClick={() => setQuestions((q) => [...q, emptyQuestion()])}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              + Add question
            </button>
          </div>
          <div className="mt-1 flex flex-col gap-2">
            {questions.length === 0 && (
              <p className="text-[11px] text-muted-foreground">None — applicants just submit a résumé + note.</p>
            )}
            {questions.map((q, i) => (
              <div key={q.id} className="flex items-center gap-2">
                <Input
                  value={q.prompt}
                  onChange={(e) =>
                    setQuestions((qs) => qs.map((x, idx) => (idx === i ? { ...x, prompt: e.target.value } : x)))
                  }
                  placeholder="What draws you to this role?"
                  className="text-sm"
                />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) =>
                      setQuestions((qs) => qs.map((x, idx) => (idx === i ? { ...x, required: e.target.checked } : x)))
                    }
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}
                  className="shrink-0 text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label>Compliance &amp; legal</Label>
            <button
              type="button"
              onClick={() =>
                setCompliance((c) =>
                  c.includes("Equal opportunity")
                    ? c
                    : c.trim()
                      ? `${c.trim()}\n\n${STANDARD_COMPLIANCE}`
                      : STANDARD_COMPLIANCE,
                )
              }
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Insert standard statement
            </button>
          </div>
          <p className="mb-1 text-[11px] text-muted-foreground">
            Shown at the end of the posting (EEO, at-will, etc.). Markdown — review it for your jurisdiction.
          </p>
          <Textarea
            rows={6}
            value={compliance}
            onChange={(e) => setCompliance(e.target.value)}
            placeholder="## Equal opportunity employer…"
            className="font-mono text-[12.5px]"
          />
          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={saveComplianceDefault}
              onChange={(e) => setSaveComplianceDefault(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Save as my default for new roles
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {job ? "Save" : "Create role"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ pipeline --------------------------------- */

function ResumeButton({ applicationId }: { applicationId: string }) {
  const [loading, setLoading] = useState(false);
  async function open() {
    setLoading(true);
    const w = window.open("", "_blank");
    const { url } = await getResumeUrlAction(applicationId);
    setLoading(false);
    if (url) {
      if (w) w.location.href = url;
      else window.open(url, "_blank");
    } else {
      if (w) w.close();
    }
  }
  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
      Résumé
    </button>
  );
}

function ApplicationDialog({
  app,
  onClose,
  onMove,
  onRescreen,
}: {
  app: Application | null;
  onClose: () => void;
  onMove: (id: string, stage: ApplicationStage) => void;
  onRescreen: (id: string) => Promise<void>;
}) {
  const [rescreening, setRescreening] = useState(false);
  const [emailBusy, setEmailBusy] = useState<"rejection" | "interview" | null>(null);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(30);
  const [scheduling, setScheduling] = useState(false);
  const [schedMsg, setSchedMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!app) return null;
  const scored = app.ai_score != null;

  async function schedule() {
    if (!when) {
      setSchedMsg({ ok: false, text: "Pick a date and time." });
      return;
    }
    setScheduling(true);
    setSchedMsg(null);
    const r = await scheduleInterviewAction(app!.id, new Date(when).toISOString(), duration);
    setScheduling(false);
    if (r.ok) {
      onMove(app!.id, "interview");
      setSchedMsg({
        ok: true,
        text: r.joinUrl ? "Scheduled — calendar invite sent, Zoom link added." : "Scheduled — calendar invite sent to the candidate.",
      });
    } else {
      setSchedMsg({ ok: false, text: r.error ?? "Couldn't schedule." });
    }
  }

  async function rescreen() {
    setRescreening(true);
    await onRescreen(app!.id);
    setRescreening(false);
  }

  async function draftEmail(kind: "rejection" | "interview") {
    setEmailBusy(kind);
    setEmailMsg(null);
    const r = await draftCandidateEmailAction(app!.id, kind);
    setEmailBusy(null);
    setEmailMsg(
      r.ok
        ? { ok: true, text: "Drafted in the Email Manager — review and send it there." }
        : { ok: false, text: r.error ?? "Couldn't draft the email." },
    );
  }

  return (
    <Dialog open={!!app} onClose={onClose} title={app.candidate_name || "Applicant"} className="max-w-xl">
      <div className="flex max-h-[72vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {app.candidate_email && <span>{app.candidate_email}</span>}
          {app.candidate_phone && <span>· {app.candidate_phone}</span>}
          {app.resume_path && (
            <span>
              · <ResumeButton applicationId={app.id} />
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Stage</span>
          <select
            value={app.stage}
            onChange={(e) => onMove(app.id, e.target.value as ApplicationStage)}
            className="rounded-md border border-border bg-card px-2 py-1 text-[12px]"
          >
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">AI screening</span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={rescreen} disabled={rescreening}>
              {rescreening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {scored ? "Re-screen" : "Screen now"}
            </Button>
          </div>
          {scored ? (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-sm font-semibold tabular-nums",
                    scoreTone(app.ai_score ?? 0),
                  )}
                >
                  {app.ai_score}/100
                </span>
                {app.ai_recommend && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <Star className="h-3 w-3" /> Recommend interview
                  </span>
                )}
              </div>
              {app.ai_summary && <p className="text-[13px] leading-relaxed">{app.ai_summary}</p>}
              {app.ai_eval.strengths.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Strengths</p>
                  <ul className="mt-0.5 list-disc pl-4 text-[12px] text-muted-foreground">
                    {app.ai_eval.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {app.ai_eval.concerns.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Concerns</p>
                  <ul className="mt-0.5 list-disc pl-4 text-[12px] text-muted-foreground">
                    {app.ai_eval.concerns.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Not screened yet — score this candidate against the role.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email candidate</span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => draftEmail("interview")}
                disabled={emailBusy !== null || !app.candidate_email}
              >
                {emailBusy === "interview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Interview invite
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => draftEmail("rejection")}
                disabled={emailBusy !== null || !app.candidate_email}
              >
                {emailBusy === "rejection" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Rejection
              </Button>
            </div>
          </div>
          {emailMsg && (
            <p
              className={cn(
                "mt-2 text-[12px]",
                emailMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
              )}
            >
              {emailMsg.text}
              {emailMsg.ok && (
                <a href="/email" className="ml-1 font-medium underline">
                  Open Email Manager
                </a>
              )}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            AI drafts it in your voice and stages it in the Email Manager — nothing sends until you review and send it.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Interview</span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setShowSchedule((v) => !v)}>
              <CalendarClock className="h-3.5 w-3.5" /> Schedule
            </Button>
          </div>
          {showSchedule && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1 text-[12px]"
              />
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="rounded-md border border-border bg-card px-2 py-1 text-[12px]"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
              </select>
              <Button size="sm" onClick={schedule} disabled={scheduling}>
                {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                Schedule
              </Button>
            </div>
          )}
          {schedMsg && (
            <p
              className={cn(
                "mt-2 text-[12px]",
                schedMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
              )}
            >
              {schedMsg.text}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Sends a Google Calendar invite to the candidate (+ a Zoom link if Zoom is connected) and moves them to Interview.
          </p>
        </div>

        {app.cover_note && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Why they&apos;re a fit</p>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{app.cover_note}</p>
          </div>
        )}

        {app.answers.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Screening answers</p>
            {app.answers.map((qa, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/20 p-2">
                <p className="text-[12px] font-medium">{qa.question}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-muted-foreground">{qa.answer}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PipelineBoard({ job, onBack }: { job: JobPost; onBack: () => void }) {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [screening, setScreening] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setApps(await listApplicationsAction(job.id));
  }, [job.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function move(appId: string, stage: ApplicationStage) {
    setApps((cur) => (cur ? cur.map((a) => (a.id === appId ? { ...a, stage } : a)) : cur));
    await moveApplicationStageAction(appId, stage);
  }

  async function rescreen(appId: string) {
    await screenApplicationAction(appId);
    await refresh();
  }

  async function screenAll() {
    setScreening(true);
    setNote(null);
    const r = await screenJobApplicantsAction(job.id);
    setScreening(false);
    await refresh();
    setNote(
      r.screened > 0 ? `Screened ${r.screened} new applicant${r.screened === 1 ? "" : "s"}.` : "Everyone is already screened.",
    );
  }

  const byStage = useMemo(() => {
    const map: Record<ApplicationStage, Application[]> = {
      applied: [],
      screening: [],
      interview: [],
      offer: [],
      hired: [],
      rejected: [],
    };
    for (const a of apps ?? []) map[a.stage].push(a);
    // Rank within each column: recommended first, then by score (unscored last).
    const rank = (a: Application) => (a.ai_recommend ? 1_000_000 : 0) + (a.ai_score ?? -1);
    for (const k of Object.keys(map) as ApplicationStage[]) map[k].sort((x, y) => rank(y) - rank(x));
    return map;
  }, [apps]);

  const openApp = apps?.find((a) => a.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> All roles
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{job.title}</h2>
          <p className="text-[11px] text-muted-foreground">
            {apps ? `${apps.length} applicant${apps.length === 1 ? "" : "s"}` : "Loading…"}
            {note && <span className="ml-1 text-emerald-600 dark:text-emerald-400">· {note}</span>}
          </p>
        </div>
        {apps && apps.length > 0 && (
          <Button size="sm" variant="secondary" onClick={screenAll} disabled={screening}>
            {screening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Screen applicants
          </Button>
        )}
      </div>

      {apps === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : apps.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Users className="h-8 w-8 opacity-40" />
          <p className="text-sm">No applicants yet.</p>
          <p className="text-xs">
            {job.status === "open"
              ? "Share the public link to start collecting applications."
              : "Publish this role to open applications."}
          </p>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((st) => (
            <div key={st.key} className="flex w-64 shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className={cn("text-[12px] font-semibold", st.tint)}>{st.label}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{byStage[st.key].length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {byStage[st.key].map((a) => (
                  <Card key={a.id} className="p-2.5">
                    <button type="button" className="block w-full text-left" onClick={() => setOpenId(a.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{a.candidate_name || "—"}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{a.candidate_email}</div>
                        </div>
                        {a.ai_score != null && (
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                              scoreTone(a.ai_score),
                            )}
                            title="AI fit score"
                          >
                            {a.ai_score}
                          </span>
                        )}
                      </div>
                      {a.ai_recommend && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          <Star className="h-2.5 w-2.5" /> Interview
                        </span>
                      )}
                      {a.ai_summary ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{a.ai_summary}</p>
                      ) : a.cover_note ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{a.cover_note}</p>
                      ) : null}
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {a.resume_path ? (
                        <ResumeButton applicationId={a.id} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">No résumé</span>
                      )}
                      <select
                        value={a.stage}
                        onChange={(e) => move(a.id, e.target.value as ApplicationStage)}
                        className="rounded-md border border-border bg-card px-1.5 py-1 text-[11px]"
                      >
                        {STAGES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ApplicationDialog app={openApp} onClose={() => setOpenId(null)} onMove={move} onRescreen={rescreen} />
    </div>
  );
}

/* ------------------------------- job card -------------------------------- */

function JobCard({
  job,
  onEdit,
  onOpenPipeline,
  onRefresh,
}: {
  job: JobPost;
  onEdit: () => void;
  onOpenPipeline: () => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const status = STATUS_META[job.status];

  async function setStatus(status: "draft" | "open" | "closed") {
    setBusy(true);
    await setJobStatusAction(job.id, status);
    setBusy(false);
    onRefresh();
  }
  async function remove() {
    if (!window.confirm(`Delete "${job.title}" and its applicants? This can't be undone.`)) return;
    setBusy(true);
    await deleteJobAction(job.id);
    onRefresh();
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(jobUrl(job.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <button className="min-w-0 text-left" onClick={onOpenPipeline}>
          <div className="truncate text-sm font-semibold hover:underline">{job.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {[job.location, EMPLOYMENT_LABEL[job.employment_type], formatPay(job)].filter(Boolean).join(" · ")}
          </div>
        </button>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", status.cls)}>
          {status.label}
        </span>
      </div>

      <button onClick={onOpenPipeline} className="flex items-center gap-3 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> {job.applicant_count ?? 0} applicant{job.applicant_count === 1 ? "" : "s"}
        </span>
        {(job.active_count ?? 0) > 0 && <span className="text-sky-600 dark:text-sky-400">{job.active_count} active</span>}
      </button>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onOpenPipeline}>
          <Users className="h-3.5 w-3.5" /> Pipeline
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onEdit} disabled={busy}>
          Edit
        </Button>
        {job.status === "open" ? (
          <>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={copyLink}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <a href={jobUrl(job.slug)} target="_blank" rel="noreferrer" className="inline-flex">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <ExternalLink className="h-3.5 w-3.5" /> View
              </Button>
            </a>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStatus("closed")} disabled={busy}>
              Close
            </Button>
          </>
        ) : (
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setStatus("open")} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Publish
          </Button>
        )}
        <button
          type="button"
          onClick={remove}
          className="ml-auto text-muted-foreground transition hover:text-destructive"
          title="Delete role"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function TalentPage() {
  const [jobs, setJobs] = useState<JobPost[] | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; job: JobPost | null }>({ open: false, job: null });
  const [pipeline, setPipeline] = useState<JobPost | null>(null);
  const [careersSlug, setCareersSlug] = useState<string | null>(null);
  const [complianceDefault, setComplianceDefault] = useState("");
  const [copiedBoard, setCopiedBoard] = useState(false);

  const refresh = useCallback(async () => {
    const [js, link, comp] = await Promise.all([
      listJobsAction(),
      getCareersLinkAction(),
      getWorkspaceComplianceAction(),
    ]);
    setJobs(js);
    setCareersSlug(link.slug);
    setComplianceDefault(comp.compliance);
    // Keep the open pipeline job fresh.
    setPipeline((cur) => (cur ? js.find((j) => j.id === cur.id) ?? null : null));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function copyBoard() {
    if (!careersSlug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/careers/${careersSlug}`);
      setCopiedBoard(true);
      setTimeout(() => setCopiedBoard(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <PageHeader
        title="Talent"
        description="Run your own job board — post roles, collect applicants, and move them through your hiring pipeline."
        actions={
          <Button size="sm" onClick={() => setDialog({ open: true, job: null })}>
            <Plus className="h-4 w-4" /> New role
          </Button>
        }
      />
      <PageBody className="space-y-5">
        {careersSlug && !pipeline && (
          <Card className="flex flex-wrap items-center justify-between gap-2 border-dashed p-3">
            <div className="min-w-0 text-sm">
              <span className="font-medium">Your careers page: </span>
              <span className="break-all text-muted-foreground">{`${typeof window !== "undefined" ? window.location.origin : ""}/careers/${careersSlug}`}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={copyBoard}>
                {copiedBoard ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedBoard ? "Copied" : "Copy link"}
              </Button>
              <a href={`/careers/${careersSlug}`} target="_blank" rel="noreferrer" className="inline-flex">
                <Button size="sm" variant="ghost">
                  <ExternalLink className="h-4 w-4" /> View
                </Button>
              </a>
            </div>
          </Card>
        )}

        {pipeline ? (
          <PipelineBoard job={pipeline} onBack={() => setPipeline(null)} />
        ) : jobs === null ? (
          <div className="flex justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Briefcase className="h-10 w-10 opacity-40" />
            <p className="max-w-sm text-sm">
              No roles yet. Post your first job — the AI can draft the description from your business brief — then share
              the public link.
            </p>
            <Button size="sm" onClick={() => setDialog({ open: true, job: null })}>
              <Plus className="h-4 w-4" /> New role
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onEdit={() => setDialog({ open: true, job })}
                onOpenPipeline={() => setPipeline(job)}
                onRefresh={refresh}
              />
            ))}
          </div>
        )}
      </PageBody>

      <JobDialog
        open={dialog.open}
        job={dialog.job}
        complianceDefault={complianceDefault}
        onClose={() => setDialog({ open: false, job: null })}
        onSaved={refresh}
      />
    </>
  );
}
