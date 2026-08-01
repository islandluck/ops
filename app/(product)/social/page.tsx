"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Clock,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  bulkPreviewTweetsAction,
  bulkScheduleTweetsAction,
  getXStyleAction,
  learnXStyleFromTextAction,
  learnXStyleFromXAction,
  saveXStyleAction,
} from "@/app/actions";

function fmtWhen(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export default function SocialPage() {
  return (
    <>
      <PageHeader
        title="Social — X"
        description="Teach Operator your voice, then drop in a batch of ideas and schedule them across the week in one click."
      />
      <PageBody className="max-w-3xl space-y-5">
        <VoiceSection />
        <ComposerSection />
        <QueueSection />
      </PageBody>
    </>
  );
}

/* -------------------------------- Voice ---------------------------------- */

function VoiceSection() {
  const [profile, setProfile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"x" | "paste" | "save" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [paste, setPaste] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void getXStyleAction().then((r) => {
      setProfile(r.profile);
      setLoading(false);
    });
  }, []);

  async function learnFromX() {
    setBusy("x");
    setErr(null);
    setMsg(null);
    const r = await learnXStyleFromXAction();
    setBusy(null);
    if (r.ok && r.profile) {
      setProfile(r.profile);
      setMsg(`Learned your voice from ${r.count} of your tweets.`);
      setShowPaste(false);
    } else if (r.needsPaste) {
      setShowPaste(true);
      setErr(`${r.error ?? "Couldn't read your X."} Paste a few example tweets instead.`);
    } else {
      setErr(r.error ?? "Couldn't learn your style.");
    }
  }

  async function learnFromPaste() {
    setBusy("paste");
    setErr(null);
    setMsg(null);
    const r = await learnXStyleFromTextAction(paste);
    setBusy(null);
    if (r.ok && r.profile) {
      setProfile(r.profile);
      setMsg(`Learned your voice from ${r.count} example tweets.`);
      setShowPaste(false);
      setPaste("");
    } else {
      setErr(r.error ?? "Couldn't learn your style.");
    }
  }

  async function saveEdit() {
    setBusy("save");
    await saveXStyleAction(draft);
    setBusy(null);
    setProfile(draft.trim() ? draft.trim() : null);
    setEditing(false);
    setMsg("Voice updated.");
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold">Your voice</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Learned from your tweets and matched on everything Operator drafts for X.
            </p>
          </div>
        </div>
        {profile && !editing && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(profile); setEditing(true); }}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={learnFromX} disabled={busy !== null}>
              {busy === "x" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-learn
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-4 flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : editing ? (
        <div className="mt-4 space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[160px] font-mono text-[12.5px]" />
          <div className="flex gap-2">
            <Button size="sm" variant="success" onClick={saveEdit} disabled={busy === "save"}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save voice
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : profile ? (
        <div className="mt-4 whitespace-pre-line rounded-xl border border-border bg-muted/30 p-4 text-[13px] leading-relaxed text-foreground/90">
          {profile}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Operator can study how you write and match it. Pull from your connected X, or paste a handful of tweets you love.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={learnFromX} disabled={busy !== null}>
              {busy === "x" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Learn from my X
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowPaste((s) => !s)}>
              Paste examples
            </Button>
          </div>
        </div>
      )}

      {showPaste && !editing && (
        <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
          <Label>Paste a few of your tweets (one per line)</Label>
          <Textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            className="min-h-[120px]"
            placeholder={"just shipped a thing i'm proud of\nhot take: most dashboards are decoration\n..."}
          />
          <Button size="sm" onClick={learnFromPaste} disabled={busy === "paste" || paste.trim().length < 10}>
            {busy === "paste" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Learn from these
          </Button>
        </div>
      )}

      {msg && <p className="mt-3 text-[12.5px] text-emerald-600">{msg}</p>}
      {err && <p className="mt-3 text-[12.5px] text-amber-600">{err}</p>}
    </Card>
  );
}

/* ------------------------------ Composer --------------------------------- */

function ComposerSection() {
  const { reloadWorkspace } = useStore();
  const [raw, setRaw] = useState("");
  const [cleaned, setCleaned] = useState<string[] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [perDay, setPerDay] = useState(3);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number } | null>(null);

  async function clean() {
    setCleaning(true);
    setErr(null);
    setDone(null);
    const r = await bulkPreviewTweetsAction(raw);
    setCleaning(false);
    if (r.ok && r.tweets) setCleaned(r.tweets);
    else setErr(r.error ?? "Couldn't clean up the tweets.");
  }

  async function schedule() {
    if (!cleaned) return;
    setScheduling(true);
    setErr(null);
    const r = await bulkScheduleTweetsAction(cleaned, { perDay });
    setScheduling(false);
    if (r.ok) {
      setDone({ count: r.scheduled ?? 0 });
      setCleaned(null);
      setRaw("");
      await reloadWorkspace();
    } else {
      setErr(r.error ?? "Couldn't schedule the tweets.");
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarClock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold">Bulk composer</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Paste a list of tweets — Operator polishes each in your voice and schedules them across the days.
          </p>
        </div>
      </div>

      {!cleaned ? (
        <div className="mt-4 space-y-3">
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="min-h-[180px]"
            placeholder={"One idea per line (or separate longer ones with a blank line):\n\nwe just crossed 100 users 🎉\nthe secret to shipping fast is deleting scope\nreminder: your first draft is allowed to be bad"}
          />
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">
              {raw.trim() ? `${raw.split(/\n\s*\n|\r?\n/).filter((l) => l.trim()).length} lines` : "Paste your tweets"}
            </span>
            <Button onClick={clean} disabled={cleaning || raw.trim().length < 4}>
              {cleaning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {cleaning ? "Polishing in your voice…" : "Clean up in my voice"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">{cleaned.length} ready — edit any before scheduling</p>
            <Button size="sm" variant="ghost" onClick={() => setCleaned(null)}>Start over</Button>
          </div>
          <div className="space-y-2">
            {cleaned.map((t, i) => (
              <TweetRow
                key={i}
                value={t}
                onChange={(v) => setCleaned((arr) => arr!.map((x, j) => (j === i ? v : x)))}
                onRemove={() => setCleaned((arr) => arr!.filter((_, j) => j !== i))}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label>Posts per day</Label>
              <Select value={String(perDay)} onChange={(e) => setPerDay(Number(e.target.value))} className="w-40">
                {[1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>{n} / day</option>
                ))}
              </Select>
            </div>
            <Button variant="success" onClick={schedule} disabled={scheduling || cleaned.length === 0}>
              {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Schedule all {cleaned.length}
            </Button>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Spread across upcoming days at good posting times, and auto-published to X. Cancel any before it goes out.
          </p>
        </div>
      )}

      {done && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
          ✅ Scheduled {done.count} post{done.count === 1 ? "" : "s"} — see the queue below.
        </p>
      )}
      {err && <p className="mt-3 text-[12.5px] text-destructive">{err}</p>}
    </Card>
  );
}

function TweetRow({
  value,
  onChange,
  onRemove,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const over = value.length > 280;
  return (
    <div className="rounded-xl border border-border p-2.5">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[58px] resize-none border-0 bg-transparent p-1.5 text-[13px] shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1.5">
        <span className={cn("text-[11px] tabular-nums", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {value.length}/280
        </span>
        <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-red-600" aria-label="Remove">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- Queue ---------------------------------- */

function QueueSection() {
  const { state } = useStore();
  const tz = state?.brief?.timezone;

  const upcoming = useMemo(() => {
    const now = Date.now();
    return (state?.tasks ?? [])
      .filter(
        (t) =>
          t.execution_status === "queued" &&
          t.affected_systems.includes("X (Twitter)") &&
          t.scheduled_at &&
          new Date(t.scheduled_at).getTime() > now,
      )
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  }, [state?.tasks]);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Clock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold">Scheduled queue</h2>
          <p className="text-[12.5px] text-muted-foreground">
            {upcoming.length ? `${upcoming.length} post${upcoming.length === 1 ? "" : "s"} queued to auto-publish.` : "Nothing scheduled yet."}
          </p>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-4 space-y-2">
          {upcoming.map((t) => {
            const content = t.assets.find((a) => a.asset_type === "social_post")?.content ?? t.title;
            return (
              <div key={t.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                <div className="mt-0.5 flex h-6 shrink-0 items-center gap-1 rounded-md bg-muted px-2 text-[11px] font-medium text-muted-foreground">
                  <CalendarClock className="h-3 w-3" />
                  {fmtWhen(t.scheduled_at!, tz)}
                </div>
                <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-foreground/90">{content}</p>
              </div>
            );
          })}
          <p className="pt-1 text-[11.5px] text-muted-foreground">Manage or cancel any of these from the board.</p>
        </div>
      )}
    </Card>
  );
}
