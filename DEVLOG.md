# Operator — Developer Log

A running log of substantial changes, decisions, and gotchas for the Operator
(Approval Center) app. Newest entry first. Each entry lists what shipped (with
commit hashes), the decisions behind it, and any follow-ups.

---

## 2026-08-12

Focus: **incident response** — root-caused and stopped a runaway background
agent that flooded two live accounts with thousands of approval tasks, and
shipped the bulk tools to dig out. Also finished **Command Center Phase 2**.

### Shipped

#### Runaway Social Media Agent — root-caused and fixed
- `783876f` A three-part runaway on live accounts ("Billion Dollar Algorithms",
  "Britney"): a background Social Media Agent produced thousands of approval
  tasks and could not be turned off.
  - **Cause 1 — no generation cap.** In approval mode the agent emitted
    `x:3 + blog:1 = 4` tasks *every* cron tick; only the *autopilot* branch was
    bounded (`AUTOPILOT_TARGET`). An hourly cron therefore added 4 tasks/hour
    forever.
  - **Cause 2 — the OFF switch rode the doomed bundle save.** Toggling "Work in
    the background" off only persisted via the whole-workspace bundle save,
    which serializes every task in one server action. Past Next's **1 MB**
    server-action body limit (thousands of tasks) the save threw, so the toggle
    never reached the DB and the cron kept feeding itself.
  - **Cause 3 — no bulk clear.** Delete/archive were per-card only.
  - **Fixes:** per-agent generation caps that top a bounded queue up then no-op
    (social `APPROVAL_QUEUE_CAP = 6`; generic `BACKGROUND_DRAFT_CAP = 12`;
    **background-only** — manual "Run now" is never capped); `setAgentBackgroundAction`,
    a targeted one-row UPDATE that bypasses the bundle save, wired into
    `store.updateAgent` and a one-click **Stop** on the agent card's
    "Background on" badge; chunked, workspace-scoped **bulk delete/archive**
    (FK-cascade) with a board **Bulk** menu that acts on the current filter set;
    raised `serverActions.bodySizeLimit` to **8 MB** as defense-in-depth.

#### Command Center — Phase 2 (Executive suggests goals + Deep Dive)
- `853474d` **Suggest goals** — the Executive proposes 6–10 short,
  business-specific goal bullets grounded in the brief, active projects, and the
  founder's *current* goals (so it complements, not duplicates). A review panel
  accepts/dismisses each; accepted ones drop into the first period's columns or
  the horizons. Metered under the `goal-suggestions` operation. **Send to Deep
  Dive** feeds the rendered goals into the Deep Dive pipeline so company
  knowledge absorbs what the founder is aiming for.

### Key decisions & lessons
- **The whole-workspace bundle save is a scaling liability.** Any state edited
  through the client store rides one server action that serializes every task;
  past ~1 MB it throws and the edit *silently* fails to persist. Safety-critical
  or scale-sensitive writes (settings, toggles, bulk ops) must be **targeted
  one-row/one-set server actions**, never the bundle save.
- **Bound the pipeline, not the cron.** A frequent scheduler is only safe if
  each run tops a *bounded* queue up to a ceiling and then no-ops. Now applied to
  both autopilot (the publish pipeline) and approval mode (the review queue).

### Known issues / follow-ups
- These fixes reach the two affected accounts on the next Vercel deploy (the
  `bodySizeLimit` change needs a fresh build). Recovery per account: **Stop** the
  agent, then **Bulk → Delete/Archive** filtered to that agent.
- Optional follow-up: a per-workspace "Pause all background agents" master switch.

---

## 2026-08-11

Focus: the **Command Center** goals workspace (first draft), a global **model
cost lever**, and an Executive-chat polish.

### Shipped

#### Command Center — a user-authored goals workspace
- `8f6fec9` `/command-center`: the founder's own goals across every timeline —
  per-period **Monthly / Weekly / Daily / Parking** columns plus **Year / Future
  / Moonshot** horizons. A reusable `BulletList` editor (checkbox → strikethrough,
  one indent level, Enter = new / Tab = indent / Backspace-empty = delete),
  client-authoritative debounced autosave, and **Update Executive** which pushes
  the goals into Executive memory as one replaceable, pinned entry. New
  `command_center` table (one JSON doc per workspace). Agents never write this
  doc — it's the human's space.

#### Model cost lever
- `9a28730` Documented `ANTHROPIC_MODEL` as the global cost lever: flip one env
  var to run every agent on a cheaper model (e.g. Haiku 4.5) with no code change.
  The model resolves `process.env.ANTHROPIC_MODEL || "claude-opus-4-8"` across
  the agent code.

#### Executive chat — loading-state fix
- `e108a8b` The starter-question buttons had a glitchy loading state (a stale
  `sending` closure + a render gate tied to message count); Haiku's speed exposed
  it. Added a synchronous `sendingRef` lock + a correct render gate so a fast
  response can't leave the buttons clickable or double-fire.

---

## 2026-08-10

Focus: a **production auth incident** (login + password reset 500s) and
**per-workspace AI usage metering**.

### Shipped

#### Production auth 500 — root-caused (DOMMatrix)
- `25496e7` Login and password reset returned a generic "something went wrong"
  in production. Cause: `lib/deepdive/extract.ts` *statically* imported
  `pdf-parse` (→ `pdfjs-dist`, which references the browser global `DOMMatrix`),
  poisoning the shared server module graph that the auth actions live in — so the
  auth path threw `ReferenceError: DOMMatrix is not defined` at module load.
  Fix: **lazy-import** `pdf-parse`/`mammoth` inside `extractDocText`, plus
  `serverExternalPackages: ["pdf-parse","pdfjs-dist","@napi-rs/canvas"]` in
  `next.config.mjs`. Verified 0 `DOMMatrix` references in `.next/server`.
- `7a634b1` Auth actions now surface + log the real failure cause instead of a
  generic message.

#### AI usage metering
- `684129b` Per-workspace Claude token tracking to see which customers drive AI
  cost. An `ai_usage` table + a `getAnthropic()` metered singleton whose custom
  `fetch` records each `/v1/messages` `usage` payload, attributed via
  AsyncLocalStorage (`runWithUsage(workspaceId, operation, fn)`). A gated
  operator report at `/admin/usage` (allow-listed via `ADMIN_EMAILS`) ranks
  workspaces by tokens + calls. Implemented with ~18 `new Anthropic()` →
  `getAnthropic()` swaps and thin attribution wrappers — no call-site churn.

---

## 2026-08-09

Focus: the **Email Manager** — a full, human-in-the-loop inbox operation — plus
a sidebar cleanup.

### Shipped

#### Email Manager (Phases 1–3)
- `174851d` **Phase 1** — the Admin agent reads and triages the inbox into
  **editable draft replies** (with the user's signature + learned style), then
  the user can **send / archive / trash**, always human-in-the-loop. New
  `email_triage` table; needs the Gmail `gmail.modify` scope (reconnect).
- `67b61ba` Filter the inbox to Gmail's **Primary + Updates** categories (skip
  Promotions/Social) to cut API calls and declutter.
- `5bb3095` **Phase 2** — an auto-triage **cadence** (cron sweep + settings), a
  **"Check now"** button, and **bulk-send** of drafted replies.
- `d883083` Surface triage results as a **Drafts review queue** (the "I triaged
  44 emails but where are they?" fix).
- `3922481` **Phase 3** — **batch archive** suggestions + **learn reply style
  from sent mail**.

#### Sidebar cleanup
- `bb77acb` Group the primary nav into labeled sections.
- `2be1a0b` Show the real workspace initial (not a hardcoded "N").

---

## 2026-08-06 (continued)

Focus: execution honesty and reach, the **Reply Assistant**, real calendar
events, and **Reset Account**. (The 2026-08-04 entry below already covers this
day's earlier Notes work.)

### Shipped

#### Execution — honest, and acting on what a task needs
- `14fe78f` A task now acts on the systems its intent implies **∩ the connected
  integrations** (not an agent's whole allowlist), with an honest run status when
  there's no connected system to act on, and the integration allowlists broadened.

#### Reply Assistant
- `61064ce` Draft a reply and open X's composer **pre-filled** for a one-click
  manual post (X blocks programmatic replies to non-mentions, so the human posts).

#### Calendar — write the real event
- `eac8e71` `createCalendarEvent` now writes the **real** event from the task —
  day, start time, duration, timezone, and recurrence — rather than an all-day
  placeholder.

#### Reset Account
- `a806397` A full workspace **wipe + re-onboard**, behind a 3-gate
  type-to-confirm Danger Zone.
- `7e577d8` Start fresh workspaces with agents **idle and background off**, so a
  reset board stays empty (fixes the Social Media Agent re-populating the board
  after a reset via cron).

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
- `bf40ee2` **Deepen to emails + companies + meetings** — snapshot now reads
  inbound email (with body), companies (firmographics), and upcoming meetings
  (booked via a HubSpot scheduling page), each behind its own availability flag.
  Two new Radar signals: **reply** (drafts an in-context response to an inbound
  email + logs to the contact timeline) and **meeting-prep** (drafts a prep
  brief for a booked meeting). Outreach/reply drafts get account firmographics.
  Conversations inbox (`conversations.read`) deferred.
- `3a875ad` **Scope correction (verified against a real account).** The
  `crm.objects.emails.read`/`crm.objects.meetings.read` scopes I'd named do NOT
  exist. Probed each object with the live token + read the required scope from
  HubSpot's 403s: **meetings/calls/notes reads ride on `crm.objects.contacts.read`
  (already working — no new scope)**; the email-engagement object has **no
  grantable scope** on this app type; **companies** needs `crm.objects.companies.read`;
  **email/chat content** comes via **`conversations.read`** (the Conversations
  inbox). Replaced the dead email-engagement read with a Conversations-based
  `hsAwaitingReply`; registry scopes corrected. **Scopes to add + reconnect:
  `crm.objects.companies.read` + `conversations.read`.**

#### Google Calendar — schedule senses
- `019f5a6` Read the primary calendar (next 7 days) into `getCalendarSnapshot` →
  a "Your schedule (next 7 days)" section in the daily brief + a schedule line in
  the Executive chat. Reuses the existing `calendar.events` scope. The write side
  (`createCalendarEvent` on approved tasks with a due date) already existed.

#### Board persistence fix
- `d1c1fd4` **Delete / reject / archive persist immediately.** Agent-created
  (CRM Radar) cards couldn't be removed — they entered the client via a reload
  that armed `skipFirstSave` + reverted optimistic edits, and the 800ms debounced
  bundle-save was dropped on a quick refresh. Now these write straight to the DB
  via server actions alongside the optimistic update, so they stick.

#### Notes — jot it down, get it done
- `9294787` A quick-capture **Notes** section (`/notes`) — write freely, autosave.
  "Action this note" hands it to the Executive, which (grounded in brief + CRM +
  calendar) proposes **a project OR a set of tasks**; approve → real delegated
  work on the board / Projects; the note is badged "Actioned →". New `notes`
  table (migration 0027), self-contained (not in the bundle), immediate-persist
  editor. Reuses `createProject` + the brief's task-creation.

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
