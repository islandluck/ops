# Operator — the Approval Center

**A website-native business operating system where AI agents prepare the work and you approve execution — in one place, with a full audit trail.**

Operator is built for entrepreneurs, freelancers, agencies, and small-business operators. The core interaction model is deliberately **not a chatbot**. It's an **Approval Center**: a kanban board crossed with an approval workflow. Agents continuously detect work, draft the actual deliverables, and surface each piece as a task in a category queue. You review what matters and approve execution with one click — and only then does anything touch a real system.

> This document describes the product as it stands today. For a 10-minute local/prod setup, see [SETUP.md](SETUP.md); for deploy specifics, [DEPLOY.md](DEPLOY.md); for connecting live integrations, [PHASE3.md](PHASE3.md).

---

## The core idea

Most "AI for business" tools drop you into a chat box and make you do the driving. Operator inverts that:

1. **Agents prepare.** Each agent watches its domain (growth, admin, content, research, finance, social) and prepares complete, ready-to-use drafts — a real email, a Notion page, a tweet, a spreadsheet — grounded in your business.
2. **You approve.** Work lands on a board as a task with a rationale ("why this, why now"), the draft to review, the systems it will touch, and its risk level. You **Approve**, **Request changes**, or **Reject**.
3. **It executes for real.** On approval, Operator performs the actual action against the connected system and records an auditable execution run — every step, success or failure.

Nothing that touches a real system happens without a human decision (unless you explicitly opt an agent into autonomous mode within guardrails). Every task has a visible lifecycle and everything is logged.

**Task lifecycle:** `Detected → Prepared → Ready for approval → Approved → Executing → Completed / Failed (with retry)`

---

## Feature areas

### 1. The Approval Center (the board)

The hero surface (`/approvals`).

- **Six-column kanban** — New · Agent Working · Ready for Approval · Changes Requested · Approved · Done — with drag-and-drop, plus a **list view** toggle.
- **Task cards** show category, risk, agent, proposed-action count, due/scheduled time, and live execution state (Executing / Scheduled / Failed / Done).
- **Task detail drawer** — the rationale, the draft deliverable(s), attached images, affected systems with live connection status, change history, and the action buttons. Keyboard shortcuts (**A** approve, **R** request changes).
- **Filter, sort, search** — by category, risk, agent, and due date; sort by urgency / impact / newest.
- **Left rail** — category queues with counts, saved views, and the agent roster with live status.
- Fully **responsive** — on mobile the board becomes category tabs with a full-screen task view.

### 2. Your AI team (agents)

A roster of specialist agents (`/agents`), each with an editable **persona** and capabilities:

| Agent | Domain | What it does |
|---|---|---|
| **Growth Agent** | growth | Finds warm leads going cold, drafts personal follow-ups, keeps the pipeline moving |
| **Admin Agent** | admin | Scheduling, receipts, and inbox triage (reads and sorts your email into action) |
| **Content Agent** | content | Newsletters, website copy, and posts in your brand voice |
| **Research Agent** | research | Tracks competitors, summarizes calls, turns notes into decision-ready briefs |
| **Finance Agent** | finance | Chases overdue invoices, reconciles payouts, keeps the books tidy |
| **Social Media Agent** | content | Researches your industry and drafts/schedules/publishes on-brand social content |
| **Manager / Executive** | — | Premium leadership tier (coming soon) |

- **Build-an-agent** — create custom agents with their own emoji/accent, persona instructions, department, folder, integration access, and autonomy.
- **Permission tiers per agent** — *Suggest only* · *Approval required* · *Auto-ship* (autonomous within guardrails). Money and paid-media actions never auto-run by default.
- **Background operation** — agents flagged "work in the background" run on a schedule (via cron in production), preparing work while you're away.

### 3. Tasks that think (AI planning)

Create a task in plain language and Operator **plans it before it lands**: it interprets intent, chooses which integrations the task needs, writes a complete ready-to-use draft of the actual content, and assigns a category + risk level. A one-line request becomes a fully-formed, reviewable task instead of an empty shell. (Powered by Claude; falls back to a bare task when AI isn't configured.)

### 4. AI drafting & revision

- **"Have {agent} do this"** — for any task that needs a deliverable, the assigned agent drafts it on demand, grounded in the task context + your business brief + its persona.
- **Request changes** — send a draft back with a note ("make it less salesy") and the agent revises it, returning it to Ready.
- All drafting is grounded in the **business brief** so output sounds like *your* company, honors your voice rules, and avoids your restricted phrases.

### 5. Email triage (the Admin agent)

Point the Admin agent at your inbox and it reads unseen mail, summarizes it, and turns it into an **inbox digest** plus routed **action tasks** (e.g., "Draft a reply to …"), de-duplicated so repeat/background runs only process genuinely new email. Suggested replies are drafted for your approval and sent in-thread on approval.

### 6. Live integrations & real execution

Operator connects to real tools via **OAuth 2.0** (server-authoritative, tokens encrypted at rest with AES-256-GCM) and performs genuine actions on approval:

| Integration | Live action on approval |
|---|---|
| **Gmail** | Send email / reply in-thread |
| **Google Calendar** | Create events |
| **Google Sheets** | Create + populate spreadsheets |
| **HubSpot** | Create/update CRM contacts |
| **Notion** | Create pages |
| **Stripe** | Create **draft** invoices (never charges) |
| **X (Twitter)** | Publish posts + images (OAuth 2.0 + PKCE) |

Additional tools appear in the UI and simulate execution until wired (Webflow, LinkedIn, Slack). Every execution writes an **ExecutionRun** — per-step results, success/failure, and a retry path — so there's a complete audit of what actually happened. Safe-by-design defaults (e.g., Stripe drafts, Gmail can self-send for verification).

### 7. File manager

A native document library (`/documents`) where every agent deliverable is filed durably and server-authoritatively. Organize by folder, preview content, and **export**: download as **PDF**, **Word (.doc)**, or **Markdown**, or **Send to Notion** (creates a page and remembers the link).

### 8. The Social Media Manager

A complete, hands-off-capable social pipeline built on the Social Media Agent:

- **Live research** — pulls current, relevant industry topics via Tavily (gracefully falls back to brief-grounded drafting without a key).
- **Multi-channel drafting** — on-brand **X posts** and **blog drafts**, filed to the board + file manager for review.
- **Publish to X** — approved posts publish for real via the X API. A **single, hard 280-character guarantee** runs through every drafting path (manual, agent, revisions) and the publish guard, so a post can never be rejected or silently truncated for length. Per-workspace daily cap prevents runaway posting.
- **Images** — attach visuals to posts: **upload your own** (PNG/JPEG/WebP/GIF) or **search a stock library** (Pexels), stored in Supabase Storage, uploaded to X as media (up to 4/post). A media failure falls back to text-only with a note rather than sinking the post.
- **Scheduling + auto-publish** — approve a post now but queue it to publish at a chosen time. A background scheduler publishes due posts automatically through the same audited path, respecting the daily cap. Posts show as "Scheduled" and can be published-now or unscheduled any time.
- **Autopilot** — set the agent to *Auto-ship* and it runs fully hands-off: drafts, schedules, and publishes on a cadence **without per-post approval**, while keeping safety valves — it's opt-in, uses a lead time so you can cancel before anything goes out, keeps a bounded pipeline (so a frequent cron can't run away), and every post is still visible + cancellable on the board.

### 9. Business brief — the grounding context

A single editable profile (`/brief`) — company, industry, core offer, ideal customer, goals, brand **voice rules**, **restricted phrases**, working hours, and timezone. It's injected into every agent's drafting, which is what makes the whole system **generalize to any company** rather than being hardcoded to one.

### 10. Dashboard, activity log & settings

- **Dashboard** (`/dashboard`) — a 10-second read: what needs approval, agent status, category breakdown, recent activity.
- **Activity log** (`/activity`) — a filterable, day-grouped, click-through audit of every event: drafts prepared, approvals, executions, integrations touched.
- **Settings** (`/settings`) — profile, per-agent permission modes, notifications, reset/sign-out.
- **Onboarding** (`/onboarding`) — a guided wizard that builds the business brief, connects tools, and sets approval preferences on first run.

---

## Trust & safety model

Operator is designed so autonomy never outruns accountability:

- **Human-in-the-loop by default.** Anything touching a real system requires approval unless an agent is explicitly set to autonomous — and even autonomous social posts are visible and cancellable before they go out.
- **Permission tiers** per agent and per integration (Suggest / Approval / Auto). Money and paid media never auto-run by default.
- **Guardrails everywhere** — the 280-char guarantee, per-workspace daily post caps, scheduling lead times, and graceful fallbacks (text-only if media fails, brief-grounded if research is unavailable).
- **Server-authoritative execution** — real actions and their audit runs are owned by the server, never the client. OAuth tokens are encrypted at rest; secrets live only in the environment, never in the repo.
- **Full auditability** — every task carries its rationale, decisions, and execution steps; the activity log records the lifecycle of everything.

---

## Tech & architecture

- **Frontend** — Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v3 · a hand-built shadcn-style component kit · `lucide-react` icons · native HTML5 drag-and-drop.
- **Backend** — Supabase (**Postgres** + **Auth** + **Storage**) · **Drizzle ORM** with SQL migrations · Next.js **server actions**.
- **AI** — the Claude API (Anthropic) for planning, drafting, revision, and social content; **Tavily** for live research; **Pexels** for stock imagery. Every model call is grounded in the business brief.
- **Integrations** — OAuth 2.0 (with PKCE for X), refresh-token rotation, AES-256-GCM token encryption.
- **Automation** — cron endpoints (Vercel Cron in production) drive background agents and the auto-publish scheduler, secured with a shared secret.

**Two run modes, one codebase:**

- **Demo mode** (no env vars) — a seeded, realistic workspace, mocked auth, state in `localStorage`. Open and go.
- **Server mode** (Supabase configured) — real Supabase Auth, durable Postgres, live integrations, deployable to Vercel. The client store loads the workspace bundle from Postgres and persists through server actions, scoped to the authenticated user.

```
app/
  page.tsx                Marketing landing
  login/  onboarding/     Auth + guided setup
  (product)/              Authenticated shell (sidebar + topbar + global drawer)
    approvals/            The Approval Center board (hero)
    dashboard/ activity/ integrations/ brief/ documents/ settings/
  actions.ts              Server actions (the write surface)
  api/agents/run          Cron: background agents + due scheduled posts
  api/social/publish      Cron: auto-publish scheduler
  api/integrations/[provider]/{connect,callback}   OAuth flows
lib/
  db/         schema.ts (Drizzle tables) · queries.ts · migrations
  ai/         plan.ts · draft.ts · social.ts · research.ts · stock.ts
  agents/     run.ts · triage.ts · social.ts · schedule.ts · slots.ts
  integrations/  registry.ts · oauth.ts · tokens.ts · execute.ts · google/hubspot/stripe/notion/x
  media/      storage.ts (Supabase Storage)
  social/     x-post.ts (the single 280-char source of truth)
  store.tsx   Mode-aware client store (the UI's operation surface)
components/  ui/ · board/ · app/
```

---

## Current state & roadmap

**Built and working today:** the full Approval Center, the agent roster + build-an-agent, AI task planning + drafting + revision, email triage, live execution across seven integrations, the file manager with exports, and the complete Social Media Manager (research → drafting → images → publishing → scheduling → auto-publish → autopilot). All backed by real Supabase persistence and verified end-to-end.

**Prerequisites to fully light up certain features:**
- Reconnect X to grant the `media.write` scope (needed to attach images to live tweets; text posts work without it).
- Provider keys as desired: `TAVILY_API_KEY` (research), `PEXELS_API_KEY` (stock), plus `CRON_SECRET` for the production schedulers.

**Natural next steps:**
- Auto-attach images to autopilot posts.
- AI image generation (in addition to upload + stock).
- Newsletter / ESP publishing (the email counterpart to X).
- Live trend hashtags (requires X API Basic tier).
- Production deploy to Vercel (rotate any shared dev secrets first).
