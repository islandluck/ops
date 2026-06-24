"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Rocket, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useStore, type OnboardingPayload } from "@/lib/store";
import { PERMISSION_META } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { PermissionMode } from "@/lib/types";

const STEPS = [
  { title: "Your account", subtitle: "The basics" },
  { title: "Your business", subtitle: "What you do" },
  { title: "Your goals", subtitle: "What matters most" },
  { title: "Connect tools", subtitle: "Where agents work" },
  { title: "Voice & approvals", subtitle: "How agents behave" },
  { title: "Review & launch", subtitle: "You're ready" },
];

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

const TOOLS = [
  { name: "Gmail", desc: "Read context and send approved emails", color: "bg-red-50 text-red-600" },
  { name: "Google Calendar", desc: "Scheduling and reschedules", color: "bg-blue-50 text-blue-600" },
  { name: "Webflow", desc: "Publish website changes after approval", color: "bg-indigo-50 text-indigo-600" },
  { name: "HubSpot", desc: "Keep your CRM up to date", color: "bg-orange-50 text-orange-600" },
  { name: "Stripe", desc: "Invoices and payment reminders", color: "bg-violet-50 text-violet-600" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { completeOnboarding, hydrated } = useStore();
  const [step, setStep] = useState(0);

  const [data, setData] = useState({
    user_name: "Alex Rivera",
    user_email: "alex@northwindstudio.com",
    company_name: "Northwind Studio",
    website_url: "https://northwindstudio.com",
    business_description:
      "A three-person studio that designs websites and brand identities for small, owner-run service businesses.",
    ideal_customer_profile:
      "Owner-operated service businesses with 2–25 staff who need a credible, converting web presence.",
    goals: new Set([GOAL_OPTIONS[0], GOAL_OPTIONS[1]]),
    voice: new Set([VOICE_OPTIONS[0], VOICE_OPTIONS[1], VOICE_OPTIONS[2], VOICE_OPTIONS[3]]),
    connected: new Set(["Gmail", "Google Calendar"]),
    approvalDefault: "approval" as PermissionMode,
  });

  const total = STEPS.length;
  const isLast = step === total - 1;

  function toggleIn(key: "goals" | "voice" | "connected", value: string) {
    setData((d) => {
      const next = new Set(d[key]);
      next.has(value) ? next.delete(value) : next.add(value);
      return { ...d, [key]: next };
    });
  }

  function launch() {
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
      connected: [...data.connected],
    };
    completeOnboarding(payload);
    router.push("/approvals");
  }

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
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                    active && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                      done
                        ? "bg-success text-white"
                        : active
                          ? "bg-primary text-white"
                          : "bg-muted text-muted-foreground",
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
              style={{ width: `${((step + 1) / total) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] font-medium text-muted-foreground">
            Step {step + 1} of {total} · {STEPS[step].title}
          </p>
        </div>
      </aside>

      {/* Content */}
      <main className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
        <div className="w-full max-w-xl">
          <div className="mb-6">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-primary">
              {STEPS[step].subtitle}
            </p>
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
              <div className="space-y-2.5">
                <p className="mb-1 text-[13.5px] text-muted-foreground">
                  Connect the tools your agents work across. Nothing is hosted by you.
                </p>
                {TOOLS.map((t) => {
                  const on = data.connected.has(t.name);
                  return (
                    <div key={t.name} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold", t.color)}>
                        {t.name[0]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold">{t.name}</p>
                        <p className="text-[12px] text-muted-foreground">{t.desc}</p>
                      </div>
                      <Switch checked={on} onCheckedChange={() => toggleIn("connected", t.name)} />
                    </div>
                  );
                })}
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

            {step === 5 && (
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-lg font-bold text-white">
                      {data.company_name[0] ?? "N"}
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold">{data.company_name}</p>
                      <p className="text-[12.5px] text-muted-foreground">{data.website_url}</p>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                    <SummaryItem label="Goals" value={`${data.goals.size} selected`} />
                    <SummaryItem label="Voice rules" value={`${data.voice.size} selected`} />
                    <SummaryItem label="Connected tools" value={`${data.connected.size} connected`} />
                    <SummaryItem label="Default permission" value={PERMISSION_META[data.approvalDefault].label} />
                  </dl>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <p className="text-[13px] text-emerald-900">
                    Your five agents are ready and a seeded set of real tasks is waiting in your
                    Approval Center. Nothing risky runs without your sign-off.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="mt-8 flex items-center justify-between">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            ) : (
              <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                Cancel
              </Link>
            )}

            {isLast ? (
              <Button size="lg" onClick={launch} disabled={!hydrated}>
                <Rocket className="h-4 w-4" />
                Launch workspace
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

function ChoiceChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
