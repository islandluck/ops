"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  FileSearch,
  Inbox,
  PenLine,
  Play,
  Receipt,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Telescope,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { HeroBoard } from "@/components/marketing/hero-board";
import { Button, buttonVariants } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { hasSupabaseClientEnv } from "@/lib/config";
import { cn } from "@/lib/cn";

const LOOP = [
  { icon: FileSearch, title: "Agent detects work", body: "Agents watch your inbox, calendar, site, and CRM for things that need doing." },
  { icon: PenLine, title: "Prepares a draft", body: "It writes the emails, copy, or summary and explains why it surfaced the task." },
  { icon: ClipboardCheck, title: "You approve", body: "Review the draft and affected systems, then Approve, Request changes, or Reject." },
  { icon: Zap, title: "It executes", body: "On approval the work runs — emails send, records update, content publishes." },
  { icon: Check, title: "Moves to Done", body: "The card lands in Done and the full lifecycle is written to your activity log." },
];

const AGENTS = [
  { icon: TrendingUp, name: "Growth Agent", desc: "Follows up with warm leads, re-engages trials, requests reviews.", color: "text-emerald-600 bg-emerald-50" },
  { icon: Inbox, name: "Admin Agent", desc: "Handles scheduling, reschedules, receipts, and inbox chores.", color: "text-sky-600 bg-sky-50" },
  { icon: PenLine, name: "Content Agent", desc: "Drafts newsletters, website copy, and social posts in your voice.", color: "text-violet-600 bg-violet-50" },
  { icon: Telescope, name: "Research Agent", desc: "Tracks competitors and turns calls into briefs you can act on.", color: "text-amber-600 bg-amber-50" },
  { icon: Receipt, name: "Finance Agent", desc: "Chases overdue invoices and reconciles payouts — never moves money alone.", color: "text-rose-600 bg-rose-50" },
];

const PERMISSIONS = [
  { title: "Suggest only", body: "The agent surfaces ideas. Nothing happens until you build it out.", tone: "border-slate-200" },
  { title: "Approval required", body: "The agent prepares the work and waits for your one-click approval.", tone: "border-indigo-200 ring-1 ring-indigo-100" },
  { title: "Auto-run within guardrails", body: "Low-risk actions run automatically inside the limits you set.", tone: "border-emerald-200" },
];

export default function LandingPage() {
  const router = useRouter();
  const { enterDemo } = useStore();

  function openDemo() {
    if (hasSupabaseClientEnv) {
      // Real backend: sign in to reach the live workspace.
      router.push("/login");
      return;
    }
    enterDemo();
    router.push("/approvals");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Nav ------------------------------------------------------------ */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#agents" className="transition-colors hover:text-foreground">Agents</a>
            <a href="#trust" className="transition-colors hover:text-foreground">Trust &amp; control</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Sign in
            </Link>
            <Button size="sm" onClick={openDemo}>
              Open the demo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero ----------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="container relative grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px] font-medium text-muted-foreground shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              The website-native business operating system
            </span>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.4rem]">
              Run the repetitive parts of your business from one place.
            </h1>
            <p className="mt-5 max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
              Connect your inbox, calendar, website, and CRM. Agents prepare work
              across growth, admin, content, and research. You review what matters
              and approve execution in one click.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={openDemo} className="shadow-sm">
                <Play className="h-4 w-4" />
                Open the live demo
              </Button>
              <Link href="/onboarding" className={buttonVariants({ variant: "outline", size: "lg" })}>
                See onboarding
              </Link>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["No setup or infrastructure", "Approval-gated by default", "Your data stays yours"].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" />
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="lg:pl-4">
            <HeroBoard />
          </div>
        </div>
      </section>

      {/* Loop ----------------------------------------------------------- */}
      <section id="how" className="border-t border-border bg-card/60 py-20">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <SectionEyebrow>The core loop</SectionEyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Agents do the prep. You stay in control.
            </h2>
            <p className="mt-3 text-muted-foreground">
              Every task follows the same visible path — and nothing risky runs
              without your sign-off.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-5">
            {LOOP.map((step, i) => (
              <div key={step.title} className="relative rounded-xl border border-border bg-card p-5 shadow-card">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="h-5 w-5" />
                </div>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Step {i + 1}
                </p>
                <h3 className="mt-0.5 text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agents --------------------------------------------------------- */}
      <section id="agents" className="py-20">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <SectionEyebrow>Specialized agents</SectionEyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              One agent per part of your business
            </h2>
            <p className="mt-3 text-muted-foreground">
              Not one vague super-assistant. Five focused operators that map to the
              work you already do.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((a) => (
              <div key={a.name} className="card-interactive rounded-xl border border-border bg-card p-5 shadow-card">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", a.color)}>
                  <a.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{a.name}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{a.desc}</p>
              </div>
            ))}
            <div className="flex flex-col justify-center rounded-xl border border-dashed border-border bg-muted/40 p-5">
              <p className="text-sm font-medium text-foreground">Every agent waits for your rules.</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Set each one to suggest, require approval, or auto-run within
                guardrails — per category and per integration.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust ---------------------------------------------------------- */}
      <section id="trust" className="border-t border-border bg-card/60 py-20">
        <div className="container grid gap-12 lg:grid-cols-2">
          <div>
            <SectionEyebrow>Trust &amp; control</SectionEyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              You remain the principal. Always.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Operator is built around approval gates, not black-box autonomy.
              Risky actions stop and wait for you, every move is logged, and money
              never moves on its own.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Approval gates before anything risky executes",
                "A complete, readable activity log for every task",
                "Paid media and payments never auto-run in V1",
                "Edit, snooze, or reject any prepared task",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  <span className="text-foreground/90">{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 inline-flex items-center gap-2 rounded-lg border border-border bg-card p-1 pr-4 text-sm shadow-sm">
              <span className="rounded-md bg-primary/10 px-2.5 py-1.5 font-medium text-primary">
                <ScrollText className="mr-1.5 inline h-4 w-4" />
                Activity log
              </span>
              <span className="text-muted-foreground">Nothing happens off the record.</span>
            </div>
          </div>
          <div className="grid content-start gap-4">
            {PERMISSIONS.map((p) => (
              <div key={p.title} className={cn("rounded-xl border bg-card p-5 shadow-card", p.tone)}>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">{p.title}</h3>
                  <ShieldCheck className="h-5 w-5 text-muted-foreground/50" />
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA ------------------------------------------------------------ */}
      <section className="py-20">
        <div className="container">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-indigo-600 to-indigo-700 px-8 py-14 text-center shadow-elevated">
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-10" />
            <div className="relative mx-auto max-w-xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white">
                See the Approval Center in action
              </h2>
              <p className="mt-3 text-indigo-100">
                A seeded workspace is ready and waiting — real tasks, real drafts,
                real approvals. No account needed.
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  onClick={openDemo}
                  className="bg-white text-indigo-700 hover:bg-white/90"
                >
                  Open the live demo
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Link
                  href="/login"
                  className={buttonVariants({
                    variant: "ghost",
                    size: "lg",
                    className: "text-white hover:bg-white/10 hover:text-white",
                  })}
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer --------------------------------------------------------- */}
      <footer className="border-t border-border py-10">
        <div className="container flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <Logo size="sm" />
          <p>Operator — Approval Center. A V1 product prototype.</p>
          <p>Built for operators, not engineers.</p>
        </div>
      </footer>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[13px] font-semibold uppercase tracking-wider text-primary">
      {children}
    </span>
  );
}
