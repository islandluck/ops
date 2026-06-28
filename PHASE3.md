# Phase 3 — Live Integrations

Approving a task can now perform **real actions** on connected tools:

| Integration | Auth | What "approve" does | Safety |
|---|---|---|---|
| **Gmail** | Google OAuth | Sends the approved draft via the Gmail API | Sends to **your own address** (verifiable test); production targets the real recipient |
| **Google Calendar** | Google OAuth (same app) | Creates a calendar event from the task | Event on your primary calendar |
| **HubSpot** | HubSpot OAuth | Creates/updates a CRM contact | A single `operator-demo@example.com` contact |
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

## 1. Google (Gmail + Calendar)

1. **console.cloud.google.com** → create/select a project.
2. **APIs & Services → Enable APIs** → enable **Gmail API** and **Google Calendar API**.
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
6. Restart, open **Integrations → Connect Gmail**, approve consent. Gmail **and** Calendar
   flip to Connected. Approve a Growth/Admin task → you'll receive the email / see the event.

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
