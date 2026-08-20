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
  Lightbulb,
  Link2,
  ListChecks,
  Loader2,
  MessageCircle,
  MonitorPlay,
  Pause,
  Pencil,
  Play,
  Repeat2,
  Rocket,
  RotateCcw,
  Send,
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
  activateAdPlacementAction,
  createAdCampaignAction,
  deleteAdCampaignAction,
  getAdCampaignAction,
  getAdPlacementAction,
  getXAdsStatusAction,
  listAdCampaignsAction,
  pauseAdPlacementAction,
  publishAdToXAction,
  setAdCreativeStatusAction,
  setAdDestinationAction,
  suggestAdCampaignsAction,
  updateAdCreativeAction,
} from "@/app/actions";
import type {
  AdCampaign,
  AdCampaignIdea,
  AdCampaignSummary,
  AdCreative,
  AdPlacement,
  AdPlatform,
  AdPublishPreview,
  XAdsStatus,
} from "@/lib/types";

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

/** X Ads publish flow for an X creative: dry-run + setup when unconnected,
 *  create-paused + explicit activate (spend) when connected. */
function XPublish({ creative, dailyBudgetCents }: { creative: AdCreative; dailyBudgetCents: number }) {
  const [placement, setPlacement] = useState<AdPlacement | null>(null);
  const [status, setStatus] = useState<XAdsStatus | null>(null);
  const [preview, setPreview] = useState<AdPublishPreview | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdPlacementAction(creative.id).then(setPlacement);
    getXAdsStatusAction().then(setStatus);
  }, [creative.id]);

  async function publish() {
    setBusy(true);
    setError(null);
    const r = await publishAdToXAction(creative.id);
    setBusy(false);
    if (!("ok" in r) || !r.ok) {
      setError("error" in r ? r.error : "Couldn't publish.");
      return;
    }
    setPlacement(r.placement);
    if (r.mode === "dry_run") {
      setPreview(r.preview);
      setMissing(r.missing);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }

  async function activate() {
    if (!placement) return;
    const ok = window.confirm(
      `This starts spending about ${dollars(dailyBudgetCents)}/day on X until you pause it. Go live now?`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    const r = await activateAdPlacementAction(placement.id);
    setBusy(false);
    if ("ok" in r && r.ok) setPlacement(r.placement);
    else setError("error" in r ? r.error : "Couldn't activate.");
  }

  async function pause() {
    if (!placement) return;
    setBusy(true);
    setError(null);
    const r = await pauseAdPlacementAction(placement.id);
    setBusy(false);
    if ("ok" in r && r.ok) setPlacement(r.placement);
    else setError("error" in r ? r.error : "Couldn't pause.");
  }

  const live = placement?.status === "active";
  const paused = placement?.status === "paused";
  const failed = placement?.status === "failed";

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400">
          <Send className="h-3.5 w-3.5" /> Publish to X Ads
        </div>
        {live && (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">Live</span>
        )}
        {paused && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            On X · paused
          </span>
        )}
        {failed && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-600">Failed</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!paused && !live && (
          <Button size="sm" onClick={publish} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {status && !status.ready ? "Preview & set up" : "Publish (paused)"}
          </Button>
        )}
        {paused && (
          <>
            <span className="text-xs text-muted-foreground">Created on X, paused — nothing is spending.</span>
            <Button size="sm" variant="success" onClick={activate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Activate
            </Button>
          </>
        )}
        {live && (
          <>
            <span className="text-xs text-success">
              Live on X{placement && placement.spend_cents > 0 ? ` · ${dollars(placement.spend_cents)} spent` : ""}.
            </span>
            <Button size="sm" variant="secondary" onClick={pause} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
              Pause
            </Button>
          </>
        )}
        {placement?.external_campaign_id && (
          <a href="https://ads.x.com/" target="_blank" rel="noreferrer" className={CHIP}>
            Open in X Ads <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {open && preview && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Preview — nothing was sent</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close preview">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="text-muted-foreground">
            Objective <span className="font-medium text-foreground">{preview.objective}</span> · Budget{" "}
            <span className="font-medium text-foreground">{dollars(preview.daily_budget_cents)}/day</span>
          </div>
          <div className="whitespace-pre-wrap rounded bg-muted/50 p-2">{preview.tweet_text}</div>
          <ol className="ml-4 list-decimal space-y-0.5 text-muted-foreground">
            {preview.steps.map((s, i) => (
              <li key={i}>{s.label}</li>
            ))}
          </ol>
          {missing.length > 0 && (
            <div className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2">
              <div className="font-semibold text-amber-700 dark:text-amber-400">To publish for real, connect X Ads</div>
              <ol className="ml-4 mt-1 list-decimal space-y-0.5 text-muted-foreground">
                <li>
                  Create an app at{" "}
                  <a
                    href="https://developer.x.com/en/portal/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    developer.x.com
                  </a>{" "}
                  and apply for Ads API access.
                </li>
                <li>
                  Create and fund an ads account at{" "}
                  <a href="https://ads.x.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    ads.x.com
                  </a>
                  .
                </li>
                <li>Add these to your environment, then redeploy:</li>
              </ol>
              <ul className="ml-4 mt-1 list-disc font-mono text-[11px] text-muted-foreground">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Friction-free manual handoff for X: the ready-to-paste post + the exact
 *  settings to mirror in X Ads + a deep link. No API / company account needed. */
function XManualHandoff({
  creative,
  destinationUrl,
  campaignName,
  dailyBudgetCents,
}: {
  creative: AdCreative;
  destinationUrl: string;
  campaignName: string;
  dailyBudgetCents: number;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const utm = utmUrl(destinationUrl, "x", campaignName);
  const post = [creative.primary_text?.trim(), utm].filter(Boolean).join("\n\n");
  const objective = destinationUrl ? "Website traffic" : "Engagements";

  async function copy(which: string, text: string) {
    if (text && (await copyText(text))) {
      setCopied(which);
      setTimeout(() => setCopied(null), 1400);
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400">
        <Send className="h-3.5 w-3.5" /> Publish on X Ads
      </div>
      <p className="text-xs text-muted-foreground">
        Create the campaign in X Ads and paste each piece below — about two minutes, no API needed.
      </p>

      {/* The post to promote */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Promoted post</span>
          <button
            type="button"
            onClick={() => copy("post", post || creative.primary_text)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {copied === "post" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === "post" ? "Copied" : "Copy post"}
          </button>
        </div>
        <div className="whitespace-pre-wrap rounded-md bg-background p-2.5 text-[13px] leading-snug">
          {post || creative.primary_text}
        </div>
      </div>

      {/* Settings to mirror in X's campaign creator */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Objective</div>
          <div className="truncate font-medium">{objective}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Daily budget</div>
          <div className="truncate font-medium">{dollars(dailyBudgetCents)}/day</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Location</div>
          <div className="truncate font-medium">{creative.geo || "—"}</div>
        </div>
        <button
          type="button"
          onClick={() => copy("aud", creative.audience)}
          className="min-w-0 text-left"
          title="Copy audience"
        >
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Audience {copied === "aud" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </div>
          <div className="truncate font-medium">{creative.audience || "—"}</div>
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        <a href="https://ads.x.com/" target="_blank" rel="noreferrer" className={CHIP}>
          Create on X Ads <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          onClick={() => copy("utm", utm)}
          disabled={!utm}
          title={utm || "Set a destination URL above to build the tracked link"}
          className={CHIP}
        >
          {copied === "utm" ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          {copied === "utm" ? "Copied" : "UTM link"}
        </button>
        {creative.image_url && (
          <a href={creative.image_url} target="_blank" rel="noreferrer" className={CHIP}>
            Image <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button type="button" onClick={() => setShowSteps((v) => !v)} className={CHIP}>
          <ListChecks className="h-3.5 w-3.5" /> Steps
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showSteps && "rotate-180")} />
        </button>
      </div>
      {showSteps && (
        <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
          {LAUNCH.x.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A labeled, copy-to-clipboard field for manual paste-in handoffs. */
function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    if (value && (await copyText(value))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          disabled={!value}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className={cn(
          "whitespace-pre-wrap rounded-md bg-background p-2.5 text-[13px] leading-snug",
          mono && "break-all font-mono text-[12px]",
        )}
      >
        {value || "—"}
      </div>
    </div>
  );
}

/** Friction-free manual handoff for Google Search ads. No API needed. */
function GoogleManualHandoff({
  creative,
  destinationUrl,
  campaignName,
  dailyBudgetCents,
}: {
  creative: AdCreative;
  destinationUrl: string;
  campaignName: string;
  dailyBudgetCents: number;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const utm = utmUrl(destinationUrl, "google", campaignName);
  const keywords = creative.keywords.join(", ");

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        <Send className="h-3.5 w-3.5" /> Publish on Google Ads
      </div>
      <p className="text-xs text-muted-foreground">
        Create a Search campaign in Google Ads and paste each piece below — about two minutes, no API needed.
      </p>

      <CopyField label="Headline" value={creative.headline} />
      <CopyField label="Description" value={creative.description} />
      {keywords && <CopyField label="Keywords" value={keywords} />}
      <CopyField label="Final URL" value={utm || destinationUrl} mono />

      <p className="text-[11px] text-muted-foreground">
        Google asks for 3+ headlines and 2+ descriptions per ad — add a couple more variations when you paste these in.
      </p>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Goal</div>
          <div className="truncate font-medium">Website traffic</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Daily budget</div>
          <div className="truncate font-medium">{dollars(dailyBudgetCents)}/day</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Location</div>
          <div className="truncate font-medium">{creative.geo || "—"}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <a href="https://ads.google.com/" target="_blank" rel="noreferrer" className={CHIP}>
          Create on Google Ads <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button type="button" onClick={() => setShowSteps((v) => !v)} className={CHIP}>
          <ListChecks className="h-3.5 w-3.5" /> Steps
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showSteps && "rotate-180")} />
        </button>
      </div>
      {showSteps && (
        <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
          {LAUNCH.google.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CreativeCard({
  creative,
  brand,
  destinationUrl,
  campaignName,
  dailyBudgetCents,
  xAdsConfigured,
  onChange,
}: {
  creative: AdCreative;
  brand: string;
  destinationUrl: string;
  campaignName: string;
  dailyBudgetCents: number;
  xAdsConfigured: boolean;
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

  // X uses the friction-free manual handoff unless the Ads API is configured.
  const isXManual = creative.platform === "x" && !xAdsConfigured;
  const launchedControl = (
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
  );

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
          {isXManual ? (
            <XManualHandoff
              creative={creative}
              destinationUrl={destinationUrl}
              campaignName={campaignName}
              dailyBudgetCents={dailyBudgetCents}
            />
          ) : creative.platform === "google" ? (
            <GoogleManualHandoff
              creative={creative}
              destinationUrl={destinationUrl}
              campaignName={campaignName}
              dailyBudgetCents={dailyBudgetCents}
            />
          ) : (
            <>
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
            </>
          )}

          {creative.platform === "x" && xAdsConfigured ? (
            <XPublish creative={creative} dailyBudgetCents={dailyBudgetCents} />
          ) : (
            launchedControl
          )}
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
  const [suggesting, setSuggesting] = useState(false);
  const [ideas, setIdeas] = useState<AdCampaignIdea[]>([]);

  const [campaign, setCampaign] = useState<AdCampaign | null>(null);
  const [history, setHistory] = useState<AdCampaignSummary[]>([]);
  const [dest, setDest] = useState("");
  const [savingDest, setSavingDest] = useState(false);
  const [xAdsConfigured, setXAdsConfigured] = useState(false);

  const platforms = useMemo(
    () => (Object.keys(selected) as AdPlatform[]).filter((p) => selected[p]),
    [selected],
  );

  useEffect(() => {
    listAdCampaignsAction().then(setHistory);
    getXAdsStatusAction().then((s) => setXAdsConfigured(s.configured));
  }, []);

  // Keep the URL box in sync with whichever campaign is open.
  useEffect(() => {
    setDest(campaign?.destination_url ?? "");
  }, [campaign?.id, campaign?.destination_url]);

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setError(null);
    const r = await suggestAdCampaignsAction();
    setSuggesting(false);
    if ("ok" in r && r.ok) setIdeas(r.ideas);
    else setError("error" in r ? r.error : "Couldn't suggest campaigns.");
  }

  function applyIdea(idea: AdCampaignIdea) {
    setObjective(idea.objective);
    setSelected({
      meta: idea.platforms.includes("meta"),
      google: idea.platforms.includes("google"),
      x: idea.platforms.includes("x"),
      linkedin: idea.platforms.includes("linkedin"),
    });
    setIdeas([]);
  }

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
            <div className="mb-1 flex items-center justify-between gap-2">
              <Label htmlFor="ad-objective">What should this campaign achieve?</Label>
              <button
                type="button"
                onClick={suggest}
                disabled={suggesting}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}
                {suggesting ? "Reading your strategy…" : "Suggest campaigns"}
              </button>
            </div>
            <Textarea
              id="ad-objective"
              rows={3}
              placeholder="e.g. Get 50 demo bookings from operations leaders at US logistics companies this month."
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />

            {ideas.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-2.5">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    From your strategy — pick one to start
                  </span>
                  <button
                    type="button"
                    onClick={() => setIdeas([])}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss suggestions"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {ideas.map((idea, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => applyIdea(idea)}
                      className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-accent/40"
                    >
                      <span className="text-sm font-semibold leading-tight">{idea.title}</span>
                      <span className="text-xs leading-snug text-muted-foreground">{idea.rationale}</span>
                      <span className="mt-auto flex flex-wrap gap-1 pt-1">
                        {idea.platforms.map((p) => (
                          <span
                            key={p}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {PLATFORM_LABEL[p]}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                  dailyBudgetCents={campaign.daily_budget_cents}
                  xAdsConfigured={xAdsConfigured}
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
              Describe a goal above — or hit <span className="font-medium text-foreground">Suggest campaigns</span> to
              start from your strategy — and the Growth agent will draft native ads for each platform, ready to review,
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
