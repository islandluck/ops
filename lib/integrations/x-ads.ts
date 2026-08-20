import "server-only";

import crypto from "node:crypto";
import type { AdCampaign, AdCreative } from "@/lib/types";

/**
 * X (Twitter) Ads API integration.
 *
 * SAFETY: every campaign this creates is entry_status=PAUSED — it never spends
 * on publish. Only an explicit, human-triggered activate flips a campaign live.
 *
 * The X Ads API (ads-api.x.com) is separate from the v2 posting API: it needs
 * Ads API access approved on a developer app, OAuth 1.0a app + user credentials,
 * and a funded ads account. Until all five values are in the environment, every
 * call here runs in DRY-RUN — it returns the exact plan it would send and what's
 * still missing, and sends nothing.
 */

const X_ADS_API = "https://ads-api.x.com/12";

export interface XAdsCreds {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
  accountId: string;
}

/** The app is registered (consumer keys present) — enough to describe the setup. */
export function xAdsConfigured(): boolean {
  return Boolean(process.env.X_ADS_CONSUMER_KEY && process.env.X_ADS_CONSUMER_SECRET);
}

/** All five values present → we can actually talk to the Ads API for this account. */
export function xAdsCreds(): XAdsCreds | null {
  const consumerKey = process.env.X_ADS_CONSUMER_KEY;
  const consumerSecret = process.env.X_ADS_CONSUMER_SECRET;
  const token = process.env.X_ADS_ACCESS_TOKEN;
  const tokenSecret = process.env.X_ADS_ACCESS_SECRET;
  const accountId = process.env.X_ADS_ACCOUNT_ID;
  if (consumerKey && consumerSecret && token && tokenSecret && accountId) {
    return { consumerKey, consumerSecret, token, tokenSecret, accountId };
  }
  return null;
}

/** Which required env values are still missing (for the setup checklist). */
export function xAdsMissing(): string[] {
  const need: [string, string][] = [
    ["X_ADS_CONSUMER_KEY", "App API key"],
    ["X_ADS_CONSUMER_SECRET", "App API secret"],
    ["X_ADS_ACCESS_TOKEN", "Your access token"],
    ["X_ADS_ACCESS_SECRET", "Your access token secret"],
    ["X_ADS_ACCOUNT_ID", "Ads account id"],
  ];
  return need.filter(([k]) => !process.env[k]).map(([k, label]) => `${label} (${k})`);
}

// ── OAuth 1.0a signing ──────────────────────────────────────────────────────

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Encode form/query params the same way the signature base string does. */
function encodeParams(params: Record<string, string>): string {
  return Object.keys(params)
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");
}

/** Build the OAuth 1.0a Authorization header for one signed request. */
function oauth1Header(
  method: string,
  baseUrl: string,
  params: Record<string, string>,
  creds: XAdsCreds,
  nonce: string,
  timestamp: string,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(all[k])}`)
    .join("&");
  const base = [method.toUpperCase(), rfc3986(baseUrl), rfc3986(paramString)].join("&");
  const signingKey = `${rfc3986(creds.consumerSecret)}&${rfc3986(creds.tokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
  const header: Record<string, string> = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${rfc3986(k)}="${rfc3986(header[k])}"`)
      .join(", ")
  );
}

/** Exposed for testing the signer against known vectors. */
export function _signatureBaseAndHeader(
  method: string,
  baseUrl: string,
  params: Record<string, string>,
  creds: XAdsCreds,
  nonce: string,
  timestamp: string,
): string {
  return oauth1Header(method, baseUrl, params, creds, nonce, timestamp);
}

async function xAdsRequest(
  creds: XAdsCreds,
  method: "GET" | "POST" | "PUT",
  path: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const baseUrl = `${X_ADS_API}${path}`;
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = String(Math.floor(new Date().getTime() / 1000));
  const auth = oauth1Header(method, baseUrl, params, creds, nonce, timestamp);
  const headers: Record<string, string> = { Authorization: auth };
  let url = baseUrl;
  const init: RequestInit = { method, headers };
  const encoded = encodeParams(params);
  if (method === "GET") {
    if (encoded) url += `?${encoded}`;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = encoded;
  }
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = JSON.stringify((json as { errors?: unknown }).errors ?? json).slice(0, 300);
    throw new Error(`X Ads ${method} ${path} → ${res.status}: ${detail}`);
  }
  return json;
}

// ── Campaign mapping ────────────────────────────────────────────────────────

/** cents → X's local-micro amount (1 unit = 1e-6 of the account currency). */
function centsToMicro(cents: number): number {
  return Math.max(0, Math.round(cents)) * 10_000;
}

/** WEBSITE_CLICKS when we have a landing URL, else engagement. */
function objectiveFor(campaign: AdCampaign): string {
  return campaign.destination_url ? "WEBSITE_CLICKS" : "ENGAGEMENTS";
}

/** The promoted-only tweet body — ad copy plus the (UTM-tagged) destination. */
function tweetTextFor(campaign: AdCampaign, creative: AdCreative): string {
  const parts = [creative.primary_text?.trim()].filter(Boolean) as string[];
  if (campaign.destination_url) parts.push(campaign.destination_url);
  return parts.join("\n\n").slice(0, 280);
}

export interface XPlanStep {
  label: string;
  method: "GET" | "POST" | "PUT";
  path: string;
  params?: Record<string, string>;
}

export interface XCampaignPlan {
  objective: string;
  dailyBudgetMicro: number;
  tweetText: string;
  steps: XPlanStep[];
}

/**
 * The exact, ordered sequence of X Ads API calls a publish would make — for the
 * dry-run preview. `:account_id` and chained `:campaign_id` / `:line_item_id` /
 * `:tweet_id` are filled from prior responses at execution time.
 */
export function buildXCampaignPlan(campaign: AdCampaign, creative: AdCreative): XCampaignPlan {
  const objective = objectiveFor(campaign);
  const dailyBudgetMicro = centsToMicro(campaign.daily_budget_cents);
  const tweetText = tweetTextFor(campaign, creative);
  const name = campaign.name.slice(0, 100) || "Ad campaign";

  return {
    objective,
    dailyBudgetMicro,
    tweetText,
    steps: [
      {
        label: "Create campaign (PAUSED)",
        method: "POST",
        path: "/accounts/:account_id/campaigns",
        params: {
          name,
          funding_instrument_id: ":funding_instrument_id",
          daily_budget_amount_local_micro: String(dailyBudgetMicro),
          entry_status: "PAUSED",
        },
      },
      {
        label: "Create ad group / line item (PAUSED)",
        method: "POST",
        path: "/accounts/:account_id/line_items",
        params: {
          campaign_id: ":campaign_id",
          name: name.slice(0, 90) + " — ads",
          product_type: "PROMOTED_TWEETS",
          placements: "ALL_ON_TWITTER",
          objective,
          bid_strategy: "AUTO",
          entry_status: "PAUSED",
        },
      },
      {
        label: "Create promoted-only tweet",
        method: "POST",
        path: "/accounts/:account_id/tweet",
        params: { text: tweetText, nullcast: "true" },
      },
      {
        label: "Attach tweet to the ad group",
        method: "POST",
        path: "/accounts/:account_id/promoted_tweets",
        params: { line_item_id: ":line_item_id", tweet_ids: ":tweet_id" },
      },
    ],
  };
}

// ── Live execution (only when fully configured) ─────────────────────────────

export interface XPublishResult {
  campaignId: string;
  lineItemId: string;
  tweetId: string;
  status: "paused";
}

function firstId(json: Record<string, unknown>): string {
  const data = (json as { data?: unknown }).data;
  if (Array.isArray(data)) return String((data[0] as { id?: unknown })?.id ?? "");
  return String((data as { id?: unknown; id_str?: unknown })?.id ?? (data as { id_str?: unknown })?.id_str ?? "");
}

/**
 * Create the campaign on X, PAUSED. Spends nothing. Requires full creds — callers
 * must gate on xAdsCreds(). Throws with the platform error on any failed step.
 */
export async function publishToX(
  creds: XAdsCreds,
  campaign: AdCampaign,
  creative: AdCreative,
): Promise<XPublishResult> {
  const acct = `/accounts/${creds.accountId}`;
  const plan = buildXCampaignPlan(campaign, creative);

  // A funding instrument is required to create a campaign.
  const funding = await xAdsRequest(creds, "GET", `${acct}/funding_instruments`, { count: "1" });
  const fundingId = firstId(funding);
  if (!fundingId) throw new Error("No funding instrument on the ads account — add a payment method in X Ads.");

  const campaignRes = await xAdsRequest(creds, "POST", `${acct}/campaigns`, {
    name: plan.steps[0].params!.name,
    funding_instrument_id: fundingId,
    daily_budget_amount_local_micro: String(plan.dailyBudgetMicro),
    entry_status: "PAUSED",
  });
  const campaignId = firstId(campaignRes);

  const lineRes = await xAdsRequest(creds, "POST", `${acct}/line_items`, {
    campaign_id: campaignId,
    name: plan.steps[1].params!.name,
    product_type: "PROMOTED_TWEETS",
    placements: "ALL_ON_TWITTER",
    objective: plan.objective,
    bid_strategy: "AUTO",
    entry_status: "PAUSED",
  });
  const lineItemId = firstId(lineRes);

  const tweetRes = await xAdsRequest(creds, "POST", `${acct}/tweet`, {
    text: plan.tweetText,
    nullcast: "true",
  });
  const tweetId = firstId(tweetRes);

  await xAdsRequest(creds, "POST", `${acct}/promoted_tweets`, {
    line_item_id: lineItemId,
    tweet_ids: tweetId,
  });

  return { campaignId, lineItemId, tweetId, status: "paused" };
}

/** Flip a paused campaign to ACTIVE — this STARTS SPENDING. Human-triggered only. */
export async function activateXCampaign(creds: XAdsCreds, externalCampaignId: string): Promise<void> {
  await xAdsRequest(creds, "PUT", `/accounts/${creds.accountId}/campaigns/${externalCampaignId}`, {
    entry_status: "ACTIVE",
  });
}

/** Pause a live campaign — stops spending. */
export async function pauseXCampaign(creds: XAdsCreds, externalCampaignId: string): Promise<void> {
  await xAdsRequest(creds, "PUT", `/accounts/${creds.accountId}/campaigns/${externalCampaignId}`, {
    entry_status: "PAUSED",
  });
}
