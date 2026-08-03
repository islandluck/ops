"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Download,
  FileText,
  FolderKanban,
  Handshake,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  Mail,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { ImageSlot } from "@/components/media/image-slot";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { markdownToHtml, markdownToPlainText } from "@/lib/content/format";
import {
  addGoalAction,
  addMemoryAction,
  approveBriefSuggestionAction,
  archiveInvestorUpdateAction,
  deleteGoalAction,
  deleteInvestorUpdateAction,
  deleteMemoryAction,
  dismissBriefSuggestionAction,
  generateBriefAction,
  generateInvestorUpdateAction,
  getExecutiveBundleAction,
  sendExecutiveMessageAction,
  setGoalStatusAction,
  startNewExecutiveChatAction,
  togglePinMemoryAction,
  updateInvestorUpdateAction,
} from "@/app/actions";
import type {
  BriefKind,
  BriefSuggestion,
  CompanyGoal,
  ExecBrief,
  ExecKpi,
  ExecMemory,
  ExecMessage,
  ExecNudge,
  ExecutiveBundle,
  GoalHorizon,
  GoalMetric,
  InvestorMetric,
  InvestorUpdate,
  InvestorUpdateContent,
} from "@/lib/types";

const STARTERS = [
  "How are we doing this week?",
  "What should I focus on next?",
  "Help me set a company goal",
  "Where are we leaving money on the table?",
];

/** Attachments are read as text and appended to the message so the agent sees them. */
const MAX_ATTACH_CHARS = 30_000;
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|hpp|sh|sql|env|toml|ini)$/i;
function isTextFile(f: File): boolean {
  return f.type.startsWith("text/") || /json|xml|csv|yaml|javascript|typescript/.test(f.type) || TEXT_EXT.test(f.name);
}
function composeMessage(typed: string, att: { name: string; text: string } | null): string {
  if (!att) return typed;
  return `${typed}\n\n[Attached file: ${att.name}]\n\n${att.text}`;
}
/** Split a stored user message back into the typed part + any attached file. */
function splitAttachment(content: string): { typed: string; file?: { name: string; text: string } } {
  const m = content.match(/\n\n\[Attached file: ([^\]]+)\]\n\n([\s\S]*)$/);
  if (!m || m.index === undefined) return { typed: content };
  return { typed: content.slice(0, m.index), file: { name: m[1], text: m[2] } };
}

export default function ExecutivePage() {
  const [bundle, setBundle] = useState<ExecutiveBundle | null>(null);
  const [messages, setMessages] = useState<ExecMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"chat" | "brief" | "investor">("chat");
  const [briefs, setBriefs] = useState<ExecBrief[]>([]);
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  const [cadence, setCadence] = useState<BriefKind>("daily");
  const [generating, setGenerating] = useState(false);
  const [busySug, setBusySug] = useState<string | null>(null);
  const [updates, setUpdates] = useState<InvestorUpdate[]>([]);
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);
  const [genUpdate, setGenUpdate] = useState(false);
  const { reloadWorkspace } = useStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);
  const [attachErr, setAttachErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const attachFile = useCallback(async (file: File | undefined | null) => {
    setAttachErr("");
    if (!file) return;
    if (!isTextFile(file)) {
      setAttachErr("Only text files for now — .md, .txt, .csv, .json, code, etc.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAttachErr("That file is too large (max 2 MB).");
      return;
    }
    try {
      const raw = await file.text();
      const text = raw.length > MAX_ATTACH_CHARS ? raw.slice(0, MAX_ATTACH_CHARS) + "\n…[truncated]" : raw;
      setAttachment({ name: file.name, text });
    } catch {
      setAttachErr("Couldn't read that file.");
    }
  }, []);

  const loadBundle = useCallback(async () => {
    const b = await getExecutiveBundleAction();
    if (b) {
      setBundle(b);
      setMessages(b.messages);
      setBriefs(b.briefs);
      setUpdates(b.investorUpdates);
    }
    setLoading(false);
  }, []);

  const generateUpdate = useCallback(async () => {
    setGenUpdate(true);
    const res = await generateInvestorUpdateAction();
    setGenUpdate(false);
    if (res.ok && res.update) {
      await loadBundle();
      setSelectedUpdateId(res.update.id);
    }
  }, [loadBundle]);

  const saveUpdate = useCallback(async (id: string, content: InvestorUpdateContent) => {
    const res = await updateInvestorUpdateAction(id, content);
    if (res.ok && res.update) {
      const updated = res.update;
      setUpdates((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    }
    return res;
  }, []);

  const archiveUpdate = useCallback(async (id: string, archived: boolean) => {
    const res = await archiveInvestorUpdateAction(id, archived);
    if (res.ok) {
      setUpdates((prev) => prev.map((u) => (u.id === id ? { ...u, archived } : u)));
      setSelectedUpdateId(null);
    }
    return res;
  }, []);

  const deleteUpdate = useCallback(async (id: string) => {
    const res = await deleteInvestorUpdateAction(id);
    if (res.ok) {
      setUpdates((prev) => prev.filter((u) => u.id !== id));
      setSelectedUpdateId(null);
    }
    return res;
  }, []);

  const generateBrief = useCallback(async () => {
    setGenerating(true);
    const res = await generateBriefAction(cadence);
    setGenerating(false);
    if (res.ok && res.brief) {
      await loadBundle();
      setSelectedBriefId(res.brief.id);
      setView("brief");
    }
  }, [loadBundle, cadence]);

  const approveSug = useCallback(
    async (briefId: string, sug: BriefSuggestion) => {
      setBusySug(sug.id);
      const res = await approveBriefSuggestionAction(briefId, sug.id);
      setBusySug(null);
      if (res.ok) {
        if (sug.kind === "task") reloadWorkspace(); // surface the new board task
        await loadBundle();
      }
    },
    [loadBundle, reloadWorkspace],
  );

  const dismissSug = useCallback(
    async (briefId: string, sugId: string) => {
      setBusySug(sugId);
      await dismissBriefSuggestionAction(briefId, sugId);
      setBusySug(null);
      await loadBundle();
    },
    [loadBundle],
  );

  const newChat = useCallback(async () => {
    setMessages([]);
    await startNewExecutiveChatAction();
    await loadBundle();
  }, [loadBundle]);
  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || sending) return;
      setInput("");
      setMessages((m) => [
        ...m,
        { id: `tmp-${m.length}`, role: "user", content: clean, actions: [], created_at: "" },
      ]);
      setSending(true);
      const res = await sendExecutiveMessageAction(clean);
      setSending(false);
      if (res.ok) {
        await loadBundle(); // authoritative messages + refreshed KPIs/goals/memory
      } else {
        setMessages((m) => [
          ...m,
          { id: `err-${m.length}`, role: "assistant", content: res.error ?? "I couldn't respond — try again.", actions: [], created_at: "" },
        ]);
      }
    },
    [sending, loadBundle],
  );

  const submit = useCallback(() => {
    const composed = composeMessage(input.trim(), attachment);
    if (!composed.trim() || sending) return;
    setAttachment(null);
    setAttachErr("");
    void send(composed);
  }, [input, attachment, sending, send]);

  const agentName = bundle?.agentName ?? "Executive Agent";
  const cadenceBriefs = briefs.filter((b) => b.kind === cadence);
  const shownBrief = cadenceBriefs.find((b) => b.id === selectedBriefId) ?? cadenceBriefs[0] ?? null;
  const shownUpdate =
    updates.find((u) => u.id === selectedUpdateId) ?? updates.find((u) => !u.archived) ?? updates[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Conversation */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <Compass className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight">{agentName}</h1>
            <p className="hidden truncate text-[12px] text-muted-foreground sm:block">
              Your Chief of Staff — grounded in your live business data
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {view === "chat" && messages.length > 0 && (
              <button
                onClick={newChat}
                title="Start a new chat"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <MessageSquarePlus className="h-4 w-4" />
                <span className="hidden sm:inline">New chat</span>
              </button>
            )}
            <div className="flex rounded-lg border border-border bg-muted/50 p-0.5 text-[12.5px] font-medium">
              {(
                [
                  ["chat", "Conversation"],
                  ["brief", "Briefs"],
                  ["investor", "Investor update"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-md px-3 py-1 transition",
                    view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === "chat" ? (
        <>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState onPick={(t) => void send(t)} />
          ) : (
            <div className="mx-auto max-w-2xl space-y-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} agentName={agentName} />
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {agentName} is thinking…
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void attachFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="mx-auto max-w-2xl">
            {attachErr && <p className="mb-1.5 text-[12px] text-destructive">{attachErr}</p>}
            {attachment && (
              <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted/60 py-1 pl-2 pr-1 text-[12px]">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{attachment.name}</span>
                <span className="shrink-0 text-muted-foreground">{Math.max(1, Math.round(attachment.text.length / 1000))}k chars</span>
                <button
                  onClick={() => setAttachment(null)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Remove attachment"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div
              className={cn(
                "flex items-end gap-2 rounded-xl border bg-background px-2 py-1.5 transition-colors",
                dragOver ? "border-primary/60 ring-2 ring-primary/20" : "border-input focus-within:border-primary/50",
              )}
            >
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => {
                  void attachFile(e.target.files?.[0]);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                title="Attach a text file"
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={dragOver ? "Drop the file here…" : `Message ${agentName}…`}
                className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[14px] outline-none"
              />
              <Button
                size="sm"
                className="mb-0.5 h-9 shrink-0"
                disabled={sending || (!input.trim() && !attachment)}
                onClick={submit}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
        </>
        ) : view === "brief" ? (
          <BriefView
            brief={shownBrief}
            briefs={cadenceBriefs}
            selectedId={shownBrief?.id ?? null}
            onSelect={setSelectedBriefId}
            cadence={cadence}
            onCadence={(c) => {
              setCadence(c);
              setSelectedBriefId(null);
            }}
            generating={generating}
            onGenerate={generateBrief}
            agentName={agentName}
            onApprove={(sug) => shownBrief && approveSug(shownBrief.id, sug)}
            onDismiss={(sugId) => shownBrief && dismissSug(shownBrief.id, sugId)}
            busySug={busySug}
          />
        ) : (
          <InvestorView
            update={shownUpdate}
            updates={updates}
            onSelect={setSelectedUpdateId}
            generating={genUpdate}
            onGenerate={generateUpdate}
            onSave={saveUpdate}
            onArchive={archiveUpdate}
            onDelete={deleteUpdate}
            companyName={bundle?.companyName ?? ""}
            agentName={agentName}
          />
        )}
      </div>

      {/* Context rail */}
      <aside className="min-h-0 w-full shrink-0 overflow-y-auto bg-muted/30 lg:w-[360px]">
        <div className="space-y-6 p-5">
          <NudgesPanel nudges={bundle?.nudges ?? []} />
          <KpiStrip kpis={bundle?.kpis ?? []} />
          <GoalsPanel goals={bundle?.goals ?? []} onChanged={loadBundle} />
          <MemoryPanel memory={bundle?.memory ?? []} onChanged={loadBundle} />
        </div>
      </aside>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-5 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
        <Compass className="h-7 w-7" />
      </span>
      <div>
        <h2 className="text-[17px] font-semibold">Talk to your Chief of Staff</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          Set company goals, ask for strategy, and get a partner who sees across every agent, project, and metric — and
          remembers what matters. It can kick off projects and campaigns for you, right from here.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-foreground/80 transition hover:border-primary/40 hover:text-primary"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, agentName }: { message: ExecMessage; agentName: string }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser ? "items-end" : "items-start")}>
        {!isUser && (
          <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600">
            <Compass className="h-3 w-3" /> {agentName}
          </p>
        )}
        {isUser ? (
          <UserContent content={message.content} />
        ) : (
          <div
            className="prose-chat rounded-2xl border border-border bg-card px-3.5 py-2.5 text-foreground"
            // Safe: markdownToHtml HTML-escapes all input before formatting.
            dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }}
          />
        )}
        {message.actions?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.actions.map((a, i) =>
              a.href ? (
                <Link
                  key={i}
                  href={a.href}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11.5px] font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  <Check className="h-3 w-3" /> {a.summary} <ArrowUpRight className="h-3 w-3" />
                </Link>
              ) : (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11.5px] font-medium text-emerald-700"
                >
                  <Check className="h-3 w-3" /> {a.summary}
                </span>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UserContent({ content }: { content: string }) {
  const { typed, file } = splitAttachment(content);
  return (
    <div className="space-y-1.5">
      {typed.trim() && (
        <div className="whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground">
          {typed.trim()}
        </div>
      )}
      {file && (
        <div className="overflow-hidden rounded-xl border border-border bg-muted/50 text-left">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground">
            <FileText className="h-3.5 w-3.5 shrink-0" /> {file.name}
          </div>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-snug text-foreground/75">
            {file.text}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- daily brief ------------------------------ */

function fmtBriefDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Serialize a brief to Markdown (the canonical export; txt/doc/pdf derive from it). */
function briefToMarkdown(b: ExecBrief): string {
  const c = b.content;
  const out: string[] = ["# Daily Brief", `_Prepared ${fmtBriefDate(b.created_at)}_`, ""];
  if (c.headline) out.push(`**${c.headline}**`, "");
  if (c.kpi_review) out.push("## KPI review", c.kpi_review, "");
  const sec = (title: string, items: string[]) => {
    if (items.length) {
      out.push(`## ${title}`);
      items.forEach((i) => out.push(`- ${i}`));
      out.push("");
    }
  };
  sec("Shipped", c.shipped);
  sec("In motion", c.in_motion);
  sec("Next", c.next);
  if (c.insights.length) {
    out.push("## Insights & ideas");
    c.insights.forEach((i) => {
      out.push(`### ${i.title}`);
      if (i.detail) out.push(i.detail);
      out.push("");
    });
  }
  const open = c.suggestions.filter((s) => s.status !== "dismissed");
  if (open.length) {
    out.push("## Proposed next steps");
    open.forEach((s) =>
      out.push(`- **[${s.kind}]** ${s.title}${s.rationale ? ` — ${s.rationale}` : ""}${s.status === "accepted" ? " _(created)_" : ""}`),
    );
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Print a document to PDF via a hidden iframe (the print dialog's "Save as PDF"). */
function printBriefPdf(bodyHtml: string, docTitle = "Daily Brief") {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>` +
      `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;max-width:680px;margin:32px auto;padding:0 24px;line-height:1.6}` +
      `h1{font-size:24px;margin:0 0 4px}h2{font-size:14px;margin:1.7em 0 .4em;text-transform:uppercase;letter-spacing:.05em;color:#64748b}` +
      `h3{font-size:15px;margin:1.1em 0 .2em}ul{padding-left:1.3em}li{margin:.2em 0}` +
      `code{background:#f1f5f9;padding:.1em .35em;border-radius:4px;font-size:.9em}a{color:#2563eb}` +
      `</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  setTimeout(() => document.body.removeChild(iframe), 1500);
}

function downloadBrief(b: ExecBrief, fmt: "md" | "txt" | "doc" | "pdf") {
  const md = briefToMarkdown(b);
  const base = `daily-brief-${new Date(b.created_at).toISOString().slice(0, 10)}`;
  if (fmt === "md") downloadBlob(`${base}.md`, md, "text/markdown");
  else if (fmt === "txt") downloadBlob(`${base}.txt`, markdownToPlainText(md), "text/plain");
  else if (fmt === "doc")
    downloadBlob(
      `${base}.doc`,
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${markdownToHtml(md)}</body></html>`,
      "application/msword",
    );
  else printBriefPdf(markdownToHtml(md));
}

function BriefView({
  brief,
  briefs,
  selectedId,
  onSelect,
  cadence,
  onCadence,
  generating,
  onGenerate,
  agentName,
  onApprove,
  onDismiss,
  busySug,
}: {
  brief: ExecBrief | null;
  briefs: ExecBrief[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  cadence: BriefKind;
  onCadence: (c: BriefKind) => void;
  generating: boolean;
  onGenerate: () => void;
  agentName: string;
  onApprove: (sug: BriefSuggestion) => void;
  onDismiss: (sugId: string) => void;
  busySug: string | null;
}) {
  const isWeekly = cadence === "weekly";
  const noun = isWeekly ? "weekly review" : "daily brief";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold">{isWeekly ? "Weekly Review" : "Daily Brief"}</h2>
            <p className="text-[12px] text-muted-foreground">
              {brief ? `Prepared ${fmtBriefDate(brief.created_at)}` : "Not generated yet"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border bg-muted/50 p-0.5 text-[12px] font-medium">
              <button
                onClick={() => onCadence("daily")}
                className={cn(
                  "rounded-md px-2.5 py-1 transition",
                  !isWeekly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Daily
              </button>
              <button
                onClick={() => onCadence("weekly")}
                className={cn(
                  "rounded-md px-2.5 py-1 transition",
                  isWeekly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Weekly
              </button>
            </div>
            {briefs.length > 1 && (
              <select
                value={selectedId ?? briefs[0]?.id}
                onChange={(e) => onSelect(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-[12.5px] font-medium outline-none"
                title="Brief archive"
              >
                {briefs.map((b, i) => (
                  <option key={b.id} value={b.id}>
                    {i === 0 ? "Latest · " : ""}
                    {fmtBriefDate(b.created_at)}
                  </option>
                ))}
              </select>
            )}
            {brief && (
              <Popover
                align="end"
                className="inline-flex"
                trigger={
                  <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[12.5px] font-medium transition-colors hover:bg-accent">
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Download</span>
                  </span>
                }
              >
                {(close) => (
                  <div className="min-w-[150px]">
                    {(
                      [
                        ["md", "Markdown (.md)"],
                        ["txt", "Text (.txt)"],
                        ["doc", "Word (.doc)"],
                        ["pdf", "PDF"],
                      ] as const
                    ).map(([fmt, label]) => (
                      <button
                        key={fmt}
                        onClick={() => {
                          downloadBrief(brief, fmt);
                          close();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                      >
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            )}
            <Button size="sm" variant={brief ? "outline" : "primary"} onClick={onGenerate} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {generating ? "Preparing…" : brief ? "Regenerate" : isWeekly ? "Generate review" : "Generate brief"}
            </Button>
          </div>
        </div>

        {generating && !brief ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-[13px]">{agentName} is reviewing the business…</p>
          </div>
        ) : brief ? (
          <BriefBody brief={brief} onApprove={onApprove} onDismiss={onDismiss} busySug={busySug} />
        ) : (
          <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <Sparkles className="h-6 w-6" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold">No {noun} yet</h3>
              <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                {isWeekly
                  ? `Have ${agentName} step back and review the week — what moved, progress on your goals, and one sharp recommendation for what's next.`
                  : `Have ${agentName} synthesize a briefing from across your agents, metrics, and goals — what shipped, what's underway, what's next, and where the opportunities are.`}
              </p>
            </div>
            <Button size="sm" onClick={onGenerate} disabled={generating}>
              <Sparkles className="h-4 w-4" /> {isWeekly ? "Generate this week's review" : "Generate today's brief"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function BriefBody({
  brief,
  onApprove,
  onDismiss,
  busySug,
}: {
  brief: ExecBrief;
  onApprove: (sug: BriefSuggestion) => void;
  onDismiss: (sugId: string) => void;
  busySug: string | null;
}) {
  const content = brief.content;
  const openSuggestions = content.suggestions.filter((s) => s.status !== "dismissed");
  return (
    <div className="mt-5 space-y-6">
      {content.headline && (
        <p className="text-balance text-[20px] font-semibold leading-snug">{content.headline}</p>
      )}
      {content.kpi_review && (
        <div className="rounded-2xl border border-indigo-200/70 bg-gradient-to-b from-indigo-50/60 to-transparent p-4">
          <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
            <TrendingUp className="h-3.5 w-3.5" /> KPI review
          </p>
          <p className="text-[13.5px] leading-relaxed text-foreground/90">{content.kpi_review}</p>
        </div>
      )}
      {openSuggestions.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
          <p className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-700">
            <Sparkles className="h-3.5 w-3.5" /> Proposed next steps
          </p>
          <div className="space-y-2.5">
            {openSuggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                sug={s}
                busy={busySug === s.id}
                onApprove={() => onApprove(s)}
                onDismiss={() => onDismiss(s.id)}
              />
            ))}
          </div>
        </div>
      )}
      <BriefList title="Shipped" icon={<CheckCircle2 className="h-3.5 w-3.5" />} items={content.shipped} accent="text-emerald-600" empty="Nothing completed recently." />
      <BriefList title="In motion" icon={<Zap className="h-3.5 w-3.5" />} items={content.in_motion} accent="text-sky-600" empty="Nothing underway right now." />
      <BriefList title="Next" icon={<ArrowRight className="h-3.5 w-3.5" />} items={content.next} accent="text-amber-600" empty="Nothing queued." />
      {content.insights.length > 0 && (
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-600">
            <Lightbulb className="h-3.5 w-3.5" /> Insights &amp; ideas
          </p>
          <div className="space-y-2">
            {content.insights.map((ins, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-3">
                <p className="text-[13.5px] font-semibold">{ins.title}</p>
                {ins.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{ins.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SUG_META: Record<BriefSuggestion["kind"], { label: string; icon: typeof FolderKanban }> = {
  project: { label: "Project", icon: FolderKanban },
  campaign: { label: "Campaign", icon: TrendingUp },
  task: { label: "Task", icon: ListChecks },
};

function SuggestionCard({
  sug,
  busy,
  onApprove,
  onDismiss,
}: {
  sug: BriefSuggestion;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const meta = SUG_META[sug.kind];
  const Icon = meta.icon;
  const accepted = sug.status === "accepted";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {meta.label}
            </span>
            <p className="text-[13.5px] font-semibold leading-snug">{sug.title}</p>
          </div>
          {sug.rationale && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{sug.rationale}</p>}
          <div className="mt-2">
            {accepted ? (
              sug.ref_href ? (
                <Link
                  href={sug.ref_href}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11.5px] font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  <Check className="h-3 w-3" /> Created — open <ArrowUpRight className="h-3 w-3" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-600">
                  <Check className="h-3 w-3" /> Created
                </span>
              )
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="success" disabled={busy} onClick={onApprove}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Approve &amp; create
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
                  <X className="h-3.5 w-3.5" /> Dismiss
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BriefList({
  title,
  icon,
  items,
  accent,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  accent: string;
  empty: string;
}) {
  return (
    <div>
      <p className={cn("mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", accent)}>
        {icon} {title}
      </p>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-[13.5px] leading-relaxed">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

/* --------------------------- investor update ---------------------------- */

/** Serialize an investor update to Markdown (the canonical export). */
function investorUpdateToMarkdown(u: InvestorUpdate): string {
  const c = u.content;
  const out: string[] = [`# Investor Update — ${c.period}`, `_Prepared ${fmtBriefDate(u.created_at)}_`, ""];
  if (c.image_url) out.push(`![](${c.image_url})`, "");
  if (c.tldr) out.push(c.tldr, "");
  const bullets = (title: string, items: string[]) => {
    if (items.length) {
      out.push(`## ${title}`);
      items.forEach((i) => out.push(`- ${i}`));
      out.push("");
    }
  };
  bullets("Highlights", c.highlights);
  if (c.metrics.length) {
    out.push("## Metrics");
    c.metrics.forEach((m) => out.push(`- **${m.label}:** ${m.value}${m.note ? ` — ${m.note}` : ""}`));
    out.push("");
  }
  bullets("Challenges", c.lowlights);
  bullets("What's next", c.whats_next);
  bullets("The ask", c.asks);
  if (c.closing) out.push("---", "", c.closing, "");
  return out.join("\n").trim() + "\n";
}

function downloadInvestorUpdate(u: InvestorUpdate, fmt: "md" | "txt" | "doc" | "pdf") {
  const md = investorUpdateToMarkdown(u);
  const slug = (u.content.period || "investor-update").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = `investor-update-${slug}`;
  if (fmt === "md") downloadBlob(`${base}.md`, md, "text/markdown");
  else if (fmt === "txt") downloadBlob(`${base}.txt`, markdownToPlainText(md), "text/plain");
  else if (fmt === "doc")
    downloadBlob(
      `${base}.doc`,
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${markdownToHtml(md)}</body></html>`,
      "application/msword",
    );
  else printBriefPdf(markdownToHtml(md), `Investor Update — ${u.content.period}`);
}

const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Suggested email subject, e.g. "Andros investor update — August 2026". */
function investorEmailSubject(companyName: string, period: string): string {
  const co = companyName.trim();
  const p = period.trim();
  if (co && p) return `${co} investor update — ${p}`;
  if (co) return `${co} investor update`;
  if (p) return `Investor update — ${p}`;
  return "Investor update";
}

/** Build an email-ready HTML fragment (inline styles) to paste into a mail client. */
function investorUpdateEmailHtml(u: InvestorUpdate): string {
  const c = u.content;
  const parts: string[] = [];
  const H2 = (t: string) =>
    `<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:28px 0 8px;">${escapeHtml(t)}</h2>`;
  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    parts.push(H2(title));
    parts.push(
      `<ul style="margin:0;padding-left:20px;">${items
        .map((i) => `<li style="margin:4px 0;">${escapeHtml(i)}</li>`)
        .join("")}</ul>`,
    );
  };

  parts.push(
    `<p style="text-transform:uppercase;letter-spacing:.08em;font-size:12px;color:#64748b;margin:0 0 4px;">Investor Update</p>`,
    `<h1 style="font-size:24px;margin:0 0 16px;color:#0f172a;">${escapeHtml(c.period)}</h1>`,
  );
  if (c.image_url)
    parts.push(
      `<img src="${escapeHtml(c.image_url)}" alt="" style="width:100%;max-width:600px;border-radius:12px;margin:0 0 20px;display:block;" />`,
    );
  if (c.tldr) parts.push(`<p style="font-size:16px;line-height:1.6;margin:0 0 8px;color:#0f172a;">${escapeHtml(c.tldr)}</p>`);

  list("Highlights", c.highlights);

  if (c.metrics.length) {
    parts.push(H2("Metrics"));
    parts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0;">${c.metrics
        .map(
          (m) =>
            `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${escapeHtml(
              m.label,
            )}</td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;white-space:nowrap;">${escapeHtml(
              m.value,
            )}${m.note ? ` <span style="color:#94a3b8;font-weight:400;">(${escapeHtml(m.note)})</span>` : ""}</td></tr>`,
        )
        .join("")}</table>`,
    );
  }

  list("Challenges", c.lowlights);
  list("What's next", c.whats_next);

  if (c.asks.length) {
    parts.push(H2("The ask"));
    parts.push(
      `<ul style="margin:0;padding-left:20px;">${c.asks
        .map((a) => `<li style="margin:4px 0;font-weight:600;color:#0f172a;">${escapeHtml(a)}</li>`)
        .join("")}</ul>`,
    );
  }

  if (c.closing)
    parts.push(
      `<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-style:italic;color:#475569;line-height:1.6;">${escapeHtml(
        c.closing,
      )}</p>`,
    );

  return `<div style="max-width:600px;margin:0 auto;font-family:${EMAIL_FONT};color:#0f172a;line-height:1.6;font-size:15px;">${parts.join(
    "",
  )}</div>`;
}

/** Copy rich text (HTML + a plain-text fallback) to the clipboard. */
async function copyRichText(html: string, plain: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    return false;
  }
}

function InvestorView({
  update,
  updates,
  onSelect,
  generating,
  onGenerate,
  onSave,
  onArchive,
  onDelete,
  companyName,
  agentName,
}: {
  update: InvestorUpdate | null;
  updates: InvestorUpdate[];
  onSelect: (id: string) => void;
  generating: boolean;
  onGenerate: () => void;
  onSave: (
    id: string,
    content: InvestorUpdateContent,
  ) => Promise<{ ok: boolean; update?: InvestorUpdate; error?: string }>;
  onArchive: (id: string, archived: boolean) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean }>;
  companyName: string;
  agentName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<InvestorUpdateContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busyMenu, setBusyMenu] = useState(false);

  // Leave edit mode whenever the shown update changes (e.g. picking another one).
  const shownId = update?.id ?? null;
  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setEditErr("");
  }, [shownId]);

  const archivedCount = updates.filter((u) => u.archived).length;
  const visible = updates.filter((u) => !u.archived || showArchived || u.id === shownId);
  const subject = update ? investorEmailSubject(companyName, update.content.period) : "";

  function startEdit() {
    if (!update) return;
    setDraft({ ...update.content });
    setEditErr("");
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft(null);
    setEditErr("");
  }
  async function saveEdit() {
    if (!update || !draft) return;
    setSaving(true);
    setEditErr("");
    const res = await onSave(update.id, draft);
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      setDraft(null);
    } else {
      setEditErr(res.error ?? "Couldn't save your changes.");
    }
  }
  async function copyEmail() {
    if (!update) return;
    const ok = await copyRichText(
      investorUpdateEmailHtml(update),
      markdownToPlainText(investorUpdateToMarkdown(update)),
    );
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  async function toggleArchive() {
    if (!update) return;
    setBusyMenu(true);
    await onArchive(update.id, !update.archived);
    setBusyMenu(false);
  }
  async function doDelete() {
    if (!update) return;
    setBusyMenu(true);
    await onDelete(update.id);
    setBusyMenu(false);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold">Investor Update</h2>
            <p className="text-[12px] text-muted-foreground">
              {editing
                ? "Editing — changes save to this update"
                : update
                  ? `${update.content.period} · prepared ${fmtBriefDate(update.created_at)}${update.archived ? " · archived" : ""}`
                  : "Not generated yet"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
              </>
            ) : (
              <>
                {archivedCount > 0 && (
                  <button
                    onClick={() => setShowArchived((v) => !v)}
                    title={showArchived ? "Hide archived updates" : "Show archived updates"}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors",
                      showArchived
                        ? "border-primary/40 bg-primary/5 text-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{showArchived ? "Hide archived" : `Archived (${archivedCount})`}</span>
                  </button>
                )}
                {visible.length > 1 && (
                  <select
                    value={shownId ?? visible[0]?.id}
                    onChange={(e) => onSelect(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-2 text-[12.5px] font-medium outline-none"
                    title="Update history"
                  >
                    {visible.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.content.period || fmtBriefDate(u.created_at)}
                        {u.archived ? " · archived" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {update && (
                  <>
                    <Button size="sm" variant="outline" onClick={copyEmail} title="Copy as a formatted email">
                      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Mail className="h-4 w-4" />}
                      <span className="hidden sm:inline">{copied ? "Copied" : "Copy email"}</span>
                    </Button>
                    <Popover
                      align="end"
                      className="inline-flex"
                      trigger={
                        <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[12.5px] font-medium transition-colors hover:bg-accent">
                          <Download className="h-4 w-4" />
                          <span className="hidden sm:inline">Download</span>
                        </span>
                      }
                    >
                      {(close) => (
                        <div className="min-w-[150px]">
                          {(
                            [
                              ["md", "Markdown (.md)"],
                              ["txt", "Text (.txt)"],
                              ["doc", "Word (.doc)"],
                              ["pdf", "PDF"],
                            ] as const
                          ).map(([fmt, label]) => (
                            <button
                              key={fmt}
                              onClick={() => {
                                downloadInvestorUpdate(update, fmt);
                                close();
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                            >
                              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </Popover>
                    <Button size="sm" variant="outline" onClick={startEdit} title="Edit this update">
                      <Pencil className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <UpdateMenu
                      archived={update.archived}
                      busy={busyMenu}
                      onArchive={toggleArchive}
                      onDelete={doDelete}
                    />
                  </>
                )}
                <Button size="sm" variant={update ? "outline" : "primary"} onClick={onGenerate} disabled={generating}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {generating ? "Drafting…" : update ? "Regenerate" : "Generate update"}
                </Button>
              </>
            )}
          </div>
        </div>

        {generating && !update ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-[13px]">{agentName} is drafting your investor update…</p>
          </div>
        ) : editing && draft ? (
          <>
            {editErr && (
              <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                {editErr}
              </p>
            )}
            <InvestorEditor draft={draft} onChange={setDraft} />
          </>
        ) : update ? (
          <InvestorBody update={update} subject={subject} />
        ) : (
          <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
              <Handshake className="h-6 w-6" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold">No investor update yet</h3>
              <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                Have {agentName} draft a monthly update from your live metrics, goals, and progress — highlights, the
                honest challenges, what&apos;s next, and specific asks. Then edit it, add a photo, and copy it as an
                email ready to send.
              </p>
            </div>
            <Button size="sm" onClick={onGenerate} disabled={generating}>
              <Handshake className="h-4 w-4" /> Generate this month&apos;s update
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function InvestorBody({ update, subject }: { update: InvestorUpdate; subject: string }) {
  const c = update.content;
  return (
    <div className="mt-5 space-y-6">
      <SubjectRow subject={subject} />
      {c.image_url && (
        <div className="overflow-hidden rounded-2xl border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.image_url} alt="" className="aspect-[16/9] w-full object-cover" />
        </div>
      )}
      {c.tldr && (
        <div className="rounded-2xl border border-sky-200/70 bg-gradient-to-b from-sky-50/70 to-transparent p-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sky-700">The short version</p>
          <p className="text-balance text-[15px] font-medium leading-relaxed text-foreground/90">{c.tldr}</p>
        </div>
      )}

      {c.metrics.length > 0 && (
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
            <TrendingUp className="h-3.5 w-3.5" /> Metrics
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {c.metrics.map((m, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
                <p className="mt-0.5 text-[19px] font-semibold tabular-nums leading-tight">{m.value}</p>
                {m.note && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{m.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <InvestorList title="Highlights" icon={<Sparkles className="h-3.5 w-3.5" />} items={c.highlights} accent="text-emerald-600" empty="No highlights captured." />
      <InvestorList title="Challenges" icon={<AlertTriangle className="h-3.5 w-3.5" />} items={c.lowlights} accent="text-amber-600" empty="No challenges flagged." />
      <InvestorList title="What's next" icon={<ArrowRight className="h-3.5 w-3.5" />} items={c.whats_next} accent="text-sky-600" empty="Nothing queued." />

      {c.asks.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
          <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
            <Handshake className="h-3.5 w-3.5" /> The ask
          </p>
          <ul className="space-y-1.5">
            {c.asks.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-[13.5px] font-medium leading-relaxed">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.closing && (
        <p className="border-t border-border pt-4 text-[13.5px] italic leading-relaxed text-muted-foreground">
          {c.closing}
        </p>
      )}
    </div>
  );
}

function InvestorList({
  title,
  icon,
  items,
  accent,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  accent: string;
  empty: string;
}) {
  return (
    <div>
      <p className={cn("mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", accent)}>
        {icon} {title}
      </p>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-[13.5px] leading-relaxed">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

/** The suggested email subject line, with a one-click copy. */
function SubjectRow({ subject }: { subject: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(subject);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Subject</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{subject}</span>
      <button
        type="button"
        onClick={copy}
        title="Copy subject line"
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

/** Overflow menu for an investor update: archive / unarchive and delete. */
function UpdateMenu({
  archived,
  busy,
  onArchive,
  onDelete,
}: {
  archived: boolean;
  busy: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <Popover
      align="end"
      className="inline-flex"
      trigger={
        <span
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-input bg-background transition-colors hover:bg-accent"
          title="More actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </span>
      }
    >
      {(close) => (
        <UpdateMenuBody archived={archived} busy={busy} onArchive={onArchive} onDelete={onDelete} close={close} />
      )}
    </Popover>
  );
}

function UpdateMenuBody({
  archived,
  busy,
  onArchive,
  onDelete,
  close,
}: {
  archived: boolean;
  busy: boolean;
  onArchive: () => void;
  onDelete: () => void;
  close: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="min-w-[190px]">
      <button
        onClick={() => {
          onArchive();
          close();
        }}
        disabled={busy}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent disabled:opacity-50"
      >
        {archived ? (
          <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Archive className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {archived ? "Unarchive" : "Archive"}
      </button>
      {confirming ? (
        <div className="mt-1 rounded-md bg-destructive/5 p-2">
          <p className="mb-1.5 px-0.5 text-[12px] text-muted-foreground">Delete permanently?</p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                onDelete();
                close();
              }}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete…
        </button>
      )}
    </div>
  );
}

/* --------------------------- investor editor ---------------------------- */

function InvestorEditor({
  draft,
  onChange,
}: {
  draft: InvestorUpdateContent;
  onChange: (next: InvestorUpdateContent) => void;
}) {
  const set = (partial: Partial<InvestorUpdateContent>) => onChange({ ...draft, ...partial });
  return (
    <div className="mt-5 space-y-6">
      <EditGroup label="Period">
        <Input value={draft.period} onChange={(e) => set({ period: e.target.value })} placeholder="e.g. August 2026" />
      </EditGroup>
      <EditGroup label="Hero image" hint="Optional — shown at the top of the update and in the email.">
        <ImageSlot
          label="hero image"
          value={draft.image_url}
          onChange={(url) => set({ image_url: url ?? undefined })}
        />
      </EditGroup>
      <EditGroup label="The short version (TL;DR)">
        <Textarea
          value={draft.tldr}
          onChange={(e) => set({ tldr: e.target.value })}
          className="min-h-[84px]"
          placeholder="Two or three sentences an investor could skim in ten seconds."
        />
      </EditGroup>
      <ListEditor
        label="Highlights"
        items={draft.highlights}
        onChange={(v) => set({ highlights: v })}
        placeholder="A concrete win or milestone this period."
      />
      <MetricsEditor metrics={draft.metrics} onChange={(v) => set({ metrics: v })} />
      <ListEditor
        label="Challenges"
        items={draft.lowlights}
        onChange={(v) => set({ lowlights: v })}
        placeholder="An honest risk, blocker, or miss."
      />
      <ListEditor
        label="What's next"
        items={draft.whats_next}
        onChange={(v) => set({ whats_next: v })}
        placeholder="A priority or plan for next period."
      />
      <ListEditor
        label="The ask"
        items={draft.asks}
        onChange={(v) => set({ asks: v })}
        placeholder="A specific ask — an intro, a hire, advice, capital."
      />
      <EditGroup label="Closing note">
        <Textarea
          value={draft.closing}
          onChange={(e) => set({ closing: e.target.value })}
          className="min-h-[70px]"
          placeholder="A brief, warm sign-off (optional)."
        />
      </EditGroup>
    </div>
  );
}

function EditGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function ListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const setAt = (i: number, v: string) => onChange(items.map((it, j) => (j === i ? v : it)));
  const removeAt = (i: number) => onChange(items.filter((_, j) => j !== i));
  const add = () => onChange([...items, ""]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const arr = items.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <AddBtn onClick={add} />
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[12px] text-muted-foreground">
          Nothing here yet.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <Textarea
                value={it}
                onChange={(e) => setAt(i, e.target.value)}
                placeholder={placeholder}
                className="min-h-[44px] flex-1"
              />
              <div className="flex flex-col">
                <EditIconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </EditIconBtn>
                <EditIconBtn label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </EditIconBtn>
                <EditIconBtn label="Remove" danger onClick={() => removeAt(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </EditIconBtn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricsEditor({
  metrics,
  onChange,
}: {
  metrics: InvestorMetric[];
  onChange: (metrics: InvestorMetric[]) => void;
}) {
  const setAt = (i: number, p: Partial<InvestorMetric>) =>
    onChange(metrics.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const removeAt = (i: number) => onChange(metrics.filter((_, j) => j !== i));
  const add = () => onChange([...metrics, { label: "", value: "" }]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Metrics</Label>
        <AddBtn onClick={add} />
      </div>
      {metrics.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[12px] text-muted-foreground">
          No metrics yet.
        </p>
      ) : (
        <div className="space-y-2">
          {metrics.map((m, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">Metric {i + 1}</span>
                <EditIconBtn label="Remove metric" danger onClick={() => removeAt(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </EditIconBtn>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={m.label}
                  onChange={(e) => setAt(i, { label: e.target.value })}
                  placeholder="Label (e.g. MRR)"
                />
                <Input
                  value={m.value}
                  onChange={(e) => setAt(i, { value: e.target.value })}
                  placeholder="Value (e.g. $12k)"
                />
              </div>
              <Input
                value={m.note ?? ""}
                onChange={(e) => setAt(i, { note: e.target.value || undefined })}
                placeholder="Note (optional, e.g. +18% MoM)"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-primary transition hover:bg-primary/10"
    >
      <Plus className="h-3.5 w-3.5" /> Add
    </button>
  );
}

function EditIconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1 text-muted-foreground transition hover:bg-accent disabled:pointer-events-none disabled:opacity-30",
        danger && "hover:text-red-600",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Nudges --------------------------------- */

const NUDGE_META: Record<ExecNudge["severity"], { card: string; icon: typeof Bell; color: string }> = {
  attention: { card: "border-amber-200 bg-amber-50/60", icon: AlertTriangle, color: "text-amber-600" },
  positive: { card: "border-emerald-200 bg-emerald-50/60", icon: CheckCircle2, color: "text-emerald-600" },
  info: { card: "border-border bg-card", icon: Info, color: "text-muted-foreground" },
};

function NudgesPanel({ nudges }: { nudges: ExecNudge[] }) {
  if (!nudges.length) return null;
  return (
    <div>
      <RailHeading icon={<Bell className="h-3.5 w-3.5" />} label="Needs your attention" />
      <div className="mt-2 space-y-2">
        {nudges.map((n) => {
          const m = NUDGE_META[n.severity];
          const Icon = m.icon;
          const inner = (
            <div className={cn("rounded-xl border p-2.5", m.card)}>
              <div className="flex items-start gap-2">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", m.color)} />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold leading-snug">{n.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{n.detail}</p>
                </div>
              </div>
            </div>
          );
          return n.href ? (
            <Link key={n.id} href={n.href} className="block transition hover:opacity-90">
              {inner}
            </Link>
          ) : (
            <div key={n.id}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- KPIs ---------------------------------- */

function KpiStrip({ kpis }: { kpis: ExecKpi[] }) {
  if (!kpis.length) return null;
  return (
    <div>
      <RailHeading icon={<TrendingUp className="h-3.5 w-3.5" />} label="KPIs" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {kpis.map((k) => (
          <div key={k.key} className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] font-medium text-muted-foreground">{k.label}</p>
            <p className="mt-0.5 text-[19px] font-semibold leading-tight tabular-nums">{k.value}</p>
            {k.delta ? (
              <p
                className={cn(
                  "mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium",
                  k.tone === "up" ? "text-emerald-600" : k.tone === "down" ? "text-amber-600" : "text-muted-foreground",
                )}
              >
                {k.tone === "up" ? <TrendingUp className="h-3 w-3" /> : k.tone === "down" ? <TrendingDown className="h-3 w-3" /> : null}
                {k.delta}
              </p>
            ) : (
              k.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{k.hint}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- Goals --------------------------------- */

const HORIZON_LABEL: Record<GoalHorizon, string> = { month: "This month", quarter: "This quarter", ongoing: "Ongoing" };

function GoalsPanel({ goals, onChanged }: { goals: CompanyGoal[]; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [horizon, setHorizon] = useState<GoalHorizon>("month");
  const [metric, setMetric] = useState<GoalMetric | "">("");
  const [busy, setBusy] = useState(false);

  const active = goals.filter((g) => g.status === "active");
  const focus = active.filter((g) => g.horizon === "month" || g.horizon === "quarter");
  const ongoing = active.filter((g) => g.horizon === "ongoing");

  async function add() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const num = metric ? Number(target.replace(/[^0-9.]/g, "")) : null;
    await addGoalAction({
      title: title.trim(),
      horizon,
      metric_key: metric || null,
      target_number: Number.isFinite(num) ? num : null,
      target: target.trim() || undefined,
    });
    setTitle("");
    setTarget("");
    setMetric("");
    setHorizon("month");
    setAdding(false);
    setBusy(false);
    await onChanged();
  }

  return (
    <div>
      <RailHeading
        icon={<Target className="h-3.5 w-3.5" />}
        label="Goals"
        action={
          <button onClick={() => setAdding((v) => !v)} className="text-muted-foreground hover:text-foreground" title="Add goal">
            <Plus className="h-3.5 w-3.5" />
          </button>
        }
      />
      {adding && (
        <div className="mt-2 space-y-2 rounded-xl border border-border bg-card p-2.5">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal (e.g. Reach $10k MRR)" className="h-8 text-[13px]" autoFocus />
          <div className="flex rounded-lg border border-border bg-muted/50 p-0.5 text-[11.5px] font-medium">
            {(["month", "quarter", "ongoing"] as GoalHorizon[]).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={cn(
                  "flex-1 rounded-md py-1 transition",
                  horizon === h ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {h === "month" ? "Month" : h === "quarter" ? "Quarter" : "Ongoing"}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as GoalMetric | "")}
              className="h-8 flex-1 rounded-md border border-border bg-background px-1.5 text-[12px]"
            >
              <option value="">No live tracking</option>
              <option value="revenue">Track revenue ($)</option>
              <option value="followers">Track followers</option>
            </select>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={metric ? (metric === "revenue" ? "e.g. 10000" : "e.g. 5000") : "Target (optional)"}
              className="h-8 w-24 text-[13px]"
            />
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="success" className="flex-1" onClick={add} disabled={busy || !title.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {active.length === 0 && !adding && (
        <p className="mt-2 rounded-xl border border-dashed border-border p-3 text-[12px] text-muted-foreground">
          Set a focus for this month — everything the agent briefs + proposes will ladder up to it. Or ask it to help.
        </p>
      )}
      {focus.length > 0 && (
        <div className="mt-2">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-violet-600">Focus</p>
          <div className="space-y-2">
            {focus.map((g) => (
              <GoalItem key={g.id} goal={g} onChanged={onChanged} />
            ))}
          </div>
        </div>
      )}
      {ongoing.length > 0 && (
        <div className="mt-3">
          {focus.length > 0 && <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">Ongoing</p>}
          <div className="space-y-2">
            {ongoing.map((g) => (
              <GoalItem key={g.id} goal={g} onChanged={onChanged} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GoalItem({ goal: g, onChanged }: { goal: CompanyGoal; onChanged: () => Promise<void> }) {
  const p = g.progress;
  return (
    <div className="group rounded-xl border border-border bg-card p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {g.horizon !== "ongoing" && (
            <span className="mb-1 inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              {HORIZON_LABEL[g.horizon]}
            </span>
          )}
          <p className="text-[13px] font-medium leading-snug">{g.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button onClick={async () => { await setGoalStatusAction(g.id, "achieved"); await onChanged(); }} title="Mark achieved" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-emerald-600">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={async () => { await deleteGoalAction(g.id); await onChanged(); }} title="Delete" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {p ? (
        <div className="mt-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium">
            <span className="text-muted-foreground">
              {g.metric_key === "revenue" ? "$" : ""}
              {p.current.toLocaleString()} / {g.metric_key === "revenue" ? "$" : ""}
              {p.target.toLocaleString()}
            </span>
            <span className={cn(p.pct >= 100 ? "text-emerald-600" : "text-primary")}>{p.pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all", p.pct >= 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${p.pct}%` }} />
          </div>
        </div>
      ) : (
        g.target && <p className="mt-0.5 text-[11.5px] font-medium text-primary">Target: {g.target}</p>
      )}
      {g.detail && <p className="mt-1 text-[12px] text-muted-foreground">{g.detail}</p>}
    </div>
  );
}

/* -------------------------------- Memory -------------------------------- */

const MEMORY_TONE: Record<string, string> = {
  fact: "bg-slate-100 text-slate-600",
  preference: "bg-sky-50 text-sky-700",
  decision: "bg-violet-50 text-violet-700",
  insight: "bg-amber-50 text-amber-700",
};

function MemoryPanel({ memory, onChanged }: { memory: ExecMemory[]; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!note.trim() || busy) return;
    setBusy(true);
    await addMemoryAction(note.trim());
    setNote("");
    setAdding(false);
    setBusy(false);
    await onChanged();
  }

  return (
    <div>
      <RailHeading
        icon={<Brain className="h-3.5 w-3.5" />}
        label="What it knows"
        action={
          <button onClick={() => setAdding((v) => !v)} className="text-muted-foreground hover:text-foreground" title="Add a note">
            <Plus className="h-3.5 w-3.5" />
          </button>
        }
      />
      {adding && (
        <div className="mt-2 space-y-1.5 rounded-xl border border-border bg-card p-2.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Something the Executive should always remember…"
            rows={2}
            className="w-full resize-none rounded-lg border border-input bg-background p-2 text-[13px] outline-none focus:border-primary/50"
            autoFocus
          />
          <div className="flex gap-1.5">
            <Button size="sm" variant="success" className="flex-1" onClick={add} disabled={busy || !note.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Remember
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="mt-2 space-y-2">
        {memory.length === 0 && !adding && (
          <p className="rounded-xl border border-dashed border-border p-3 text-[12px] text-muted-foreground">
            The Executive builds this up as you talk — decisions, preferences, and what's working. You can add notes too.
          </p>
        )}
        {memory.map((m) => (
          <div key={m.id} className="group rounded-xl border border-border bg-card p-2.5">
            <div className="flex items-start gap-2">
              <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize", MEMORY_TONE[m.kind] ?? MEMORY_TONE.fact)}>
                {m.kind}
              </span>
              <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground/90">{m.content}</p>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={async () => { await togglePinMemoryAction(m.id, !m.pinned); await onChanged(); }}
                  title={m.pinned ? "Unpin" : "Pin"}
                  className={cn("rounded p-1 hover:bg-accent", m.pinned ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                >
                  <Pin className="h-3 w-3" />
                </button>
                <button onClick={async () => { await deleteMemoryAction(m.id); await onChanged(); }} title="Forget" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RailHeading({ icon, label, action }: { icon: React.ReactNode; label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground/70">{icon}</span>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{label}</h3>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}
