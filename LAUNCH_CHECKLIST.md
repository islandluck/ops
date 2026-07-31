# Operator — Pre-Launch Checklist

Things to finish **before opening past the hand-picked private beta**. The app is
already deployed for beta testing at `https://ops-ai-launch.vercel.app`.

## 🔴 Auth & email (do first — blocks real onboarding)
- [ ] **Set up custom SMTP.** Supabase's built-in email is a shared, testing-only
      service capped at a few messages/hour *project-wide* — it throws
      `email rate limit exceeded` under any real signup volume. Use a real provider:
  - **Resend** (recommended): verify domain `androsinnovations.com` (add its SPF/DKIM
    DNS records) → API key → Supabase → **Authentication → Emails → SMTP Settings**:
    host `smtp.resend.com`, port `465`, user `resend`, pass = API key,
    sender `noreply@androsinnovations.com`.
  - Then **Authentication → Rate Limits** → raise the email limit (default is low).
- [ ] **Re-enable "Confirm email"** — Supabase → Authentication → Providers → Email.
      *(Turned OFF 2026-07-31 as a beta stopgap because of the rate limit above.)*
- [ ] Keep `AUTH_AUTOCONFIRM` **off** in production (it is).

## 🟠 Data & safety
- [x] **Workspace-scoping guard** — `npm run check:tenancy` (now in CI) enforces that
      every SELECT/UPDATE/DELETE on a workspace table is tenant-filtered or explicitly
      exempt. Catches a forgotten `workspace_id` before it ships. *(task #26 — done)*
- [ ] **Full RLS (defense in depth).** The guard above is code-layer. For true
      DB-level isolation, enable Supabase RLS + an authenticated (per-user) connection
      so even a missed filter can't cross tenants. Larger task — before scaling past beta.
- [ ] **Production DB pool.** Cache the Postgres pool in prod (`lib/db/index.ts` only
      caches in dev → connection churn). *(being fixed in a separate session)*
- [ ] Confirm safety switches in Vercel: `OPERATOR_EXECUTION_DISABLED` (kill switch,
      off for normal), `OPERATOR_DAILY_ACTION_CAP` (default 50).

## 🟠 Make execution real (Phase 2)
- [ ] Gmail sends to the **real recipient** (currently self-sends to the owner).
- [ ] Remove hardcoded demo records (HubSpot `operator-demo@…`, Stripe `$50` draft). *(task #28)*
- [ ] Register **production OAuth callbacks** for every provider in use
      (Google / X / Notion) + the Stripe **prod** webhook endpoint.

## 🟡 Payments & billing
- [ ] Stripe **stays in test mode** until a deliberate go-live (never a live key in dev).
- [ ] Decide Operator's **own billing** (subscriptions) before charging users — none exists yet.

## 🟢 Config hygiene
- [ ] Set `NEXT_PUBLIC_APP_URL` to the final domain (Vercel URL or custom domain).
- [ ] Run `npm run preflight` before each deploy (hard-fails on a live Stripe key).
