# Deploying X (Twitter) ads from Operator

The Ads Manager can create real campaigns on X. This is **off by default** and
**never spends money on its own** — read the safety model below, then follow the
setup.

## Safety model

- **Publish creates the campaign PAUSED.** Nothing spends when you publish.
- **Going live is a separate, explicit click** ("Activate") with a spend
  confirmation. Only that action starts spending. You can pause again anytime.
- **Until you finish setup, "Publish to X" is a dry-run.** It shows the exact
  campaign it *would* create and lists what's missing — and sends nothing.

## Why this needs more than "connect X"

The X **Ads API** (`ads-api.x.com`) is separate from the posting connection the
app already uses:

- It requires **Ads API access** — a separate approval on a developer app.
- It uses **OAuth 1.0a** credentials (not the OAuth 2.0 posting tokens).
- It requires a **funded ads account** (a real payment method on file).

## One-time setup

1. **Developer app** — go to [developer.x.com](https://developer.x.com/en/portal/dashboard),
   create an app (or reuse one), and **apply for Ads API access**. Approval is
   granted by X and can take time.
2. **Ads account** — at [ads.x.com](https://ads.x.com/), create an ads account and
   add a funding source. The **account id** is in the URL (e.g. `18ce54d4x5t`).
3. **Credentials** — in the developer portal, get the app's **API key + secret**
   (consumer key/secret) and generate **your access token + secret** with ads
   permissions for that account.
4. **Environment** — add these to your environment (Vercel → Project → Settings →
   Environment Variables), then redeploy:

   | Variable | What it is |
   |---|---|
   | `X_ADS_CONSUMER_KEY` | app API key |
   | `X_ADS_CONSUMER_SECRET` | app API secret |
   | `X_ADS_ACCESS_TOKEN` | your access token |
   | `X_ADS_ACCESS_SECRET` | your access token secret |
   | `X_ADS_ACCOUNT_ID` | the ads account id |

Once all five are present, **Publish to X** switches from dry-run to real
(paused) publishing automatically. No code change needed.

## What publishing does

For an X creative it runs, in order:

1. Create the **campaign** (PAUSED) with the campaign's daily budget.
2. Create the **ad group / line item** (PAUSED), objective `WEBSITE_CLICKS` when
   there's a destination URL, else `ENGAGEMENTS`.
3. Create a **promoted-only tweet** from the ad's primary text + destination URL.
4. **Attach** the tweet to the ad group.

Then you review it in the Ads Manager and, when ready, **Activate** to go live.

## Not yet included

- **Image upload** — the promoted tweet is text + link for now (X media upload is
  a follow-up). The link renders a card preview.
- **Detailed targeting** — audience/geo are carried as campaign metadata; granular
  X targeting criteria (location GUIDs, interests) is a follow-up.
- **Spend/metrics sync** — live spend is shown when available; full analytics
  sync is a later phase.
