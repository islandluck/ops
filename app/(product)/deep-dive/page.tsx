"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Clock,
  Compass,
  FileText,
  Lightbulb,
  Loader2,
  Play,
  Sparkles,
  Telescope,
  TrendingUp,
  Upload,
  Users,
  X,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  approveReviewActionAction,
  dismissReviewActionAction,
  getCompanyContextAction,
  getReviewStateAction,
  listDeepDivesAction,
  pokeDeepDiveAction,
  setDeepDiveCadenceAction,
  startDeepDiveAction,
  startReviewAction,
} from "@/app/actions";
import type {
  CompanyContext,
  ContextItem,
  ContextPerson,
  ContextTimelineEntry,
  DeepDive,
  DeepDiveCadence,
  OperatingReview,
  ReviewAction,
} from "@/lib/types";

const ACTIVE: DeepDive["status"][] = ["queued", "collecting", "distilling", "synthesizing"];
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv";

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

type DeepDiveTab = "reviews" | "context";

export default function DeepDivePage() {
  const [tab, setTab] = useState<DeepDiveTab>("reviews");
  return (
    <>
      <PageHeader
        title="Deep Dive"
        description={
          tab === "reviews"
            ? "Your weekly cofounder review of the whole business — what's working, what's slipping, what you're missing, and the moves to make."
            : "Feed the platform your company's own material — it reads everything, connects the dots, and briefs every agent."
        }
        actions={
          <Link href="/executive" className="inline-flex">
            <Button size="sm" variant="outline">
              <Compass className="h-4 w-4" /> Executive Office
            </Button>
          </Link>
        }
      />
      <PageBody className="space-y-6">
        <TabBar tab={tab} setTab={setTab} />
        {tab === "reviews" ? <ReviewsTab /> : <ContextTab />}
      </PageBody>
    </>
  );
}

function TabBar({ tab, setTab }: { tab: DeepDiveTab; setTab: (t: DeepDiveTab) => void }) {
  const base = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition";
  return (
    <div className="inline-flex gap-1 rounded-xl border border-border bg-card p-1">
      <button
        type="button"
        onClick={() => setTab("reviews")}
        className={cn(base, tab === "reviews" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
      >
        <Telescope className="h-4 w-4" /> Reviews
      </button>
      <button
        type="button"
        onClick={() => setTab("context")}
        className={cn(base, tab === "context" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
      >
        <FileText className="h-4 w-4" /> Context
      </button>
    </div>
  );
}

/* =============================== Context tab ============================= */

function ContextTab() {
  const [dives, setDives] = useState<DeepDive[]>([]);
  const [context, setContext] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);

  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [ds, ctx] = await Promise.all([listDeepDivesAction(), getCompanyContextAction()]);
    setDives(ds);
    setContext(ctx);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = dives.find((d) => ACTIVE.includes(d.status)) ?? null;
  const activeId = active?.id ?? null;

  // While a run is active, drive it forward and poll for progress (works without cron).
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await pokeDeepDiveAction();
      } catch {
        /* ignore — will retry */
      }
      if (!alive) return;
      const [ds, ctx] = await Promise.all([listDeepDivesAction(), getCompanyContextAction()]);
      if (!alive) return;
      setDives(ds);
      setContext(ctx);
      if (alive) timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 700);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activeId]);

  async function start() {
    if (starting) return;
    setStarting(true);
    setError("");
    const fd = new FormData();
    if (title.trim()) fd.append("title", title.trim());
    if (pasted.trim()) fd.append("text", pasted.trim());
    files.forEach((f) => fd.append("files", f));
    const res = await startDeepDiveAction(fd);
    setStarting(false);
    if (res.ok) {
      setFiles([]);
      setPasted("");
      setTitle("");
      await load();
    } else {
      setError(res.error ?? "Couldn't start the Deep Dive.");
    }
  }

  const canStart = (files.length > 0 || pasted.trim().length > 0) && !starting && !active;

  return (
    <div className="space-y-6">
      {active && <ProgressCard dive={active} />}

      <Composer
        files={files}
        setFiles={setFiles}
        pasted={pasted}
        setPasted={setPasted}
        title={title}
        setTitle={setTitle}
        onStart={start}
        canStart={canStart}
        starting={starting}
        blocked={Boolean(active)}
        error={error}
      />

      {context && <ContextPackView context={context} />}

      {!loading && <History dives={dives} />}
    </div>
  );
}

/* =============================== Reviews tab ============================= */

interface ReviewState {
  latestRun: DeepDive | null;
  reviews: OperatingReview[];
  cadence: DeepDiveCadence;
}

function ReviewsTab() {
  const [state, setState] = useState<ReviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await getReviewStateAction();
    setState(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = state?.latestRun ?? null;
  const active = run && ACTIVE.includes(run.status) ? run : null;
  const activeId = active?.id ?? null;

  // While a review is generating, drive it forward and poll (works without cron).
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await pokeDeepDiveAction();
      } catch {
        /* ignore — will retry */
      }
      if (!alive) return;
      const s = await getReviewStateAction();
      if (!alive) return;
      setState(s);
      if (alive) timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activeId]);

  async function runNow() {
    if (running || active) return;
    setRunning(true);
    setErr("");
    const res = await startReviewAction();
    setRunning(false);
    if (!res.ok) setErr(res.error ?? "Couldn't start the review.");
    await load();
  }

  async function changeCadence(c: DeepDiveCadence) {
    setState((s) => (s ? { ...s, cadence: c } : s));
    await setDeepDiveCadenceAction(c);
  }

  async function act(reviewId: string, actionId: string, kind: "approve" | "dismiss") {
    setBusyAction(actionId);
    try {
      if (kind === "approve") await approveReviewActionAction(reviewId, actionId);
      else await dismissReviewActionAction(reviewId, actionId);
      await load();
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-5 py-8 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your reviews…
      </div>
    );
  }

  const reviews = state?.reviews ?? [];
  const selected = reviews.find((r) => r.id === selectedId) ?? reviews[0] ?? null;

  return (
    <div className="space-y-6">
      <ReviewControls
        cadence={state?.cadence ?? "off"}
        onCadence={changeCadence}
        onRun={runNow}
        running={running}
        blocked={Boolean(active)}
        error={err}
      />
      {active && (
        <ProgressCard dive={active} note="Reading your week across email, projects, goals, and opportunities — connecting the dots." />
      )}
      {!selected && !active && <EmptyReviews />}
      {selected && <ReviewView review={selected} onAct={act} busyAction={busyAction} />}
      {reviews.length > 1 && (
        <ReviewArchive reviews={reviews} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      )}
    </div>
  );
}

function ReviewControls({
  cadence,
  onCadence,
  onRun,
  running,
  blocked,
  error,
}: {
  cadence: DeepDiveCadence;
  onCadence: (c: DeepDiveCadence) => void;
  onRun: () => void;
  running: boolean;
  blocked: boolean;
  error: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
          <Telescope className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Operating Review</h2>
          <p className="text-[12.5px] text-muted-foreground">
            A weekly read on the whole business, with moves your agents can take once you approve them.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["off", "weekly"] as DeepDiveCadence[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onCadence(c)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] font-medium capitalize transition",
                    cadence === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <Button size="sm" onClick={onRun} disabled={running || blocked}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Starting…" : "Run review now"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      {blocked && !error && (
        <p className="mt-2 text-[12px] text-muted-foreground">A review is already running — it'll appear here shortly.</p>
      )}
    </section>
  );
}

function EmptyReviews() {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <Telescope className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-[14px] font-medium">No reviews yet</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">
        Run your first Operating Review for an honest read on where the business stands — what's working, what's slipping,
        and the highest-leverage moves this week. Turn on <span className="font-medium">Weekly</span> to get one
        automatically.
      </p>
    </section>
  );
}

const KIND_LABEL: Record<ReviewAction["kind"], string> = {
  email: "Email",
  project: "Project",
  outreach: "Outreach",
  crm: "CRM",
  task: "Task",
  meeting: "Meeting",
};
const LEVEL_CLS: Record<string, string> = {
  high: "text-rose-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
};

function ReviewView({
  review,
  onAct,
  busyAction,
}: {
  review: OperatingReview;
  onAct: (reviewId: string, actionId: string, kind: "approve" | "dismiss") => void;
  busyAction: string | null;
}) {
  const c = review.content;
  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            Review v{review.version}
          </span>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">{fmtDate(review.created_at)}</span>
        </div>
        {c.headline && (
          <p className="mt-2 text-balance text-[15px] font-medium leading-relaxed text-foreground/90">{c.headline}</p>
        )}
      </div>

      {c.moved.length > 0 && (
        <PackBlock title="What moved" icon={<TrendingUp className="h-3.5 w-3.5" />} accent="text-sky-600">
          <ul className="space-y-1">
            {c.moved.map((m, i) => (
              <li key={i} className="text-[13px] leading-snug">
                • {m}
              </li>
            ))}
          </ul>
        </PackBlock>
      )}

      {c.kpi_read && (
        <PackBlock title="The numbers" icon={<Sparkles className="h-3.5 w-3.5" />} accent="text-violet-600">
          <p className="text-[13px] leading-relaxed text-foreground/90">{c.kpi_read}</p>
        </PackBlock>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {c.risks.length > 0 && (
          <PackBlock title="Risks" icon={<AlertTriangle className="h-3.5 w-3.5" />} accent="text-rose-600">
            <ItemList items={c.risks} />
          </PackBlock>
        )}
        {c.opportunities.length > 0 && (
          <PackBlock title="Missed & worth a look" icon={<Lightbulb className="h-3.5 w-3.5" />} accent="text-amber-600">
            <ItemList items={c.opportunities} />
          </PackBlock>
        )}
      </div>

      {c.actions.length > 0 && (
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Proposed actions
          </p>
          <div className="space-y-2.5">
            {c.actions.map((a) => (
              <ActionRow key={a.id} reviewId={review.id} action={a} onAct={onAct} busy={busyAction === a.id} />
            ))}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Approving stages the action for you — a drafted email, a new project, or a task in your Approval Center.
            Nothing is sent or executed until you say so.
          </p>
        </div>
      )}
    </section>
  );
}

function ActionRow({
  reviewId,
  action,
  onAct,
  busy,
}: {
  reviewId: string;
  action: ReviewAction;
  onAct: (reviewId: string, actionId: string, kind: "approve" | "dismiss") => void;
  busy: boolean;
}) {
  const a = action;
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        a.status === "accepted"
          ? "border-emerald-200 bg-emerald-50/40"
          : a.status === "dismissed"
            ? "border-border bg-muted/30 opacity-70"
            : "border-border bg-background",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-accent px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[a.kind]}
        </span>
        <p className="min-w-0 flex-1 text-[13.5px] font-medium">{a.title}</p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          <span className={LEVEL_CLS[a.impact]}>{a.impact} impact</span> · {a.effort} effort
          {a.reversible ? "" : " · hard to undo"}
        </span>
      </div>
      {a.rationale && <p className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">{a.rationale}</p>}
      {a.goal && (
        <p className="mt-1 text-[12px] leading-snug text-foreground/70">
          <span className="text-muted-foreground">→ </span>
          {a.goal}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        {a.status === "proposed" ? (
          <>
            <Button size="sm" onClick={() => onAct(reviewId, a.id, "approve")} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAct(reviewId, a.id, "dismiss")} disabled={busy}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </>
        ) : a.status === "accepted" ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Approved
            {a.ref_href && (
              <Link href={a.ref_href} className="inline-flex items-center gap-0.5 text-primary hover:underline">
                View <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </span>
        ) : (
          <span className="text-[12px] font-medium text-muted-foreground">Dismissed</span>
        )}
      </div>
    </div>
  );
}

function ReviewArchive({
  reviews,
  selectedId,
  onSelect,
}: {
  reviews: OperatingReview[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Past reviews</p>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {reviews.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent/40",
              r.id === selectedId && "bg-accent/40",
            )}
          >
            <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-indigo-700">
              v{r.version}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{r.content.headline || "Operating Review"}</span>
            <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{fmtDate(r.created_at)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------- composer ------------------------------- */

function Composer({
  files,
  setFiles,
  pasted,
  setPasted,
  title,
  setTitle,
  onStart,
  canStart,
  starting,
  blocked,
  error,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  pasted: string;
  setPasted: (s: string) => void;
  title: string;
  setTitle: (s: string) => void;
  onStart: () => void;
  canStart: boolean;
  starting: boolean;
  blocked: boolean;
  error: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const byName = new Map(files.map((f) => [f.name + f.size, f]));
    incoming.forEach((f) => byName.set(f.name + f.size, f));
    setFiles(Array.from(byName.values()).slice(0, 25));
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
          <Telescope className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold">Start a Deep Dive</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Docs, notes, memos, decks (as text) — anything that captures where the company is. Runs in the background.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-7 text-center transition",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-accent/40",
          )}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-[13px] font-medium">Drop files here, or click to choose</p>
          <p className="text-[11.5px] text-muted-foreground">PDF, Word (.docx), or text/markdown · up to 25 files, 20 MB each</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span
                key={f.name + f.size}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-background py-1 pl-2 pr-1 text-[12px]"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <Textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="…or paste notes, context, or a brain-dump about the company here."
          className="min-h-[96px]"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional label (e.g. Q2 board deck + notes)"
            className="h-9 max-w-xs flex-1"
          />
          <div className="ml-auto flex items-center gap-2">
            {error && <span className="text-[12px] text-destructive">{error}</span>}
            <Button size="sm" onClick={onStart} disabled={!canStart}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {starting ? "Starting…" : "Start Deep Dive"}
            </Button>
          </div>
        </div>
        {blocked && (
          <p className="text-[12px] text-muted-foreground">A Deep Dive is already running — it'll finish shortly.</p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------- progress ------------------------------- */

function ProgressCard({ dive, note }: { dive: DeepDive; note?: string }) {
  const { done, total } = dive.progress;
  const pct =
    dive.status === "synthesizing" ? 92 : total > 0 ? Math.min(90, Math.round((done / total) * 90)) : 8;
  return (
    <section className="rounded-2xl border border-sky-200/70 bg-gradient-to-b from-sky-50/70 to-transparent p-5">
      <div className="flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
        <p className="text-[14px] font-semibold">{dive.title}</p>
        <span className="ml-auto text-[12.5px] font-medium text-sky-700">{dive.stage_detail || "Working…"}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sky-100">
        <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {note ?? "Reading your material and connecting the dots."} You can leave this page — it keeps running in the
        background.
      </p>
    </section>
  );
}

/* ----------------------------- context pack ----------------------------- */

function ContextPackView({ context }: { context: CompanyContext }) {
  const p = context.pack;
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">What the platform understands</h2>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
          v{context.version}
        </span>
        <Link
          href="/executive"
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
        >
          Ask the Executive <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {context.summary && (
        <p className="mt-3 text-balance text-[14px] leading-relaxed text-foreground/90">{context.summary}</p>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {p.people.length > 0 && (
          <PackBlock title="People" icon={<Users className="h-3.5 w-3.5" />} accent="text-sky-600">
            <ul className="space-y-1.5">
              {p.people.map((person, i) => (
                <PersonRow key={i} person={person} />
              ))}
            </ul>
          </PackBlock>
        )}
        {p.timeline.length > 0 && (
          <PackBlock title="Timeline" icon={<Clock className="h-3.5 w-3.5" />} accent="text-indigo-600">
            <ul className="space-y-1.5">
              {p.timeline.map((t, i) => (
                <TimelineRow key={i} entry={t} />
              ))}
            </ul>
          </PackBlock>
        )}
        {p.themes.length > 0 && (
          <PackBlock title="Themes" icon={<Sparkles className="h-3.5 w-3.5" />} accent="text-violet-600">
            <ItemList items={p.themes} />
          </PackBlock>
        )}
        {p.decisions.length > 0 && (
          <PackBlock title="Decisions" icon={<CheckCircle2 className="h-3.5 w-3.5" />} accent="text-emerald-600">
            <ItemList items={p.decisions} />
          </PackBlock>
        )}
        {p.open_threads.length > 0 && (
          <PackBlock title="Open threads" icon={<Lightbulb className="h-3.5 w-3.5" />} accent="text-amber-600">
            <ItemList items={p.open_threads} />
          </PackBlock>
        )}
        {p.risks.length > 0 && (
          <PackBlock title="Risks" icon={<AlertTriangle className="h-3.5 w-3.5" />} accent="text-rose-600">
            <ItemList items={p.risks} />
          </PackBlock>
        )}
        {p.products.length > 0 && (
          <PackBlock title="Products" icon={<Boxes className="h-3.5 w-3.5" />} accent="text-cyan-600">
            <ItemList items={p.products} />
          </PackBlock>
        )}
      </div>

      <p className="mt-5 border-t border-border pt-3 text-[12px] text-muted-foreground">
        The Executive has also stored key facts in its memory. Run another Deep Dive anytime to build on this.
      </p>
    </section>
  );
}

function PackBlock({
  title,
  icon,
  accent,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={cn("mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", accent)}>
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

function PersonRow({ person }: { person: ContextPerson }) {
  return (
    <li className="text-[13px] leading-snug">
      <span className="font-medium">{person.name}</span>
      {person.role && <span className="text-muted-foreground"> — {person.role}</span>}
      {person.note && <span className="block text-[12px] text-muted-foreground">{person.note}</span>}
    </li>
  );
}

function TimelineRow({ entry }: { entry: ContextTimelineEntry }) {
  return (
    <li className="flex gap-2 text-[13px] leading-snug">
      {entry.when && <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{entry.when}</span>}
      <span>{entry.what}</span>
    </li>
  );
}

function ItemList({ items }: { items: ContextItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="text-[13px] leading-snug">
          <span className="font-medium">{it.title}</span>
          {it.detail && <span className="block text-[12px] text-muted-foreground">{it.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------- history ------------------------------- */

const STATUS_PILL: Record<DeepDive["status"], { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-muted text-muted-foreground" },
  collecting: { label: "Reading", cls: "bg-sky-50 text-sky-700" },
  distilling: { label: "Reading", cls: "bg-sky-50 text-sky-700" },
  synthesizing: { label: "Synthesizing", cls: "bg-indigo-50 text-indigo-700" },
  wiring: { label: "Finishing", cls: "bg-indigo-50 text-indigo-700" },
  complete: { label: "Complete", cls: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-rose-50 text-rose-700" },
};

function History({ dives }: { dives: DeepDive[] }) {
  if (!dives.length) return null;
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">History</p>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {dives.map((d) => {
          const pill = STATUS_PILL[d.status];
          const cost = d.usage.est_cost_cents;
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", pill.cls)}>
                {pill.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.title}</span>
              {d.error && d.status === "failed" && (
                <span className="text-[11.5px] text-rose-600" title={d.error}>
                  {d.error.length > 60 ? d.error.slice(0, 60) + "…" : d.error}
                </span>
              )}
              <span className="text-[11.5px] tabular-nums text-muted-foreground">
                {d.progress.total} source{d.progress.total === 1 ? "" : "s"}
                {d.usage.calls > 0 && cost > 0 ? ` · ~$${(cost / 100).toFixed(2)}` : ""}
              </span>
              <span className="text-[11.5px] tabular-nums text-muted-foreground">{fmtDate(d.created_at)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
