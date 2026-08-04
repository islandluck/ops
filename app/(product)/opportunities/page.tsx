"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  MapPin,
  Presentation,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  X,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import {
  draftGrantPlanAction,
  getOpportunitiesAction,
  saveOpportunityLocationAction,
  saveOpportunityScannerAction,
  scanOpportunitiesNowAction,
  setOpportunityStatusAction,
  type OpportunitiesView,
} from "@/app/actions";
import type {
  Opportunity,
  OpportunityScanner,
  OpportunityType,
  ScannerCadence,
  ScannerMode,
  ScannerScope,
} from "@/lib/types";

/* ------------------------------ type meta ------------------------------- */

const TYPES: {
  type: OpportunityType;
  label: string;
  icon: typeof Landmark;
  blurb: string;
  ready: boolean;
}[] = [
  { type: "grant", label: "Grants", icon: Landmark, blurb: "Federal, state & foundation grants your company can win.", ready: true },
  { type: "conference", label: "Conferences", icon: Presentation, blurb: "Industry conferences & expos for exposure and connections.", ready: true },
  { type: "event", label: "Events", icon: CalendarDays, blurb: "Local events that put your business in front of the right people.", ready: true },
  { type: "competition", label: "Awards", icon: Trophy, blurb: "Pitch & essay competitions worth entering.", ready: false },
];

const CADENCE_OPTS: SegmentedOption<ScannerCadence>[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
];
const MODE_OPTS: SegmentedOption<ScannerMode>[] = [
  { value: "scan", label: "Scan only" },
  { value: "scan_draft", label: "Scan + draft" },
  { value: "approve", label: "Manual" },
];
const SCOPE_OPTS: SegmentedOption<ScannerScope>[] = [
  { value: "local", label: "Local" },
  { value: "state", label: "State" },
  { value: "national", label: "National" },
];

const MODE_HELP: Record<ScannerMode, string> = {
  scan: "Automatically finds and ranks matches on your schedule. You choose what to do with each one.",
  scan_draft: "Also auto-prepares an application plan for the single best new grant — ready for your review.",
  approve: "Nothing runs on its own. You press “Scan now” yourself, whenever you want.",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/* -------------------------------- page ---------------------------------- */

export default function OpportunitiesPage() {
  const [view, setView] = useState<OpportunitiesView | null>(null);
  const [active, setActive] = useState<OpportunityType>("grant");

  const load = useCallback(async () => {
    setView(await getOpportunitiesAction());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scanners = view?.scanners ?? [];
  const scanner = useMemo(() => scanners.find((s) => s.type === active) ?? null, [scanners, active]);
  const meta = TYPES.find((t) => t.type === active)!;
  const items = useMemo(
    () => (view?.opportunities ?? []).filter((o) => o.type === active),
    [view, active],
  );

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="The platform scans the web for opportunities that fit your company — and ranks them by how well they match."
        actions={
          <Link href="/projects" className="inline-flex">
            <Button size="sm" variant="outline">
              <FileText className="h-4 w-4" /> Projects
            </Button>
          </Link>
        }
      />
      <PageBody className="space-y-6">
        <TypeTabs active={active} onPick={setActive} />

        {!view ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : meta.ready ? (
          <>
            <ScannerConfig
              key={active}
              type={active}
              scanner={scanner}
              location={view.location}
              onChanged={load}
            />
            <Results type={active} items={items} onChanged={load} />
          </>
        ) : (
          <ComingSoon meta={meta} />
        )}
      </PageBody>
    </>
  );
}

/* ------------------------------- type tabs ------------------------------ */

function TypeTabs({ active, onPick }: { active: OpportunityType; onPick: (t: OpportunityType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TYPES.map((t) => {
        const on = t.type === active;
        return (
          <button
            key={t.type}
            onClick={() => onPick(t.type)}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
              on ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:bg-accent/50",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                {t.label}
                {!t.ready && (
                  <span className="rounded bg-muted px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Soon
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{t.blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- config panel ----------------------------- */

function ScannerConfig({
  type,
  scanner,
  location,
  onChanged,
}: {
  type: OpportunityType;
  scanner: OpportunityScanner | null;
  location: { city: string; state: string; country: string };
  onChanged: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string>("");

  // Defaults mirror the DB defaults so the panel is usable before the first save.
  const enabled = scanner?.enabled ?? false;
  const cadence = scanner?.cadence ?? "weekly";
  const mode = scanner?.mode ?? "scan";
  const scope = scanner?.scope ?? "state";
  const status = scanner?.status ?? "idle";
  const busy = scanning || status === "scanning";
  const meta = TYPES.find((t) => t.type === type) ?? TYPES[0];
  // Auto-draft (scan+draft) only applies to grants; other types get scan / manual.
  const modeOpts = type === "grant" ? MODE_OPTS : MODE_OPTS.filter((o) => o.value !== "scan_draft");

  const patch = useCallback(
    async (p: Parameters<typeof saveOpportunityScannerAction>[1]) => {
      setSaving(true);
      await saveOpportunityScannerAction(type, p);
      await onChanged();
      setSaving(false);
    },
    [type, onChanged],
  );

  async function scanNow() {
    if (busy) return;
    setScanning(true);
    setNote("");
    const res = await scanOpportunitiesNowAction(type);
    await onChanged();
    setScanning(false);
    if (!res.ok) setNote(res.error ?? "Scan failed.");
    else if (res.found === 0) setNote("No new matches this time — everything found was already on your list.");
    else setNote(`Found ${res.found} new ${res.found === 1 ? "match" : "matches"}.`);
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
            <meta.icon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">{meta.label} scanner</h2>
            <p className="text-[12px] text-muted-foreground">Set how it runs, then let it work — or scan on demand.</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {note && <span className="text-[12px] text-muted-foreground">{note}</span>}
          <Button size="sm" onClick={scanNow} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {busy ? "Scanning…" : "Scan now"}
          </Button>
        </div>
      </div>

      {/* Autonomy */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Autonomy">
          <Segmented options={modeOpts} value={mode} onChange={(m) => patch({ mode: m })} size="sm" />
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{MODE_HELP[mode]}</p>
        </Field>

        <Field label="Schedule">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={enabled}
              disabled={mode === "approve"}
              onCheckedChange={(v) => patch({ enabled: v })}
              label="Scan automatically"
            />
            <span className="text-[13px] text-foreground/80">
              {mode === "approve" ? "Manual — runs only when you scan" : enabled ? "Scanning automatically" : "Off"}
            </span>
          </div>
          {mode !== "approve" && (
            <div className={cn("mt-2 transition-opacity", enabled ? "opacity-100" : "pointer-events-none opacity-40")}>
              <Segmented options={CADENCE_OPTS} value={cadence} onChange={(c) => patch({ cadence: c })} size="sm" />
            </div>
          )}
        </Field>

        <Field label="Where to look">
          <Segmented options={SCOPE_OPTS} value={scope} onChange={(s) => patch({ scope: s })} size="sm" />
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
            National scans federal grants (grants.gov). State &amp; Local also search the web for programs near you.
          </p>
        </Field>

        <LocationEditor location={location} onSaved={onChanged} />
      </div>

      {/* Safety note — the invariant the whole feature is built on. */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200/70 bg-emerald-50/60 px-3 py-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-[12px] leading-snug text-emerald-900/80">
          The platform only ever <span className="font-semibold">surfaces</span> opportunities and prepares drafts for your
          review. It never submits an application, registers, or pays for anything on its own — the final step is always yours.
        </p>
      </div>

      {/* Status line */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
        {status === "failed" && scanner?.last_error ? (
          <span className="inline-flex items-center gap-1 text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {scanner.last_error.slice(0, 90)}
          </span>
        ) : (
          <>
            <span>Last scan: {scanner?.last_run_at ? fmtDate(scanner.last_run_at) : "never"}</span>
            {mode !== "approve" && enabled && scanner?.next_run_at && <span>Next: {fmtDate(scanner.next_run_at)}</span>}
          </>
        )}
        {scanner && scanner.usage.runs > 0 && (
          <span className="ml-auto tabular-nums">
            {scanner.usage.runs} run{scanner.usage.runs === 1 ? "" : "s"} · {scanner.usage.searches} searches
            {scanner.usage.est_cost_cents > 0 ? ` · ~$${(scanner.usage.est_cost_cents / 100).toFixed(2)}` : ""}
          </span>
        )}
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function LocationEditor({
  location,
  onSaved,
}: {
  location: { city: string; state: string; country: string };
  onSaved: () => Promise<void>;
}) {
  const [city, setCity] = useState(location.city);
  const [state, setState] = useState(location.state);
  const [country, setCountry] = useState(location.country);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = city !== location.city || state !== location.state || country !== location.country;

  async function save() {
    setSaving(true);
    setSaved(false);
    await saveOpportunityLocationAction({ city, state, country });
    await onSaved();
    setSaving(false);
    setSaved(true);
  }

  return (
    <Field label="Company location">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setSaved(false);
            }}
            placeholder="City"
            className="h-8 w-28 pl-7 text-[13px]"
          />
        </div>
        <Input
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setSaved(false);
          }}
          placeholder="State"
          className="h-8 w-20 text-[13px]"
        />
        <Input
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setSaved(false);
          }}
          placeholder="Country"
          className="h-8 w-24 text-[13px]"
        />
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved && !dirty ? "Saved" : "Save"}
        </Button>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">Helps find programs you're geographically eligible for.</p>
    </Field>
  );
}

/* ------------------------------- results -------------------------------- */

function Results({
  type,
  items,
  onChanged,
}: {
  type: OpportunityType;
  items: Opportunity[];
  onChanged: () => Promise<void>;
}) {
  const shortlisted = items.filter((o) => o.status === "shortlisted" || o.status === "drafted");
  const fresh = items.filter((o) => o.status === "new");

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-[14px] font-medium">No opportunities yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted-foreground">
          Press <span className="font-medium text-foreground">Scan now</span> to have the platform search the web for grants
          that fit your company. The first scan takes a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {shortlisted.length > 0 && (
        <ResultGroup title="Shortlisted" count={shortlisted.length}>
          {shortlisted.map((o) => (
            <OpportunityCard key={o.id} opp={o} onChanged={onChanged} />
          ))}
        </ResultGroup>
      )}
      <ResultGroup title={shortlisted.length > 0 ? "Found" : `${items.length} found`} count={fresh.length}>
        {fresh.map((o) => (
          <OpportunityCard key={o.id} opp={o} onChanged={onChanged} />
        ))}
        {fresh.length === 0 && (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            Everything found has been shortlisted or dismissed.
          </p>
        )}
      </ResultGroup>
    </div>
  );
}

function ResultGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {count > 0 && <span className="ml-1.5 tabular-nums text-muted-foreground/70">{count}</span>}
      </p>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function fitTone(score: number): string {
  if (score >= 80) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (score >= 60) return "bg-sky-50 text-sky-700 ring-sky-600/20";
  if (score >= 40) return "bg-amber-50 text-amber-700 ring-amber-600/20";
  return "bg-muted text-muted-foreground ring-border";
}

function OpportunityCard({ opp, onChanged }: { opp: Opportunity; onChanged: () => Promise<void> }) {
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const dismissed = opp.status === "dismissed";

  async function setStatus(status: Opportunity["status"]) {
    setBusy(true);
    await setOpportunityStatusAction(opp.id, status);
    await onChanged();
    setBusy(false);
  }

  async function draft() {
    if (drafting || opp.project_id) return;
    setDrafting(true);
    await draftGrantPlanAction(opp.id);
    await onChanged();
    setDrafting(false);
  }

  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-4 transition-colors",
        opp.status === "shortlisted" || opp.status === "drafted" ? "border-l-2 border-l-emerald-500" : "",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-1.5 text-[13px] font-bold tabular-nums ring-1 ring-inset",
            fitTone(opp.fit_score),
          )}
          title="Fit score"
        >
          {opp.fit_score}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-[14px] font-semibold leading-snug">{opp.title}</h3>
            {opp.project_id && (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                Plan drafted
              </span>
            )}
          </div>
          {opp.org && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{opp.org}</p>}

          {opp.summary && <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85">{opp.summary}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            {opp.amount && (
              <span className="inline-flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" /> {opp.amount}
              </span>
            )}
            {opp.deadline && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {opp.deadline}
              </span>
            )}
            {opp.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {opp.location}
              </span>
            )}
          </div>

          {opp.fit_rationale && (
            <p className="mt-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-[12px] leading-snug text-foreground/75">
              <span className="font-medium text-foreground/90">Why it fits: </span>
              {opp.fit_rationale}
            </p>
          )}

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {/* Grants can be turned into a draft application project; conferences
                and events are surfaced to shortlist and open (register yourself). */}
            {opp.type === "grant" &&
              (opp.project_id ? (
                <Link href="/projects" className="inline-flex">
                  <Button size="sm" variant="secondary">
                    <FileText className="h-3.5 w-3.5" /> View plan
                  </Button>
                </Link>
              ) : (
                <Button size="sm" variant="primary" onClick={draft} disabled={drafting}>
                  {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                  {drafting ? "Drafting…" : "Draft application plan"}
                </Button>
              ))}

            {opp.status !== "shortlisted" && opp.status !== "drafted" && (
              <Button size="sm" variant="outline" onClick={() => setStatus("shortlisted")} disabled={busy}>
                <Check className="h-3.5 w-3.5" /> Shortlist
              </Button>
            )}

            {opp.url && (
              <a href={opp.url} target="_blank" rel="noopener noreferrer" className="inline-flex">
                <Button size="sm" variant="ghost">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </Button>
              </a>
            )}

            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-muted-foreground"
              onClick={() => setStatus(dismissed ? "new" : "dismissed")}
              disabled={busy}
              title={dismissed ? "Restore" : "Dismiss"}
            >
              <X className="h-3.5 w-3.5" /> {dismissed ? "Restore" : "Dismiss"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------ coming soon ----------------------------- */

function ComingSoon({ meta }: { meta: (typeof TYPES)[number] }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <meta.icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-[15px] font-semibold">{meta.label} scanner is coming soon</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
        {meta.blurb} It works just like the Grants scanner — set a schedule and autonomy level, and the platform surfaces
        the best matches for your review. Grants are live first.
      </p>
    </div>
  );
}
