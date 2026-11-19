"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  Loader2,
  Megaphone,
  Plus,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  createCampaignAction,
  createMarketingItemAction,
  deleteCampaignAction,
  deleteMarketingItemAction,
  generateCampaignPostsAction,
  growthBoostMarketingItemAction,
  listCampaignsAction,
  listMarketingItemsAction,
  planCampaignAction,
  publishMarketingItemAction,
  scheduleMarketingItemAction,
  setMarketingItemPostedAction,
  updateCampaignAction,
  updateMarketingItemAction,
} from "@/app/actions";
import type {
  CampaignProgress,
  MarketingCampaign,
  MarketingChannel,
  MarketingItem,
  MarketingItemStatus,
} from "@/lib/types";

/* ------------------------------- channel meta ---------------------------- */

const CHANNELS: { key: MarketingChannel; label: string; badge: string; cls: string }[] = [
  { key: "x", label: "X", badge: "X", cls: "bg-slate-900 text-white dark:bg-white dark:text-slate-900" },
  { key: "linkedin", label: "LinkedIn", badge: "in", cls: "bg-[#0a66c2] text-white" },
  { key: "blog", label: "Blog", badge: "B", cls: "bg-amber-500 text-white" },
  { key: "newsletter", label: "Newsletter", badge: "N", cls: "bg-rose-500 text-white" },
];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<MarketingChannel, string>;

function ChannelBadge({ channel }: { channel: MarketingChannel }) {
  const c = CHANNELS.find((x) => x.key === channel)!;
  return (
    <span className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold", c.cls)}>
      {c.badge}
    </span>
  );
}

const ITEM_STATUS: Record<MarketingItemStatus, { label: string; cls: string }> = {
  idea: { label: "Idea", cls: "border-border bg-muted/50 text-muted-foreground" },
  drafted: { label: "Draft", cls: "border-border bg-muted/50 text-muted-foreground" },
  scheduled: { label: "Scheduled", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  published: { label: "Published", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
};

const PROGRESS: Record<CampaignProgress, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "text-muted-foreground" },
  drafting: { label: "Drafting", cls: "text-amber-600 dark:text-amber-400" },
  scheduled: { label: "Scheduled", cls: "text-sky-600 dark:text-sky-400" },
  published: { label: "Published", cls: "text-emerald-600 dark:text-emerald-400" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso.slice(0, 16);
  }
}
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

/* ------------------------------- previews -------------------------------- */

function LinkedInPreview({ body, image, company }: { body: string; image: string | null; company: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-slate-900 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0a66c2] text-sm font-bold text-white">
          {(company || "Co").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{company || "Your company"}</div>
          <div className="text-[11px] text-slate-500">now</div>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{body || "Your LinkedIn post…"}</p>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="mt-2 w-full rounded-md border border-slate-200" />
      )}
      <div className="mt-2 flex gap-4 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </div>
    </div>
  );
}

function NewsletterPreview({ title, body, company }: { title: string; body: string; company: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white text-slate-900 shadow-sm">
      <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
        From <span className="font-medium text-slate-700">{company || "Your company"}</span> · Newsletter
      </div>
      <div className="p-3">
        {title && <div className="text-[15px] font-semibold">{title}</div>}
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{body || "Your newsletter…"}</p>
      </div>
    </div>
  );
}

/* --------------------------- growth marketer panel ----------------------- */

type BoostResult =
  | { kind: "options"; options: { text: string; note: string }[] }
  | { kind: "rewrite"; body_md: string; changes: string[] };

function GrowthPanel({ result, onUse, onDismiss }: { result: BoostResult; onUse: (text: string) => void; onDismiss: () => void }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-2.5 dark:border-violet-500/30 dark:bg-violet-500/10">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
          <TrendingUp className="h-3 w-3" /> Growth Marketer
        </span>
        <button onClick={onDismiss} className="text-[11px] font-medium text-violet-600 hover:underline">
          Keep mine
        </button>
      </div>
      {result.kind === "options" ? (
        <div className="mt-2 space-y-1.5">
          {result.options.map((o, i) => (
            <button
              key={i}
              onClick={() => onUse(o.text)}
              className="block w-full rounded-md bg-white/70 p-2 text-left text-[12.5px] leading-relaxed text-foreground transition hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
            >
              {o.note && <span className="mr-1 font-semibold text-violet-700 dark:text-violet-300">{o.note}:</span>}
              {o.text}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2">
          {result.changes.length > 0 && (
            <ul className="mb-1.5 list-disc pl-4 text-[11px] text-violet-900/80 dark:text-violet-200/80">
              {result.changes.slice(0, 5).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-white/70 p-2 text-[12.5px] leading-relaxed dark:bg-white/5">
            {result.body_md}
          </div>
          <Button size="sm" className="mt-2" onClick={() => onUse(result.body_md)}>
            Use this version
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ item dialog ------------------------------ */

function ItemDialog({
  item,
  company,
  onClose,
  onChanged,
}: {
  item: MarketingItem | null;
  company: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { reloadWorkspace } = useStore();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [boost, setBoost] = useState<BoostResult | null>(null);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setBody(item.body_md);
    setWhen(toLocalInput(item.scheduled_at));
    setCopied(false);
    setMsg(null);
    setBoost(null);
  }, [item]);

  if (!item) return null;
  const manual = item.channel === "linkedin" || item.channel === "newsletter";
  const isBlog = item.channel === "blog";
  const done = item.status === "published";

  async function persist() {
    await updateMarketingItemAction(item!.id, { title, body_md: body });
  }
  async function saveContent() {
    setBusy("save");
    await persist();
    setBusy(null);
    onChanged();
  }
  async function runGrowth() {
    setBusy("boost");
    setMsg(null);
    await persist();
    const r = await growthBoostMarketingItemAction(item!.id);
    setBusy(null);
    if (r.ok && r.result) setBoost(r.result as BoostResult);
    else setMsg({ ok: false, text: r.error ?? "Couldn't run the growth marketer." });
  }
  async function schedule() {
    if (!when) {
      setMsg({ ok: false, text: "Pick a date and time." });
      return;
    }
    setBusy("schedule");
    await persist();
    const r = await scheduleMarketingItemAction(item!.id, new Date(when).toISOString());
    setBusy(null);
    if ("ok" in r && r.ok) {
      setMsg({ ok: true, text: manual ? "Reminder set — post it manually at that time." : "Scheduled." });
      onChanged();
      void reloadWorkspace();
    } else setMsg({ ok: false, text: ("error" in r && r.error) || "Couldn't schedule." });
  }
  async function publishNow() {
    setBusy("publish");
    await persist();
    const r = await publishMarketingItemAction(item!.id);
    setBusy(null);
    if ("ok" in r && r.ok) {
      setMsg({ ok: true, text: r.url ? `Published — ${r.url}` : "Published." });
      onChanged();
      void reloadWorkspace();
    } else setMsg({ ok: false, text: ("error" in r && r.error) || "Couldn't publish." });
  }
  async function markPosted() {
    setBusy("posted");
    await setMarketingItemPostedAction(item!.id, true);
    setBusy(null);
    setMsg({ ok: true, text: "Marked as posted." });
    onChanged();
  }
  async function copyText() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  async function remove() {
    if (!window.confirm("Delete this post?")) return;
    await deleteMarketingItemAction(item!.id);
    onChanged();
    onClose();
  }

  return (
    <Dialog open={!!item} onClose={onClose} title={`${CHANNEL_LABEL[item.channel]} post`} className="max-w-2xl">
      <div className="flex max-h-[76vh] flex-col gap-3 overflow-y-auto pr-1">
        {(isBlog || item.channel === "newsletter") && (
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}
        <div>
          <div className="flex items-center justify-between">
            <Label>{isBlog ? "Body (markdown)" : "Post text"}</Label>
            <button
              type="button"
              onClick={runGrowth}
              disabled={busy !== null || !body.trim()}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-violet-600 transition hover:underline disabled:pointer-events-none disabled:opacity-40 dark:text-violet-400"
            >
              {busy === "boost" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
              Growth Marketer
            </button>
          </div>
          <Textarea
            rows={isBlog ? 12 : 6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={cn(isBlog && "font-mono text-[12.5px]")}
          />
          {item.channel === "x" && (
            <p className="mt-1 text-[11px] text-muted-foreground">{body.length}/280 — longer text is trimmed to fit X.</p>
          )}
        </div>

        {boost && (
          <GrowthPanel
            result={boost}
            onDismiss={() => setBoost(null)}
            onUse={(text) => {
              setBody(text);
              setBoost(null);
            }}
          />
        )}

        {item.channel === "linkedin" && (
          <div>
            <Label>Preview</Label>
            <div className="mt-1">
              <LinkedInPreview body={body} image={item.image_url} company={company} />
            </div>
          </div>
        )}
        {item.channel === "newsletter" && (
          <div>
            <Label>Preview</Label>
            <div className="mt-1">
              <NewsletterPreview title={title} body={body} company={company} />
            </div>
          </div>
        )}

        {!done && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/20 p-2.5">
            <div>
              <Label>Schedule for</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-56" />
            </div>
            <Button size="sm" variant="success" onClick={schedule} disabled={busy !== null}>
              {busy === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              {manual ? "Set reminder" : "Schedule"}
            </Button>
          </div>
        )}

        {msg && (
          <p className={cn("text-[12.5px] break-all", msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600")}>
            {msg.text}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" onClick={remove} className="text-muted-foreground transition hover:text-destructive" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveContent} disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            {manual ? (
              <>
                <Button size="sm" variant="outline" onClick={copyText}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy text"}
                </Button>
                {!done && (
                  <Button size="sm" onClick={markPosted} disabled={busy !== null}>
                    {busy === "posted" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Mark posted
                  </Button>
                )}
              </>
            ) : (
              !done && (
                <Button size="sm" onClick={publishNow} disabled={busy !== null}>
                  {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Publish now
                </Button>
              )
            )}
            {item.ref_url && (
              <a href={item.ref_url} target="_blank" rel="noreferrer" className="inline-flex">
                <Button size="sm" variant="ghost">
                  <ExternalLink className="h-4 w-4" /> View
                </Button>
              </a>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------- campaign dialog ---------------------------- */

function CampaignDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id?: string) => void }) {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [weeks, setWeeks] = useState(2);
  const [channels, setChannels] = useState<MarketingChannel[]>(["x", "linkedin", "blog"]);
  const [busy, setBusy] = useState<"plan" | "empty" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setObjective("");
    setWeeks(2);
    setChannels(["x", "linkedin", "blog"]);
    setError(null);
  }, [open]);

  function toggle(c: MarketingChannel) {
    setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }
  async function plan() {
    if (!name.trim() || !objective.trim() || channels.length === 0) {
      setError("Add a name, objective, and at least one channel.");
      return;
    }
    setBusy("plan");
    setError(null);
    const r = await planCampaignAction({ name, objective, weeks, channels });
    setBusy(null);
    if (r.ok) {
      onCreated(r.campaignId);
      onClose();
    } else setError(r.error ?? "Couldn't plan the campaign.");
  }
  async function createEmpty() {
    if (!name.trim()) {
      setError("Give the campaign a name.");
      return;
    }
    setBusy("empty");
    const r = await createCampaignAction({ name, objective, status: "active" });
    setBusy(null);
    if ("ok" in r && r.ok) {
      onCreated(r.campaign.id);
      onClose();
    } else setError(("error" in r && r.error) || "Couldn't create.");
  }

  return (
    <Dialog open={open} onClose={onClose} title="New campaign" className="max-w-xl">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pre-seed launch" />
        </div>
        <div>
          <Label>Description / objective</Label>
          <Textarea
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What's this campaign about? Who's it for, what's the message, any key details?"
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label>Length</Label>
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="mt-1 h-9 rounded-lg border border-border bg-card px-2 text-sm"
            >
              {[1, 2, 3, 4, 6, 8].map((w) => (
                <option key={w} value={w}>
                  {w} week{w === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Channels</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => {
                const on = channels.includes(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition",
                      on ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:border-foreground",
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={createEmpty} disabled={busy !== null}>
            {busy === "empty" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create empty
          </Button>
          <Button onClick={plan} disabled={busy !== null}>
            {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Plan with AI
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------- campaign detail ----------------------------- */

function CampaignDetail({
  campaign,
  company,
  onBack,
  onChanged,
}: {
  campaign: MarketingCampaign;
  company: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [objective, setObjective] = useState(campaign.objective);
  const [launch, setLaunch] = useState(toDateInput(campaign.starts_at));
  const [items, setItems] = useState<MarketingItem[] | null>(null);
  const [openItem, setOpenItem] = useState<MarketingItem | null>(null);
  const [genBusy, setGenBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const its = await listMarketingItemsAction(campaign.id);
    setItems(its);
    setOpenItem((cur) => (cur ? its.find((i) => i.id === cur.id) ?? null : null));
  }, [campaign.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    setName(campaign.name);
    setObjective(campaign.objective);
    setLaunch(toDateInput(campaign.starts_at));
  }, [campaign]);

  async function saveHeader() {
    await updateCampaignAction(campaign.id, {
      name,
      objective,
      starts_at: launch ? new Date(launch).toISOString() : null,
    });
    onChanged();
  }
  async function generate(channel: MarketingChannel) {
    setGenBusy(channel);
    await generateCampaignPostsAction(campaign.id, [channel]);
    setGenBusy(null);
    refresh();
    onChanged();
  }
  async function generateAll() {
    setGenBusy("all");
    await generateCampaignPostsAction(campaign.id, ["x", "linkedin", "blog", "newsletter"]);
    setGenBusy(null);
    refresh();
    onChanged();
  }
  async function addEmpty(channel: MarketingChannel) {
    const r = await createMarketingItemAction({ channel, campaign_id: campaign.id, body_md: "" });
    refresh();
    onChanged();
    if ("ok" in r && r.ok) setOpenItem(r.item);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> All campaigns
        </Button>
        <Button size="sm" className="ml-auto" onClick={generateAll} disabled={genBusy !== null}>
          {genBusy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate all channels
        </Button>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <Label>Campaign name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveHeader} />
          </div>
          <div>
            <Label>Launch date</Label>
            <Input type="date" value={launch} onChange={(e) => setLaunch(e.target.value)} onBlur={saveHeader} className="w-44" />
          </div>
        </div>
        <div>
          <Label>Description / objective</Label>
          <Textarea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} onBlur={saveHeader} />
        </div>
      </Card>

      {CHANNELS.map((c) => {
        const chItems = (items ?? []).filter((i) => i.channel === c.key);
        return (
          <div key={c.key}>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ChannelBadge channel={c.key} />
                <span className="text-sm font-semibold">{c.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {chItems.length} post{chItems.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => generate(c.key)} disabled={genBusy !== null}>
                  {genBusy === c.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Generate
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => addEmpty(c.key)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
            {chItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">
                No {c.label} post yet — Generate one with AI or add your own.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {chItems.map((it) => (
                  <PostRow key={it.id} item={it} onOpen={() => setOpenItem(it)} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <ItemDialog item={openItem} company={company} onClose={() => setOpenItem(null)} onChanged={refresh} />
    </div>
  );
}

function PostRow({ item, onOpen }: { item: MarketingItem; onOpen: () => void }) {
  const st = ITEM_STATUS[item.status];
  return (
    <Card className="flex items-center gap-3 p-2.5">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-medium">{item.title || item.body_md.slice(0, 80) || "Untitled"}</div>
        <div className="truncate text-[11px] text-muted-foreground">{item.body_md.slice(0, 110)}</div>
        {item.scheduled_at && <div className="text-[11px] text-muted-foreground">{fmtDateTime(item.scheduled_at)}</div>}
      </button>
      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>
    </Card>
  );
}

/* ------------------------------ campaign table --------------------------- */

function CampaignTable({
  campaigns,
  onOpen,
  onDelete,
}: {
  campaigns: MarketingCampaign[];
  onOpen: (c: MarketingCampaign) => void;
  onDelete: (c: MarketingCampaign) => void;
}) {
  const sorted = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      if (a.starts_at && b.starts_at) return a.starts_at.localeCompare(b.starts_at);
      if (a.starts_at) return -1;
      if (b.starts_at) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [campaigns]);

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Campaign</th>
            <th className="px-3 py-2">Launch date</th>
            <th className="px-3 py-2">Status</th>
            {CHANNELS.map((c) => (
              <th key={c.key} className="px-2 py-2 text-center">
                {c.label}
              </th>
            ))}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const prog = PROGRESS[c.progress ?? "not_started"];
            return (
              <tr key={c.id} className="group border-b border-border/60 last:border-0 hover:bg-accent/50">
                <td className="px-3 py-2.5">
                  <button onClick={() => onOpen(c)} className="min-w-0 text-left">
                    <div className="truncate font-medium hover:underline">{c.name}</div>
                    {c.objective && <div className="truncate text-[11px] text-muted-foreground">{c.objective}</div>}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-[12.5px] tabular-nums text-muted-foreground">{fmtDate(c.starts_at)}</td>
                <td className="px-3 py-2.5">
                  <span className={cn("text-[12.5px] font-medium", prog.cls)}>{prog.label}</span>
                </td>
                {CHANNELS.map((ch) => {
                  const n = c.posts_by_channel?.[ch.key] ?? 0;
                  return (
                    <td key={ch.key} className="px-2 py-2.5 text-center">
                      {n > 0 ? (
                        <span className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                          <Check className="h-4 w-4" />
                          {n > 1 && <span className="ml-0.5 text-[11px] tabular-nums">{n}</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-2.5 text-right">
                  <button
                    onClick={() => onDelete(c)}
                    className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    title="Delete campaign"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function MarketingPage() {
  const { state } = useStore();
  const company = state?.brief?.company_name || "Your company";
  const [tab, setTab] = useState<"campaigns" | "calendar">("campaigns");
  const [campaigns, setCampaigns] = useState<MarketingCampaign[] | null>(null);
  const [items, setItems] = useState<MarketingItem[] | null>(null);
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);
  const [calItem, setCalItem] = useState<MarketingItem | null>(null);
  const [newCampaign, setNewCampaign] = useState(false);

  const refresh = useCallback(async () => {
    const [cs, its] = await Promise.all([listCampaignsAction(), listMarketingItemsAction()]);
    setCampaigns(cs);
    setItems(its);
    setCalItem((cur) => (cur ? its.find((i) => i.id === cur.id) ?? null : null));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCampaign = campaigns?.find((c) => c.id === openCampaignId) ?? null;

  // Calendar grouping (secondary tab).
  const calGroups = useMemo(() => {
    const scheduled = (items ?? []).filter((i) => i.scheduled_at).sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));
    const byDay = new Map<string, MarketingItem[]>();
    for (const it of scheduled) {
      const key = fmtDay(it.scheduled_at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(it);
    }
    return byDay;
  }, [items]);

  return (
    <>
      <PageHeader
        title="Marketing"
        description="Plan campaigns and run your content calendar across X, LinkedIn, blog, and newsletters — from one place."
        actions={
          <Button size="sm" onClick={() => setNewCampaign(true)}>
            <Plus className="h-4 w-4" /> New campaign
          </Button>
        }
      />
      <PageBody className="space-y-5">
        {!openCampaign && (
          <Segmented
            options={[
              { value: "campaigns", label: "Campaigns" },
              { value: "calendar", label: "Calendar" },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        {openCampaign ? (
          <CampaignDetail
            campaign={openCampaign}
            company={company}
            onBack={() => setOpenCampaignId(null)}
            onChanged={refresh}
          />
        ) : tab === "campaigns" ? (
          campaigns === null ? (
            <Loading />
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <Megaphone className="h-9 w-9 opacity-40" />
              <p className="max-w-sm text-sm">
                No campaigns yet. Create one, describe it, and let the AI draft posts for each channel — then run them through
                the Growth Marketer and schedule.
              </p>
              <Button size="sm" onClick={() => setNewCampaign(true)}>
                <Plus className="h-4 w-4" /> New campaign
              </Button>
            </div>
          ) : (
            <CampaignTable
              campaigns={campaigns}
              onOpen={(c) => setOpenCampaignId(c.id)}
              onDelete={async (c) => {
                if (!window.confirm(`Delete "${c.name}"? Its posts stay but detach from the campaign.`)) return;
                await deleteCampaignAction(c.id);
                refresh();
              }}
            />
          )
        ) : items === null ? (
          <Loading />
        ) : calGroups.size === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <CalendarClock className="h-9 w-9 opacity-40" />
            <p className="max-w-sm text-sm">Nothing scheduled yet. Schedule posts from a campaign to see them here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {[...calGroups.entries()].map(([day, its]) => (
              <div key={day}>
                <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{day}</div>
                <div className="flex flex-col gap-2">
                  {its.map((it) => (
                    <PostRow key={it.id} item={it} onOpen={() => setCalItem(it)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>

      <ItemDialog item={calItem} company={company} onClose={() => setCalItem(null)} onChanged={refresh} />
      <CampaignDialog
        open={newCampaign}
        onClose={() => setNewCampaign(false)}
        onCreated={(id) => {
          if (id) setOpenCampaignId(id);
          refresh();
        }}
      />
    </>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-16 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}
