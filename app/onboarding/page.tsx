"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Gavel, Loader2, Plug, RotateCcw, ShieldCheck, Target } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useStore, type OnboardingPayload } from "@/lib/store";
import { completeOnboardingAction } from "@/app/actions";
import { hasSupabaseClientEnv } from "@/lib/config";
import { PERMISSION_META, DEFAULT_BOARD_GOAL, DEFAULT_BOARD_MEMBERS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { PermissionMode } from "@/lib/types";

const STEPS = [
  { title: "Your account", subtitle: "The basics" },
  { title: "Your business", subtitle: "What you do" },
  { title: "Your goals", subtitle: "What matters most" },
  { title: "Build your boardroom", subtitle: "Your AI board" },
  { title: "Voice & approvals", subtitle: "How agents behave" },
  { title: "Connect your tools", subtitle: "Where agents work" },
];
const COLLECT_STEPS = 5; // steps 0–4 are collected, then persisted; step 5 is integrations

const GOAL_OPTIONS = [
  "Book more discovery calls",
  "Follow up with leads within 24 hours",
  "Publish content consistently",
  "Reduce overdue invoices to zero",
  "Stay on top of admin & scheduling",
  "Keep an eye on competitors",
];

const VOICE_OPTIONS = [
  "Warm and plain-spoken",
  "Confident, never hypey",
  "Short sentences",
  "Lead with the client's outcome",
  "Friendly and casual",
  "Professional and precise",
];

const ROLE_LABEL: Record<string, string> = {
  finance: "Finance",
  marketing: "Marketing",
  product: "Product",
  strategy: "Strategy",
  technology: "Technology",
};

const CONNECT = [
  { key: "google", name: "Google", desc: "Gmail, Calendar & Sheets", color: "bg-red-50 text-red-600", oauth: true },
  { key: "x", name: "X (Twitter)", desc: "Publish approved posts", color: "bg-slate-100 text-slate-700", oauth: true },
  { key: "hubspot", name: "HubSpot", desc: "Keep your CRM in sync", color: "bg-orange-50 text-orange-600", oauth: false },
  { key: "notion", name: "Notion", desc: "Create pages & read notes", color: "bg-neutral-100 text-neutral-700", oauth: true },
  { key: "stripe", name: "Stripe", desc: "Invoices & checkout", color: "bg-violet-50 text-violet-600", oauth: false },
];

const LOADING_MESSAGES = [
  "Reading your brief…",
  "Assembling your boardroom…",
  "Briefing your agents…",
  "Setting your goals…",
  "Preparing your workspace…",
];

export default function OnboardingPage() {
  const router = useRouter();
  const { completeOnboarding, hydrated, state, reloadWorkspace } = useStore();
  const configured = hasSupabaseClientEnv;
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState({
    user_name: configured ? "" : "Alex Rivera",
    user_email: configured ? "" : "alex@northwindstudio.com",
    company_name: configured ? "" : "Northwind Studio",
    website_url: configured ? "" : "https://northwindstudio.com",
    business_description: configured
      ? ""
      : "A three-person studio that designs websites and brand identities for small, owner-run service businesses.",
    ideal_customer_profile: configured
      ? ""
      : "Owner-operated service businesses with 2–25 staff who need a credible, converting web presence.",
    goals: new Set<string>(configured ? [] : [GOAL_OPTIONS[0], GOAL_OPTIONS[1]]),
    voice: new Set<string>(configured ? [] : [VOICE_OPTIONS[0], VOICE_OPTIONS[1], VOICE_OPTIONS[2], VOICE_OPTIONS[3]]),
    approvalDefault: "approval" as PermissionMode,
  });

  const [board, setBoard] = useState({
    goal: DEFAULT_BOARD_GOAL,
    members: DEFAULT_BOARD_MEMBERS.map((m) => ({ role: m.role, name: m.name, emoji: m.emoji, mandate: m.mandate })),
  });

  useEffect(() => {
    const session = state?.session;
    if (!configured || !session) return;
    setData((d) => ({
      ...d,
      user_name: d.user_name || session.user_name || "",
      user_email: d.user_email || session.user_email || "",
    }));
  }, [configured, state?.session?.user_name, state?.session?.user_email]);

  // Cycle the loading messages while the workspace is being set up.
  useEffect(() => {
    if (!submitting) {
      setMsgIdx(0);
      return;
    }
    const iv = setInterval(() => setMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length), 1300);
    return () => clearInterval(iv);
  }, [submitting]);

  function toggleIn(key: "goals" | "voice", value: string) {
    setData((d) => {
      const next = new Set(d[key]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...d, [key]: next };
    });
  }

  function patchMember(role: string, p: Partial<{ name: string; emoji: string }>) {
    setBoard((b) => ({ ...b, members: b.members.map((m) => (m.role === role ? { ...m, ...p } : m)) }));
  }

  function resetMember(role: string) {
    const seed = DEFAULT_BOARD_MEMBERS.find((m) => m.role === role);
    if (seed) patchMember(role, { name: seed.name, emoji: seed.emoji });
  }

  // Persist everything, then advance to the (post-setup) integrations step.
  async function persist() {
    setError(null);
    setSubmitting(true);
    const boardMembers = board.members.map((m) => ({ role: m.role, name: m.name, emoji: m.emoji }));
    if (configured) {
      const res = await completeOnboardingAction({
        user_name: data.user_name.trim(),
        company_name: data.company_name.trim(),
        website_url: data.website_url.trim(),
        business_description: data.business_description.trim(),
        ideal_customer_profile: data.ideal_customer_profile.trim(),
        goals: [...data.goals],
        voice_rules: [...data.voice],
        approvalDefault: data.approvalDefault,
        boardGoal: board.goal.trim(),
        boardMembers,
      });
      if (!res.ok) {
        setSubmitting(false);
        setError(res.error ?? "Something went wrong. Please try again.");
        return;
      }
      await reloadWorkspace();
    } else {
      const payload: OnboardingPayload = {
        company_name: data.company_name,
        website_url: data.website_url,
        business_description: data.business_description,
        ideal_customer_profile: data.ideal_customer_profile,
        goals: [...data.goals],
        voice_rules: [...data.voice],
        approvalDefault: data.approvalDefault,
        user_name: data.user_name,
        user_email: data.user_email,
        connected: [],
      };
      completeOnboarding(payload);
    }
    setSubmitting(false);
    setStep(COLLECT_STEPS); // → integrations
  }

  function connect(providerKey: string, oauth: boolean) {
    if (configured && oauth) window.location.href = `/api/integrations/${providerKey}/connect`;
    else router.push("/integrations");
  }

  // While the workspace is being created, show a progressive loader.
  if (submitting) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-6 text-center">
        <Logo />
        <Loader2 className="mt-10 h-8 w-8 animate-spin text-primary" />
        <p className="mt-5 text-[15px] font-medium text-foreground">{LOADING_MESSAGES[msgIdx]}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Setting up {data.company_name.trim() || "your workspace"}…</p>
      </div>
    );
  }

  const onIntegrations = step === COLLECT_STEPS;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas lg:flex-row">
      {/* Rail */}
      <aside className="shrink-0 border-b border-border bg-card px-6 py-6 lg:w-[300px] lg:border-b-0 lg:border-r lg:px-7 lg:py-8">
        <Logo />
        <div className="mt-8 hidden lg:block">
          <ol className="space-y-1">
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <li
                  key={s.title}
                  className={cn("flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors", active && "bg-primary/5")}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                      done ? "bg-success text-white" : active ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span>
                    <span className={cn("block text-[13.5px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                      {s.title}
                    </span>
                    <span className="block text-[11.5px] text-muted-foreground/70">{s.subtitle}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="mt-4 lg:hidden">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] font-medium text-muted-foreground">
            Step {step + 1} of {STEPS.length} · {STEPS[step].title}
          </p>
        </div>
      </aside>

      {/* Content */}
      <main className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
        <div className="w-full max-w-xl">
          <div className="mb-6">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-primary">{STEPS[step].subtitle}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{STEPS[step].title}</h1>
          </div>

          <div className="min-h-[280px]">
            {step === 0 && (
              <div className="space-y-4">
                <Row>
                  <FieldX label="Your name">
                    <Input value={data.user_name} onChange={(e) => setData((d) => ({ ...d, user_name: e.target.value }))} />
                  </FieldX>
                  <FieldX label="Work email">
                    <Input value={data.user_email} onChange={(e) => setData((d) => ({ ...d, user_email: e.target.value }))} />
                  </FieldX>
                </Row>
                <FieldX label="Company name">
                  <Input value={data.company_name} onChange={(e) => setData((d) => ({ ...d, company_name: e.target.value }))} />
                </FieldX>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <FieldX label="Website">
                  <Input value={data.website_url} onChange={(e) => setData((d) => ({ ...d, website_url: e.target.value }))} />
                </FieldX>
                <FieldX label="What does your business do?">
                  <Textarea value={data.business_description} onChange={(e) => setData((d) => ({ ...d, business_description: e.target.value }))} />
                </FieldX>
                <FieldX label="Who is your ideal customer?">
                  <Textarea value={data.ideal_customer_profile} onChange={(e) => setData((d) => ({ ...d, ideal_customer_profile: e.target.value }))} />
                </FieldX>
              </div>
            )}

            {step === 2 && (
              <div>
                <p className="mb-3 text-[13.5px] text-muted-foreground">
                  Pick what your agents should optimize for. You can change this anytime.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GOAL_OPTIONS.map((g) => (
                    <ChoiceChip key={g} active={data.goals.has(g)} onClick={() => toggleIn("goals", g)}>
                      {g}
                    </ChoiceChip>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-[13.5px] font-medium">
                    <Target className="h-4 w-4 text-primary" /> The board's goal
                  </p>
                  <p className="mb-2 text-[12.5px] text-muted-foreground">
                    Your AI board of directors drives everything toward this. The default is deliberately aggressive —
                    make it yours (it keeps its VC-caliber, direct character either way).
                  </p>
                  <Textarea value={board.goal} onChange={(e) => setBoard((b) => ({ ...b, goal: e.target.value }))} rows={2} placeholder={DEFAULT_BOARD_GOAL} />
                </div>
                <div>
                  <p className="mb-2 text-[13.5px] font-medium">Your 5 board members</p>
                  <p className="mb-2.5 text-[12px] text-muted-foreground">
                    Rename any of them or swap the avatar. You can rewrite each mandate later from the Boardroom.
                  </p>
                  <div className="space-y-2.5">
                    {board.members.map((m) => (
                      <div key={m.role} className="rounded-xl border border-border bg-card p-3">
                        <div className="flex items-center gap-2.5">
                          <input
                            value={m.emoji}
                            onChange={(e) => patchMember(m.role, { emoji: e.target.value })}
                            maxLength={4}
                            className="h-9 w-11 shrink-0 rounded-lg border border-input bg-background text-center text-lg"
                          />
                          <div className="min-w-0 flex-1">
                            <Input
                              value={m.name}
                              onChange={(e) => patchMember(m.role, { name: e.target.value })}
                              placeholder="Member name"
                              className="h-8 text-[13.5px] font-semibold"
                            />
                          </div>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                            {ROLE_LABEL[m.role] ?? m.role}
                          </span>
                          <button
                            onClick={() => resetMember(m.role)}
                            title="Reset to suggested"
                            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">{m.mandate}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <p className="mb-2 text-[13.5px] font-medium">How should agents sound?</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {VOICE_OPTIONS.map((v) => (
                      <ChoiceChip key={v} active={data.voice.has(v)} onClick={() => toggleIn("voice", v)}>
                        {v}
                      </ChoiceChip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[13.5px] font-medium">Default permission level</p>
                  <div className="space-y-2">
                    {(["suggest", "approval", "auto"] as PermissionMode[]).map((m) => {
                      const active = data.approvalDefault === m;
                      return (
                        <button
                          key={m}
                          onClick={() => setData((d) => ({ ...d, approvalDefault: m }))}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                            active ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:bg-accent",
                          )}
                        >
                          <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", active ? "border-primary bg-primary" : "border-border")}>
                            {active && <Check className="h-3 w-3 text-white" />}
                          </span>
                          <span>
                            <span className="block text-[13.5px] font-semibold">{PERMISSION_META[m].label}</span>
                            <span className="block text-[12.5px] text-muted-foreground">{PERMISSION_META[m].description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {step === COLLECT_STEPS && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <p className="text-[13px] text-emerald-900">
                    Your workspace is ready. Connect your accounts so your agents can actually act — or skip and do it
                    anytime from Integrations. Nothing sends without your approval.
                  </p>
                </div>
                {CONNECT.map((c) => (
                  <div key={c.key} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold", c.color)}>
                      {c.name[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold">{c.name}</p>
                      <p className="text-[12px] text-muted-foreground">{c.desc}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => connect(c.key, c.oauth)}>
                      <Plug className="h-4 w-4" />
                      Connect
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}

          {/* Footer nav */}
          <div className="mt-8 flex items-center justify-between">
            {onIntegrations ? (
              <Link href="/integrations" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                Manage in Integrations
              </Link>
            ) : step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            ) : (
              <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                Cancel
              </Link>
            )}

            {onIntegrations ? (
              <Button size="lg" onClick={() => router.push("/approvals")}>
                Go to my workspace
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : step === COLLECT_STEPS - 1 ? (
              <Button size="lg" onClick={persist} disabled={!hydrated}>
                <Gavel className="h-4 w-4" />
                Set up my workspace
              </Button>
            ) : (
              <Button size="lg" onClick={() => setStep((s) => s + 1)}>
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function FieldX({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ChoiceChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3.5 py-3 text-left text-[13px] font-medium transition-colors",
        active ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20" : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      <span className={cn("flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2", active ? "border-primary bg-primary" : "border-border")}>
        {active && <Check className="h-2.5 w-2.5 text-white" />}
      </span>
      {children}
    </button>
  );
}
