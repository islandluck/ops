"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgePercent,
  Clock,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  addSourcingSourceAction,
  deleteSourcingRequestAction,
  deleteSourcingSourceAction,
  getSourcingRequestAction,
  listSourcingRequestsAction,
  listSourcingSourcesAction,
  runSourcingAction,
  updateSourcingSourceAction,
} from "@/app/actions";
import type { SourcingPick, SourcingRequest, SourcingSource, SourcingTrust } from "@/lib/types";

const TRUST: Record<SourcingTrust, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  reputable: { label: "Reputable seller", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: ShieldCheck },
  caution: { label: "Use caution", cls: "border-amber-200 bg-amber-50 text-amber-700", Icon: ShieldAlert },
  unknown: { label: "Unverified seller", cls: "border-slate-200 bg-slate-50 text-slate-600", Icon: ShieldQuestion },
};

const LOADING_MSGS = [
  "Searching reputable retailers…",
  "Checking your preferred avenues…",
  "Opening listings to confirm prices + shipping…",
  "Weighing price, delivery speed, and seller safety…",
  "Picking the best overall value…",
];

export default function SourcingPage() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [current, setCurrent] = useState<SourcingRequest | null>(null);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<SourcingSource[]>([]);
  const [recent, setRecent] = useState<SourcingRequest[]>([]);

  const loadSide = useCallback(async () => {
    const [s, r] = await Promise.all([listSourcingSourcesAction(), listSourcingRequestsAction()]);
    setSources(s);
    setRecent(r);
  }, []);

  useEffect(() => {
    void loadSide();
  }, [loadSide]);

  // Deep link: /sourcing?open=<id> opens a specific past result (e.g. from the
  // Executive's source_product tool). Read on the client to avoid a Suspense boundary.
  useEffect(() => {
    const openId = new URLSearchParams(window.location.search).get("open");
    if (!openId) return;
    void (async () => {
      const req = await getSourcingRequestAction(openId);
      if (req) {
        setCurrent(req);
        setError(req.status === "failed" ? req.error || "The search failed." : "");
      }
    })();
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % LOADING_MSGS.length), 2600);
    return () => clearInterval(t);
  }, [busy]);

  async function run() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    setCurrent(null);
    setMsgIdx(0);
    const res = await runSourcingAction(q);
    setBusy(false);
    if (res.ok && res.request) {
      setCurrent(res.request);
      if (res.request.status === "failed") setError(res.request.error || "The search failed.");
      await loadSide();
    } else {
      setError(res.error ?? "Couldn't run the search.");
    }
  }

  return (
    <>
      <PageHeader
        title="Sourcing"
        description="Tell your purchasing manager what you need. It shops reputable sellers and your preferred avenues, opens the listings, and recommends the best buy — price, shipping, and seller safety weighed. It never buys; you do."
      />
      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-5">
            <Card className="p-4">
              <label className="text-[13px] font-medium">Source me…</label>
              <div className="mt-2 flex gap-2">
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void run();
                  }}
                  placeholder="e.g. a 2-slice stainless toaster under $40, fast shipping"
                  disabled={busy}
                />
                <Button onClick={run} disabled={busy || !query.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {busy ? "Sourcing…" : "Source it"}
                </Button>
              </div>
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                Describe what you want and any constraints — budget, condition (new/used), delivery speed, brand.
              </p>
            </Card>

            {error && (
              <Card className="border-destructive/30 p-3 text-[12.5px] text-destructive">{error}</Card>
            )}

            {busy && (
              <Card className="flex items-center gap-3 p-5">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                <div>
                  <p className="text-[13px] font-medium">Your purchasing manager is shopping around…</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{LOADING_MSGS[msgIdx]}</p>
                </div>
              </Card>
            )}

            {!busy && current && current.status === "complete" && current.result && (
              <ResultView r={current.result} />
            )}
          </div>

          <div className="space-y-4">
            <SourcesPanel sources={sources} reload={loadSide} />
            <RecentPanel
              recent={recent}
              reload={loadSide}
              onOpen={async (id) => {
                const req = await getSourcingRequestAction(id);
                if (req) {
                  setCurrent(req);
                  setError(req.status === "failed" ? req.error || "The search failed." : "");
                }
              }}
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}

function ResultView({ r }: { r: NonNullable<SourcingRequest["result"]> }) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recommendation</p>
        <p className="mt-1 text-[14.5px] font-medium leading-snug">{r.headline || "Here's what I found."}</p>
        {r.savings_note && (
          <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
            <BadgePercent className="h-3.5 w-3.5" />
            {r.savings_note}
          </p>
        )}
      </Card>

      {r.best && <PickCard pick={r.best} best />}

      {r.alternatives.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-semibold text-muted-foreground">Other options</p>
          <div className="space-y-2">
            {r.alternatives.map((a, i) => (
              <PickCard key={i} pick={a} />
            ))}
          </div>
        </div>
      )}

      {r.caveats && (
        <Card className="border-amber-200 bg-amber-50/50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Before you buy</p>
          <p className="mt-1 text-[12.5px] text-foreground/80">{r.caveats}</p>
        </Card>
      )}

      {r.searched.length > 0 && (
        <p className="text-[11px] text-muted-foreground">Checked: {r.searched.join(" · ")}</p>
      )}
    </div>
  );
}

function PickCard({ pick, best }: { pick: SourcingPick; best?: boolean }) {
  const t = TRUST[pick.trust];
  const Icon = t.Icon;
  return (
    <Card className={cn("p-4", best && "border-emerald-300 ring-1 ring-emerald-200")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {best && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">
              <Sparkles className="h-3 w-3" />
              Best buy
            </span>
          )}
          <h4 className={cn("font-semibold leading-snug", best ? "mt-1.5 text-[14px]" : "text-[13px]")}>{pick.title}</h4>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {pick.seller}
            {pick.condition ? ` · ${pick.condition}` : ""}
          </p>
        </div>
        {pick.price && (
          <p className={cn("shrink-0 font-semibold tabular-nums", best ? "text-[18px]" : "text-[15px]")}>{pick.price}</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", t.cls)}>
          <Icon className="h-3 w-3" />
          {t.label}
        </span>
        {pick.shipping && <span className="text-[11.5px] text-muted-foreground">{pick.shipping}</span>}
      </div>
      {pick.why && <p className="mt-2 text-[12.5px] text-foreground/75">{pick.why}</p>}
      {pick.url && (
        <a
          href={pick.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
        >
          View listing
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </Card>
  );
}

function SourcesPanel({ sources, reload }: { sources: SourcingSource[]; reload: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [site, setSite] = useState("");
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!site.trim()) return;
    setAdding(true);
    await addSourcingSourceAction({ label: label.trim(), site: site.trim() });
    setAdding(false);
    setLabel("");
    setSite("");
    await reload();
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Store className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">Your sources</h3>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Avenues to also check for deals — eBay, Craigslist, auctions, a favorite store.
      </p>

      <div className="mt-3 space-y-1.5">
        {sources.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">None yet — it still checks the open web and major retailers.</p>
        ) : (
          sources.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
              <button
                onClick={async () => {
                  await updateSourcingSourceAction(s.id, { enabled: !s.enabled });
                  await reload();
                }}
                className={cn(
                  "h-3.5 w-3.5 shrink-0 rounded-full border transition",
                  s.enabled ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground/40",
                )}
                aria-label={s.enabled ? "Disable source" : "Enable source"}
                title={s.enabled ? "On — click to pause" : "Paused — click to enable"}
              />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[12.5px] font-medium", !s.enabled && "text-muted-foreground line-through")}>{s.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">{s.site}</p>
              </div>
              <button
                onClick={async () => {
                  await deleteSourcingSourceAction(s.id);
                  await reload();
                }}
                className="shrink-0 text-muted-foreground/50 hover:text-destructive"
                aria-label="Remove source"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Site or domain (e.g. ebay.com)" />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional, e.g. eBay auctions)" />
        <Button size="sm" className="w-full" onClick={add} disabled={adding || !site.trim()}>
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add source
        </Button>
      </div>
    </Card>
  );
}

function RecentPanel({
  recent,
  onOpen,
  reload,
}: {
  recent: SourcingRequest[];
  onOpen: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  if (recent.length === 0) return null;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">Recent</h3>
      </div>
      <div className="mt-2 space-y-0.5">
        {recent.map((r) => (
          <div key={r.id} className="group flex items-center gap-1">
            <button
              onClick={() => onOpen(r.id)}
              className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-accent"
              title={r.query}
            >
              {r.query}
              {r.status !== "complete" && <span className="ml-1 text-[10.5px] text-muted-foreground">({r.status})</span>}
            </button>
            <button
              onClick={async () => {
                await deleteSourcingRequestAction(r.id);
                await reload();
              }}
              className="shrink-0 text-muted-foreground/40 opacity-0 transition hover:text-destructive group-hover:opacity-100"
              aria-label="Delete"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
