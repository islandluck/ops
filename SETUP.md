# Operator — Production Setup & Deploy

This app runs in **two modes**, decided automatically by environment variables:

| Mode | When | Data | Auth |
|------|------|------|------|
| **Demo** | No Supabase env set | `localStorage` (per browser) | Mocked |
| **Server** | Supabase env set | Postgres (Supabase) | Real (Supabase Auth) |

Out of the box (no env) it runs in **demo mode** — perfect for trying it. Add the
Supabase env below to switch to a real, durable, multi-user backend. No code changes.

---

## Phase 1 — Go live with Supabase (≈10 minutes)

### 1. Create a Supabase project
Go to <https://supabase.com> → **New project**. Pick a name + database password (save it).

### 2. Grab your keys
- **Project Settings → API**
  - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
  - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
- **Database → Connect → ORMs** (or "Connection string")
  - **Transaction pooler** (port `6543`) → `DATABASE_URL`
  - **Direct / Session** (port `5432`) → `DIRECT_URL`

### 3. Configure env
```bash
cd operator
cp .env.example .env.local
# paste the five values into .env.local
```

### 4. Create the tables
```bash
npm run db:migrate     # applies drizzle/0000_*.sql to your Supabase database
# (or: npm run db:push  to sync the schema directly)
```

### 5. (Recommended for fast testing) Auth settings
In Supabase **Authentication → Providers → Email**, turn **"Confirm email" OFF**
so sign-up logs you straight in. Leave it ON for real production (users confirm via email).

### 6. Run it
```bash
npm run dev      # http://localhost:3000
```
Now: **Sign up → onboarding → your Approval Center**. A fully-seeded workspace is
provisioned on first sign-in, scoped to your account, persisted in Postgres.

> Switch back to demo mode anytime by removing the Supabase vars from `.env.local`.

---

## Deploy to Vercel

1. **Push to GitHub.** Either push this repo and set Vercel's *Root Directory* to
   `operator`, or copy the `operator/` folder into its own repo.
2. **Vercel → New Project → import the repo.**
   - Framework: **Next.js** (auto-detected)
   - Root Directory: **`operator`** (if deploying from the monorepo)
3. **Add environment variables** (same five as `.env.local`, plus):
   - `NEXT_PUBLIC_APP_URL` = your Vercel URL (e.g. `https://operator.vercel.app`)
4. **Deploy.** Migrations run from your machine (`npm run db:migrate`) against the
   same Supabase database — Vercel just serves the app.
5. In Supabase **Authentication → URL Configuration**, add your Vercel URL to
   **Site URL** and **Redirect URLs**.

That's it — a live, multi-user, durable Approval Center.

---

## What's next (Phases 2 & 3)

The execution layer is real in *bookkeeping* (durable runs, approvals, audit log)
but doesn't yet perform external side-effects. Coming next:

- **Phase 2 — Real AI drafting (Anthropic).** Agents draft actual content from your
  business brief. Needs `ANTHROPIC_API_KEY`.
- **Phase 3 — Live integrations.** OAuth connect flows + real execution for Gmail,
  Google Calendar, HubSpot, Stripe. Needs provider apps you create (and Google's
  review process to send mail from your domain).

---

## Troubleshooting

- **`process.version` Edge warning at build** — benign. It comes from `@supabase/ssr`
  in middleware (the official pattern) and works fine on Vercel's Edge runtime.
- **"DATABASE_URL is not set"** — you're in server mode without a DB string, or it's
  malformed. Check `.env.local`. Use the **pooled** URL (port 6543) for `DATABASE_URL`.
- **Sign-up doesn't log me in** — "Confirm email" is ON in Supabase. Confirm via the
  email link, or turn it off for testing (step 5).
- **Saves feel delayed** — edits are debounced (~0.8s) then persisted as a batch.
