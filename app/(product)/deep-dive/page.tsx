"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Compass,
  FileText,
  Lightbulb,
  Loader2,
  Sparkles,
  Telescope,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  getCompanyContextAction,
  listDeepDivesAction,
  pokeDeepDiveAction,
  startDeepDiveAction,
} from "@/app/actions";
import type { CompanyContext, ContextItem, ContextPerson, ContextTimelineEntry, DeepDive } from "@/lib/types";

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

export default function DeepDivePage() {
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
    <>
      <PageHeader
        title="Deep Dive"
        description="Feed the platform your company's own material — it reads everything, connects the dots, and briefs every agent."
        actions={
          <Link href="/executive" className="inline-flex">
            <Button size="sm" variant="outline">
              <Compass className="h-4 w-4" /> Executive Office
            </Button>
          </Link>
        }
      />
      <PageBody className="space-y-6">
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
      </PageBody>
    </>
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

function ProgressCard({ dive }: { dive: DeepDive }) {
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
        Reading your material and connecting the dots. You can leave this page — it keeps running in the background.
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
