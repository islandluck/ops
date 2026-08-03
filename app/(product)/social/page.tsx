"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Clock,
  ExternalLink,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Reply,
  Search,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  addXTargetAction,
  attachStockImageAction,
  bulkPreviewTweetsAction,
  bulkScheduleTweetsAction,
  dismissOpportunityAction,
  draftOpportunityRepliesAction,
  getReplyOpportunitiesAction,
  getXStyleAction,
  getXTargetsAction,
  growthBoostTweetAction,
  learnXStyleFromTextAction,
  learnXStyleFromXAction,
  postOpportunityReplyAction,
  postReplyAction,
  refreshReplyRadarAction,
  removePostImageAction,
  removeXTargetAction,
  saveXStyleAction,
  searchStockAction,
  suggestRepliesAction,
  uploadPostImageAction,
} from "@/app/actions";
import type { PostImage, ReplyOpportunity, XTarget } from "@/lib/types";
import type { StockImage } from "@/lib/ai/stock";

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
        <ReplyAssistantSection />
        <ReplyRadarSection />
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
  const [cleaned, setCleaned] = useState<{ text: string; image: PostImage | null }[] | null>(null);
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
    if (r.ok && r.tweets) setCleaned(r.tweets.map((t) => ({ text: t, image: null })));
    else setErr(r.error ?? "Couldn't clean up the tweets.");
  }

  async function schedule() {
    if (!cleaned) return;
    setScheduling(true);
    setErr(null);
    const r = await bulkScheduleTweetsAction(
      cleaned.map((d) => ({ text: d.text, mediaId: d.image?.id ?? null })),
      { perDay },
    );
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
            {cleaned.map((d, i) => (
              <TweetRow
                key={i}
                value={d.text}
                image={d.image}
                onChange={(v) => setCleaned((arr) => arr!.map((x, j) => (j === i ? { ...x, text: v } : x)))}
                onImage={(img) => setCleaned((arr) => arr!.map((x, j) => (j === i ? { ...x, image: img } : x)))}
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
  image,
  onChange,
  onImage,
  onRemove,
}: {
  value: string;
  image: PostImage | null;
  onChange: (v: string) => void;
  onImage: (img: PostImage | null) => void;
  onRemove: () => void;
}) {
  const over = value.length > 280;
  const [boosting, setBoosting] = useState(false);
  const [options, setOptions] = useState<{ boosted: string; note: string }[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [boostDraft, setBoostDraft] = useState("");
  const [boostErr, setBoostErr] = useState<string | null>(null);

  async function boost() {
    setBoosting(true);
    setBoostErr(null);
    setOptions(null);
    const r = await growthBoostTweetAction(value);
    setBoosting(false);
    if (r.ok && r.suggestions?.length) {
      setOptions(r.suggestions);
      setSelectedIdx(0);
      setBoostDraft(r.suggestions[0].boosted);
    } else {
      setBoostErr(r.error ?? "Couldn't boost this one.");
    }
  }

  function pick(i: number) {
    setSelectedIdx(i);
    if (options?.[i]) setBoostDraft(options[i].boosted);
  }

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
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={boost}
            disabled={boosting || value.trim().length < 4}
            title="Suggest a more viral version"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-violet-600 transition hover:bg-violet-50 disabled:pointer-events-none disabled:opacity-40"
          >
            {boosting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
            Growth Marketer
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-muted-foreground hover:text-red-600"
            aria-label="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <TweetImageSlot image={image} onImage={onImage} />

      {boostErr && <p className="px-1.5 pb-0.5 text-[11px] text-amber-600">{boostErr}</p>}

      {options && (
        <div className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50/70 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
            <TrendingUp className="h-3 w-3" />
            Growth Marketer — pick a direction, then tweak
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {options.map((o, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pick(i)}
                title={o.boosted}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition",
                  i === selectedIdx
                    ? "bg-violet-600 text-white"
                    : "bg-white/70 text-violet-700 hover:bg-white",
                )}
              >
                {i + 1}
                {o.note ? ` · ${o.note}` : ""}
              </button>
            ))}
          </div>
          <Textarea
            value={boostDraft}
            onChange={(e) => setBoostDraft(e.target.value)}
            className="mt-1.5 min-h-[64px] resize-none border-violet-200 bg-white/70 text-[13px] leading-relaxed focus-visible:border-violet-400"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              size="sm"
              variant="success"
              disabled={!boostDraft.trim()}
              onClick={() => {
                onChange(boostDraft.trim());
                setOptions(null);
              }}
            >
              <Check className="h-3.5 w-3.5" />
              Use this
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOptions(null)}>
              Keep mine
            </Button>
            <span
              className={cn(
                "ml-auto text-[11px] tabular-nums",
                boostDraft.length > 280 ? "font-semibold text-destructive" : "text-violet-600/70",
              )}
            >
              {boostDraft.length}/280
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function TweetImageSlot({
  image,
  onImage,
}: {
  image: PostImage | null;
  onImage: (img: PostImage | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "stock">("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [attaching, setAttaching] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadPostImageAction(null, fd);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok && res.image) {
      onImage(res.image);
      setOpen(false);
    } else {
      setErr(res.error ?? "Upload failed.");
    }
  }

  async function runSearch() {
    if (!q.trim()) return;
    setSearching(true);
    setErr("");
    const res = await searchStockAction(q.trim());
    setSearching(false);
    setConfigured(res.configured);
    setResults(res.images);
  }

  async function pickStock(img: StockImage) {
    setAttaching(img.url);
    setErr("");
    const res = await attachStockImageAction(null, {
      url: img.url,
      alt: img.alt,
      width: img.width,
      height: img.height,
      attribution: img.attribution,
    });
    setAttaching(null);
    if (res.ok && res.image) {
      onImage(res.image);
      setOpen(false);
    } else {
      setErr(res.error ?? "Couldn't add that image.");
    }
  }

  async function remove() {
    if (!image) return;
    const id = image.id;
    onImage(null);
    setOpen(false);
    await removePostImageAction(id);
  }

  if (image) {
    return (
      <div className="mt-2 flex items-center gap-2 px-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt="" className="h-12 w-12 rounded-md border border-border object-cover" />
        <span className="text-[11.5px] text-muted-foreground">Image attached — posts with the tweet</span>
        <button
          type="button"
          onClick={remove}
          className="ml-auto rounded p-1 text-muted-foreground hover:text-red-600"
          aria-label="Remove image"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 px-1.5">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ImagePlus className="h-3.5 w-3.5" />
          Add image
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <Segmented
              options={[
                { value: "upload", label: "Upload" },
                { value: "stock", label: "Stock" },
              ]}
              value={tab}
              onChange={(v) => setTab(v as "upload" | "stock")}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="Close image picker"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {tab === "upload" ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-5 text-[12.5px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy ? "Uploading…" : "Choose an image (max 10 MB)"}
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runSearch();
                    }
                  }}
                  placeholder="Search Pexels…"
                  className="h-8"
                />
                <Button size="sm" variant="outline" onClick={runSearch} disabled={searching || !q.trim()}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {!configured && (
                <p className="text-[11.5px] text-amber-600">
                  Stock search needs a Pexels API key (PEXELS_API_KEY). Upload works either way.
                </p>
              )}
              {results.length > 0 && (
                <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto">
                  {results.map((img) => (
                    <button
                      key={img.url}
                      type="button"
                      onClick={() => pickStock(img)}
                      disabled={attaching !== null}
                      title={img.attribution}
                      className="relative aspect-[4/3] overflow-hidden rounded-md border border-border transition hover:ring-2 hover:ring-primary"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.thumb} alt={img.alt} className="h-full w-full object-cover" />
                      {attaching === img.url && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {err && <p className="mt-1.5 text-[11px] text-destructive">{err}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Reply assistant ---------------------------- */

function ReplyAssistantSection() {
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [needsText, setNeedsText] = useState(false);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<{ id: string; text: string; author: string | null } | null>(null);
  const [options, setOptions] = useState<{ reply: string; note: string }[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postedUrl, setPostedUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function suggest() {
    setLoading(true);
    setErr(null);
    setPostedUrl(null);
    const r = await suggestRepliesAction(url, needsText ? pastedText : undefined);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error ?? "Couldn't suggest replies.");
      return;
    }
    if (r.needsText) {
      setNeedsText(true);
      setErr("Couldn't read that tweet automatically — paste its text below, then try again.");
      return;
    }
    if (r.suggestions?.length && r.tweetId) {
      setTarget({ id: r.tweetId, text: r.tweetText ?? pastedText, author: r.author ?? null });
      setOptions(r.suggestions);
      setSelectedIdx(0);
      setDraft(r.suggestions[0].reply);
      setNeedsText(false);
    }
  }

  function pick(i: number) {
    setSelectedIdx(i);
    if (options?.[i]) setDraft(options[i].reply);
  }

  async function post() {
    if (!target) return;
    setPosting(true);
    setErr(null);
    const r = await postReplyAction(target.id, draft);
    setPosting(false);
    if (r.ok && r.url) setPostedUrl(r.url);
    else setErr(r.error ?? "Couldn't post the reply.");
  }

  function reset() {
    setUrl("");
    setPastedText("");
    setNeedsText(false);
    setTarget(null);
    setOptions(null);
    setDraft("");
    setPostedUrl(null);
    setErr(null);
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Reply className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold">Reply assistant</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Paste a tweet from a big account in your niche — get value-add replies in your voice, then post.
          </p>
        </div>
      </div>

      {postedUrl ? (
        <div className="mt-4 space-y-3">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
            ✅ Reply posted.{" "}
            <a
              href={postedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium underline"
            >
              View on X <ExternalLink className="h-3 w-3" />
            </a>
          </p>
          <Button size="sm" variant="outline" onClick={reset}>
            Reply to another
          </Button>
        </div>
      ) : !target ? (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Tweet link</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://x.com/username/status/1234567890"
            />
          </div>
          {needsText && (
            <div className="space-y-1.5">
              <Label>Paste the tweet&apos;s text</Label>
              <Textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                className="min-h-[70px]"
                placeholder="Paste what the tweet says so Operator can draft a reply."
              />
            </div>
          )}
          <Button
            onClick={suggest}
            disabled={loading || url.trim().length < 8 || (needsText && pastedText.trim().length < 3)}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Reading the room…" : "Suggest replies"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Replying to {target.author ?? "this tweet"}
            </p>
            <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{target.text}</p>
          </div>

          {options && (
            <div className="flex flex-wrap gap-1">
              {options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(i)}
                  title={o.reply}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition",
                    i === selectedIdx
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground/80 hover:bg-muted/70",
                  )}
                >
                  {i + 1}
                  {o.note ? ` · ${o.note}` : ""}
                </button>
              ))}
            </div>
          )}

          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[80px]" />
          <div className="flex items-center gap-2">
            <Button variant="success" onClick={post} disabled={posting || !draft.trim() || draft.length > 280}>
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post reply
            </Button>
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
            <span
              className={cn(
                "ml-auto text-[11px] tabular-nums",
                draft.length > 280 ? "font-semibold text-destructive" : "text-muted-foreground",
              )}
            >
              {draft.length}/280
            </span>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Posts a real reply to your connected X. Add genuine value — quality replies grow your account; spammy
            ones get you muted.
          </p>
        </div>
      )}

      {err && <p className="mt-3 text-[12.5px] text-amber-600">{err}</p>}
    </Card>
  );
}

/* ------------------------------ Reply radar ------------------------------ */

function ReplyRadarSection() {
  const [targets, setTargets] = useState<XTarget[]>([]);
  const [opps, setOpps] = useState<ReplyOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [readBlocked, setReadBlocked] = useState(false);

  async function loadAll() {
    const [t, o] = await Promise.all([getXTargetsAction(), getReplyOpportunitiesAction()]);
    setTargets(t);
    setOpps(o);
    setLoading(false);
  }
  useEffect(() => {
    void loadAll();
  }, []);

  async function add() {
    if (!handle.trim()) return;
    setAdding(true);
    setErr(null);
    setMsg(null);
    const r = await addXTargetAction(handle, note);
    setAdding(false);
    if (r.ok && r.target) {
      setHandle("");
      setNote("");
      setTargets((prev) => [r.target!, ...prev.filter((x) => x.id !== r.target!.id)]);
    } else {
      setErr(r.error ?? "Couldn't add that account.");
    }
  }

  async function remove(id: string) {
    setTargets((prev) => prev.filter((t) => t.id !== id));
    await removeXTargetAction(id);
  }

  async function refresh() {
    setRefreshing(true);
    setErr(null);
    setMsg(null);
    setReadBlocked(false);
    const r = await refreshReplyRadarAction();
    setRefreshing(false);
    if (!r.ok) {
      setErr(r.error ?? "Couldn't refresh the radar.");
      return;
    }
    setReadBlocked(Boolean(r.readBlocked));
    await loadAll();
    if (r.found) setMsg(`Found ${r.found} new ${r.found === 1 ? "opportunity" : "opportunities"}.`);
    else if (!r.readBlocked) setMsg("No new opportunities right now.");
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Radar className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold">Reply radar</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Watch the big accounts in your niche — Operator finds their tweets worth replying to and drafts replies in
              your voice.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || targets.length === 0}>
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 items-center rounded-lg border border-input bg-background px-2.5">
            <span className="text-[13px] text-muted-foreground">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder="handle"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none"
            />
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="sm:max-w-[200px]"
          />
          <Button onClick={add} disabled={adding || handle.trim().length < 1}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Watch
          </Button>
        </div>
        {targets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-1 pl-2.5 pr-1 text-[12px]"
              >
                @{t.handle}
                <button
                  onClick={() => remove(t.id)}
                  className="rounded-full p-0.5 text-muted-foreground hover:text-red-600"
                  aria-label={`Stop watching ${t.handle}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {msg && <p className="mt-3 text-[12.5px] text-emerald-600">{msg}</p>}
      {err && <p className="mt-3 text-[12.5px] text-amber-600">{err}</p>}
      {readBlocked && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Couldn&apos;t read your targets&apos; tweets — reading other accounts needs the X API{" "}
          <strong>Basic tier</strong>. Your posting + reply-assistant features still work on the free tier.
        </p>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : opps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-muted-foreground">
            {targets.length === 0
              ? "Add a few accounts to watch, then hit Refresh."
              : "No opportunities yet — hit Refresh to scan your watchlist."}
          </p>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[12px] font-medium text-muted-foreground">
              {opps.length} opportunit{opps.length === 1 ? "y" : "ies"} — best first
            </p>
            {opps.map((o) => (
              <OpportunityCard key={o.id} opp={o} onDone={(id) => setOpps((prev) => prev.filter((x) => x.id !== id))} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function OpportunityCard({ opp, onDone }: { opp: ReplyOpportunity; onDone: (id: string) => void }) {
  const [options, setOptions] = useState(opp.suggested_replies);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [draft, setDraft] = useState(opp.suggested_replies[0]?.reply ?? "");
  const [drafting, setDrafting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function draftReplies() {
    setDrafting(true);
    setErr(null);
    const r = await draftOpportunityRepliesAction(opp.id);
    setDrafting(false);
    if (r.ok && r.suggestions?.length) {
      setOptions(r.suggestions);
      setSelectedIdx(0);
      setDraft(r.suggestions[0].reply);
    } else {
      setErr(r.error ?? "Couldn't draft replies.");
    }
  }
  function pick(i: number) {
    setSelectedIdx(i);
    if (options[i]) setDraft(options[i].reply);
  }
  async function post() {
    setPosting(true);
    setErr(null);
    const r = await postOpportunityReplyAction(opp.id, draft);
    setPosting(false);
    if (r.ok) onDone(opp.id);
    else setErr(r.error ?? "Couldn't post the reply.");
  }
  async function dismiss() {
    onDone(opp.id);
    await dismissOpportunityAction(opp.id);
  }

  const scoreColor =
    opp.score >= 75
      ? "bg-emerald-100 text-emerald-700"
      : opp.score >= 60
        ? "bg-amber-100 text-amber-700"
        : "bg-muted text-muted-foreground";

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <a
          href={opp.tweet_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
        >
          {opp.author_handle} <ExternalLink className="h-3 w-3" />
        </a>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", scoreColor)}>{opp.score}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">{opp.tweet_text}</p>
      {opp.reason && <p className="mt-1.5 text-[11.5px] italic text-muted-foreground">Why: {opp.reason}</p>}

      <div className="mt-2.5 rounded-lg border border-border bg-muted/30 p-2.5">
        {options.length === 0 ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={draftReplies} disabled={drafting}>
              {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Draft replies
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(i)}
                  title={o.reply}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition",
                    i === selectedIdx
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground/80 hover:bg-muted",
                  )}
                >
                  {i + 1}
                  {o.note ? ` · ${o.note}` : ""}
                </button>
              ))}
            </div>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-1.5 min-h-[64px] resize-none bg-background text-[13px]"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" variant="success" onClick={post} disabled={posting || !draft.trim() || draft.length > 280}>
                {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Post reply
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Dismiss
              </Button>
              <span
                className={cn(
                  "ml-auto text-[11px] tabular-nums",
                  draft.length > 280 ? "font-semibold text-destructive" : "text-muted-foreground",
                )}
              >
                {draft.length}/280
              </span>
            </div>
          </>
        )}
      </div>
      {err && <p className="mt-1.5 text-[11.5px] text-amber-600">{err}</p>}
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
