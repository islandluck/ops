# Phase 3 — Live Integrations

Approving a task can now perform **real actions** on connected tools:

| Integration | Auth | What "approve" does | Safety |
|---|---|---|---|
| **Gmail** | Google OAuth | Sends the approved draft via the Gmail API | Sends to **your own address** (verifiable test); production targets the real recipient |
| **Google Calendar** | Google OAuth (same app) | Creates a calendar event from the task | Event on your primary calendar |
| **Google Sheets** | Google OAuth (same app) | Logs the approved task to a new spreadsheet | Creates a sheet in your Drive |
| **HubSpot** | HubSpot OAuth | Creates/updates a CRM contact | A single `operator-demo@example.com` contact |
| **Notion** | Notion OAuth | Creates a page under a shared page | Only pages you share with the integration |
| **X (Twitter)** | X OAuth 2.0 (PKCE) | Publishes the approved post | Text only; capped at 10 posts/day |
| **Stripe** | Secret key | Creates a **draft** invoice | Test mode (`sk_test_…`); never finalized/charged |

Each is **off until configured + connected**. Until then, approving simulates as before — your
current app is unchanged. Tokens are **encrypted (AES-256-GCM)** at rest and never sent to the browser.

---

## 0. Encryption key (required for any OAuth provider)

```bash
# Generate a 32-byte key and add to operator/.env.local (and Vercel):
openssl rand -base64 32
```
```
TOKEN_ENCRYPTION_KEY=<the base64 value>
```

Also make sure `NEXT_PUBLIC_APP_URL` matches the origin you'll connect from
(e.g. `http://localhost:3000` locally, your Vercel URL in production) — OAuth redirect
URIs are derived from the request origin.

---

## 1. Google (Gmail + Calendar + Sheets)

1. **console.cloud.google.com** → create/select a project.
2. **APIs & Services → Enable APIs** → enable **Gmail API**, **Google Calendar API**, and **Google Sheets API**.
3. **OAuth consent screen** → External → fill the basics → **Add yourself as a Test user**
   (lets you use sensitive scopes without full verification while testing).
4. **Credentials → Create Credentials → OAuth client ID → Web application**.
   - **Authorized redirect URI:** `<APP_URL>/api/integrations/google/callback`
     (e.g. `http://localhost:3000/api/integrations/google/callback`).
5. Copy the client id/secret into `.env.local`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
6. Restart, open **Integrations → Connect Gmail**, approve consent. Gmail, Calendar **and**
   Sheets flip to Connected (one Google grant). Approve a Growth/Admin task → you'll receive
   the email / see the event; approving a Research task logs it to a new spreadsheet.

> Sending mail to *external* recipients at scale needs Google's app verification (can take
> weeks). Test users + your own address work immediately.

## 2. HubSpot

1. **developers.hubspot.com** → create an app (or use a test account).
2. **Auth** tab → set **Redirect URL:** `<APP_URL>/api/integrations/hubspot/callback`.
3. Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `oauth`.
4. Copy credentials:
   ```
   HUBSPOT_CLIENT_ID=...
   HUBSPOT_CLIENT_SECRET=...
   ```
5. Restart → **Connect HubSpot** → approve. Approving a CRM-affecting task upserts the demo contact.

## 3. Stripe

1. **dashboard.stripe.com** → toggle **Test mode** → Developers → API keys.
2. Copy the **Secret key** (`sk_test_…`):
   ```
   STRIPE_SECRET_KEY=sk_test_...
   ```
3. Restart → **Connect Stripe** (validates the key) → approving a Finance task creates a
   **draft** invoice in your test dashboard.

## 4. Notion

1. **notion.so/my-integrations** → **New integration** → type **Public** (required for OAuth).
2. Fill the basics, then set the **Redirect URI:** `<APP_URL>/api/integrations/notion/callback`.
3. Copy the OAuth **Client ID** and **Client secret**:
   ```
   NOTION_CLIENT_ID=...
   NOTION_CLIENT_SECRET=...
   ```
4. Restart → **Connect Notion** → approve, and **select the page(s)** Operator may use.
5. Approving a Research/Content task creates a page (with the draft) under a shared page.

> Notion grants access per selected page. If you share none, execution returns a clear
> "share a page with the Operator integration" message — just share one and retry.

## 5. X / Twitter (publish social posts)

1. **developer.x.com** → sign up for a developer account (the **Free** tier allows posting).
2. Create a **Project + App**, then open the app's **User authentication settings**:
   - **App permissions:** **Read and write** (required to post)
   - **Type of App:** **Web App, Automated App or Bot** (a confidential client)
   - **Callback URI / Redirect URL:** `<APP_URL>/api/integrations/x/callback`
     (e.g. `http://localhost:3000/api/integrations/x/callback`)
   - **Website URL:** your site
3. From **Keys and tokens → OAuth 2.0 Client ID and Client Secret**:
   ```
   X_CLIENT_ID=...
   X_CLIENT_SECRET=...
   ```
4. Restart → **Integrations → Connect X (Twitter)** → authorize. Approving an X post
   from the Social Media Agent publishes it for real.

> Uses OAuth 2.0 with PKCE and the least-privilege scopes `tweet.read tweet.write
> users.read offline.access`. Access tokens last ~2h and are auto-refreshed (X rotates
> the refresh token each time, which we persist). Posting is **text-only** for now —
> images are a later phase. A **10 posts/day** cap guards against spam flags.

---

## Notes

- **Local restart required** after adding env vars (`next start`/`next dev` loads `.env.local` at boot).
- On **Vercel**, add the same vars in Project → Settings → Environment Variables, and register
  the production redirect URIs (`https://<your-domain>/api/integrations/<provider>/callback`)
  in each provider's app.
- **Disconnect** clears the stored tokens (and the sibling Gmail/Calendar token).
- Architecture: `lib/integrations/*` (registry, oauth, tokens, provider clients, execute),
  `app/api/integrations/[provider]/{connect,callback}` (OAuth), and server actions in
  `app/actions.ts`. Approving a task with a connected integration runs
  `runTaskExecution` server-side and writes a real, auditable `ExecutionRun`.
