"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  Loader2,
  Mail,
  PenSquare,
  Plug,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  archiveEmailAction,
  bulkArchiveAction,
  bulkSendRepliesAction,
  checkInboxNowAction,
  getAttentionQueueAction,
  getDraftQueueAction,
  learnEmailStyleAction,
  getEmailBodyAction,
  getEmailManagerAction,
  saveEmailDraftAction,
  saveEmailSettingsAction,
  sendEmailReplyAction,
  sendInboxSummaryToExecutiveAction,
  trashEmailAction,
  triageEmailsAction,
} from "@/app/actions";
import dynamic from "next/dynamic";
import type { EmailBody, EmailCadence, EmailListItem, EmailManagerState, EmailSettings } from "@/lib/types";

// Loaded on demand — the composer (and its 30s poll) only matter once the user
// opens Compose, so keep it out of the initial /email bundle.
const OutboundComposer = dynamic(
  () => import("@/components/email/outbound-composer").then((m) => m.OutboundComposer),
  { ssr: false },
);

const CAT_BADGE: Record<string, string> = {
  Investor: "bg-violet-100 text-violet-700",
  Customer: "bg-emerald-100 text-emerald-700",
  Internal: "bg-sky-100 text-sky-700",
  Admin: "bg-slate-100 text-slate-600",
  Noise: "bg-zinc-100 text-zinc-500",
};
const URG_BADGE: Record<string, string> = {
  Critical: "bg-red-100 text-red-700",
  High: "bg-orange-100 text-orange-700",
  Normal: "bg-slate-100 text-slate-600",
  Low: "bg-zinc-100 text-zinc-500",
};

// Gmail category tabs — default to Primary + Updates so promo/social clutter never
// hits the screen or the triage AI, and we only fetch metadata for mail that matters.
const CATEGORY_CHIPS: { key: string; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "updates", label: "Updates" },
  { key: "promotions", label: "Promotions" },
  { key: "social", label: "Social" },
];
const DEFAULT_CATS = ["primary", "updates"];

function fmtDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function EmailManagerPage() {
  const { reloadWorkspace, state: appState } = useStore();
  // Operator Lite: members run their OWN inbox, but the AI Outbound Composer +
  // "Send to Executive" are owner-only for now — hide those controls for members.
  const isMember = !!appState?.viewer?.isMember;
  const [state, setState] = useState<EmailManagerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageStack, setPageStack] = useState<string[]>([]); // tokens for pages after the first

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [triaging, setTriaging] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toExecState, setToExecState] = useState<"idle" | "busy" | "done">("idle");
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATS);
  const [checkingNow, setCheckingNow] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [view, setView] = useState<"inbox" | "attention" | "drafts">("inbox");
  const [draftQueue, setDraftQueue] = useState<EmailListItem[]>([]);
  const [attentionQueue, setAttentionQueue] = useState<EmailListItem[]>([]);
  const [notice, setNotice] = useState("");
  const [archivingSuggested, setArchivingSuggested] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const curToken = pageStack[pageStack.length - 1];

  const load = useCallback(async (token?: string, cats?: string[]) => {
    setError("");
    const res = await getEmailManagerAction(token, cats ?? DEFAULT_CATS);
    if ("error" in res) {
      setError(res.error);
      setState(null);
    } else {
      setState(res);
    }
    setLoading(false);
  }, []);

  const loadDrafts = useCallback(async () => {
    const r = await getDraftQueueAction();
    if (!("error" in r)) setDraftQueue(r.items);
  }, []);

  const loadAttention = useCallback(async () => {
    const r = await getAttentionQueueAction();
    if (!("error" in r)) setAttentionQueue(r.items);
  }, []);

  useEffect(() => {
    void load(undefined, DEFAULT_CATS);
    void loadDrafts();
    void loadAttention();
  }, [load, loadDrafts, loadAttention]);

  const inboxItems = state?.items ?? [];
  const items = view === "drafts" ? draftQueue : view === "attention" ? attentionQueue : inboxItems;
  const selected = items.find((i) => i.id === selectedId) ?? null;

  // Refresh the current list, and keep the tab counts fresh.
  async function reload() {
    if (view === "drafts") {
      await loadDrafts();
      return;
    }
    if (view === "attention") {
      await loadAttention();
      return;
    }
    await load(curToken, categories);
    await loadDrafts();
    await loadAttention();
  }

  function switchView(v: "inbox" | "attention" | "drafts", selectId?: string) {
    setView(v);
    setSelectedId(selectId ?? null);
    setChecked(new Set());
    setNotice("");
    if (v === "drafts") void loadDrafts();
    else if (v === "attention") void loadAttention();
    else void load(curToken, categories);
  }

  function goNext() {
    const nt = state?.nextPageToken;
    if (!nt) return;
    setSelectedId(null);
    setChecked(new Set());
    setPageStack((s) => [...s, nt]);
    void load(nt, categories);
  }
  function goBack() {
    if (!pageStack.length) return;
    setSelectedId(null);
    setChecked(new Set());
    const next = pageStack.slice(0, -1);
    setPageStack(next);
    void load(next[next.length - 1], categories);
  }

  // Toggle a Gmail category tab; changing the filter resets to the first page.
  function toggleCategory(key: string) {
    const next = categories.includes(key) ? categories.filter((c) => c !== key) : [...categories, key];
    if (!next.length) return; // keep at least one tab selected
    setCategories(next);
    setSelectedId(null);
    setChecked(new Set());
    setPageStack([]);
    setLoading(true);
    void load(undefined, next);
  }

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleCheckAll() {
    setChecked((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  async function runTriage(ids: string[]) {
    if (!ids.length || triaging) return;
    setTriaging(true);
    setError("");
    setNotice("");
    try {
      const r = await triageEmailsAction(ids);
      if (!r.ok) {
        setError(r.error ?? "Triage failed.");
      } else {
        const d = r.replyDrafts ?? 0;
        setNotice(`Triaged ${r.triaged ?? 0} — ${d} draft${d === 1 ? "" : "s"} ready to review.`);
      }
      await reload();
      reloadWorkspace(); // any implied action tasks land on the board
    } finally {
      setTriaging(false);
      setChecked(new Set());
    }
  }
  function triagePrimary() {
    if (checked.size > 0) return runTriage([...checked]);
    const fresh = items.filter((i) => i.status === "new").map((i) => i.id);
    return runTriage(fresh);
  }

  async function onArchive(id: string) {
    setActingId(id);
    const r = await archiveEmailAction(id);
    setActingId(null);
    if (!r.ok) return setError(r.error);
    if (selectedId === id) setSelectedId(null);
    await reload();
  }
  async function onTrash(id: string) {
    setActingId(id);
    const r = await trashEmailAction(id);
    setActingId(null);
    if (!r.ok) return setError(r.error);
    if (selectedId === id) setSelectedId(null);
    await reload();
  }

  async function sendToExecutive() {
    setToExecState("busy");
    const r = await sendInboxSummaryToExecutiveAction();
    setToExecState(r.ok ? "done" : "idle");
    if (!r.ok) setError(r.error ?? "Nothing to summarize yet.");
    else reloadWorkspace();
  }

  // Check now — sweep new unread mail, triage + draft it, then drop into the review queue.
  async function checkNow() {
    if (checkingNow) return;
    setCheckingNow(true);
    setError("");
    setNotice("");
    setSelectedId(null);
    setChecked(new Set());
    try {
      const r = await checkInboxNowAction();
      if (!r.ok) {
        setError(r.error ?? "Couldn't check for new mail.");
        return;
      }
      const triaged = r.triaged ?? 0;
      const drafts = r.replyDrafts ?? 0;
      setNotice(
        triaged
          ? `Triaged ${triaged} new email${triaged === 1 ? "" : "s"} — ${drafts} draft${drafts === 1 ? "" : "s"} ready to review${r.remaining ? `, ${r.remaining} more to check` : ""}.`
          : "No new mail to triage right now.",
      );
      await loadDrafts();
      if (drafts > 0) {
        setView("drafts"); // land in the review queue where the drafts are
      } else {
        setView("inbox");
        setPageStack([]);
        await load(undefined, categories);
      }
      reloadWorkspace();
    } finally {
      setCheckingNow(false);
    }
  }

  // Bulk send: the checked drafts if any are selected, else every ready draft on the page.
  const draftItems = items.filter((i) => i.draft_reply.trim() && i.status !== "sent");
  const checkedDraftIds = draftItems.filter((i) => checked.has(i.id)).map((i) => i.id);
  const bulkIds = checkedDraftIds.length ? checkedDraftIds : draftItems.map((i) => i.id);

  async function bulkSend() {
    if (!bulkIds.length || bulkSending) return;
    setBulkSending(true);
    setError("");
    try {
      const r = await bulkSendRepliesAction(bulkIds);
      if (!r.ok) setError(r.error);
      else if (r.failed) setError(`Sent ${r.sent}, ${r.failed} couldn't send.`);
      setChecked(new Set());
      await reload();
    } finally {
      setBulkSending(false);
    }
  }

  // Batch archive — the agent flags low-value mail (Noise / Archive, no reply) to clear in one click.
  const suggestedArchive = items.filter(
    (i) => i.status !== "new" && !i.draft_reply.trim() && (i.category === "Noise" || i.action_type === "Archive"),
  );
  async function archiveSuggested() {
    if (!suggestedArchive.length || archivingSuggested) return;
    setArchivingSuggested(true);
    setError("");
    setNotice("");
    try {
      const r = await bulkArchiveAction(suggestedArchive.map((i) => i.id));
      if (!r.ok) setError(r.error);
      else setNotice(`Archived ${r.archived} low-value email${r.archived === 1 ? "" : "s"}.`);
      setSelectedId(null);
      await reload();
    } finally {
      setArchivingSuggested(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Email Manager"
        description="See your inbox, let the Admin agent triage and draft replies, then edit, approve, and send — you stay in control of every email that goes out."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={composeOpen ? "outline" : undefined}
              disabled={!state?.connected}
              onClick={() => setComposeOpen((v) => !v)}
            >
              <PenSquare className="h-4 w-4" />
              Compose
            </Button>
            <Button size="sm" variant="outline" disabled={checkingNow || !state?.connected} onClick={checkNow}>
              {checkingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Check now
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 className="h-4 w-4" />
              Email settings
            </Button>
            <Button size="sm" disabled={triaging || !state?.connected || !items.length} onClick={triagePrimary}>
              {triaging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {checked.size > 0 ? `Triage selected (${checked.size})` : "Triage all"}
            </Button>
          </div>
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !state?.connected ? (
          <NotConnected error={error} />
        ) : (
          <div className="space-y-3">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                {error}
              </div>
            )}
            {notice && !error && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
                {notice}
              </div>
            )}
            {showSettings && (
              <SettingsPanel
                initial={state.settings}
                onClose={() => setShowSettings(false)}
              />
            )}
            {composeOpen && <OutboundComposer onClose={() => setComposeOpen(false)} />}
            <div className="grid gap-4 lg:grid-cols-[340px_1fr_300px]">
              {/* LEFT — Inbox */}
              <Card className="flex max-h-[calc(100vh-190px)] flex-col overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div className="inline-flex rounded-lg border border-border p-0.5">
                    <button
                      onClick={() => switchView("inbox")}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        view === "inbox" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <Inbox className="h-3.5 w-3.5" />
                      Inbox
                    </button>
                    <button
                      onClick={() => switchView("attention")}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        view === "attention" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Attention
                      {attentionQueue.length > 0 && (
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                          {attentionQueue.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => switchView("drafts")}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        view === "drafts" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Drafts
                      {draftQueue.length > 0 && (
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
                          {draftQueue.length}
                        </span>
                      )}
                    </button>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && checked.size === items.length}
                      onChange={toggleCheckAll}
                      className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    />
                    Select all
                  </label>
                </div>
                {/* Gmail category tabs — declutter to what matters (inbox view only) */}
                {view === "inbox" && (
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
                    {CATEGORY_CHIPS.map((c) => {
                      const on = categories.includes(c.key);
                      return (
                        <button
                          key={c.key}
                          onClick={() => toggleCategory(c.key)}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                            on
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Bulk send bar — appears when drafts are ready on this page */}
                {draftItems.length > 0 && (
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-primary/5 px-3 py-1.5">
                    <span className="text-[11.5px] text-muted-foreground">
                      {checkedDraftIds.length
                        ? `${checkedDraftIds.length} selected with a draft`
                        : `${draftItems.length} draft${draftItems.length === 1 ? "" : "s"} ready`}
                    </span>
                    <Button
                      size="sm"
                      variant="success"
                      disabled={bulkSending || !bulkIds.length}
                      onClick={bulkSend}
                    >
                      {bulkSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Send {bulkIds.length}
                    </Button>
                  </div>
                )}
                {/* Batch archive — the agent's low-value suggestions, cleared on one click */}
                {view === "inbox" && suggestedArchive.length > 0 && (
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-amber-50 px-3 py-1.5">
                    <span className="text-[11.5px] text-amber-800">
                      {suggestedArchive.length} low-value email{suggestedArchive.length === 1 ? "" : "s"} flagged to
                      clear
                    </span>
                    <Button size="sm" variant="outline" disabled={archivingSuggested} onClick={archiveSuggested}>
                      {archivingSuggested ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                      Archive {suggestedArchive.length}
                    </Button>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto">
                  {items.length === 0 ? (
                    <div className="p-8 text-center text-[12.5px] text-muted-foreground">
                      {view === "drafts"
                        ? "No drafts to review yet. Triage some mail to generate replies."
                        : "Your inbox is clear. 🎉"}
                    </div>
                  ) : (
                    items.map((it) => (
                      <InboxRow
                        key={it.id}
                        item={it}
                        active={it.id === selectedId}
                        checked={checked.has(it.id)}
                        acting={actingId === it.id}
                        onToggle={() => toggleCheck(it.id)}
                        onOpen={() => setSelectedId(it.id)}
                        onArchive={() => onArchive(it.id)}
                        onTrash={() => onTrash(it.id)}
                      />
                    ))
                  )}
                </div>
                {view === "inbox" && (
                  <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11.5px] text-muted-foreground">
                    <button
                      onClick={goBack}
                      disabled={!pageStack.length}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Newer
                    </button>
                    <span>Page {pageStack.length + 1}</span>
                    <button
                      onClick={goNext}
                      disabled={!state.nextPageToken}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted disabled:opacity-40"
                    >
                      Older <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </Card>

              {/* MIDDLE — Reader + Draft */}
              <div className="flex min-w-0 flex-col gap-4">
                <ReaderPane id={selected?.id ?? null} fallbackSubject={selected?.subject} />
                <DraftPane
                  item={selected}
                  onTriage={() => selected && runTriage([selected.id])}
                  triaging={triaging}
                  onSent={reload}
                  onArchive={() => selected && onArchive(selected.id)}
                />
              </div>

              {/* RIGHT — Daily Triage Info + Send to Executive */}
              <div className="flex flex-col gap-4">
                <TriageInfo
                  info={state.triageInfo}
                  onOpen={(v) => switchView(v)}
                  onSelect={(id) => switchView("attention", id)}
                />
                {!isMember && (
                  <Card className="p-4">
                    <p className="text-[13px] font-semibold">Keep the Executive in the loop</p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      Send a summary of what moved in your inbox so your chief-of-staff stays current on the
                      business.
                    </p>
                    <Button
                      size="sm"
                      variant={toExecState === "done" ? "outline" : undefined}
                      className="mt-3 w-full"
                      disabled={toExecState === "busy"}
                      onClick={sendToExecutive}
                    >
                      {toExecState === "busy" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : toExecState === "done" ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {toExecState === "done" ? "Sent to Executive" : "Send to Executive"}
                    </Button>
                  </Card>
                )}
                <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                  Archive &amp; Delete need Google reconnected with the new permission —{" "}
                  <Link href="/integrations" className="font-medium underline">
                    reconnect in Integrations
                  </Link>
                  . Delete moves mail to Trash (recoverable), never a permanent erase.
                </p>
              </div>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

function InboxRow({
  item,
  active,
  checked,
  acting,
  onToggle,
  onOpen,
  onArchive,
  onTrash,
}: {
  item: EmailListItem;
  active: boolean;
  checked: boolean;
  acting: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  const triaged = item.status !== "new";
  return (
    <div
      className={cn(
        "group flex items-start gap-2 border-b border-border px-2.5 py-2.5 transition-colors",
        active ? "bg-primary/5" : "hover:bg-muted/40",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
      />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          <p className={cn("min-w-0 flex-1 truncate text-[12.5px]", item.unread ? "font-semibold" : "font-medium")}>
            {item.from_name || item.from_email}
          </p>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">{fmtDate(item.date)}</span>
        </div>
        <p className={cn("truncate text-[12px]", item.unread ? "font-medium" : "text-foreground/80")}>
          {item.subject}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{item.snippet}</p>
        {triaged && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.category && (
              <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-semibold", CAT_BADGE[item.category] ?? "bg-slate-100 text-slate-600")}>
                {item.category}
              </span>
            )}
            {item.urgency && (
              <span className={cn("rounded px-1.5 py-0.5 text-[9.5px] font-semibold", URG_BADGE[item.urgency] ?? "bg-slate-100 text-slate-600")}>
                {item.urgency}
              </span>
            )}
            {item.status === "sent" ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700">
                Replied
              </span>
            ) : item.draft_reply ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-primary">
                Draft ready
              </span>
            ) : item.category === "Noise" || item.action_type === "Archive" ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700">
                Archive?
              </span>
            ) : null}
          </div>
        )}
      </button>
      <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {acting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <button onClick={onArchive} title="Archive" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Archive className="h-3.5 w-3.5" />
            </button>
            <button onClick={onTrash} title="Delete (move to Trash)" className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReaderPane({ id, fallbackSubject }: { id: string | null; fallbackSubject?: string }) {
  const [body, setBody] = useState<EmailBody | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setBody(null);
    void getEmailBodyAction(id).then((r) => {
      if (cancelled) return;
      if (r.ok) setBody(r.email);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Card className="flex max-h-[46vh] min-h-[220px] flex-col overflow-hidden p-0">
      <div className="border-b border-border px-4 py-2.5 text-[12px] font-semibold text-muted-foreground">
        {id ? "Email" : "Select an email"}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!id ? (
          <div className="flex h-full items-center justify-center text-center text-[13px] text-muted-foreground">
            Pick a message from your inbox to read it here.
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : body ? (
          <div>
            <h3 className="text-[15px] font-semibold leading-snug">{body.subject}</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {body.from_name} &lt;{body.from_email}&gt; · {fmtDate(body.date)}
            </p>
            <div className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
              {body.body || "(no text content)"}
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-muted-foreground">{fallbackSubject ?? "Couldn't load this email."}</div>
        )}
      </div>
    </Card>
  );
}

function DraftPane({
  item,
  onTriage,
  triaging,
  onSent,
  onArchive,
}: {
  item: EmailListItem | null;
  onTriage: () => void;
  triaging: boolean;
  onSent: () => void;
  onArchive: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the editable draft whenever the selected email (or its generated draft) changes.
  useEffect(() => {
    setDraft(item?.draft_reply ?? "");
    setSent(item?.status === "sent");
    setErr("");
    setSaveState("idle");
  }, [item?.id, item?.draft_reply, item?.status]);

  if (!item) {
    return (
      <Card className="flex min-h-[180px] items-center justify-center p-6 text-center text-[13px] text-muted-foreground">
        The agent&apos;s read and a draft reply will appear here once you open and triage an email.
      </Card>
    );
  }

  const triaged = item.status !== "new";

  function persist(next: string) {
    setSaveState("saving");
    void saveEmailDraftAction(item!.id, next).then((r) => setSaveState(r.ok ? "saved" : "idle"));
  }
  function onEdit(v: string) {
    setDraft(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(v), 700);
  }
  function flush() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    persist(draft);
  }

  async function send() {
    if (sending || !draft.trim()) return;
    flush();
    setSending(true);
    setErr("");
    const r = await sendEmailReplyAction(item!.id);
    setSending(false);
    if (r.ok) {
      setSent(true);
      onSent();
    } else {
      setErr(r.error);
    }
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-[13px] font-semibold">Agent response &amp; draft</p>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
      </div>

      {!triaged ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-8 text-center">
          <p className="max-w-xs text-[12.5px] text-muted-foreground">
            Not triaged yet. Have the Admin agent read this email and draft a reply for you.
          </p>
          <Button size="sm" disabled={triaging} onClick={onTriage}>
            {triaging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Triage this email
          </Button>
        </div>
      ) : (
        <>
          {item.summary && (
            <div className="mb-3 rounded-lg border border-border bg-muted/40 p-2.5">
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", CAT_BADGE[item.category] ?? "bg-slate-100 text-slate-600")}>
                  {item.category || "—"}
                </span>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", URG_BADGE[item.urgency] ?? "bg-slate-100 text-slate-600")}>
                  {item.urgency || "—"}
                </span>
                {item.action_type && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {item.action_type}
                  </span>
                )}
              </div>
              <p className="text-[12.5px] text-foreground/85">{item.summary}</p>
            </div>
          )}

          {sent ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-800">
              <Check className="h-4 w-4 shrink-0" /> Reply sent to {item.from_name || item.from_email}.
            </div>
          ) : item.draft_reply || draft ? (
            <>
              <Textarea
                value={draft}
                onChange={(e) => onEdit(e.target.value)}
                onBlur={flush}
                placeholder="Your reply…"
                className="min-h-[160px] resize-y text-[13px] leading-relaxed"
              />
              {err && <p className="mt-1.5 text-[12px] text-red-600">{err}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" variant="success" disabled={sending || !draft.trim()} onClick={send}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Approve &amp; send
                </Button>
                <Button size="sm" variant="outline" onClick={onArchive}>
                  <Archive className="h-4 w-4" />
                  Archive
                </Button>
                <span className="ml-auto text-[11px] text-muted-foreground">Sends in-thread from your Gmail</span>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              No reply needed here — the agent flagged this as{" "}
              <span className="font-medium">{item.action_type || "no action"}</span>. You can archive or delete it.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function TriageInfo({
  info,
  onOpen,
  onSelect,
}: {
  info: EmailManagerState["triageInfo"];
  onOpen: (view: "inbox" | "attention" | "drafts") => void;
  onSelect: (id: string) => void;
}) {
  const stats: { label: string; value: number; view?: "inbox" | "attention" | "drafts" }[] = [
    { label: "Triaged", value: info.total, view: "inbox" },
    { label: "Need attention", value: info.attention, view: "attention" },
    { label: "Drafts ready", value: info.drafts, view: "drafts" },
    { label: "Sent", value: info.sent },
  ];
  return (
    <Card className="p-4">
      <p className="text-[13px] font-semibold">Daily Triage Info</p>
      <p className="text-[11.5px] text-muted-foreground">Last 24 hours</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {stats.map((s) => {
          const clickable = Boolean(s.view) && s.value > 0;
          return (
            <button
              key={s.label}
              type="button"
              disabled={!clickable}
              onClick={() => s.view && onOpen(s.view)}
              className={cn(
                "rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-left transition-colors",
                clickable ? "cursor-pointer hover:border-primary/40 hover:bg-primary/5" : "cursor-default",
              )}
            >
              <p className="text-[18px] font-semibold tabular-nums leading-none">{s.value}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                {s.label}
                {clickable && <ChevronRight className="h-3 w-3 opacity-60" />}
              </p>
            </button>
          );
        })}
      </div>
      {info.attentionItems.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Needs attention
          </p>
          <ul className="space-y-0.5">
            {info.attentionItems.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onSelect(it.id)}
                  title={`${it.from_name} — ${it.subject}`}
                  className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted"
                >
                  <span
                    className={cn(
                      "mt-[3px] shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none",
                      URG_BADGE[it.urgency] ?? "bg-slate-100 text-slate-600",
                    )}
                  >
                    {it.urgency || "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-foreground/90">{it.from_name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{it.subject}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {info.total === 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Nothing triaged yet today. Hit <span className="font-medium">Triage all</span> to get started.
        </p>
      )}
    </Card>
  );
}

function SettingsPanel({
  initial,
  onClose,
}: {
  initial: EmailSettings;
  onClose: () => void;
}) {
  const [signature, setSignature] = useState(initial.signature);
  const [replyStyle, setReplyStyle] = useState(initial.reply_style);
  const [cadence, setCadence] = useState<EmailCadence>(initial.cadence);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [learning, setLearning] = useState(false);
  const [learnMsg, setLearnMsg] = useState("");

  async function save() {
    setSaveState("saving");
    const r = await saveEmailSettingsAction({ signature, reply_style: replyStyle, cadence });
    setSaveState(r.ok ? "saved" : "idle");
  }

  // Learn the founder's signature + style from their Sent mail — fills the fields to review.
  async function learnStyle() {
    if (learning) return;
    setLearning(true);
    setLearnMsg("");
    try {
      const r = await learnEmailStyleAction();
      if (r.ok) {
        setSignature(r.style.signature);
        setReplyStyle(r.style.reply_style);
        setSaveState("idle");
        setLearnMsg("Learned from your sent mail — review and Save.");
      } else {
        setLearnMsg(r.error);
      }
    } finally {
      setLearning(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" />
        <p className="text-[13px] font-semibold">Email settings</p>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
      </div>

      {/* Auto-triage cadence */}
      <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <p className="text-[12.5px] font-medium">Auto-triage my inbox</p>
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          The Admin agent triages new Primary + Updates mail and drafts replies on this cadence. It never sends —
          you always approve every email that goes out.
        </p>
        <div className="mt-2 inline-flex rounded-lg border border-border p-0.5">
          {(["off", "hourly", "daily"] as EmailCadence[]).map((c) => (
            <button
              key={c}
              onClick={() => setCadence(c)}
              className={cn(
                "rounded-md px-3 py-1 text-[12px] font-medium capitalize transition-colors",
                cadence === c ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Learn from sent mail */}
      <div className="mb-3 flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11.5px] text-muted-foreground">
          Not sure what to write? Let the agent study your Sent mail and propose a signature + style.
        </p>
        <Button size="sm" variant="outline" disabled={learning} onClick={learnStyle}>
          {learning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Learn from sent mail
        </Button>
      </div>
      {learnMsg && <p className="mb-2 text-[11.5px] text-emerald-700">{learnMsg}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium">Signature</label>
          <Textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder={"Best,\nAlex Rivera\nFounder, Northwind Studio\nnorthwindstudio.com"}
            className="min-h-[120px] resize-y text-[12.5px]"
          />
          <p className="text-[11px] text-muted-foreground">Appended to the end of every drafted reply.</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium">Reply style</label>
          <Textarea
            value={replyStyle}
            onChange={(e) => setReplyStyle(e.target.value)}
            placeholder="e.g. Warm but concise. Open with a quick thanks, keep it to 3–4 sentences, no jargon, always end with a clear next step."
            className="min-h-[120px] resize-y text-[12.5px]"
          />
          <p className="text-[11px] text-muted-foreground">Guides how the agent writes each draft.</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saveState === "saving"}>
          <Check className="h-4 w-4" />
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </Card>
  );
}

function NotConnected({ error }: { error: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Plug className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-[15px] font-semibold">Connect Gmail to manage email</h3>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
          {error ||
            "The Email Manager reads your inbox and drafts replies for your approval. Connect Google to get started."}
        </p>
      </div>
      <Link href="/integrations">
        <Button size="sm">
          <Plug className="h-4 w-4" />
          Go to Integrations
        </Button>
      </Link>
    </Card>
  );
}
