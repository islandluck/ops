"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  ExternalLink,
  Loader2,
  Mail,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  beginNetworkingPlanAction,
  buildNetworkingPlanAction,
  closeNetworkingTargetAction,
  createNetworkingTargetAction,
  deleteNetworkingTargetAction,
  listNetworkingTargetsAction,
  updateNetworkingPlanAction,
} from "@/app/actions";
import type { NetworkingChannel, NetworkingDraft, NetworkingPlan, NetworkingStatus, NetworkingTarget } from "@/lib/types";

const CHANNEL_LABEL: Record<NetworkingDraft["channel"], string> = { email: "Email", x: "X / Twitter", linkedin: "LinkedIn" };
const CHANNEL_DEST: Record<NetworkingDraft["channel"], string> = {
  email: "Email Manager",
  x: "Social queue",
  linkedin: "send manually on LinkedIn",
};

const CONTEXT_PLACEHOLDER = `Why are you reaching out, and what's the ask?
e.g. We just won a Bezos Earth Fund award and want to thank him + introduce our startup — hoping for a 15-min call or a coffee if he's ever in Nassau.`;

const STATUS_STYLE: Record<NetworkingStatus, string> = {
  planning: "bg-amber-100 text-amber-800",
  planned: "bg-sky-100 text-sky-700",
  active: "bg-emerald-100 text-emerald-700",
  closed: "bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<NetworkingStatus, string> = {
  planning: "Drafting…",
  planned: "Plan ready",
  active: "In motion",
  closed: "Closed",
};

function fmtAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NetworkingPage() {
  const [targets, setTargets] = useState<NetworkingTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [context, setContext] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listNetworkingTargetsAction().catch(() => [] as NetworkingTarget[]);
      if (cancelled) return;
      setTargets(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = targets.find((t) => t.id === selectedId) ?? null;

  function upsert(t: NetworkingTarget) {
    setTargets((prev) => {
      const i = prev.findIndex((x) => x.id === t.id);
      if (i === -1) return [t, ...prev];
      const next = prev.slice();
      next[i] = t;
      return next;
    });
  }

  async function draft() {
    const w = who.trim();
    if (!w || drafting) return;
    setDrafting(true);
    setError("");
    const created = await createNetworkingTargetAction({ who: w, context });
    if (!created.ok) {
      setDrafting(false);
      setError(created.error);
      return;
    }
    upsert(created.target);
    setSelectedId(created.target.id);
    setWho("");
    setContext("");
    // Immediately research + draft the plan.
    const built = await buildNetworkingPlanAction(created.target.id);
    setDrafting(false);
    if (built.ok && built.target) upsert(built.target);
    else setError(built.error ?? "Couldn't draft the plan.");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-600 text-white">
          <Network className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-[20px] font-semibold leading-tight">Networking</h1>
          <p className="text-[13px] text-muted-foreground">
            Point the agent at someone you want to reach. It researches them, maps warm paths through your
            network, finds events + contacts, and drafts friendly intros — you review, then it stages them in your
            Email Manager to send. It never sends or connects on its own.
          </p>
        </div>
      </div>

      {selected ? (
        <TargetDetail
          target={selected}
          onBack={() => setSelectedId(null)}
          onChange={upsert}
          onRemove={(id) => {
            setTargets((prev) => prev.filter((t) => t.id !== id));
            setSelectedId(null);
          }}
        />
      ) : (
        <>
          {/* Guided intake */}
          <div className="rounded-xl border border-primary/25 bg-primary/[0.03] p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Help me network my way to…
            </p>
            <Input
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Who do you want to reach? e.g. Jeff Bezos, the head of Koch Industries, the PM of the Bahamas"
              className="text-[13px]"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && who.trim() && context.trim() && draft()}
            />
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              placeholder={CONTEXT_PLACEHOLDER}
              className="mt-2 text-[13px]"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" disabled={drafting || !who.trim()} onClick={draft}>
                {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {drafting ? "Researching & drafting…" : "Draft networking plan"}
              </Button>
              <span className="text-[11.5px] text-muted-foreground">The more context, the sharper the plan.</span>
            </div>
            {error && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
            )}
          </div>

          {/* Targets */}
          <div className="mt-6">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Your networking targets
            </p>
            {loading ? (
              <div className="flex justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : targets.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-[12.5px] text-muted-foreground">
                No targets yet. Name someone above and the agent will draft your way in.
              </p>
            ) : (
              <div className="space-y-2">
                {targets.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{t.who}</p>
                      {t.context && <p className="truncate text-[11.5px] text-muted-foreground">{t.context}</p>}
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium", STATUS_STYLE[t.status])}>
                      {STATUS_LABEL[t.status]}
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{fmtAgo(t.updated_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
    </div>
  );
}

function TargetDetail({
  target,
  onBack,
  onChange,
  onRemove,
}: {
  target: NetworkingTarget;
  onBack: () => void;
  onChange: (t: NetworkingTarget) => void;
  onRemove: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"build" | "begin" | "close" | null>(null);
  const [notice, setNotice] = useState("");
  const [stagedKinds, setStagedKinds] = useState<{ email: boolean; x: boolean }>({ email: false, x: false });
  const [error, setError] = useState("");
  const [refine, setRefine] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftPlan, setDraftPlan] = useState<NetworkingPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const plan = target.plan;
  const planning = target.status === "planning";
  const locked = target.status === "closed";

  async function rebuild(direction?: string) {
    if (busy) return;
    setBusy("build");
    setError("");
    setNotice("");
    const r = await buildNetworkingPlanAction(target.id, direction);
    setBusy(null);
    if (r.ok && r.target) {
      onChange(r.target);
      setRefine("");
    } else setError(r.error ?? "Couldn't draft the plan.");
  }
  async function begin() {
    if (busy || !plan) return;
    setBusy("begin");
    setError("");
    setNotice("");
    const r = await beginNetworkingPlanAction(target.id);
    setBusy(null);
    if (r.ok && r.target) {
      onChange(r.target);
      const emails = plan.drafts.filter((d) => d.channel === "email").length;
      const tweets = plan.drafts.filter((d) => d.channel === "x").length;
      const li = plan.drafts.filter((d) => d.channel === "linkedin").length;
      setStagedKinds({ email: emails > 0, x: tweets > 0 });
      const parts: string[] = [];
      if (emails) parts.push(`${emails} email${emails === 1 ? "" : "s"} → Email Manager`);
      if (tweets) parts.push(`${tweets} tweet${tweets === 1 ? "" : "s"} → Social queue`);
      const tail = li ? ` ${li} LinkedIn note${li === 1 ? "" : "s"} are yours to send manually below.` : "";
      setNotice(parts.length ? `Staged ${parts.join(" · ")}.${tail}` : tail.trim() || "Nothing to stage.");
    } else setError(r.error ?? "Couldn't begin the plan.");
  }
  async function close() {
    if (busy) return;
    setBusy("close");
    const r = await closeNetworkingTargetAction(target.id);
    setBusy(null);
    if (r.ok && r.target) onChange(r.target);
  }
  async function del() {
    if (busy) return;
    setBusy("close");
    await deleteNetworkingTargetAction(target.id);
    onRemove(target.id);
  }
  function startEdit() {
    if (!plan) return;
    setDraftPlan(structuredClone(plan));
    setEditing(true);
    setError("");
    setNotice("");
  }
  async function saveEdit() {
    if (!draftPlan) return;
    setSaving(true);
    setError("");
    const r = await updateNetworkingPlanAction(target.id, draftPlan);
    setSaving(false);
    if (r.ok && r.target) {
      onChange(r.target);
      setEditing(false);
      setDraftPlan(null);
    } else setError(r.error ?? "Couldn't save your changes.");
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All targets
        </button>
        <span className="ml-auto" />
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraftPlan(null); }} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save changes
            </Button>
          </>
        ) : (
          <>
            {plan && !locked && (
              <Button size="sm" onClick={begin} disabled={busy !== null || !plan.drafts.length}>
                {busy === "begin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Begin — stage intros
              </Button>
            )}
            {plan && !locked && (
              <Button size="sm" variant="outline" onClick={startEdit} disabled={busy !== null}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => rebuild()} disabled={busy !== null}>
              {busy === "build" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {plan ? "Regenerate" : "Draft plan"}
            </Button>
            {!locked && (
              <Button size="sm" variant="ghost" onClick={close} disabled={busy !== null}>
                <Check className="h-4 w-4" /> Close
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={del} disabled={busy !== null} title="Delete target">
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <div className="mb-4">
        <h2 className="text-[18px] font-semibold">{target.who}</h2>
        {target.context && <p className="mt-0.5 text-[12.5px] italic text-muted-foreground">“{target.context}”</p>}
      </div>

      {notice && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          <span>{notice}</span>
          <span className="flex shrink-0 gap-3">
            {stagedKinds.email && <a href="/email" className="font-semibold underline underline-offset-2">Email Manager</a>}
            {stagedKinds.x && <a href="/social" className="font-semibold underline underline-offset-2">Social queue</a>}
          </span>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
      )}

      {/* Suggest a different route / add direction, then regenerate — before it's locked in. */}
      {plan && !editing && !locked && (
        <div className="mb-5 rounded-xl border border-border bg-muted/30 p-3">
          <label className="text-[12px] font-medium">Suggest a different route or add direction</label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <Textarea
              value={refine}
              onChange={(e) => setRefine(e.target.value)}
              rows={2}
              placeholder="e.g. Skip cold email — focus on a warm intro through Dana, and add an X reply to his latest post."
              className="flex-1 text-[12.5px]"
            />
            <Button size="sm" variant="outline" disabled={busy !== null || !refine.trim()} onClick={() => rebuild(refine)} className="self-start">
              {busy === "build" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Regenerate with this
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Or click Edit above to tweak the drafts and steps directly.</p>
        </div>
      )}

      {planning && !plan ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-[13px]">Researching {target.who} and drafting your way in…</p>
        </div>
      ) : !plan ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-[12.5px] text-muted-foreground">
          No plan yet — click “Draft plan”.
        </p>
      ) : editing && draftPlan ? (
        <PlanEditor plan={draftPlan} onChange={setDraftPlan} />
      ) : (
        <PlanView plan={plan} />
      )}
    </div>
  );
}

function PlanView({ plan }: { plan: NonNullable<NetworkingTarget["plan"]> }) {
  return (
    <div className="space-y-6">
      {plan.summary && (
        <div className="rounded-2xl border border-sky-200/70 bg-gradient-to-b from-sky-50/70 to-transparent p-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-sky-700">The approach</p>
          <p className="text-[14px] leading-relaxed text-foreground/90">{plan.summary}</p>
        </div>
      )}

      {plan.target_research && (
        <Section icon={<Users className="h-3.5 w-3.5" />} title="About them" accent="text-indigo-600">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{plan.target_research}</p>
        </Section>
      )}

      {plan.warm_paths.length > 0 && (
        <Section icon={<Users className="h-3.5 w-3.5" />} title="Warm paths in your network" accent="text-emerald-600">
          <div className="space-y-2">
            {plan.warm_paths.map((p, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3">
                <p className="text-[13px] font-medium">
                  {p.name}
                  {p.role ? <span className="font-normal text-muted-foreground"> · {p.role}</span> : null}
                  {p.company ? <span className="font-normal text-muted-foreground"> @ {p.company}</span> : null}
                </p>
                {p.connection && <p className="mt-0.5 text-[12px] text-muted-foreground">Connection: {p.connection}</p>}
                {p.note && <p className="mt-0.5 text-[12px] text-muted-foreground">{p.note}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.events.length > 0 && (
        <Section icon={<Calendar className="h-3.5 w-3.5" />} title="Events to meet them" accent="text-amber-600">
          <div className="space-y-2">
            {plan.events.map((e, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium">{e.name}</p>
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                {(e.when || e.where) && (
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{[e.when, e.where].filter(Boolean).join(" · ")}</p>
                )}
                {e.why && <p className="mt-0.5 text-[12px] text-muted-foreground">{e.why}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan.channels.length > 0 && (
        <Section icon={<Network className="h-3.5 w-3.5" />} title="Ways to reach them" accent="text-sky-600">
          <div className="space-y-2">
            {plan.channels.map((c, i) => (
              <ChannelRow key={i} channel={c} />
            ))}
          </div>
        </Section>
      )}

      {plan.drafts.length > 0 && (
        <Section icon={<Mail className="h-3.5 w-3.5" />} title="Intro drafts" accent="text-indigo-600">
          <div className="space-y-2.5">
            {plan.drafts.map((d, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-[12px] font-medium text-muted-foreground">
                    <span
                      className={cn(
                        "mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        d.channel === "x" ? "bg-sky-100 text-sky-700" : d.channel === "linkedin" ? "bg-blue-100 text-blue-700" : "bg-indigo-100 text-indigo-700",
                      )}
                    >
                      {CHANNEL_LABEL[d.channel]}
                    </span>
                    {d.purpose || "Intro"}
                    {d.to_name ? ` · to ${d.to_name}` : ""}
                    {d.to_email ? ` (${d.to_email})` : ""}
                  </p>
                  {d.draft_id ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      <Check className="h-3 w-3" /> In {CHANNEL_DEST[d.channel]}
                    </span>
                  ) : d.channel === "linkedin" ? (
                    <span className="shrink-0 text-[10px] font-medium text-muted-foreground">send manually</span>
                  ) : null}
                </div>
                {d.note && <p className="mt-1 text-[11px] text-muted-foreground">🔎 {d.note}</p>}
                {d.subject && <p className="mt-1.5 text-[13px] font-semibold">{d.subject}</p>}
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">{d.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            “Begin” routes each draft to the right place — emails to your Email Manager, tweets to your Social queue —
            as editable drafts. LinkedIn notes are yours to send manually. Nothing sends until you approve it.
          </p>
        </Section>
      )}

      {plan.steps.length > 0 && (
        <Section icon={<Check className="h-3.5 w-3.5" />} title="The plan" accent="text-foreground/70">
          <ol className="space-y-1.5">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
                <span className="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}

/** Edit the plan before locking it in — tweak/add/remove the intro drafts, the approach, the steps. */
function PlanEditor({ plan, onChange }: { plan: NetworkingPlan; onChange: (p: NetworkingPlan) => void }) {
  const set = (partial: Partial<NetworkingPlan>) => onChange({ ...plan, ...partial });
  const setDraft = (i: number, partial: Partial<NetworkingDraft>) =>
    set({ drafts: plan.drafts.map((d, j) => (j === i ? { ...d, ...partial } : d)) });
  const removeDraft = (i: number) => set({ drafts: plan.drafts.filter((_, j) => j !== i) });
  const addDraft = () =>
    set({
      drafts: [
        ...plan.drafts,
        { channel: "email", to_name: "", to_email: "", to_company: "", purpose: "", subject: "", body: "", note: "", draft_id: null },
      ],
    });
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium">The approach</label>
        <Textarea value={plan.summary} onChange={(e) => set({ summary: e.target.value })} rows={3} className="text-[12.5px]" />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">Intro drafts</p>
          <Button size="sm" variant="outline" onClick={addDraft}>
            <Plus className="h-3.5 w-3.5" /> Add intro
          </Button>
        </div>
        <div className="space-y-3">
          {plan.drafts.map((d, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={d.channel}
                  onChange={(e) => setDraft(i, { channel: e.target.value as NetworkingDraft["channel"] })}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12px]"
                >
                  <option value="email">Email</option>
                  <option value="x">X / Twitter</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
                <Input value={d.to_name} onChange={(e) => setDraft(i, { to_name: e.target.value })} placeholder="To (name)" className="h-8 min-w-[110px] flex-1 text-[12.5px]" />
                {d.channel === "email" && (
                  <>
                    <Input value={d.to_company} onChange={(e) => setDraft(i, { to_company: e.target.value })} placeholder="Org (for Hunter)" className="h-8 min-w-[110px] flex-1 text-[12.5px]" />
                    <Input value={d.to_email} onChange={(e) => setDraft(i, { to_email: e.target.value })} placeholder="email@…" className="h-8 min-w-[140px] flex-1 text-[12.5px]" />
                  </>
                )}
                <button onClick={() => removeDraft(i)} className="rounded p-1 text-muted-foreground hover:text-red-600" title="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <Input value={d.purpose} onChange={(e) => setDraft(i, { purpose: e.target.value })} placeholder="Purpose (e.g. Warm intro via Dana)" className="mt-2 h-8 text-[12px]" />
              {d.channel === "email" && (
                <Input value={d.subject} onChange={(e) => setDraft(i, { subject: e.target.value })} placeholder="Subject" className="mt-2 h-8 text-[13px] font-medium" />
              )}
              <Textarea
                value={d.body}
                onChange={(e) => setDraft(i, { body: e.target.value })}
                rows={d.channel === "email" ? 6 : 3}
                placeholder={d.channel === "x" ? "Tweet (≤280 chars)…" : d.channel === "linkedin" ? "Short LinkedIn note…" : "Email body…"}
                className="mt-2 text-[12.5px]"
              />
              {d.note && <p className="mt-1 text-[11px] text-muted-foreground">🔎 {d.note}</p>}
              {d.draft_id && (
                <p className="mt-1 text-[11px] text-muted-foreground">Already staged — edits here won’t change what’s already in {CHANNEL_DEST[d.channel]}.</p>
              )}
            </div>
          ))}
          {plan.drafts.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[12px] text-muted-foreground">No drafts — add one.</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[12px] font-medium">The plan (one step per line)</label>
        <Textarea
          value={plan.steps.join("\n")}
          onChange={(e) => set({ steps: e.target.value.split("\n") })}
          rows={Math.max(3, plan.steps.length + 1)}
          className="text-[12.5px]"
        />
      </div>

      <p className="text-[11px] text-muted-foreground">Save changes above, then Begin to route the drafts to the right place.</p>
    </div>
  );
}

function Section({ icon, title, accent, children }: { icon: ReactNode; title: string; accent: string; children: ReactNode }) {
  return (
    <div>
      <p className={cn("mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", accent)}>
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

function ChannelRow({ channel }: { channel: NetworkingChannel }) {
  const isLink = /^https?:\/\//i.test(channel.value);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{channel.label}</span>
      <div className="min-w-0 flex-1">
        {isLink ? (
          <a href={channel.value} target="_blank" rel="noopener noreferrer" className="truncate text-[12.5px] font-medium text-sky-600 hover:underline">
            {channel.value}
          </a>
        ) : (
          <span className="truncate text-[12.5px] font-medium">{channel.value}</span>
        )}
        {channel.note && <p className="truncate text-[11px] text-muted-foreground">{channel.note}</p>}
      </div>
      {isLink && (channel.kind === "x" || channel.kind === "linkedin") && (
        <a href={channel.value} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11.5px] font-medium text-muted-foreground hover:text-foreground">
          Connect →
        </a>
      )}
    </div>
  );
}
