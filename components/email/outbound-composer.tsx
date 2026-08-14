"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Clock, Loader2, RotateCcw, Send, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  bulkSendOutboundDraftsAction,
  composeOutboundDraftsAction,
  discardOutboundDraftAction,
  flushDueOutboundDraftsAction,
  listOutboundDraftsAction,
  refineOutboundDraftAction,
  regenerateOutboundDraftAction,
  scheduleOutboundDraftAction,
  sendOutboundDraftAction,
  unscheduleOutboundDraftAction,
  updateOutboundDraftAction,
} from "@/app/actions";
import type { OutboundDraft, RecipientCandidate, RecipientSource } from "@/lib/types";

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const SOURCE_LABEL: Record<RecipientSource, string> = {
  explicit: "from your note",
  hubspot: "from HubSpot",
  gmail: "from your Gmail",
  manual: "you set this",
  none: "add a recipient",
};
const SOURCE_STYLE: Record<RecipientSource, string> = {
  explicit: "bg-slate-100 text-slate-600",
  hubspot: "bg-orange-100 text-orange-700",
  gmail: "bg-sky-100 text-sky-700",
  manual: "bg-slate-100 text-slate-600",
  none: "bg-amber-100 text-amber-800",
};

const REFINEMENTS: { label: string; instruction: string }[] = [
  { label: "Warmer", instruction: "Make it warmer and more personable." },
  { label: "Shorter", instruction: "Make it shorter and more concise." },
  { label: "More formal", instruction: "Make it more formal and professional." },
  { label: "More direct", instruction: "Make it more direct and to the point." },
];

const PLACEHOLDER = `Send Jane at Acme a follow-up about our meeting
Email the Gates Foundation to gauge interest in our grant
Email Marcus to ask for an intro to his design lead`;

function presetTimes(): { label: string; iso: string }[] {
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(now.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return [
    { label: "In 1 hour", iso: inHour.toISOString() },
    { label: "Tomorrow 9am", iso: tomorrow9.toISOString() },
    { label: "In 3 days", iso: in3days.toISOString() },
  ];
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function OutboundComposer({ onClose }: { onClose: () => void }) {
  const [intents, setIntents] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<OutboundDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Apply a flush result surgically so we never clobber a draft being edited:
    // drop the ones that sent, mark the ones that failed.
    function apply(r: { sent: string[]; failed: { id: string; error: string }[] }) {
      if (cancelled) return;
      if (r.sent.length) {
        setDrafts((prev) => prev.filter((d) => !r.sent.includes(d.id)));
        setNotice(`Sent ${r.sent.length} scheduled email${r.sent.length === 1 ? "" : "s"}. ✓`);
      }
      if (r.failed.length) {
        setDrafts((prev) =>
          prev.map((d) => {
            const f = r.failed.find((x) => x.id === d.id);
            return f ? { ...d, status: "failed" as const, error: f.error } : d;
          }),
        );
      }
    }

    // On open: send anything already past due, then load the queue.
    void (async () => {
      const r = await flushDueOutboundDraftsAction().catch(() => null);
      const rows = await listOutboundDraftsAction();
      if (cancelled) return;
      setDrafts(rows);
      setLoading(false);
      if (r) apply(r);
    })();

    // While open: flush due scheduled emails every 30s (no cron needed locally).
    const iv = setInterval(async () => {
      const r = await flushDueOutboundDraftsAction().catch(() => null);
      if (r) apply(r);
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  const lineCount = intents.split("\n").map((l) => l.trim()).filter(Boolean).length;

  async function draft() {
    const lines = intents.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length || drafting) return;
    setDrafting(true);
    setError("");
    setNotice("");
    const res = await composeOutboundDraftsAction(lines);
    setDrafting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDrafts((prev) => [...res.drafts, ...prev]);
    setIntents("");
    const missing = res.drafts.filter((d) => !EMAIL_RE.test(d.to_email)).length;
    setNotice(
      `Drafted ${res.drafts.length} email${res.drafts.length === 1 ? "" : "s"}.` +
        (missing ? ` ${missing} need${missing === 1 ? "s" : ""} a recipient before it can send.` : " Review and send below."),
    );
  }

  function patchLocal(id: string, patch: Partial<OutboundDraft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function persist(id: string, patch: { to_email?: string; cc?: string; bcc?: string; subject?: string; body?: string }) {
    await updateOutboundDraftAction(id, patch);
    if (patch.to_email !== undefined) patchLocal(id, { recipient_source: "manual" });
  }

  async function schedule(id: string, whenISO: string) {
    setError("");
    const r = await scheduleOutboundDraftAction(id, whenISO);
    if (r.ok) {
      patchLocal(id, { scheduled_at: whenISO });
      setNotice("Scheduled. ✓");
    } else setError(r.error ?? "Couldn't schedule.");
  }

  async function unschedule(id: string) {
    patchLocal(id, { scheduled_at: null });
    await unscheduleOutboundDraftAction(id);
  }

  // Pick one of the resolved candidates — keep its true source (from HubSpot / Gmail).
  function pickRecipient(id: string, cand: RecipientCandidate) {
    patchLocal(id, { to_email: cand.email, recipient_source: cand.source });
    void updateOutboundDraftAction(id, { to_email: cand.email });
  }

  async function refine(id: string, instruction: string) {
    if (refiningId) return;
    setRefiningId(id);
    setError("");
    const r = await refineOutboundDraftAction(id, instruction);
    setRefiningId(null);
    if (r.ok) patchLocal(id, { subject: r.draft.subject, body: r.draft.body, status: "draft", error: "" });
    else setError(r.error ?? "Couldn't refine.");
  }

  async function regenerate(id: string) {
    if (refiningId) return;
    setRefiningId(id);
    setError("");
    const r = await regenerateOutboundDraftAction(id);
    setRefiningId(null);
    if (r.ok) patchLocal(id, { subject: r.draft.subject, body: r.draft.body, status: "draft", error: "" });
    else setError(r.error ?? "Couldn't regenerate.");
  }

  async function send(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError("");
    const r = await sendOutboundDraftAction(id);
    setBusyId(null);
    if (r.ok) {
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      setNotice("Sent. ✓");
    } else {
      setError(r.error ?? "Couldn't send.");
      patchLocal(id, { status: "failed", error: r.error ?? "" });
    }
  }

  async function discard(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    await discardOutboundDraftAction(id);
  }

  const sendable = drafts.filter((d) => EMAIL_RE.test(d.to_email));

  async function sendAll() {
    if (bulkSending || !sendable.length) return;
    setBulkSending(true);
    setError("");
    const ids = sendable.map((d) => d.id);
    const r = await bulkSendOutboundDraftsAction(ids);
    setBulkSending(false);
    const rows = await listOutboundDraftsAction();
    setDrafts(rows);
    if (r.ok) setNotice(`Sent ${r.sent}${r.failed ? `, ${r.failed} failed` : ""}.`);
    else setError(r.error);
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.03] p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[14px] font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Compose with AI
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Write what you want to say — one instruction per line. The Admin agent drafts each in your voice, finds the
            recipient, and lines them up for you to approve.
          </p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Textarea
        value={intents}
        onChange={(e) => setIntents(e.target.value)}
        rows={4}
        placeholder={PLACEHOLDER}
        className="text-[13px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={drafting || lineCount === 0} onClick={draft}>
          {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {drafting ? "Drafting…" : lineCount > 1 ? `Send ${lineCount} to agent` : "Send to agent"}
        </Button>
        <span className="text-[11.5px] text-muted-foreground">
          {lineCount > 0 ? `${lineCount} instruction${lineCount === 1 ? "" : "s"}` : "One per line for a batch."}
        </span>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
      )}
      {notice && !error && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          {notice}
        </div>
      )}

      {/* Review queue */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Drafts to send{drafts.length ? ` (${drafts.length})` : ""}
          </p>
          {sendable.length > 1 && (
            <Button size="sm" variant="outline" disabled={bulkSending} onClick={sendAll}>
              {bulkSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send all ready ({sendable.length})
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : drafts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-[12.5px] text-muted-foreground">
            Your drafted emails will appear here to review and send.
          </p>
        ) : (
          <div className="space-y-2.5">
            {drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                busy={busyId === d.id}
                refining={refiningId === d.id}
                onLocal={(patch) => patchLocal(d.id, patch)}
                onPersist={(patch) => persist(d.id, patch)}
                onPick={(cand) => pickRecipient(d.id, cand)}
                onRefine={(instruction) => refine(d.id, instruction)}
                onRegenerate={() => regenerate(d.id)}
                onSchedule={(iso) => schedule(d.id, iso)}
                onUnschedule={() => unschedule(d.id)}
                onSend={() => send(d.id)}
                onDiscard={() => discard(d.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  busy,
  refining,
  onLocal,
  onPersist,
  onPick,
  onRefine,
  onRegenerate,
  onSchedule,
  onUnschedule,
  onSend,
  onDiscard,
}: {
  draft: OutboundDraft;
  busy: boolean;
  refining: boolean;
  onLocal: (patch: Partial<OutboundDraft>) => void;
  onPersist: (patch: { to_email?: string; cc?: string; bcc?: string; subject?: string; body?: string }) => void;
  onPick: (cand: RecipientCandidate) => void;
  onRefine: (instruction: string) => void;
  onRegenerate: () => void;
  onSchedule: (iso: string) => void;
  onUnschedule: () => void;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [ccOpen, setCcOpen] = useState(Boolean(draft.cc || draft.bcc));
  const [schedOpen, setSchedOpen] = useState(false);
  const [customWhen, setCustomWhen] = useState("");
  const validTo = EMAIL_RE.test(draft.to_email);
  const failed = draft.status === "failed";
  const otherCandidates = draft.candidates.filter((c) => c.email.toLowerCase() !== draft.to_email.toLowerCase());
  const hasChoices = draft.candidates.length > 1 || (draft.candidates.length >= 1 && otherCandidates.length >= 1);

  function submitCustom() {
    const c = custom.trim();
    if (!c) return;
    setCustom("");
    setCustomOpen(false);
    onRefine(c);
  }

  return (
    <div className={cn("rounded-lg border bg-card p-3", failed ? "border-red-200" : "border-border")}>
      {draft.intent && <p className="mb-2 text-[11px] italic text-muted-foreground">“{draft.intent}”</p>}

      {/* To + source + candidate picker */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">To</span>
        <Input
          value={draft.to_email}
          onChange={(e) => onLocal({ to_email: e.target.value })}
          onBlur={(e) => onPersist({ to_email: e.target.value })}
          placeholder={draft.recipient_name ? `${draft.recipient_name}'s email…` : "recipient@email.com"}
          className={cn("h-8 max-w-[260px] flex-1 text-[12.5px]", !validTo && "border-amber-300")}
        />
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
            validTo ? SOURCE_STYLE[draft.recipient_source] : SOURCE_STYLE.none,
          )}
        >
          {validTo ? SOURCE_LABEL[draft.recipient_source] : SOURCE_LABEL.none}
        </span>
        {hasChoices && (
          <div className="relative">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              {draft.candidates.length} match{draft.candidates.length === 1 ? "" : "es"}
              <ChevronDown className="h-3 w-3" />
            </button>
            {pickerOpen && (
              <div className="absolute z-20 mt-1 w-[260px] rounded-lg border border-border bg-popover p-1 shadow-elevated">
                {draft.candidates.map((c, i) => (
                  <button
                    key={`${c.email}-${i}`}
                    onClick={() => {
                      onPick(c);
                      setPickerOpen(false);
                    }}
                    className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="text-[12.5px] font-medium">{c.name || c.email}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {c.email}
                      {c.context ? ` · ${c.context}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cc / Bcc */}
      {!ccOpen ? (
        <button
          onClick={() => setCcOpen(true)}
          className="mb-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          + Cc / Bcc
        </button>
      ) : (
        <div className="mb-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-7 text-[11px] font-medium text-muted-foreground">Cc</span>
            <Input
              value={draft.cc}
              onChange={(e) => onLocal({ cc: e.target.value })}
              onBlur={(e) => onPersist({ cc: e.target.value })}
              placeholder="cc@… (comma-separated)"
              className="h-8 flex-1 text-[12.5px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-7 text-[11px] font-medium text-muted-foreground">Bcc</span>
            <Input
              value={draft.bcc}
              onChange={(e) => onLocal({ bcc: e.target.value })}
              onBlur={(e) => onPersist({ bcc: e.target.value })}
              placeholder="bcc@… (comma-separated)"
              className="h-8 flex-1 text-[12.5px]"
            />
          </div>
        </div>
      )}

      {/* Subject */}
      <Input
        value={draft.subject}
        onChange={(e) => onLocal({ subject: e.target.value })}
        onBlur={(e) => onPersist({ subject: e.target.value })}
        placeholder="Subject"
        className="mb-2 h-8 text-[13px] font-medium"
      />

      {/* Body */}
      <div className="relative">
        <Textarea
          value={draft.body}
          onChange={(e) => onLocal({ body: e.target.value })}
          onBlur={(e) => onPersist({ body: e.target.value })}
          rows={6}
          className="text-[12.5px] leading-relaxed"
        />
        {refining && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-card/70 text-[12px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Refining…
          </div>
        )}
      </div>

      {/* Refine toolbar */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Wand2 className="h-3.5 w-3.5" /> Refine:
        </span>
        {REFINEMENTS.map((r) => (
          <button
            key={r.label}
            disabled={refining}
            onClick={() => onRefine(r.instruction)}
            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {r.label}
          </button>
        ))}
        <button
          disabled={refining}
          onClick={onRegenerate}
          title="Redraft from your original instruction"
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" /> Regenerate
        </button>
        <button
          disabled={refining}
          onClick={() => setCustomOpen((v) => !v)}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          Refine…
        </button>
      </div>
      {customOpen && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCustom()}
            placeholder="e.g. mention we met at the conference, keep it under 4 sentences"
            className="h-8 flex-1 text-[12px]"
            autoFocus
          />
          <Button size="sm" variant="outline" disabled={refining || !custom.trim()} onClick={submitCustom}>
            Apply
          </Button>
        </div>
      )}

      {failed && draft.error && <p className="mt-1.5 text-[11.5px] text-red-600">{draft.error}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !validTo} onClick={onSend}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {draft.scheduled_at ? "Send now" : failed ? "Retry send" : "Send"}
        </Button>

        {draft.scheduled_at ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[11.5px] font-medium text-sky-800">
            <Clock className="h-3.5 w-3.5" /> Scheduled · {fmtWhen(draft.scheduled_at)}
            <button onClick={onUnschedule} className="ml-0.5 rounded px-1 text-sky-700 hover:bg-sky-200">
              Cancel
            </button>
          </span>
        ) : (
          <div className="relative">
            <Button size="sm" variant="outline" disabled={!validTo} onClick={() => setSchedOpen((v) => !v)}>
              <Clock className="h-4 w-4" /> Schedule
            </Button>
            {schedOpen && (
              <div className="absolute z-20 mt-1 w-[240px] rounded-lg border border-border bg-popover p-2 shadow-elevated">
                <p className="mb-1 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Send later
                </p>
                {presetTimes().map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setSchedOpen(false);
                      onSchedule(p.iso);
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted"
                  >
                    <span>{p.label}</span>
                    <span className="text-[11px] text-muted-foreground">{fmtWhen(p.iso)}</span>
                  </button>
                ))}
                <div className="mt-1.5 border-t border-border pt-1.5">
                  <input
                    type="datetime-local"
                    value={customWhen}
                    onChange={(e) => setCustomWhen(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1.5 w-full"
                    disabled={!customWhen}
                    onClick={() => {
                      const iso = new Date(customWhen).toISOString();
                      setSchedOpen(false);
                      onSchedule(iso);
                    }}
                  >
                    Schedule for this time
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <Button size="sm" variant="ghost" onClick={onDiscard}>
          <Trash2 className="h-4 w-4" />
          Discard
        </Button>
        {!validTo && <span className="text-[11.5px] text-amber-700">Add a recipient to send.</span>}
      </div>
    </div>
  );
}
