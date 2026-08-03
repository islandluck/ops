"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  ImagePlus,
  Loader2,
  MessageCircle,
  Pencil,
  Search,
  Send,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  boostPostAction,
  getPostAction,
  markChannelPublishedAction,
  packagePostAction,
  publishPageChannelAction,
  scheduleThreadChannelAction,
  searchStockAction,
  updatePostAction,
  uploadPostImageAction,
} from "@/app/actions";
import { markdownToHtml } from "@/lib/content/format";
import type { BoostedLongform } from "@/lib/ai/content";
import type { ChannelKind, Post, PostChannel } from "@/lib/types";
import type { StockImage } from "@/lib/ai/stock";

const ALL_CHANNELS: ChannelKind[] = ["page", "x_thread", "substack"];

export default function ContentEditor() {
  const params = useParams();
  const id = String((params as { id?: string })?.id ?? "");
  const router = useRouter();

  const [post, setPost] = useState<Post | null>(null);
  const [title, setTitle] = useState("");
  const [dek, setDek] = useState("");
  const [body, setBody] = useState("");
  const [hero, setHero] = useState<string | null>(null);
  const [boosted, setBoosted] = useState<boolean>(false);
  const [channels, setChannels] = useState<PostChannel[]>([]);

  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busyBoost, setBusyBoost] = useState(false);
  const [suggestion, setSuggestion] = useState<BoostedLongform | null>(null);
  const [packaging, setPackaging] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const p = await getPostAction(id);
    if (p) {
      setPost(p);
      setTitle(p.title);
      setDek(p.dek);
      setBody(p.body_md);
      setHero(p.hero_image_url);
      setBoosted(p.boosted);
      setChannels(p.channels ?? []);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const mark = () => {
    setDirty(true);
    setSavedTick(false);
    setErr("");
  };

  const save = useCallback(async () => {
    setSaving(true);
    const res = await updatePostAction(id, { title, dek, body_md: body, hero_image_url: hero });
    setSaving(false);
    if (res.ok) {
      setDirty(false);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1600);
    } else {
      setErr(res.error ?? "Couldn't save.");
    }
    return res.ok;
  }, [id, title, dek, body, hero]);

  // Debounced autosave while editing.
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) return;
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => void save(), 1200);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [dirty, save]);

  async function boost() {
    setBusyBoost(true);
    setErr("");
    const res = await boostPostAction(id);
    setBusyBoost(false);
    if (res.ok && res.boosted) setSuggestion(res.boosted);
    else setErr(res.error ?? "Couldn't boost the post.");
  }
  async function applyBoost() {
    if (!suggestion) return;
    setTitle(suggestion.title);
    setDek(suggestion.dek);
    setBody(suggestion.body_md);
    setBoosted(true);
    setSuggestion(null);
    await updatePostAction(id, {
      title: suggestion.title,
      dek: suggestion.dek,
      body_md: suggestion.body_md,
      hero_image_url: hero,
      boosted: true,
    });
    setDirty(false);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1600);
  }

  async function packageAll() {
    setPackaging(true);
    setErr("");
    await save();
    const res = await packagePostAction(id, ALL_CHANNELS);
    if (!res.ok) setErr(res.error ?? "Couldn't package the post.");
    await load();
    setPackaging(false);
  }

  const channelOf = (k: ChannelKind) => channels.find((c) => c.channel === k) ?? null;
  const packaged = channels.length > 0;

  async function runChannel(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyKey(key);
    setErr("");
    const res = await fn();
    if (!res.ok) setErr(res.error ?? "That didn't complete.");
    await load();
    setBusyKey("");
  }

  if (loading) {
    return (
      <div className="flex h-[100dvh] flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!post) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-[14px] text-muted-foreground">This post couldn't be found.</p>
        <Button size="sm" variant="outline" onClick={() => router.push("/content")}>
          <ArrowLeft className="h-4 w-4" /> Back to Content
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-5 py-3">
        <Link href="/content" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold">{title || "Untitled post"}</p>
          <p className="text-[11px] text-muted-foreground">
            {saving ? "Saving…" : savedTick ? "Saved" : dirty ? "Unsaved changes" : "All changes saved"}
            {boosted && " · Boosted"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setPreview((v) => !v)}>
          {preview ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {preview ? "Edit" : "Preview"}
        </Button>
        <Button size="sm" variant={boosted ? "outline" : "primary"} onClick={boost} disabled={busyBoost}>
          {busyBoost ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          Growth Marketer
        </Button>
      </div>

      {err && <div className="shrink-0 bg-destructive/10 px-5 py-2 text-[12.5px] text-destructive">{err}</div>}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Editor / preview */}
        <div className="min-h-0 flex-1 overflow-y-auto border-b border-border lg:border-b-0 lg:border-r">
          {preview ? (
            <article className="mx-auto max-w-2xl px-6 py-10">
              <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground">{title || "Untitled"}</h1>
              {dek && <p className="mt-3 text-balance text-lg text-muted-foreground">{dek}</p>}
              {hero && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero} alt="" className="mt-6 w-full rounded-xl border border-border object-cover" />
              )}
              <div
                className="prose-article mt-6 text-foreground"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(body) }}
              />
            </article>
          ) : (
            <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  mark();
                }}
                placeholder="Post title"
                className="w-full bg-transparent text-[26px] font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/40"
              />
              <input
                value={dek}
                onChange={(e) => {
                  setDek(e.target.value);
                  mark();
                }}
                placeholder="A one-line standfirst that frames the value…"
                className="w-full bg-transparent text-[15px] text-muted-foreground outline-none placeholder:text-muted-foreground/40"
              />
              <HeroPicker
                hero={hero}
                onChange={(url) => {
                  setHero(url);
                  mark();
                }}
              />
              <Textarea
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  mark();
                }}
                placeholder="Write in Markdown — ## headings, **bold**, - lists, [links](https://…)."
                className="min-h-[52vh] resize-none font-mono text-[13.5px] leading-relaxed"
              />
            </div>
          )}
        </div>

        {/* Distribute rail */}
        <div className="min-h-0 w-full shrink-0 overflow-y-auto bg-muted/30 lg:w-[380px]">
          <div className="space-y-4 p-5">
            {/* Boost suggestion */}
            {suggestion && (
              <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-violet-600" />
                  <h3 className="text-[13px] font-semibold text-violet-900">Growth-marketer rewrite</h3>
                </div>
                {suggestion.changes.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {suggestion.changes.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12px] text-violet-900/80">
                        <Check className="mt-0.5 h-3 w-3 shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 line-clamp-3 text-[12px] italic text-violet-900/70">“{suggestion.title}”</p>
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" variant="success" className="flex-1" onClick={applyBoost}>
                    <Check className="h-3.5 w-3.5" /> Use this
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">Distribute</h3>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Package the post into a channel-ready form, then publish or schedule each.
              </p>
            </div>

            <Button variant={packaged ? "outline" : "primary"} className="w-full" onClick={packageAll} disabled={packaging}>
              {packaging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {packaged ? "Re-package from current draft" : "Package for distribution"}
            </Button>

            {packaged && (
              <div className="space-y-3">
                <PageChannelCard
                  channel={channelOf("page")}
                  busy={busyKey === "page"}
                  onPublish={() => runChannel("page", () => publishPageChannelAction(id))}
                />
                <ThreadChannelCard
                  channel={channelOf("x_thread")}
                  busy={busyKey === "x_thread"}
                  onSchedule={(whenISO) => runChannel("x_thread", () => scheduleThreadChannelAction(id, whenISO))}
                />
                <SubstackChannelCard
                  channel={channelOf("substack")}
                  post={{ title, dek }}
                  busy={busyKey === "substack"}
                  onMarkPosted={() => runChannel("substack", () => markChannelPublishedAction(id, "substack"))}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ hero picker ------------------------------ */

function HeroPicker({ hero, onChange }: { hero: string | null; onChange: (url: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockImage[]>([]);
  const [searching, setSearching] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadPostImageAction(null, fd);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok && res.image) onChange(res.image.url);
  }
  async function runSearch() {
    if (!q.trim()) return;
    setSearching(true);
    const res = await searchStockAction(q.trim());
    setSearching(false);
    setResults(res.images);
  }

  if (hero) {
    return (
      <div className="group relative overflow-hidden rounded-xl border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hero} alt="" className="max-h-56 w-full object-cover" />
        <button
          onClick={() => onChange(null)}
          className="absolute right-2 top-2 rounded-lg bg-slate-900/70 p-1.5 text-white opacity-0 transition group-hover:opacity-100"
          aria-label="Remove image"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          Add cover image
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setStockOpen((v) => !v)}>
          <Search className="h-4 w-4" /> Stock
        </Button>
      </div>
      {stockOpen && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Search free stock photos…"
              className="h-8 text-[13px]"
            />
            <Button size="sm" variant="outline" onClick={runSearch} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {results.slice(0, 9).map((img) => (
                <button
                  key={img.url}
                  onClick={() => {
                    onChange(img.url);
                    setStockOpen(false);
                  }}
                  className="overflow-hidden rounded-lg border border-border transition hover:ring-2 hover:ring-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.thumb} alt={img.alt} className="h-16 w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- channel cards ------------------------------ */

function CardShell({
  icon,
  title,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  status?: { text: string; cls: string };
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-foreground/70">{icon}</span>
        <h4 className="text-[13px] font-semibold">{title}</h4>
        {status && (
          <span className={cn("ml-auto rounded-full border px-2 py-0.5 text-[10.5px] font-medium", status.cls)}>
            {status.text}
          </span>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function PageChannelCard({
  channel,
  busy,
  onPublish,
}: {
  channel: PostChannel | null;
  busy: boolean;
  onPublish: () => void;
}) {
  const live = channel?.status === "published";
  return (
    <CardShell
      icon={<span className="text-[13px]">🌐</span>}
      title="Article page"
      status={live ? { text: "Live", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" } : undefined}
    >
      {live && channel?.url ? (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] text-muted-foreground">{channel.url}</span>
          <Link href={channel.url} target="_blank" className="shrink-0">
            <Button size="sm" variant="outline">
              <ExternalLink className="h-3.5 w-3.5" /> View
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-muted-foreground">Publish as a hosted article you own, live instantly.</p>
          <Button size="sm" variant="success" className="mt-2 w-full" onClick={onPublish} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Publish article
          </Button>
        </>
      )}
    </CardShell>
  );
}

function ThreadChannelCard({
  channel,
  busy,
  onSchedule,
}: {
  channel: PostChannel | null;
  busy: boolean;
  onSchedule: (whenISO?: string) => void;
}) {
  const [when, setWhen] = useState("");
  const [showTweets, setShowTweets] = useState(false);
  const tweets = channel?.variant.tweets ?? [];
  const scheduled = channel?.status === "scheduled";

  return (
    <CardShell
      icon={<MessageCircle className="h-4 w-4" />}
      title="X thread"
      status={
        scheduled
          ? {
              text: channel?.scheduled_at
                ? `Scheduled ${new Date(channel.scheduled_at).toLocaleDateString([], { month: "short", day: "numeric" })}`
                : "Scheduled",
              cls: "border-violet-200 bg-violet-50 text-violet-700",
            }
          : { text: `${tweets.length} tweets`, cls: "border-border bg-muted text-muted-foreground" }
      }
    >
      {scheduled ? (
        <p className="text-[12px] text-muted-foreground">
          Auto-publishes as a connected thread{" "}
          {channel?.scheduled_at ? `at ${new Date(channel.scheduled_at).toLocaleString()}` : ""}. Manage it in the Social
          queue.
        </p>
      ) : (
        <>
          <button
            onClick={() => setShowTweets((v) => !v)}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            {showTweets ? "Hide" : "Preview"} the {tweets.length}-tweet thread
          </button>
          {showTweets && (
            <div className="mt-2 space-y-1.5">
              {tweets.map((t, i) => (
                <p key={i} className="rounded-lg border border-border bg-muted/40 p-2 text-[12px] leading-relaxed">
                  <span className="mr-1 font-medium text-muted-foreground">{i + 1}/</span>
                  {t}
                </p>
              ))}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px]"
            />
            <Button
              size="sm"
              variant="success"
              onClick={() => onSchedule(when ? new Date(when).toISOString() : undefined)}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Schedule
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Leave the time blank to auto-pick the next good slot.</p>
        </>
      )}
    </CardShell>
  );
}

function SubstackChannelCard({
  channel,
  post,
  busy,
  onMarkPosted,
}: {
  channel: PostChannel | null;
  post: { title: string; dek: string };
  busy: boolean;
  onMarkPosted: () => void;
}) {
  const [copied, setCopied] = useState("");
  const html = channel?.variant.html ?? "";
  const markdown = channel?.variant.markdown ?? "";
  const done = channel?.status === "published";

  async function copyRich() {
    const plain = markdown || `${post.title}\n\n${post.dek}`;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      flash("rich");
    } catch {
      flash("");
    }
  }
  async function copyMd() {
    try {
      await navigator.clipboard.writeText(markdown);
      flash("md");
    } catch {
      flash("");
    }
  }
  function downloadMd() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(post.title || "post").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 48)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function flash(k: string) {
    setCopied(k);
    setTimeout(() => setCopied(""), 1600);
  }

  return (
    <CardShell
      icon={<span className="text-[13px]">📝</span>}
      title="Substack"
      status={
        done
          ? { text: "Posted", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" }
          : { text: "Ready to paste", cls: "border-amber-200 bg-amber-50 text-amber-700" }
      }
    >
      <p className="text-[12px] text-muted-foreground">
        Substack has no publish API — this formats the post perfectly. Copy it, paste into a new Substack draft (formatting
        intact), and hit publish.
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <Button size="sm" variant="success" onClick={copyRich}>
          {copied === "rich" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === "rich" ? "Copied" : "Copy for Substack"}
        </Button>
        <Link href="https://substack.com/publish/post" target="_blank">
          <Button size="sm" variant="outline" className="w-full">
            <ExternalLink className="h-3.5 w-3.5" /> Open Substack
          </Button>
        </Link>
        <Button size="sm" variant="ghost" onClick={copyMd}>
          {copied === "md" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === "md" ? "Copied" : "Copy Markdown"}
        </Button>
        <Button size="sm" variant="ghost" onClick={downloadMd}>
          <Download className="h-3.5 w-3.5" /> Download .md
        </Button>
      </div>
      {!done && (
        <button
          onClick={onMarkPosted}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Mark as posted
        </button>
      )}
    </CardShell>
  );
}
