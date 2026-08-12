# Operator — Product Document

**The Approval Center · an AI operations team you stay in control of**

*Version: 2026-08-12 · This document explains what Operator is, every feature it ships, and how real customers use it. Companion docs: [Market Analysis](MARKET.md) · [Business Plan](BUSINESS_PLAN.md) · [Developer Log](../DEVLOG.md).*

---

## 1. What Operator is

Operator is an **AI business‑operations platform** for owner‑operators — solo founders, small agencies, and lean teams who are the marketing, sales‑ops, and admin department all at once.

A team of AI agents works continuously in the background: they draft your social posts, triage and answer your email, mine your CRM for follow‑ups, run multi‑phase projects, hunt grants, produce a daily executive brief, and more. Everything they prepare lands in one place — **the Approval Center** — where you approve, edit, or reject with a single click. Then Operator performs the real action: it actually sends the email, posts the thread, updates the CRM, publishes the page.

The promise in one line:

> **Run your business like you have a team of ten — without hiring one, and without ever losing control of what goes out the door.**

### The core idea: prepare → approve → execute

Most "AI agents" force a bad choice: either they're passive tools that draft things you still have to copy‑paste and do yourself, or they're black‑box autopilots that act in your name and hope you don't mind. Operator's model is the middle path that busy owners actually want:

```
   AGENTS PREPARE            YOU DECIDE               OPERATOR EXECUTES
 ┌────────────────┐      ┌────────────────┐      ┌─────────────────────┐
 │ draft a post   │      │  Approval      │      │ posts to X          │
 │ answer an email│  ──▶ │  Center:       │  ──▶ │ sends via Gmail     │
 │ follow up a    │      │  approve /     │      │ logs to HubSpot     │
 │ stale deal     │      │  edit / reject │      │ publishes a page    │
 └────────────────┘      └────────────────┘      └─────────────────────┘
        24/7                 one click            real, audited actions
```

**Nothing external happens without your approval** — unless *you* explicitly put a specific agent on autopilot, and even then it runs inside hard safety limits (kill switch, daily caps, per‑channel caps). That control is not a footnote; it's the product.

---

## 2. How it works (the mental model)

1. **You give Operator context once.** A short *Business Brief* (what you do, who you serve, your voice, your rules) plus an optional *Deep Dive* where you upload real company material. Every agent is grounded in this, so drafts sound like you and reference reality.
2. **You connect the tools you already use.** Gmail, X/Twitter, Google Calendar, HubSpot, Notion, Stripe, Google Sheets. Tokens are encrypted and never leave the server.
3. **Agents prepare work — continuously.** On a schedule (in production, via cron) and on demand. Each piece of work becomes a **task** on the board with the draft attached and an honest note about what approving it will do.
4. **You run the Approval Center.** Skim what's ready, edit anything, and approve/reject. Approving triggers the real action against the live API; the result is written to an auditable activity log.
5. **The Executive keeps you oriented.** A chief‑of‑staff agent tracks your KPIs and goals, writes you a daily brief, and answers questions grounded in your real data.

Everything is **workspace‑scoped** and multi‑tenant‑safe: your data, tokens, and tasks live in your workspace and only yours.

---

## 3. The AI team

Every workspace starts with a team of eight agents. Six **workers** do the hands‑on work; two premium **leadership** agents coordinate and think strategically.

| Agent | Role | Default autonomy | What it does |
|---|---|---|---|
| 📈 **Growth Agent** | Business development | Approval | Finds warm leads going cold, drafts personal follow‑ups, keeps the pipeline moving. |
| 🗂️ **Admin Agent** | Operations / inbox | Approval | Scheduling, receipts, inbox chores. In the background it runs **email triage + Notion action‑extraction**. |
| ✍️ **Content Agent** | Writing | Approval | Newsletters, website copy, and posts in your brand voice. |
| 🔭 **Research Agent** | Intelligence | Suggest | Tracks competitors, summarizes calls, turns notes into decision‑ready briefs. |
| 🧾 **Finance Agent** | Bookkeeping | Approval | Chases overdue invoices, reconciles payouts — *never moves money on its own*. |
| 📣 **Social Media Agent** | Social | Approval (background on) | Researches your industry and drafts on‑brand X posts + blog content; can run on **autopilot**. |
| 🧭 **Manager Agent** *(premium)* | Coordination | Auto | Oversees the workers, plans and runs multi‑phase **Projects**. |
| 👔 **Executive Agent** *(premium)* | Chief of staff | Auto | Runs the Executive Office: chat, KPIs, memory, goals, daily brief, investor updates. |

**Autonomy is per‑agent and plain‑English:**

- **Suggest** — surfaces the idea only; nothing is built until you say so.
- **Approval** *(default)* — prepares the work and waits for your one‑click approval.
- **Auto** — low‑risk actions run automatically, inside the limits you set.

You can **build your own agents** too: give one a name, emoji, persona/instructions, department, folder, autonomy mode, which integrations it may touch, and whether it works in the background. Custom agents behave exactly like the built‑ins.

---

## 4. Feature catalog

### 4.1 The Approval Center (the board)

The home of the human‑in‑the‑loop model. A Kanban/list board of every task agents have prepared, moving through **New → Agent Working → Ready → Changes Requested → Approved → Done**.

- **Task cards** show the category, title, rationale ("why I did this"), affected systems, risk, due date, and the assigned agent.
- **Open a task** to read the full draft, edit it inline, and act: **Approve**, **Approve with edits**, **Request changes** (send it back to the agent with a note), **Reject**, **Schedule** (approve now, auto‑execute later), **Delete**, or **Archive**.
- **Honest execution.** Approving runs the real action only against *connected* systems; if a step targets a tool you haven't connected, it's recorded as *"skipped — not connected"* rather than a fake success.
- **Search, filter, and sort** by category, risk, agent, due date, or free text; switch between board and list views; toggle an archived view.
- **Bulk actions.** A **Bulk** menu operates on your current filter set — e.g. filter to one agent and **Archive** or **Delete** everything at once (with a confirm step). This is how you clear a large backlog in seconds.

### 4.2 Business Brief — the context that powers everything

A single, founder‑editable document that grounds every agent:

- **Company** — name, website, what you do, your core offer.
- **Customers & goals** — ideal customer profile, primary goals (one per line).
- **Brand voice** — voice rules (e.g. "warm, plain‑spoken, never hypey") and **restricted phrases** the agents will *never* use (e.g. "world‑class", "synergy").
- **Operating rules** — approval rules and budget limits (shown here; set during onboarding), working hours, timezone.

Every draft, plan, and triage decision is conditioned on this brief, so output is on‑brand from day one.

### 4.3 Deep Dive — teach Operator your company

Upload or paste your real material — memos, decks (as text), meeting notes, docs (PDF, Word, Markdown, up to 25 files) — and a background AI run reads all of it and produces a synthesized **Context Pack**: people, timeline, themes, decisions, open threads, risks, products.

- Runs in the background (you can leave the page); progresses through *reading → distilling → synthesizing → complete*.
- The pack is **versioned and cumulative** — run it again anytime to deepen understanding.
- It briefs **every agent** and seeds the Executive's memory, so drafts reference the right names, facts, and history.
- **Privacy by design:** after synthesizing, Operator keeps the distilled understanding and **purges the raw source text**.

### 4.4 Executive Office — your chief of staff

A conversational Executive agent that holds a live, grounded picture of your business and helps you run it.

- **Chat** grounded in your brief, Deep Dive context, live CRM and calendar, KPIs, goals, active projects, and up to 40 durable memories. Ask "what should I focus on today?" and get a real answer, not a platitude.
- **Tools the Executive can use in chat** (each produces a *draft you approve*, so it's always safe to ask): log a company goal, remember a durable fact/decision, start a project, or launch a growth campaign.
- **KPIs** computed from real data: revenue (from paid orders), followers (week‑over‑week), shipped this week, content live, active initiatives, awaiting‑you, plus HubSpot pipeline and new contacts.
- **Durable memory & goals** with full editing and pinning — the Executive remembers what matters across sessions.
- **Proactive nudges** (rule‑based, no AI cost): fresh sale, approvals sitting 3+ days, stalled follower growth, a monthly goal falling behind pace, a shipping lull, work about to auto‑publish.

### 4.5 Daily Brief, Weekly Review & Investor Updates

The Executive writes you dossiers, grounded in live data:

- **Daily Brief** — a headline, KPI review, what shipped, what's in motion, what's next, insights, and **one‑click actionable suggestions** (accept one and it creates the project/campaign/task for you). Auto‑refreshes when it goes stale; downloadable as Markdown/text/Word/PDF.
- **Weekly Review** — the same engine on a weekly cadence.
- **Investor / stakeholder updates** — an on‑demand monthly update tailored by audience (**investor**, **team**, or **advisor**). The investor view stays outward‑safe; team/advisor views also surface work‑in‑flight. Editable, with a hero image, and copy‑as‑email.

### 4.6 Command Center — your goals, your space

A user‑authored goals workspace that agents *never* write to:

- Per‑period **Monthly / Weekly / Daily / Parking‑lot** columns, plus **Year / Future / Moonshot** horizons.
- A fast bullet editor: check to strike through, indent one level, keyboard‑driven.
- **Update Executive** pushes your goals into the Executive's memory as one pinned entry, so the chief of staff always knows what you're aiming for.
- **Suggest goals** asks the Executive to propose complementary goals grounded in your brief and projects (you accept the ones you want). **Send to Deep Dive** feeds your goals into company knowledge.

### 4.7 Social Studio (X/Twitter)

A full social operation for X, built around your voice and your approval.

- **Learn your voice** from your own recent posts, so drafts sound like you.
- **Composer** — draft posts with your learned style; attach up to 4 images (upload or pull from the Pexels stock library).
- **Growth Marketer boost** — an advisory rewrite for reach (sharper hook, skimmable structure) that never invents facts.
- **Bulk schedule** — paste a batch of ideas; Operator cleans, slots, and schedules them into your queue.
- **Reply Assistant** — draft an on‑voice reply to any tweet and open X's composer pre‑filled for a one‑click manual post.
- **Reply Radar** — watches accounts you choose, scores which tweets are worth replying to, and pre‑drafts the best ones (requires X API Basic tier for reading others' timelines).
- **Autopilot** — put the Social agent on Auto and it keeps a bounded pipeline of scheduled posts (default 3) topped up and auto‑publishing on a steady cadence. Scheduled posts still appear on your board and can be cancelled any time before they go out.

### 4.8 Content Engine — write once, distribute everywhere

One longform master, packaged into every channel:

- **Generate** a 600–1,000‑word longform master in your voice (title, dek, body) — with a hard rule against fabricating stats, quotes, or studies.
- **Boost** for virality without changing the substance, and see exactly what changed.
- **Distribute** to three channels, each independently:
  - **Page** — auto‑publish as a hosted article at `/p/<slug>`.
  - **X thread** — atomize into a hook‑first, ≤270‑char thread, scheduled to auto‑publish as a real connected thread.
  - **Substack** — a "perfect paste" handoff (no API needed); you mark it published.
- One channel failing never blocks the others; deleting a post cancels any still‑queued thread so it can't publish later.

### 4.9 Email Manager — a full inbox operation you control

Turn a chaotic inbox into a review queue, human‑in‑the‑loop throughout.

- The **Admin agent reads and triages** your inbox (Gmail's **Primary + Updates** only — never Promotions/Social), classifying each email and drafting a **signed reply in your learned style**.
- Work stays as **editable drafts in a review queue** — nothing is ever sent automatically.
- Per‑message **Send / Archive / Trash** (archive drops the INBOX label; trash is recoverable, never a permanent delete), plus **bulk send** and **batch archive suggestions**.
- **Auto‑triage cadence** (hourly/daily) with a **"Check now"** button, and **learn‑your‑voice‑from‑Sent‑mail** so replies sound like you.

### 4.10 Projects — turn a goal into finished work

The Manager/Executive turns a goal into a **phased plan** you approve, then drives it to completion.

- Each plan step becomes a task: a **deliverable** (drafted by the right worker), a **page** (a real landing page that goes live on approval), or an **action** (a human checklist step).
- **Phases advance automatically** once every task in the current phase is done — later phases build on the approved (and human‑edited) work of earlier ones.
- **Packet export** — assemble all of a project's deliverables into one Word document (e.g. a grant application ready for a human to review and submit).
- Self‑healing: tasks wedged mid‑execution are revived; completed work is never reopened.

### 4.11 Opportunities — grants, conferences, events & awards

A web scanner that finds and fit‑ranks opportunities for your company.

- Four scanners: **Grants** (live — federal via grants.gov + state/local via web search), **Conferences**, **Events**, **Awards/Competitions**.
- Each result gets a **0–100 fit score** with a "why it fits" rationale, plus amount, deadline, and location where available.
- **Autonomy per scanner:** *Scan only*, *Scan + draft* (auto‑prepares an application plan for the single best new grant, fit ≥ 65), or *Manual*. Cadence weekly/biweekly/monthly, scoped local/state/national, with optional sites to also scan.
- **The never‑auto‑submit invariant:** Operator only ever *surfaces* opportunities and *drafts* plans. It never submits an application, registers, or pays for anything — the final step is always yours. This is enforced in code, not just policy.

### 4.12 CRM Radar (HubSpot)

Your CRM becomes the richest context source and a source of proactive work.

- A cached **snapshot** feeds Executive KPIs, the daily brief, and every agent's context: pipeline value, new/uncontacted contacts, **stale deals** (idle >14 days), companies/firmographics, upcoming meetings, and inbound emails awaiting reply.
- **Radar** mines the snapshot into a few high‑value tasks per sweep, each with a drafted next step: reply to an inbound email, prep for a booked meeting, follow up a stale deal, or reach out to a new contact.
- Approving a task **sends the reply via Gmail and/or logs a note to the HubSpot timeline**, so your CRM reflects reality.
- Connect with a **private‑app token** (paste a `pat‑…`) — no OAuth developer app required.

### 4.13 Pages & Storefront — a page with a buy button

Generate on‑brand pages and take a (test) sale.

- Describe an offer and Operator writes a full **landing, product, or blog page** — headline, sections, features, CTA — grounded in your brief.
- A **two‑pane visual editor**: a grouped inspector (brand/accent, hero, buy button, features, sections, footer, media) with a live device‑style preview.
- **Media** via upload (10 MB max) or the **Pexels** stock library.
- **Publish** and it's live at `/p/<slug>`; attach a **product** and the buy button becomes a real **Stripe Checkout** (test mode until you add a live key). Paid orders feed the revenue KPI.

### 4.14 Notes — jot it down, get it done

A quick‑capture notes surface with autosave. Write freely, then **Send to Executive** — grounded in your brief, CRM, and calendar, it proposes either a set of tasks (routed to the right agents) or a multi‑phase project. Approve, and it becomes real delegated work.

### 4.15 Integrations

Connect the tools you already use; each connection carries its own Suggest/Approval/Auto mode.

| Integration | Reads | Acts (on approval) |
|---|---|---|
| **Gmail** | Inbox (Primary+Updates), threads, Sent mail | Send replies (in‑thread), archive, trash |
| **Google Calendar** | Next 7 days of events | Create real events (day/time/duration/tz/recurrence) |
| **Google Sheets** | — | Create + populate spreadsheets |
| **HubSpot** | Contacts, deals, companies, meetings, inbound email | Upsert contacts, log timeline notes, update deal stage |
| **X / Twitter** | Your handle, posts, follower count; others' timelines (Basic tier) | Post tweets & threads, attach images |
| **Notion** | Pages shared with Operator | Create pages |
| **Stripe** | Orders/payments (webhook) | Draft invoices (test mode); hosted checkout for pages |
| **Tavily** | Live web research | — (powers Social + Opportunities) |
| **Pexels** | Stock image search | — (powers the media picker) |
| **grants.gov** | Federal grant data | — (powers the Grants scanner) |

Tokens are **encrypted at rest and never leave the server**; expired tokens auto‑refresh. *(Webflow, LinkedIn, and Slack appear as "coming soon" connectors.)*

### 4.16 Activity Log

A complete, human‑readable, reverse‑chronological audit trail of everything agents and you have done — grouped by day, filterable by Approvals / Executions / Agents. Every approval, execution (with per‑step result), and agent action is recorded.

### 4.17 Safety, guardrails & trust

Control is a first‑class feature:

- **Human‑in‑the‑loop by default** — nothing external ships without approval unless *you* set an agent to Auto.
- **Global kill switch** — one server flag halts *all* execution instantly.
- **Per‑workspace daily automation cap** (default 50) on unattended actions; human‑approved actions are never capped (you're the safety valve).
- **Anti‑runaway generation caps** — background agents top a bounded review queue up to a ceiling and then stop (so a frequent scheduler can never flood your board), and X posting is capped at 10/day/workspace.
- **Never‑auto‑submit** for grants; **draft‑only, test‑mode‑only** for Stripe; **read‑only** email triage (replies leave only on an explicit Send); Finance agents never move money.
- **Full audit trail** and honest status (skipped‑because‑not‑connected is surfaced, not hidden).

### 4.18 AI usage metering & cost control

- Every Claude call is **metered per workspace** (tokens + operation), powering a gated operator report that ranks which customers cost the most in AI.
- A single **model cost lever** (`ANTHROPIC_MODEL`) can run all agents on a cheaper model with no code change; two heavy operations already use a cheaper model by default. This keeps AI cost of goods well under the subscription price.

---

## 5. Case studies

*Illustrative end‑to‑end scenarios showing how each ideal customer uses Operator. (Composite examples for demonstration.)*

### Case study A — The solo founder: "My marketing runs itself, and I approve it over coffee"

**Maya** runs a one‑person SaaS doing ~$18K MRR. She has no time to market consistently.

- She fills in her Brief and runs a **Deep Dive** on her product docs and a few customer‑call notes.
- The **Social agent** (background on) tops up a queue of on‑brand X drafts from current industry topics. The **Content engine** turns one into a longform article, an X thread, and a Substack post.
- The **Admin agent** triages her inbox overnight into drafted replies.
- Each morning she opens the **Daily Brief** ("2 sales, 3 approvals waiting, follower growth flat"), then clears the **Approval Center** in ten minutes — approving the posts, editing one email, scheduling a thread.

**Outcome:** consistent presence and a zero‑inbox, on ~15 minutes a day — the work of a part‑time marketer + assistant for a fraction of the cost.

### Case study B — The small agency: "Ten clients' content, one review queue"

**Northwind**, a 6‑person marketing studio, drowns in client content and approvals.

- They run a **workspace per client**, each with that client's brief and voice.
- The **Content engine** produces each client's weekly longform + thread; the **Social Studio** learns each client's voice; **Bulk schedule** loads a month of posts at once.
- Everything routes to the **Approval Center**, where an account manager approves or requests changes — the same review workflow they already run with clients, now 10× faster.

**Outcome:** more clients per account manager, and a defensible "we use an AI ops layer" story. Operator replaces a $600–1,000/mo social stack *and* frees senior time.

### Case study C — The funded startup: "Look like a team of fifteen"

**A pre‑seed startup** — a founder and two engineers, no ops or marketing hire.

- The **Executive** tracks KPIs and writes a daily brief; **CRM Radar** turns stale HubSpot deals and new leads into drafted follow‑ups.
- The **Opportunities** scanner surfaces fit‑ranked grants and drafts an application **plan** (never submitting) that becomes a **Project**; the founder exports the packet and submits.
- Monthly, the Executive generates an **investor update** from real data, editable and copy‑as‑email.

**Outcome:** the operational surface of a much larger company — pipeline hygiene, non‑dilutive funding pursuit, and investor comms — without a hire.

### Case study D — The consultant: "Never drop a lead or an email again"

**A solo consultant** with strong inbound but a leaky follow‑up process.

- The **Growth agent** flags warm leads going cold and drafts personal follow‑ups; the **Email Manager** keeps the inbox triaged into drafted replies.
- **Notes**: after a call she jots "propose retainer to Acme, send SOW," hits **Send to Executive**, and approves the tasks it proposes.

**Outcome:** faster response times, nothing slips, and a pipeline that keeps moving — the value of an EA at ~10% of the cost.

---

## 6. Getting started (onboarding)

1. **Sign up** and complete a short onboarding that seeds your workspace (agents start idle so your board stays clean until you're ready).
2. **Write your Business Brief** (5 minutes).
3. **Connect Gmail + X** (and HubSpot/Notion/Calendar/Stripe as needed).
4. *(Optional)* **Run a Deep Dive** on your real material.
5. **Turn on an agent** or hit **Run** to prepare your first tasks — then approve your first drafts the same day.

Time to first approved action: **same session.** Reset is always available (a guarded, type‑to‑confirm account reset) if you want to start fresh.

---

## 7. Under the hood (for the technically curious)

- **Stack:** Next.js 15 (App Router), Supabase (Postgres + Auth), Drizzle ORM, deployed on Vercel; Anthropic Claude for all AI.
- **Automation:** production cron heartbeats run background agents hourly, publish scheduled posts every 15 minutes, advance Deep Dives every 2 minutes, and run opportunity scans every 6 hours — all secured by a shared secret.
- **Isolation:** every query is workspace‑scoped and guarded; tokens are encrypted at rest.
- **Honesty:** execution acts only on connected systems and records an auditable result per step.

---

## 8. What's not included / on the roadmap

- **Coming‑soon connectors:** Webflow, LinkedIn, Slack (approvals + brief where you already work).
- **Billing/plans** UI is not yet surfaced in‑app (managed out‑of‑band at launch).
- **Notifications** preferences exist in the UI but are not yet persisted server‑side.
- **Deeper analytics** and multi‑seat/team roles are natural next steps for the agency tier.

---

## 9. Why Operator wins

- **It does the work, across tools** — not a single‑function assistant, not a passive scheduler.
- **You stay in control** — the Approval Center + hard guardrails answer the #1 fear of autonomous agents.
- **It's grounded in your reality** — brief + Deep Dive + live CRM/calendar mean drafts reference the truth, in your voice.
- **It consolidates a stack** — social + content + email + CRM + projects + an executive brief, in one place, for less than the tools it replaces.

**Operator is the AI operations team for people who are the whole team — with a human always holding the last click.**
