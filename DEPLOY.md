# Deploy Operator to Vercel

Your Supabase database is already migrated and verified. This gets the app live on Vercel.
Three steps: **push to GitHub → import to Vercel → add env vars.**

> **Before you deploy:** run `npm run preflight`. It checks every required secret and
> safety switch — and hard-fails on a live Stripe key — without ever printing a value.

---

## 1. Push to GitHub

This folder is already a committed git repo. Create an empty GitHub repo and push:

**Option A — GitHub CLI** (if you have `gh`):
```bash
cd operator
gh repo create operator-approval-center --private --source=. --push
```

**Option B — Web UI:** create a new **empty** repo at <https://github.com/new>
(no README/license), then:
```bash
cd operator
git remote add origin https://github.com/<you>/operator-approval-center.git
git push -u origin main
```

> Your secrets are **not** in the repo — `.env.local` is gitignored. Only `.env.example` ships.

---

## 2. Import to Vercel

1. <https://vercel.com/new> → **Import** your new GitHub repo.
2. Framework: **Next.js** (auto-detected). Build/install commands: leave default.
3. **Root Directory:** leave as `./` (the repo root *is* the app).
   *(If you instead pushed the whole monorepo, set Root Directory to `operator`.)*
4. Don't deploy yet — add env vars first (next step), then Deploy.

---

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

Add these for the **Production** (and Preview) environment — the same values as your
local `.env.local`:

| Variable | Value | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://uklgcxtlunxvpajxqsut.supabase.co` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | your service_role key | ✅ |
| `DATABASE_URL` | **transaction pooler** string (port 6543, password URL-encoded) | ✅ |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL, e.g. `https://operator-xxxx.vercel.app` | recommended |
| `ANTHROPIC_API_KEY` | `sk-ant-…` — turns on **real AI drafting** (agents draft & revise with Claude) | optional |
| `DIRECT_URL` | session pooler string (port 5432) | only if running migrations from CI |
| `CRON_SECRET` | `openssl rand -base64 24` (same value here + in Vercel Cron) | ✅ for automation |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` — encrypts stored OAuth tokens | ✅ for integrations |
| `OPERATOR_DAILY_ACTION_CAP` | max unattended actions per workspace/day (default 50) | optional |
| provider creds | `GOOGLE_*`, `NOTION_*`, `X_*`, `STRIPE_*` (test) — see `.env.example` / `PHASE3.md` | per integration |

Then click **Deploy**.

> **Important:** in `DATABASE_URL`, the password must stay URL-encoded
> (`?`→`%3F`, `!`→`%21`, etc.) exactly as in your `.env.local`.

---

## 4. Point Supabase Auth at your Vercel URL

Supabase → **Authentication → URL Configuration**:
- **Site URL:** your Vercel URL (so confirmation / password-reset emails link correctly).
- **Redirect URLs:** add `https://<your-vercel-url>/**`.

---

## 5. Verify

Open your Vercel URL → **Sign up** (you'll get a confirmation email since email
confirmation is ON) → confirm → sign in → you land in a fully-seeded Approval Center,
backed by Postgres. Done.

---

## 6. Private beta — before you invite testers

- **Turn OFF `AUTH_AUTOCONFIRM`** in production and configure **Supabase → Authentication →
  Emails (SMTP)** so real confirmation + password-reset emails send. (Preflight warns if it's
  still on — it auto-confirms signups and is dev-only.)
- **Connect real integrations for real actions.** Register each provider's app and add its
  credentials (see `PHASE3.md`). For **Google**, you don't need full app verification for a
  beta: keep the OAuth app in **Testing** mode and add your testers as **test users** (up to
  100) — the Gmail / Calendar / Sheets scopes work for them right away.
- **Stripe stays in TEST mode.** Buy buttons accept test cards only; preflight hard-fails on a
  live key. Flip to live only when you deliberately choose to (separate task).
- **Know the kill switch.** Set `OPERATOR_EXECUTION_DISABLED=1` in Vercel to instantly halt all
  task execution across every workspace; set it back to `0` (and redeploy) to resume.
  `OPERATOR_DAILY_ACTION_CAP` bounds unattended actions per workspace/day (default 50).

---

## Notes

- **Schema changes:** migrations run from your machine, not Vercel:
  `npm run db:migrate` against the same database. (Already applied for the current schema.)
- **Connections:** the app uses Supabase's transaction pooler (`DATABASE_URL`, port 6543) —
  the correct choice for Vercel's serverless functions.
- **🔒 Rotate the secrets** you shared during setup before real production use
  (Supabase → Settings → API → roll `service_role`; Database → reset password → update
  `DATABASE_URL`/`DIRECT_URL` locally and in Vercel).
- **CI:** `.github/workflows/ci.yml` runs typecheck + build on every push/PR, and applies
  DB migrations on pushes to `main` **if** you add a `DIRECT_URL` repo secret
  (Settings → Secrets and variables → Actions). Without that secret, the migrate step is skipped.

---

## Custom domain

The app uses origin-relative auth redirects, so it adapts to any domain automatically —
connecting one is a dashboard + DNS task, no code change:

1. **Vercel → Project → Settings → Domains** → add your domain; follow Vercel's DNS
   instructions at your registrar (A/CNAME records).
2. Update the **`NEXT_PUBLIC_APP_URL`** env var to the custom domain and redeploy.
3. **Supabase → Authentication → URL Configuration** → set **Site URL** to the custom
   domain and add `https://yourdomain.com/**` to **Redirect URLs**.

That's all — the live app, auth emails, and sign-in flow will all use the new domain.

---

## AI drafting (Anthropic)

Add an `ANTHROPIC_API_KEY` env var (locally in `.env.local`, and in Vercel) to turn on
**real AI drafting**: agents draft content with Claude grounded in your business brief, and
**Request changes** actually revises the draft against your note. Without the key, the app
falls back to the seeded/simulated drafts. Optional `ANTHROPIC_MODEL` overrides the model
(defaults to `claude-opus-4-8`).
