# Operator — the Approval Center

A polished, demoable **V1 prototype** of *Operator*, a website-native business operating
system for entrepreneurs, freelancers, agencies, and small-business operators.

The core interaction model is **not** chat. It is an **Approval Center** that combines the
visual flow of a kanban board with the structure of approval workflows: agents detect work,
prepare draft outputs, and surface tasks into category queues. You review what matters and
approve execution in one click. Every task has a visible lifecycle and a full activity log.

> **Note on the repo:** this `operator/` folder is a self-contained Next.js app. It is
> intentionally unrelated to the Python materials-discovery platform in the parent
> directory — it was built from `approval-center-prd.md` as a separate product.

---

## Quick start (demo mode)

```bash
cd operator
npm install
npm run dev      # http://localhost:3000
```

With no environment variables set, the app runs in **demo mode**: a seeded, realistic
workspace ("Northwind Studio"), mocked auth, and state in `localStorage`. Nothing else
required — open it and go.

## Go to production (real backend)

Set Supabase environment variables and the app automatically switches to **server mode**:
real authentication (Supabase Auth) and durable Postgres persistence, deployable to Vercel.
**See [SETUP.md](SETUP.md) for the ~10-minute setup + deploy guide.**

### Try the demo in 30 seconds

1. Landing page → **Open the live demo** (jumps straight into a populated Approval Center).
2. Open **“Follow up with 12 warm leads”** → read the drafts → click **Approve**.
   Watch it move through *Executing → Done* with live step feedback and a toast.
3. Open **“Weekly newsletter…”** (Changes Requested) → **Request changes** with a note →
   the agent revises and returns it to *Ready for Approval*.
4. Open the **LinkedIn** task (Approved, failed) → see the error → **Retry**.
   Connect LinkedIn on the **Integrations** page first, and the retry will succeed.
5. Check the **Activity log** — the full lifecycle of everything is recorded.

To restore the seeded data at any time: **Settings → Reset demo**.

---

## What's implemented (PRD V1 scope)

- **Marketing / landing page** with the product promise and a live board preview.
- **Mocked auth** (`/login`) and a 6-step **onboarding wizard** (`/onboarding`) that builds
  the business brief, connects tools, and sets approval preferences.
- **Approval Center** (`/approvals`) — the hero:
  - Left sidebar: workspace switcher, primary nav, **categories with counts**, **saved
    views**, **agent list** with status.
  - Top bar: search, multi-dimension **filters** (category, risk, agent, due), **sort**
    (urgency / impact / newest), **board ↔ list** toggle, quick **create task**.
  - **6-column kanban**: New · Agent Working · Ready for Approval · Changes Requested ·
    Approved · Done — with **drag-and-drop** between columns.
  - Right-side **task detail drawer**: rationale ("why now"), suggested action, meta
    (agent / risk / priority / due), affected systems (with live connection status), draft
    output previews, change history, and **Approve / Request changes / Reject** actions
    (plus secondary: approve & auto-run, snooze).
- **Execution lifecycle**: Detected → Prepared → Ready → Approved → Executing →
  Completed / **Failed (with retry)**, all visible with live step progress and toasts.
- **Activity log** (`/activity`) — filterable, grouped by day, click-through to tasks.
- **Dashboard** (`/dashboard`) — a 10-second read: stats, what needs approval, agents,
  category breakdown, recent activity.
- **Integrations** (`/integrations`) — connect/disconnect + per-integration permission mode.
- **Business brief** (`/brief`) — editable company context, goals, voice, restricted phrases.
- **Settings** (`/settings`) — profile, per-agent permission modes, notifications, reset/sign-out.
- **Permission model**: Suggest only · Approval required · Auto-run within guardrails
  (money / paid media never auto-run).
- **Responsive**: on mobile the board switches to category tabs + a vertical card list with a
  sticky-action, full-screen task detail.

## Tech

- **Next.js 15** (App Router) · **React 19** · **TypeScript** · **Tailwind CSS v3**
- **Supabase** (Postgres + Auth) · **Drizzle ORM** · server actions — in server mode
- Hand-built shadcn-style component kit (`components/ui`) — no fragile CLI codegen
- `lucide-react` icons, `clsx` + `tailwind-merge` for class composition
- Native HTML5 drag-and-drop (no DnD dependency)

## Architecture

```
app/
  page.tsx              Marketing landing
  login/                Mocked auth
  onboarding/           6-step wizard → business brief
  (product)/            Authenticated shell (sidebar + topbar + global drawer)
    approvals/          The Approval Center board (hero)
    dashboard/  activity/  integrations/  brief/  settings/
components/
  ui/                   Button, Badge, Card, Input, Drawer, Dialog, Popover, …
  board/                TaskCard, BoardColumn, Board, TopBar, ListView, TaskDrawer
  app/                  AppShell, Sidebar, PageHeader, EmptyState
lib/
  types.ts              All PRD entities (Workspace, BusinessBrief, Agent, Task,
                        TaskAsset, ApprovalDecision, ExecutionRun, ActivityEvent)
  seed.ts               Realistic seeded "Northwind Studio" workspace
  store.tsx             Client store (context + reducer) — the auditable "API":
                        approve, requestChanges, reject, execute, retry, move, … +
                        localStorage persistence + simulated execution engine
  filters.ts            Pure filtering / sorting / grouping / counts
  constants.ts          Categories, statuses, risk, permission metadata + colors
  format.ts  cn.ts      Date/text helpers, className merge
```

### Data layer note

The typed client store (`lib/store.tsx`) is the single source of UI state and exposes the
PRD's operation surface (approve, request changes, reject, execute, …). Its persistence is
mode-aware:

- **Demo mode** → `localStorage`.
- **Server mode** → the workspace bundle is loaded from Postgres on mount and saved back via
  server actions (`app/actions.ts` → `lib/db/queries.ts`), debounced. Every write is scoped
  to the authenticated user's workspace.

Backend files: `lib/db/schema.ts` (Drizzle tables), `lib/db/queries.ts` (load/save/reset),
`lib/db/seed-workspace.ts` (per-workspace seeding), `lib/supabase/*` (auth), `middleware.ts`
(session + route protection), `drizzle/` (migrations).
