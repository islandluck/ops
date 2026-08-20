"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Heart,
  Link2,
  ListChecks,
  Loader2,
  MessageCircle,
  MonitorPlay,
  Pencil,
  Repeat2,
  Rocket,
  RotateCcw,
  Sparkles,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  createAdCampaignAction,
  deleteAdCampaignAction,
  getAdCampaignAction,
  listAdCampaignsAction,
  setAdCreativeStatusAction,
  setAdDestinationAction,
  updateAdCreativeAction,
} from "@/app/actions";
import type { AdCampaign, AdCampaignSummary, AdCreative, AdPlatform } from "@/lib/types";

const PLATFORMS: { key: AdPlatform; label: string; hint: string }[] = [
  { key: "meta", label: "Meta", hint: "Facebook · Instagram" },
  { key: "google", label: "Google", hint: "Search · YouTube" },
  { key: "x", label: "X", hint: "Twitter" },
  { key: "linkedin", label: "LinkedIn", hint: "Sponsored" },
];

const PLATFORM_LABEL: Record<AdPlatform, string> = {
  meta: "Meta",
  google: "Google",
  x: "X",
  linkedin: "LinkedIn",
};

/** Where each platform's ad is actually created, plus how to tag its UTM + launch it. */
const LAUNCH: Record<AdPlatform, { adManager: string; utmSource: string; utmMedium: string; steps: string[] }> = {
  meta: {
    adManager: "https://www.facebook.com/adsmanager/",
    utmSource: "facebook",
    utmMedium: "paid_social",
    steps: [
      "Open Meta Ads Manager and click Create.",
      "Choose your objective and set the daily budget.",
      "Paste the primary text, headline, and description; set the CTA button.",
      "Upload the image and set the website URL to the UTM link.",
      "Set the audience + location, then review and publish.",
    ],
  },
  google: {
    adManager: "https://ads.google.com/",
    utmSource: "google",
    utmMedium: "cpc",
    steps: [
      "Open Google Ads → new Search campaign.",
      "Add the keywords below as your ad group targeting.",
      "Paste the headline and description into a responsive search ad.",
      "Set the final URL to the UTM link, then set the daily budget.",
      "Review and publish.",
    ],
  },
  x: {
    adManager: "https://ads.x.com/",
    utmSource: "twitter",
    utmMedium: "paid_social",
    steps: [
      "Open X Ads → create a new campaign.",
      "Post (or promote) the primary text below with the image.",
      "Set the destination to the UTM link and the CTA button.",
      "Set the audience + budget, then launch.",
    ],
  },
  linkedin: {
    adManager: "https://www.linkedin.com/campaignmanager/",
    utmSource: "linkedin",
    utmMedium: "paid_social",
    steps: [
      "Open LinkedIn Campaign Manager → new Sponsored Content campaign.",
      "Paste the intro text and headline; set the CTA.",
      "Upload the image and set the landing URL to the UTM link.",
      "Set the professional audience + budget, then launch.",
    ],
  },
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "yourbrand";
}

/** Append UTM params to the campaign's destination URL, tagged for one platform. */
function utmUrl(dest: string, platform: AdPlatform, campaign: string): string {
  if (!dest) return "";
  try {
    const u = new URL(dest);
    u.searchParams.set("utm_source", LAUNCH[platform].utmSource);
    u.searchParams.set("utm_medium", LAUNCH[platform].utmMedium);
    u.searchParams.set("utm_campaign", slugify(campaign));
    return u.toString();
  } catch {
    return dest;
  }
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function creativeToText(c: AdCreative): string {
  const lines = [
    `— ${PLATFORM_LABEL[c.platform]} · ${c.format} —`,
    c.headline && `Headline: ${c.headline}`,
    c.primary_text && `Primary text: ${c.primary_text}`,
    c.description && `Description: ${c.description}`,
    c.cta && `CTA: ${c.cta}`,
    c.audience && `Audience: ${c.audience}`,
    c.geo && `Geo: ${c.geo}`,
    c.keywords.length && `Keywords: ${c.keywords.join(", ")}`,
  ].filter(Boolean);
  return lines.join("\n");
}

function campaignToText(c: AdCampaign): string {
  return [
    c.name,
    `Objective: ${c.objective}`,
    `Audience: ${c.audience}`,
    `Suggested budget: ${dollars(c.daily_budget_cents)}/day`,
    "",
    ...c.creatives.map(creativeToText),
  ].join("\n\n");
}

/** All creatives as a spreadsheet row set, ready for a platform's bulk importer. */
function campaignToCsv(c: AdCampaign): string {
  const head = [
    "Platform",
    "Format",
    "Headline",
    "Primary text",
    "Description",
    "CTA",
    "Keywords",
    "Audience",
    "Geo",
    "Destination URL",
    "Daily budget",
    "Status",
  ];
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const rows = c.creatives.map((cr) =>
    [
      PLATFORM_LABEL[cr.platform],
      cr.format,
      cr.headline,
      cr.primary_text,
      cr.description,
      cr.cta,
      cr.keywords.join("; "),
      cr.audience,
      cr.geo,
      utmUrl(c.destination_url, cr.platform, c.name),
      `${dollars(c.daily_budget_cents)}/day`,
      cr.status,
    ]
      .map((v) => esc(String(v)))
      .join(","),
  );
  return [head.map(esc).join(","), ...rows].join("\r\n");
}

/** Trigger a client-side file download of generated text (the user's own click). */
function downloadFile(name: string, text: string, mime = "text/csv"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Small avatar tile from the brand's first letter. */
function BrandDot({ brand, className }: { brand: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 font-bold text-white",
        className,
      )}
    >
      {(brand[0] || "A").toUpperCase()}
    </div>
  );
}

/** Platform-native mock of how the finished ad will look. Kept intentionally
 *  light-themed to mirror the real ad surfaces regardless of app theme. */
function AdPreview({ c, brand }: { c: AdCreative; brand: string }) {
  const slug = slugify(brand);
  const img = c.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.image_url} alt={c.image_alt || c.headline} className="aspect-[1.91/1] w-full object-cover" />
  ) : (
    <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-neutral-100 text-neutral-400">
      <MonitorPlay className="h-8 w-8" />
    </div>
  );

  if (c.platform === "google") {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-sm">
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="rounded-sm border border-neutral-300 px-1 font-bold leading-tight">Ad</span>
          <span className="text-neutral-500">·</span>
          <span className="text-neutral-700">{slug}.com</span>
        </div>
        <div className="mt-1 text-[18px] leading-snug text-[#1a0dab]">{c.headline || "Your headline here"}</div>
        <div className="mt-0.5 text-[13px] leading-snug text-neutral-700">{c.description}</div>
        {c.keywords.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {c.keywords.map((k) => (
              <span key={k} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                {k}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (c.platform === "x") {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-3 text-neutral-900 shadow-sm">
        <div className="flex items-start gap-2.5">
          <BrandDot brand={brand} className="h-10 w-10 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[13px]">
              <span className="font-bold">{brand}</span>
              <Check className="h-3.5 w-3.5 rounded-full bg-sky-500 p-[1px] text-white" />
              <span className="text-neutral-500">@{slug} · Promoted</span>
            </div>
            <div className="mt-0.5 whitespace-pre-wrap text-[14px] leading-snug">{c.primary_text}</div>
            {c.image_url && <div className="mt-2 overflow-hidden rounded-2xl border border-neutral-200">{img}</div>}
            <div className="mt-2.5 flex items-center justify-between pr-6 text-neutral-500">
              <MessageCircle className="h-4 w-4" />
              <Repeat2 className="h-4 w-4" />
              <Heart className="h-4 w-4" />
              {c.cta && (
                <span className="rounded-full border border-neutral-300 px-3 py-0.5 text-[12px] font-semibold text-neutral-800">
                  {c.cta}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (c.platform === "linkedin") {
    return (
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-sm">
        <div className="flex items-center gap-2.5 p-3">
          <BrandDot brand={brand} className="h-11 w-11 rounded-md text-sm" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{brand}</div>
            <div className="text-[11px] text-neutral-500">Promoted</div>
          </div>
        </div>
        <div className="px-3 pb-2 text-[13px] leading-snug">{c.primary_text}</div>
        {img}
        <div className="flex items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-3 py-2.5">
          <div className="min-w-0 text-[13px] font-semibold">{c.headline}</div>
          {c.cta && (
            <button className="shrink-0 rounded-full border-2 border-[#0a66c2] px-3 py-1 text-[12px] font-semibold text-[#0a66c2]">
              {c.cta}
            </button>
          )}
        </div>
      </div>
    );
  }

  // meta (default)
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-sm">
      <div className="flex items-center gap-2.5 p-3">
        <BrandDot brand={brand} className="h-10 w-10 text-sm" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{brand}</div>
          <div className="flex items-center gap-1 text-[11px] text-neutral-500">
            Sponsored · <Globe className="h-3 w-3" />
          </div>
        </div>
      </div>
      <div className="px-3 pb-2.5 text-[13px] leading-snug">{c.primary_text}</div>
      {img}
      <div className="flex items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">{c.geo}</div>
          <div className="truncate text-[13px] font-semibold">{c.headline}</div>
          <div className="truncate text-[11px] text-neutral-500">{c.description}</div>
        </div>
        {c.cta && (
          <button className="shrink-0 rounded-md bg-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-800">
            {c.cta}
          </button>
        )}
      </div>
      <div className="flex items-center justify-around border-t border-neutral-200 py-1.5 text-[12px] text-neutral-500">
        <span className="flex items-center gap-1">
          <ThumbsUp className="h-3.5 w-3.5" /> Like
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="h-3.5 w-3.5" /> Comment
        </span>
        <span className="flex items-center gap-1">
          <Repeat2 className="h-3.5 w-3.5" /> Share
        </span>
      </div>
    </div>
  );
}

const EDIT_FIELDS: { key: keyof AdCreative; label: string; area?: boolean }[] = [
  { key: "headline", label: "Headline" },
  { key: "primary_text", label: "Primary text", area: true },
  { key: "description", label: "Description" },
  { key: "cta", label: "Call to action" },
  { key: "audience", label: "Audience" },
  { key: "geo", label: "Geo" },
];

const CHIP =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";

function CreativeCard({
  creative,
  brand,
  destinationUrl,
  campaignName,
  onChange,
}: {
  creative: AdCreative;
  brand: string;
  destinationUrl: string;
  campaignName: string;
  onChange: (c: AdCreative) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(creative);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUtm, setCopiedUtm] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [placement, setPlacement] = useState(creative.placement_ref);

  const launched = creative.status === "launched";
  const link = LAUNCH[creative.platform];
  const utm = utmUrl(destinationUrl, creative.platform, campaignName);

  async function save() {
    setSaving(true);
    const r = await updateAdCreativeAction(creative.id, {
      headline: draft.headline,
      primary_text: draft.primary_text,
      description: draft.description,
      cta: draft.cta,
      audience: draft.audience,
      geo: draft.geo,
    });
    setSaving(false);
    if ("ok" in r && r.ok) {
      onChange(draft);
      setEditing(false);
    }
  }

  async function copy() {
    if (await copyText(creativeToText(creative))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }

  async function copyUtm() {
    if (utm && (await copyText(utm))) {
      setCopiedUtm(true);
      setTimeout(() => setCopiedUtm(false), 1400);
    }
  }

  async function toggleLaunched() {
    const next = launched ? "draft" : "launched";
    setBusy(true);
    const r = await setAdCreativeStatusAction(creative.id, next, placement);
    setBusy(false);
    if ("ok" in r && r.ok) onChange({ ...creative, status: next, placement_ref: placement });
  }

  return (
    <Card className={cn("flex flex-col gap-3 p-4", launched && "ring-1 ring-success/40")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {PLATFORM_LABEL[creative.platform]}
          </span>
          {launched ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
              <Check className="h-3 w-3" /> Launched
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{creative.format}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant={editing ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setDraft(creative);
              setEditing((e) => !e);
            }}
          >
            {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      </div>

      <AdPreview c={creative} brand={brand} />

      {creative.audience && !editing && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Targeting:</span> {creative.audience} · {creative.geo}
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          {EDIT_FIELDS.map((f) => (
            <div key={f.key}>
              <Label className="text-xs">{f.label}</Label>
              {f.area ? (
                <Textarea
                  rows={3}
                  value={(draft[f.key] as string) ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              ) : (
                <Input
                  value={(draft[f.key] as string) ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Launch kit */}
      {!editing && (
        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          <div className="flex flex-wrap gap-1.5">
            <a href={link.adManager} target="_blank" rel="noreferrer" className={CHIP}>
              Open {PLATFORM_LABEL[creative.platform]} <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={copyUtm}
              disabled={!utm}
              title={utm || "Add a destination URL above to build UTM links"}
              className={CHIP}
            >
              {copiedUtm ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {copiedUtm ? "Copied" : "UTM link"}
            </button>
            {creative.image_url && (
              <a href={creative.image_url} target="_blank" rel="noreferrer" className={CHIP}>
                Image <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button type="button" onClick={() => setShowSteps((v) => !v)} className={CHIP}>
              <ListChecks className="h-3.5 w-3.5" /> How to launch
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showSteps && "rotate-180")} />
            </button>
          </div>

          {showSteps && (
            <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
              {link.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              placeholder="Where's it live? (optional note / campaign ID)"
              className="h-8 text-xs"
            />
            <Button
              variant={launched ? "secondary" : "success"}
              size="sm"
              onClick={toggleLaunched}
              disabled={busy}
              className="shrink-0"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : launched ? (
                <RotateCcw className="h-3.5 w-3.5" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              {launched ? "Mark draft" : "Mark launched"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function AdsPage() {
  const { state } = useStore();
  const brand = state?.brief.company_name?.trim() || "Your brand";

  const [objective, setObjective] = useState("");
  const [selected, setSelected] = useState<Record<AdPlatform, boolean>>({
    meta: true,
    google: true,
    x: true,
    linkedin: false,
  });
  const [budget, setBudget] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [campaign, setCampaign] = useState<AdCampaign | null>(null);
  const [history, setHistory] = useState<AdCampaignSummary[]>([]);
  const [dest, setDest] = useState("");
  const [savingDest, setSavingDest] = useState(false);

  const platforms = useMemo(
    () => (Object.keys(selected) as AdPlatform[]).filter((p) => selected[p]),
    [selected],
  );

  useEffect(() => {
    listAdCampaignsAction().then(setHistory);
  }, []);

  // Keep the URL box in sync with whichever campaign is open.
  useEffect(() => {
    setDest(campaign?.destination_url ?? "");
  }, [campaign?.id, campaign?.destination_url]);

  async function generate() {
    if (!objective.trim() || !platforms.length || generating) return;
    setGenerating(true);
    setError(null);
    const budgetCents = budget.trim() && Number(budget) > 0 ? Math.round(Number(budget) * 100) : undefined;
    const r = await createAdCampaignAction({ objective: objective.trim(), platforms, budgetCents });
    setGenerating(false);
    if ("ok" in r && r.ok) {
      setCampaign(r.campaign);
      setHistory((h) => [
        {
          id: r.campaign.id,
          name: r.campaign.name,
          status: r.campaign.status,
          platforms: r.campaign.creatives.map((c) => c.platform),
          launched: 0,
          created_at: r.campaign.created_at,
        },
        ...h,
      ]);
    } else {
      setError("error" in r ? r.error : "Couldn't generate the campaign.");
    }
  }

  async function openCampaign(id: string) {
    const r = await getAdCampaignAction(id);
    if ("campaign" in r) setCampaign(r.campaign);
  }

  async function removeCampaign(id: string) {
    await deleteAdCampaignAction(id);
    setHistory((h) => h.filter((c) => c.id !== id));
    if (campaign?.id === id) setCampaign(null);
  }

  async function exportCampaign() {
    if (campaign) await copyText(campaignToText(campaign));
  }

  function exportCsv() {
    if (campaign) downloadFile(`${slugify(campaign.name)}-ads.csv`, campaignToCsv(campaign));
  }

  async function saveDest() {
    if (!campaign) return;
    setSavingDest(true);
    const r = await setAdDestinationAction(campaign.id, dest);
    setSavingDest(false);
    if ("ok" in r && r.ok) {
      setCampaign((prev) => (prev ? { ...prev, destination_url: r.destination_url } : prev));
    }
  }

  // A creative changed (edit or launch toggle): update the open campaign, roll its
  // status up, and keep the history row's launched count in sync.
  function handleCreativeChange(updated: AdCreative) {
    setCampaign((prev) => {
      if (!prev) return prev;
      const creatives = prev.creatives.map((x) => (x.id === updated.id ? updated : x));
      const status = creatives.some((c) => c.status === "launched") ? "launched" : "draft";
      return { ...prev, creatives, status };
    });
    if (campaign) {
      const creatives = campaign.creatives.map((x) => (x.id === updated.id ? updated : x));
      const launched = creatives.filter((c) => c.status === "launched").length;
      const status = launched > 0 ? "launched" : "draft";
      setHistory((h) => h.map((row) => (row.id === campaign.id ? { ...row, status, launched } : row)));
    }
  }

  return (
    <>
      <PageHeader
        title="Ads Manager"
        description="Turn one objective into launch-ready ads for every platform — copy, targeting, and budget."
      />
      <PageBody className="max-w-6xl">
        {/* Composer */}
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <Label htmlFor="ad-objective">What should this campaign achieve?</Label>
            <Textarea
              id="ad-objective"
              rows={3}
              placeholder="e.g. Get 50 demo bookings from operations leaders at US logistics companies this month."
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </div>

          <div>
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const on = selected[p.key];
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setSelected((s) => ({ ...s, [p.key]: !s[p.key] }))}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                      on
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-input",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium leading-tight">{p.label}</span>
                      <span className="block text-[11px] leading-tight opacity-70">{p.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <Label htmlFor="ad-budget">Daily budget (optional)</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="ad-budget"
                  type="number"
                  min={1}
                  placeholder="30"
                  className="pl-6"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {error && <span className="text-sm text-red-600">{error}</span>}
              <Button onClick={generate} disabled={generating || !objective.trim() || !platforms.length}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? "Building your ads…" : "Generate campaign"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Result */}
        {campaign && (
          <div className="mt-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{campaign.name}</h2>
                  {(() => {
                    const n = campaign.creatives.filter((c) => c.status === "launched").length;
                    return n > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                        <Rocket className="h-3 w-3" />
                        {n === campaign.creatives.length ? "Launched" : `${n} live`}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        Draft
                      </span>
                    );
                  })()}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{campaign.audience}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
                    {dollars(campaign.daily_budget_cents)}/day suggested
                  </span>
                  <span>{campaign.creatives.length} ads</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={exportCampaign}>
                  <Copy className="h-3.5 w-3.5" />
                  Copy all
                </Button>
              </div>
            </div>

            {/* Destination URL — drives per-platform UTM links */}
            <Card className="mt-4 flex flex-wrap items-end gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Label htmlFor="ad-dest" className="flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5" /> Destination URL
                </Label>
                <Input
                  id="ad-dest"
                  placeholder="https://yoursite.com/offer"
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveDest()}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Where clicks land. Each ad gets its own UTM-tagged link so you can track results.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={saveDest}
                disabled={savingDest || dest.trim() === (campaign.destination_url ?? "")}
              >
                {savingDest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save URL
              </Button>
            </Card>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {campaign.creatives.map((c) => (
                <CreativeCard
                  key={c.id}
                  creative={c}
                  brand={brand}
                  destinationUrl={campaign.destination_url}
                  campaignName={campaign.name}
                  onChange={handleCreativeChange}
                />
              ))}
            </div>
          </div>
        )}

        {!campaign && !generating && (
          <div className="mt-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
            <MonitorPlay className="h-9 w-9 opacity-40" />
            <p className="text-sm">
              Describe a goal above and the Growth agent will draft native ads for each platform — ready to review,
              edit, and hand to your ad accounts.
            </p>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-10">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Past campaigns
            </h3>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
              {history.map((h) => (
                <div key={h.id} className="group flex items-center gap-3 bg-card px-4 py-3 hover:bg-accent/40">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => openCampaign(h.id)}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{h.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {h.platforms.map((p) => (
                          <span key={p} className="rounded bg-muted px-1.5 py-0.5">
                            {PLATFORM_LABEL[p]}
                          </span>
                        ))}
                        <span>· {new Date(h.created_at).toLocaleDateString()}</span>
                        {h.launched > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-0.5 font-medium text-success">
                            <Rocket className="h-3 w-3" /> {h.launched} live
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => removeCampaign(h.id)}
                    aria-label="Delete campaign"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
