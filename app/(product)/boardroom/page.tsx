"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Gavel,
  ListChecks,
  Loader2,
  Plus,
  Radar,
  ScrollText,
  Send,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { markdownToHtml } from "@/lib/content/format";
import {
  advanceBoardAction,
  boardAlertToTaskAction,
  conveneBoardAction,
  deleteBoardSessionAction,
  getBoardroomAction,
  getBoardSessionAction,
  handVerdictToExecutiveAction,
  markAllBoardAlertsReadAction,
  respondToBoardAction,
  scanBoardIfDueAction,
  scanBoardNowAction,
  setBoardAlertStatusAction,
  setBoardCadenceAction,
  setBoardDirectiveStatusAction,
} from "@/app/actions";
import type {
  BoardAlert,
  BoardCadence,
  BoardDirective,
  BoardMember,
  BoardSession,
  BoardSessionStatus,
  BoardSessionSummary,
  BoardSettings,
} from "@/lib/types";

const ROLE_LABEL: Record<string, string> = {
  finance: "Finance",
  marketing: "Marketing",
  product: "Product",
  strategy: "Strategy",
  technology: "Technology",
  chair: "Chair",
  custom: "Advisor",
};
const ACCENT: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  violet: "bg-violet-100 text-violet-700",
  sky: "bg-sky-100 text-sky-700",
  rose: "bg-rose-100 text-rose-700",
  slate: "bg-slate-100 text-slate-600",
};
const STAGE_LABEL: Record<BoardSessionStatus, string> = {
  opening_pending: "The board is forming opening positions…",
  rebuttal_pending: "The board is debating…",
  awaiting_founder: "",
  verdict_pending: "The Chair is weighing the verdict…",
  complete: "",
  failed: "",
};
const DIRECTIVE_STYLE: Record<string, string> = {
  open: "bg-slate-100 text-slate-600",
  in_motion: "bg-sky-100 text-sky-700",
};

const SEVERITY: Record<string, { chip: string; label: string }> = {
  info: { chip: "bg-slate-100 text-slate-600", label: "Info" },
  attention: { chip: "bg-amber-100 text-amber-700", label: "Attention" },
  urgent: { chip: "bg-red-100 text-red-700", label: "Urgent" },
};
const CADENCES: { value: BoardCadence; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const PROMPTS = [
  "Assess where we stand and what's holding us back.",
  "What are the 3 highest-leverage moves to reach $10B faster?",
  "Who are our real competitors, and how do we beat them?",
  "Where am I fooling myself about this business?",
];

/** Render the board's markdown (bold, lists, paragraphs) — HTML-escaped + safe. */
function Md({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn("prose-chat", className)}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(children) }}
    />
  );
}

function blankSession(id: string, title: string): BoardSession {
  return {
    id,
    title,
    trigger: "user",
    status: "opening_pending",
    founder_input: "",
    verdict: "",
    disagreements: [],
    recommendations: [],
    accountability: "",
    project_id: null,
    contributions: [],
    error: "",
    created_at: new Date().toISOString(),
    completed_at: null,
  };
}

export default function BoardroomPage() {
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [sessions, setSessions] = useState<BoardSessionSummary[]>([]);
  const [alerts, setAlerts] = useState<BoardAlert[]>([]);
  const [directives, setDirectives] = useState<BoardDirective[]>([]);
  const [settings, setSettings] = useState<BoardSettings>({ cadence: "daily", last_scan_at: null });
  const [founderReply, setFounderReply] = useState("");
  const [handingOff, setHandingOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [convening, setConvening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState<BoardSession | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await getBoardroomAction();
    if ("error" in r) setError(r.error);
    else {
      setMembers(r.members);
      setSessions(r.sessions);
      setAlerts(r.alerts);
      setDirectives(r.directives);
      setSettings(r.settings);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      // Page-load poke: run a scan if the cadence is due (works without cron locally).
      const p = await scanBoardIfDueAction();
      if (!cancelled && p.created > 0) {
        void load();
        setNotice(`The board raised ${p.created} new alert${p.created === 1 ? "" : "s"} from its scan.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const newCount = alerts.filter((a) => a.status === "new").length;

  const drive = useCallback(async (id: string) => {
    setBusy(true);
    for (let i = 0; i < 5; i++) {
      const r = await advanceBoardAction(id);
      if (!r.ok) {
        setError(r.error);
        break;
      }
      setActive(r.session);
      // Stop at the founder-input pause, the verdict, or a failure.
      if (["complete", "failed", "awaiting_founder"].includes(r.session.status)) break;
    }
    setBusy(false);
    void load();
  }, [load]);

  async function convene(q?: string) {
    const text = (q ?? question).trim();
    if (!text || convening || busy) return;
    setConvening(true);
    setError("");
    const r = await conveneBoardAction(text);
    setConvening(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setQuestion("");
    setActive(blankSession(r.id, text));
    void drive(r.id);
  }

  async function openSession(id: string) {
    setError("");
    const r = await getBoardSessionAction(id);
    if ("session" in r) setActive(r.session);
    else setError(r.error);
  }

  async function scanNow() {
    if (scanning || busy) return;
    setScanning(true);
    setError("");
    setNotice("");
    const r = await scanBoardNowAction();
    setScanning(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await load();
    setNotice(
      r.created > 0
        ? `The board raised ${r.created} new alert${r.created === 1 ? "" : "s"}.`
        : "The board scanned the market — nothing material to raise right now.",
    );
  }

  async function setCadence(c: BoardCadence) {
    setSettings((s) => ({ ...s, cadence: c }));
    await setBoardCadenceAction(c);
  }

  async function dismissAlert(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    await setBoardAlertStatusAction(id, "dismissed");
  }

  async function markAllRead() {
    setAlerts((prev) => prev.map((a) => (a.status === "new" ? { ...a, status: "read" } : a)));
    await markAllBoardAlertsReadAction();
  }

  async function takeToBoard(a: BoardAlert) {
    setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "actioned" } : x)));
    void setBoardAlertStatusAction(a.id, "actioned");
    await convene(`${a.title}. ${a.detail}`.trim());
  }

  async function alertToTask(a: BoardAlert) {
    const r = await boardAlertToTaskAction(a.id);
    if (r.ok) {
      setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "actioned" } : x)));
      setNotice(`Added “${a.title}” to the Approval Center as a task.`);
    } else {
      setError(r.error ?? "Couldn't create the task.");
    }
  }

  // The founder answers the board before it rules (skip = let them rule as-is).
  async function respond(skip: boolean) {
    if (!active || busy) return;
    const text = skip ? "" : founderReply.trim();
    if (!skip && !text) return;
    setFounderReply("");
    const r = await respondToBoardAction(active.id, text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setActive(r.session);
    void drive(active.id); // resume → the verdict
  }

  async function handOff() {
    if (!active || handingOff) return;
    setHandingOff(true);
    setError("");
    const r = await handVerdictToExecutiveAction(active.id);
    setHandingOff(false);
    if (!r.ok) {
      setError(r.error ?? "Couldn't hand it off.");
      return;
    }
    setActive((s) => (s ? { ...s, project_id: r.projectId ?? s.project_id } : s));
    setNotice("Handed to the Executive — it's now a project. Track it in Projects.");
    void load();
  }

  async function deleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (active?.id === id) setActive(null);
    await deleteBoardSessionAction(id);
  }

  async function setDirective(id: string, status: "done" | "dropped") {
    setDirectives((prev) => prev.filter((d) => d.id !== id));
    await setBoardDirectiveStatusAction(id, status);
  }

  return (
    <>
      <PageHeader
        title="The Boardroom"
        description="Your standing board of VC-caliber advisors — Finance, Marketing, Product, Strategy, Technology. They deliberate, debate, and hold you accountable to one mission: $10B, as fast as possible."
        actions={
          active ? (
            <Button size="sm" variant="outline" onClick={() => setActive(null)} disabled={busy}>
              <ArrowLeft className="h-4 w-4" />
              Back to the board
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : active ? (
          <Deliberation
            session={active}
            busy={busy}
            founderReply={founderReply}
            onFounderReply={setFounderReply}
            onRespond={respond}
            onHandOff={handOff}
            handingOff={handingOff}
            onDelete={() => deleteSession(active.id)}
          />
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
            )}
            {notice && !error && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
                {notice}
              </div>
            )}

            {/* Autonomous market scan controls */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
              <Radar className="h-4 w-4 text-muted-foreground" />
              <span className="text-[12px] text-muted-foreground">Autonomous market scan:</span>
              <div className="inline-flex rounded-md border border-border p-0.5">
                {CADENCES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setCadence(c.value)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11.5px] font-medium transition-colors",
                      settings.cadence === c.value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" className="ml-auto" disabled={scanning} onClick={scanNow}>
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                {scanning ? "Scanning…" : "Scan now"}
              </Button>
            </div>

            {/* Alerts the board raised on its own */}
            {alerts.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    <Bell className="h-3.5 w-3.5" /> From the board
                    {newCount > 0 && (
                      <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {newCount} new
                      </span>
                    )}
                  </p>
                  {newCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="space-y-2.5">
                  {alerts.map((a) => (
                    <AlertCard
                      key={a.id}
                      a={a}
                      onTake={() => takeToBoard(a)}
                      onTask={() => alertToTask(a)}
                      onDismiss={() => dismissAlert(a.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Commitments the board is tracking (accountability ledger) */}
            {directives.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  <ListChecks className="h-3.5 w-3.5" /> The board is tracking
                </p>
                <Card className="divide-y divide-border p-0">
                  {directives.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          DIRECTIVE_STYLE[d.status] ?? DIRECTIVE_STYLE.open,
                        )}
                      >
                        {d.status === "in_motion" ? "In motion" : "Open"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]" title={d.title}>
                        {d.title}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => setDirective(d.id, "done")}
                          title="Mark done"
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-600"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDirective(d.id, "dropped")}
                          title="Drop"
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </Card>
              </div>
            )}

            {/* Convene */}
            <Card className="p-4">
              <p className="flex items-center gap-1.5 text-[14px] font-semibold">
                <Gavel className="h-4 w-4 text-primary" /> Convene the board
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Put a matter before them, or ask for a hard assessment. They'll debate it and deliver a verdict — even
                if it's not what you want to hear.
              </p>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                placeholder="e.g. Should we raise now, or push for another two quarters of growth first?"
                className="mt-3 text-[13px]"
              />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" disabled={convening || busy || !question.trim()} onClick={() => convene()}>
                  {convening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Convene the board
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PROMPTS.map((p) => (
                  <button
                    key={p}
                    disabled={convening || busy}
                    onClick={() => convene(p)}
                    className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Card>

            {/* Roster */}
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                Your board
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((m) => (
                  <Card key={m.id} className="p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-lg", ACCENT[m.accent] ?? ACCENT.slate)}>
                        {m.emoji}
                      </span>
                      <div>
                        <p className="text-[13.5px] font-semibold">{m.name}</p>
                        <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[m.role] ?? m.role}</p>
                      </div>
                    </div>
                    <p className="mt-2.5 line-clamp-4 text-[12px] leading-relaxed text-foreground/80">{m.mandate}</p>
                  </Card>
                ))}
              </div>
            </div>

            {/* History */}
            {sessions.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Past deliberations
                </p>
                <Card className="divide-y divide-border p-0">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="group/row flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <button
                        onClick={() => openSession(s.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
                      </button>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                          s.status === "complete"
                            ? "bg-emerald-100 text-emerald-700"
                            : s.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {s.status === "complete" ? "Verdict" : s.status === "failed" ? "Failed" : "In progress"}
                      </span>
                      <button
                        onClick={() => deleteSession(s.id)}
                        title="Delete"
                        className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover/row:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </Card>
              </div>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}

function Deliberation({
  session,
  busy,
  founderReply,
  onFounderReply,
  onRespond,
  onHandOff,
  handingOff,
  onDelete,
}: {
  session: BoardSession;
  busy: boolean;
  founderReply: string;
  onFounderReply: (v: string) => void;
  onRespond: (skip: boolean) => void;
  onHandOff: () => void;
  handingOff: boolean;
  onDelete: () => void;
}) {
  const openings = session.contributions.filter((c) => c.round === "opening");
  const rebuttals = session.contributions.filter((c) => c.round === "rebuttal");
  const stageNote = busy ? STAGE_LABEL[session.status] : "";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Matter before the board
          </p>
          <p className="mt-0.5 text-[16px] font-semibold">{session.title}</p>
        </div>
        <button
          onClick={onDelete}
          title="Delete this deliberation"
          className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {session.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          {session.error}
        </div>
      )}

      {/* Openings */}
      {(openings.length > 0 || (busy && session.status === "opening_pending")) && (
        <Section title="Opening positions">
          {openings.map((c) => (
            <Contribution key={c.id} c={c} />
          ))}
          {busy && session.status === "opening_pending" && <StageSpinner label={STAGE_LABEL.opening_pending} />}
        </Section>
      )}

      {/* Debate */}
      {(rebuttals.length > 0 || (busy && session.status === "rebuttal_pending")) && (
        <Section title="The debate">
          {rebuttals.map((c) => (
            <Contribution key={c.id} c={c} rebuttal />
          ))}
          {busy && session.status === "rebuttal_pending" && <StageSpinner label={STAGE_LABEL.rebuttal_pending} />}
        </Section>
      )}

      {/* Your response to the board (once submitted) */}
      {session.founder_input && (
        <Section title="Your response">
          <Card className="border-primary/20 bg-primary/[0.03] p-3.5">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-[14px]">🧑</span>
              <p className="text-[12.5px] font-semibold">You</p>
            </div>
            <Md className="text-[12.5px] leading-relaxed text-foreground/90">{session.founder_input}</Md>
          </Card>
        </Section>
      )}

      {/* The pause: answer the board before it rules */}
      {session.status === "awaiting_founder" && (
        <Card className="border-primary/30 bg-primary/[0.03] p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Gavel className="h-4 w-4 text-primary" /> Before the board rules — anything to add or correct?
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            The board is about to deliver its verdict. If they're working off a wrong assumption, or you have context they
            don't, tell them now — they'll weigh it (but won't just capitulate).
          </p>
          <Textarea
            value={founderReply}
            onChange={(e) => onFounderReply(e.target.value)}
            rows={3}
            placeholder="e.g. We already tried that channel — it didn't work because… / Our actual runway is 18 months, not 9…"
            className="mt-3 text-[13px]"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" disabled={busy || !founderReply.trim()} onClick={() => onRespond(false)}>
              <Send className="h-4 w-4" />
              Submit to the board
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRespond(true)}>
              Let them rule
            </Button>
          </div>
        </Card>
      )}

      {/* Verdict */}
      {busy && session.status === "verdict_pending" && (
        <Card className="border-primary/30 bg-primary/[0.03] p-4">
          <StageSpinner label={STAGE_LABEL.verdict_pending} />
        </Card>
      )}
      {session.status === "complete" && (
        <>
          <Verdict session={session} />
          <div className="flex flex-wrap items-center gap-2">
            {session.project_id ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4" /> Handed to the Executive — it's a project now.
                <Link href="/projects" className="underline underline-offset-2">
                  Open Projects
                </Link>
              </span>
            ) : (
              <Button size="sm" disabled={handingOff} onClick={onHandOff}>
                {handingOff ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                Hand to the Executive
              </Button>
            )}
          </div>
        </>
      )}

      {stageNote && session.status !== "verdict_pending" && (
        <p className="text-[11.5px] text-muted-foreground">{stageNote}</p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Contribution({ c, rebuttal }: { c: BoardSession["contributions"][number]; rebuttal?: boolean }) {
  return (
    <Card className={cn("p-3.5", rebuttal && "border-dashed")}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-[15px]">{c.member_emoji}</span>
        <div className="flex items-baseline gap-1.5">
          <p className="text-[13px] font-semibold">{c.member_name}</p>
          <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[c.member_role] ?? c.member_role}</p>
        </div>
      </div>
      <Md className="text-[12.5px] leading-relaxed text-foreground/90">{c.content}</Md>
    </Card>
  );
}

function StageSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function Verdict({ session }: { session: BoardSession }) {
  return (
    <Card className="border-primary/30 bg-primary/[0.04] p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-primary">
        <Gavel className="h-4 w-4" /> The board's verdict
      </p>
      <Md className="mt-2 text-[13.5px] leading-relaxed text-foreground">{session.verdict}</Md>

      {session.disagreements.length > 0 && (
        <div className="mt-3.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Where the board split
          </p>
          <ul className="space-y-1.5">
            {session.disagreements.map((d, i) => (
              <li key={i} className="border-l-2 border-border pl-2.5">
                <Md className="text-[12.5px] leading-relaxed text-foreground/80">{d}</Md>
              </li>
            ))}
          </ul>
        </div>
      )}

      {session.recommendations.length > 0 && (
        <div className="mt-3.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Do this next
          </p>
          <ol className="space-y-2">
            {session.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{r.title}</p>
                  {r.detail && <Md className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{r.detail}</Md>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {session.accountability && (
        <div className="mt-3.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            <Target className="h-3.5 w-3.5" /> What you must own
          </p>
          <Md className="mt-1 text-[12.5px] leading-relaxed text-amber-900">{session.accountability}</Md>
        </div>
      )}
    </Card>
  );
}

function AlertCard({
  a,
  onTake,
  onTask,
  onDismiss,
}: {
  a: BoardAlert;
  onTake: () => void;
  onTask: () => void;
  onDismiss: () => void;
}) {
  const sev = SEVERITY[a.severity] ?? SEVERITY.info;
  return (
    <Card className={cn("p-3.5", a.status === "new" && "border-l-[3px] border-l-primary")}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-[15px]">{a.member_emoji}</span>
        <div className="flex items-baseline gap-1.5">
          <p className="text-[12.5px] font-semibold">{a.member_name}</p>
          <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[a.member_role] ?? a.member_role}</p>
        </div>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", sev.chip)}>
          {sev.label}
        </span>
      </div>
      <p className="text-[13.5px] font-semibold">{a.title}</p>
      {a.detail && <Md className="mt-0.5 text-[12.5px] leading-relaxed text-foreground/85">{a.detail}</Md>}
      {a.suggested_action && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground/70">Suggested:</span> {a.suggested_action}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onTask}>
          <Plus className="h-4 w-4" /> Create a task
        </Button>
        <Button size="sm" variant="outline" onClick={onTake}>
          <Gavel className="h-4 w-4" /> Take it to the board
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          <X className="h-4 w-4" /> Dismiss
        </Button>
      </div>
    </Card>
  );
}
