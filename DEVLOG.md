# Operator — Developer Log

A running log of substantial changes, decisions, and gotchas for the Operator
(Approval Center) app. Newest entry first. Each entry lists what shipped (with
commit hashes), the decisions behind it, and any follow-ups.

---

## 2026-08-04

Focus: made the **Projects** lifecycle reliable and fast, shipped the full
**Opportunities** scanner suite, and added the first two "context-rich"
integrations — **HubSpot** (CRM) and **Google Calendar** — following a
consistent *senses → context → hands* pattern.

### Shipped

#### Opportunities — full scanner suite
Grants/events/awards discovery that drafts applications into Projects.
- `7aa8c49` Grant search via the free grants.gov API + Haiku fit-scoring.
- `6070f7a` Hybrid grant search — grants.gov (federal) + web search (state/local).
- `8fe58b1` Expand 2-letter state codes for local grant queries.
- `3c65175` Conferences & Events scanners (web search).
- `0c49cee` Let users pin their own sites to also scan.
- `23bc236` Awards / Competitions scanner — all four tabs now live.

#### Projects — engine hardening, UX, and performance
The dominant thread of the day: creating → phased plan → work tasks → phase
transitions (AI materializes new tasks) → close. Iterated hard on reliability,
then on making it *feel* fast.
- `2bccf7e` Auto-advance completed phases on Projects-page load (no cron needed locally).
- `d2f3bb9` Self-heal tasks wedged mid-execution.
- `61e7d8a` **Editable deliverables** — users edit a deliverable's document; later
  phases' drafts read + honor those edits (add partners, titles, etc.).
- `3ba628c` Heal + advance on every workspace refresh (so projects actually close).
- `ecc2aea` Stop the heal from reopening `done` tasks; make advance non-blocking.
- `9efb5b0` Heal wedged tasks *inside* the bundle read (fix the client/server fight).
- `cb11ebf` Advance/close the project when task changes are saved.
- `5c8426d` Fix the phase-transition freeze, lost completions, and save races
  (atomic advance/close claims; <10-min stale-save protection).
- `f1e07ed` In-place reloads + a "Building next phase…" indicator (no full-screen spinner).
- `4886b30` **Unclog the request pipeline** — fast saves (bulk deletes), fast loads
  (batched reads), task execution moved off the action queue to a route, and a
  non-stacking transition poll.
- `ce70942` **Instant task cards** — phase tasks appear as "Agent Working" cards
  within seconds and flip to Ready per-draft; approve-plan runs via a route.
- `a8d1136` **Grant submission packet export (.doc)** — assemble a project's
  deliverables (with edits) into one Word doc; submission stays the human's step.

#### HubSpot — CRM integration (senses / hands / context)
The CRM as the richest context source the agents read.
- `0217556` CRM snapshot (pipeline, new contacts, stale deals) → Executive KPIs +
  daily brief + every agent's planning context; **CRM Radar** mines stale deals /
  uncontacted leads into drafted follow-up tasks (deduped via `triaged_crm`);
  execution logs an approved send to the contact/deal timeline.
- `d990dc5` **Connect with a private-app token** — no developer app / OAuth dance;
  paste a `pat-…` token, validated live, stored encrypted like an OAuth token.
- `a9f653f` **Degrade gracefully when scoped to one object** — snapshot fetches
  contacts + deals independently (`Promise.allSettled`); a missing deals scope no
  longer nukes the whole snapshot (KPIs/context/Radar keep working on contacts).

#### Google Calendar — schedule senses
- `019f5a6` Read the primary calendar (next 7 days) into `getCalendarSnapshot` →
  a "Your schedule (next 7 days)" section in the daily brief + a schedule line in
  the Executive chat. Reuses the existing `calendar.events` scope. The write side
  (`createCalendarEvent` on approved tasks with a due date) already existed.

### Key decisions & lessons

- **The tab's server actions run sequentially.** Slow work (AI phase
  materialization, task execution, scans) must NOT run inside a client-called
  server action, or it queues every later load/save behind it and the app feels
  frozen. Route it: `after()` (post-response) or a Route Handler called via
  `fetch()` (routes run in parallel with actions). UI polls need an in-flight
  guard so they can't stack behind one slow call.
- **Integration snapshots must degrade gracefully.** Real tokens are often scoped
  to a subset of objects (HubSpot contacts-but-not-deals). Fetch each object
  independently and expose `<object>Available` flags; never let one failed read
  blank every downstream feature. On a hard read failure (revoked token), return
  `null` so callers *omit* the section rather than show a false "nothing here."
- **Single-tenant connect ≠ OAuth public app.** For one company connecting its own
  system, a static/private-app token pasted into the UI is far simpler than the
  OAuth developer-app flow. The OAuth path stays for future multi-tenant SaaS.
- **The senses → context → hands shape** is the integration template now:
  a cached snapshot → a one-line context string injected into agent prompts/brief
  (+ KPIs where numeric) → approval-gated write actions in the execute branch.

### Database
- Migration `0026_panoramic_fenris` — `triaged_crm` dedup table (one row per CRM
  signal already turned into a task). Applied.

### Testing notes
- Verification is done via **read-only probes** (there is no unit-test suite):
  a standalone `.mjs` that decrypts `integrations.access_token` with
  `TOKEN_ENCRYPTION_KEY` (AES-256-GCM, `iv.tag.ciphertext`) and hits the provider
  API with the same request shapes the app uses.
- The local preview runs `next start` (production) via `.claude/launch.json`, so a
  temporary dev API route 404s (no hot-reload) and any `NODE_ENV==="production"`
  guard blocks it — hence the standalone-script approach.
- HubSpot probe confirmed: token + contacts read + CRM Radar (3 real drafted
  outreach tasks) working; **deals 403** (token lacks the deals scope).
- Calendar probe (after reconnect) confirmed: 4 real upcoming events read, tz
  `America/New_York`, all three Google rows (Gmail/Calendar/Sheets) connected.

### Known issues / follow-ups
- **HubSpot running contacts-only.** The connected token doesn't carry
  `crm.objects.deals.read` (403). Deferred by decision — paste a deals-scoped
  token later and pipeline features light up automatically (no code change).
- **Google OAuth app is in "Testing" mode** → refresh tokens expire after ~7 days,
  so Google (Gmail + Calendar) needs periodic reconnect. Fix: publish the OAuth
  consent screen to "In production" in Google Cloud Console.
- **Slack** is the next planned integration (approvals + daily brief where the
  user already works; needs the Vercel deployment for the Events API URL).
- Possible polish: auto-add parseable grant/event deadlines to the calendar
  (opportunity `deadline` is currently free text like "Rolling"/"Quarterly").
