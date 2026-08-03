"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Brain,
  Check,
  CheckCircle2,
  Compass,
  Download,
  FileText,
  FolderKanban,
  Handshake,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  Paperclip,
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
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store";
import { markdownToHtml, markdownToPlainText } from "@/lib/content/format";
import {
  addGoalAction,
  addMemoryAction,
  approveBriefSuggestionAction,
  deleteGoalAction,
  deleteMemoryAction,
  dismissBriefSuggestionAction,
  generateBriefAction,
  generateInvestorUpdateAction,
  getExecutiveBundleAction,
  sendExecutiveMessageAction,
  setGoalStatusAction,
  startNewExecutiveChatAction,
  togglePinMemoryAction,
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
  InvestorUpdate,
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
  const shownUpdate = updates.find((u) => u.id === selectedUpdateId) ?? updates[0] ?? null;

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
            selectedId={shownUpdate?.id ?? null}
            onSelect={setSelectedUpdateId}
            generating={genUpdate}
            onGenerate={generateUpdate}
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

function InvestorView({
  update,
  updates,
  selectedId,
  onSelect,
  generating,
  onGenerate,
  agentName,
}: {
  update: InvestorUpdate | null;
  updates: InvestorUpdate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  generating: boolean;
  onGenerate: () => void;
  agentName: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold">Investor Update</h2>
            <p className="text-[12px] text-muted-foreground">
              {update ? `${update.content.period} · prepared ${fmtBriefDate(update.created_at)}` : "Not generated yet"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {updates.length > 1 && (
              <select
                value={selectedId ?? updates[0]?.id}
                onChange={(e) => onSelect(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-[12.5px] font-medium outline-none"
                title="Update archive"
              >
                {updates.map((u, i) => (
                  <option key={u.id} value={u.id}>
                    {i === 0 ? "Latest · " : ""}
                    {u.content.period || fmtBriefDate(u.created_at)}
                  </option>
                ))}
              </select>
            )}
            {update && (
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
            )}
            <Button size="sm" variant={update ? "outline" : "primary"} onClick={onGenerate} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {generating ? "Drafting…" : update ? "Regenerate" : "Generate update"}
            </Button>
          </div>
        </div>

        {generating && !update ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-[13px]">{agentName} is drafting your investor update…</p>
          </div>
        ) : update ? (
          <InvestorBody update={update} />
        ) : (
          <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
              <Handshake className="h-6 w-6" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold">No investor update yet</h3>
              <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                Have {agentName} draft a monthly update from your live metrics, goals, and progress — highlights, the
                honest challenges, what&apos;s next, and specific asks. Ready to download and send.
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

function InvestorBody({ update }: { update: InvestorUpdate }) {
  const c = update.content;
  return (
    <div className="mt-5 space-y-6">
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
