"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  bulkSendOutboundDraftsAction,
  composeOutboundDraftsAction,
  discardOutboundDraftAction,
  listOutboundDraftsAction,
  sendOutboundDraftAction,
  updateOutboundDraftAction,
} from "@/app/actions";
import type { OutboundDraft, RecipientSource } from "@/lib/types";

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

const PLACEHOLDER = `Send Jane at Acme a follow-up about our meeting
Email the Gates Foundation to gauge interest in our grant
Email Marcus to ask for an intro to his design lead`;

export function OutboundComposer({ onClose }: { onClose: () => void }) {
  const [intents, setIntents] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<OutboundDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);

  useEffect(() => {
    void listOutboundDraftsAction().then((rows) => {
      setDrafts(rows);
      setLoading(false);
    });
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

  // Persist an edited field on blur (also marks the recipient "manual" when the address changes).
  async function persist(id: string, patch: { to_email?: string; subject?: string; body?: string }) {
    await updateOutboundDraftAction(id, patch);
    if (patch.to_email !== undefined) patchLocal(id, { recipient_source: "manual" });
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
                onLocal={(patch) => patchLocal(d.id, patch)}
                onPersist={(patch) => persist(d.id, patch)}
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
  onLocal,
  onPersist,
  onSend,
  onDiscard,
}: {
  draft: OutboundDraft;
  busy: boolean;
  onLocal: (patch: Partial<OutboundDraft>) => void;
  onPersist: (patch: { to_email?: string; subject?: string; body?: string }) => void;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const validTo = EMAIL_RE.test(draft.to_email);
  const failed = draft.status === "failed";

  return (
    <div className={cn("rounded-lg border bg-card p-3", failed ? "border-red-200" : "border-border")}>
      {draft.intent && (
        <p className="mb-2 text-[11px] italic text-muted-foreground">“{draft.intent}”</p>
      )}

      {/* To + source */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">To</span>
        <Input
          value={draft.to_email}
          onChange={(e) => onLocal({ to_email: e.target.value })}
          onBlur={(e) => onPersist({ to_email: e.target.value })}
          placeholder={draft.recipient_name ? `${draft.recipient_name}'s email…` : "recipient@email.com"}
          className={cn("h-8 max-w-[280px] flex-1 text-[12.5px]", !validTo && "border-amber-300")}
        />
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
            validTo ? SOURCE_STYLE[draft.recipient_source] : SOURCE_STYLE.none,
          )}
        >
          {validTo ? SOURCE_LABEL[draft.recipient_source] : SOURCE_LABEL.none}
        </span>
      </div>

      {/* Subject */}
      <Input
        value={draft.subject}
        onChange={(e) => onLocal({ subject: e.target.value })}
        onBlur={(e) => onPersist({ subject: e.target.value })}
        placeholder="Subject"
        className="mb-2 h-8 text-[13px] font-medium"
      />

      {/* Body */}
      <Textarea
        value={draft.body}
        onChange={(e) => onLocal({ body: e.target.value })}
        onBlur={(e) => onPersist({ body: e.target.value })}
        rows={6}
        className="text-[12.5px] leading-relaxed"
      />

      {failed && draft.error && <p className="mt-1.5 text-[11.5px] text-red-600">{draft.error}</p>}

      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" disabled={busy || !validTo} onClick={onSend}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {failed ? "Retry send" : "Send"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          <Trash2 className="h-4 w-4" />
          Discard
        </Button>
        {!validTo && <span className="text-[11.5px] text-amber-700">Add a recipient to send.</span>}
      </div>
    </div>
  );
}
