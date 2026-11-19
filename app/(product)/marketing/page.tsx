"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Megaphone,
  Plus,
  Send,
  Sparkles,
  Trash2,
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
  listCampaignsAction,
  listMarketingItemsAction,
  planCampaignAction,
  publishMarketingItemAction,
  scheduleMarketingItemAction,
  setMarketingItemPostedAction,
  updateMarketingItemAction,
} from "@/app/actions";
import type { MarketingCampaign, MarketingChannel, MarketingItem, MarketingItemStatus } from "@/lib/types";

/* ------------------------------- channel meta ---------------------------- */

const CHANNELS: { key: MarketingChannel; label: string; badge: string; cls: string }[] = [
  { key: "x", label: "X", badge: "X", cls: "bg-slate-900 text-white dark:bg-white dark:text-slate-900" },
  { key: "linkedin", label: "LinkedIn", badge: "in", cls: "bg-[#0a66c2] text-white" },
  { key: "blog", label: "Blog", badge: "B", cls: "bg-amber-500 text-white" },
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

function fmtDate(iso: string | null): string {
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
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

/* ---------------------------- LinkedIn preview --------------------------- */

function LinkedInPreview({ item, company }: { item: MarketingItem; company: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-slate-900 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0a66c2] text-sm font-bold text-white">
          {(company || "Co").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{company || "Your company"}</div>
          <div className="text-[11px] text-slate-500">Promoted · now</div>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{item.body_md || "Your LinkedIn post…"}</p>
      {item.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_url} alt="" className="mt-2 w-full rounded-md border border-slate-200" />
      )}
      <div className="mt-2 flex gap-4 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </div>
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

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setBody(item.body_md);
    setWhen(toLocalInput(item.scheduled_at));
    setCopied(false);
    setMsg(null);
  }, [item]);

  if (!item) return null;
  const isLinkedIn = item.channel === "linkedin";
  const isBlog = item.channel === "blog";
  const done = item.status === "published";

  async function saveContent() {
    setBusy("save");
    await updateMarketingItemAction(item!.id, { title, body_md: body });
    setBusy(null);
    onChanged();
  }
  async function schedule() {
    if (!when) {
      setMsg({ ok: false, text: "Pick a date and time." });
      return;
    }
    setBusy("schedule");
    await updateMarketingItemAction(item!.id, { title, body_md: body });
    const r = await scheduleMarketingItemAction(item!.id, new Date(when).toISOString());
    setBusy(null);
    if ("ok" in r && r.ok) {
      setMsg({ ok: true, text: isLinkedIn ? "Reminder set — post it manually at that time." : "Scheduled." });
      onChanged();
      void reloadWorkspace();
    } else setMsg({ ok: false, text: ("error" in r && r.error) || "Couldn't schedule." });
  }
  async function publishNow() {
    setBusy("publish");
    await updateMarketingItemAction(item!.id, { title, body_md: body });
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
    if (!window.confirm("Delete this item?")) return;
    await deleteMarketingItemAction(item!.id);
    onChanged();
    onClose();
  }

  return (
    <Dialog open={!!item} onClose={onClose} title={`${CHANNEL_LABEL[item.channel]} post`} className="max-w-2xl">
      <div className="flex max-h-[74vh] flex-col gap-3 overflow-y-auto pr-1">
        {isBlog && (
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}
        <div>
          <Label>{isBlog ? "Body (markdown)" : "Post text"}</Label>
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

        {isLinkedIn && (
          <div>
            <Label>Preview</Label>
            <div className="mt-1">
              <LinkedInPreview item={{ ...item, body_md: body }} company={company} />
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
              {isLinkedIn ? "Set reminder" : "Schedule"}
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
            {isLinkedIn ? (
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

/* ---------------------------- composer dialog ---------------------------- */

function ComposerDialog({
  open,
  campaigns,
  onClose,
  onCreated,
}: {
  open: boolean;
  campaigns: MarketingCampaign[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [channel, setChannel] = useState<MarketingChannel>("x");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChannel("x");
    setTitle("");
    setBody("");
    setCampaignId("");
  }, [open]);

  async function create() {
    if (!body.trim() && !title.trim()) return;
    setSaving(true);
    await createMarketingItemAction({
      channel,
      title,
      body_md: body,
      campaign_id: campaignId || null,
    });
    setSaving(false);
    onCreated();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="New post" className="max-w-xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Segmented
            options={CHANNELS.map((c) => ({ value: c.key, label: c.label }))}
            value={channel}
            onChange={(v) => setChannel(v)}
            size="sm"
          />
        </div>
        {channel === "blog" && (
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title" />
          </div>
        )}
        <div>
          <Label>{channel === "blog" ? "Body (markdown)" : "Post text"}</Label>
          <Textarea rows={channel === "blog" ? 8 : 5} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        {campaigns.length > 0 && (
          <div>
            <Label>Campaign (optional)</Label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
            >
              <option value="">No campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving || (!body.trim() && !title.trim())}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------- campaign dialog ---------------------------- */

function CampaignDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
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
      onCreated();
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
      onCreated();
      onClose();
    } else setError(("error" in r && r.error) || "Couldn't create.");
  }

  return (
    <Dialog open={open} onClose={onClose} title="New campaign" className="max-w-xl">
      <div className="flex flex-col gap-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 product launch" />
        </div>
        <div>
          <Label>Objective</Label>
          <Textarea
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What should this campaign achieve? Who's it for, what's the message?"
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
            <div className="mt-1 flex gap-1.5">
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

/* --------------------------------- page ---------------------------------- */

export default function MarketingPage() {
  const { state } = useStore();
  const company = state?.brief?.company_name || "Your company";
  const [tab, setTab] = useState<"calendar" | "campaigns">("calendar");
  const [campaigns, setCampaigns] = useState<MarketingCampaign[] | null>(null);
  const [items, setItems] = useState<MarketingItem[] | null>(null);
  const [filterCampaign, setFilterCampaign] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<MarketingItem | null>(null);
  const [composer, setComposer] = useState(false);
  const [newCampaign, setNewCampaign] = useState(false);

  const refresh = useCallback(async () => {
    const [cs, its] = await Promise.all([listCampaignsAction(), listMarketingItemsAction()]);
    setCampaigns(cs);
    setItems(its);
    setOpenItem((cur) => (cur ? its.find((i) => i.id === cur.id) ?? null : null));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const shownItems = useMemo(
    () => (items ?? []).filter((i) => (filterCampaign ? i.campaign_id === filterCampaign : true)),
    [items, filterCampaign],
  );

  // Group the calendar by day (scheduled first by time, then unscheduled).
  const groups = useMemo(() => {
    const scheduled = shownItems.filter((i) => i.scheduled_at).sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));
    const unscheduled = shownItems.filter((i) => !i.scheduled_at);
    const byDay = new Map<string, MarketingItem[]>();
    for (const it of scheduled) {
      const key = fmtDate(it.scheduled_at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(it);
    }
    return { byDay, unscheduled };
  }, [shownItems]);

  const filterName = filterCampaign ? campaigns?.find((c) => c.id === filterCampaign)?.name : null;

  return (
    <>
      <PageHeader
        title="Marketing"
        description="Plan campaigns and run your content calendar across X, LinkedIn, and your blog — from one place."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setNewCampaign(true)}>
              <Megaphone className="h-4 w-4" /> New campaign
            </Button>
            <Button size="sm" onClick={() => setComposer(true)}>
              <Plus className="h-4 w-4" /> New post
            </Button>
          </div>
        }
      />
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            options={[
              { value: "calendar", label: "Calendar" },
              { value: "campaigns", label: "Campaigns" },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "calendar" && filterName && (
            <button
              onClick={() => setFilterCampaign(null)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {filterName} <span className="font-semibold">×</span>
            </button>
          )}
        </div>

        {tab === "calendar" ? (
          items === null ? (
            <Loading />
          ) : shownItems.length === 0 ? (
            <Empty onNew={() => setComposer(true)} />
          ) : (
            <div className="flex flex-col gap-4">
              {[...groups.byDay.entries()].map(([day, its]) => (
                <div key={day}>
                  <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{day}</div>
                  <div className="flex flex-col gap-2">
                    {its.map((it) => (
                      <ItemRow key={it.id} item={it} onOpen={() => setOpenItem(it)} />
                    ))}
                  </div>
                </div>
              ))}
              {groups.unscheduled.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">Unscheduled</div>
                  <div className="flex flex-col gap-2">
                    {groups.unscheduled.map((it) => (
                      <ItemRow key={it.id} item={it} onOpen={() => setOpenItem(it)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        ) : campaigns === null ? (
          <Loading />
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
            <Megaphone className="h-9 w-9 opacity-40" />
            <p className="max-w-sm text-sm">No campaigns yet. Describe an objective and let the AI draft a multi-week plan across your channels.</p>
            <Button size="sm" onClick={() => setNewCampaign(true)}>
              <Megaphone className="h-4 w-4" /> New campaign
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onOpen={() => {
                  setFilterCampaign(c.id);
                  setTab("calendar");
                }}
                onDelete={async () => {
                  if (!window.confirm(`Delete "${c.name}"? Its items stay but detach.`)) return;
                  await deleteCampaignAction(c.id);
                  refresh();
                }}
              />
            ))}
          </div>
        )}
      </PageBody>

      <ItemDialog item={openItem} company={company} onClose={() => setOpenItem(null)} onChanged={refresh} />
      <ComposerDialog open={composer} campaigns={campaigns ?? []} onClose={() => setComposer(false)} onCreated={refresh} />
      <CampaignDialog
        open={newCampaign}
        onClose={() => setNewCampaign(false)}
        onCreated={() => {
          setTab("campaigns");
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
function Empty({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
      <CalendarClock className="h-9 w-9 opacity-40" />
      <p className="max-w-sm text-sm">Nothing on the calendar yet. Draft a post or plan a campaign to fill it.</p>
      <Button size="sm" onClick={onNew}>
        <Plus className="h-4 w-4" /> New post
      </Button>
    </div>
  );
}

function ItemRow({ item, onOpen }: { item: MarketingItem; onOpen: () => void }) {
  const st = ITEM_STATUS[item.status];
  return (
    <Card className="flex items-start gap-3 p-3">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <ChannelBadge channel={item.channel} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.title || item.body_md.slice(0, 80) || "Untitled"}</div>
          {item.title && item.body_md && (
            <div className="truncate text-[11px] text-muted-foreground">{item.body_md.slice(0, 100)}</div>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {item.scheduled_at && <span>{fmtDateTime(item.scheduled_at)}</span>}
            {item.campaign_name && <span>· {item.campaign_name}</span>}
          </div>
        </div>
      </button>
      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>
    </Card>
  );
}

function CampaignCard({
  campaign,
  onOpen,
  onDelete,
}: {
  campaign: MarketingCampaign;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <button className="min-w-0 text-left" onClick={onOpen}>
          <div className="truncate text-sm font-semibold hover:underline">{campaign.name}</div>
          {campaign.objective && <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{campaign.objective}</div>}
        </button>
        <button onClick={onDelete} className="shrink-0 text-muted-foreground transition hover:text-destructive" title="Delete campaign">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <button onClick={onOpen} className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{campaign.item_count ?? 0} items</span>
        {(campaign.scheduled_count ?? 0) > 0 && <span className="text-sky-600 dark:text-sky-400">{campaign.scheduled_count} scheduled</span>}
        {(campaign.published_count ?? 0) > 0 && (
          <span className="text-emerald-600 dark:text-emerald-400">{campaign.published_count} published</span>
        )}
      </button>
    </Card>
  );
}
