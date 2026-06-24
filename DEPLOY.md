# Deploy Operator to Vercel

Your Supabase database is already migrated and verified. This gets the app live on Vercel.
Three steps: **push to GitHub → import to Vercel → add env vars.**

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
| `DIRECT_URL` | session pooler string (port 5432) | only if running migrations from CI |

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

## Notes

- **Schema changes:** migrations run from your machine, not Vercel:
  `npm run db:migrate` against the same database. (Already applied for the current schema.)
- **Connections:** the app uses Supabase's transaction pooler (`DATABASE_URL`, port 6543) —
  the correct choice for Vercel's serverless functions.
- **🔒 Rotate the secrets** you shared during setup before real production use
  (Supabase → Settings → API → roll `service_role`; Database → reset password → update
  `DATABASE_URL`/`DIRECT_URL` locally and in Vercel).
- **Custom domain:** add it in Vercel → Domains, then update `NEXT_PUBLIC_APP_URL` and the
  Supabase Site/Redirect URLs to match.
