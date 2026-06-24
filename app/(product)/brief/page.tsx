"use client";

import { useState } from "react";
import { Ban, Plus, Save, Sparkles, Target, Volume2, X } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PermissionBadge } from "@/components/badges";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export default function BriefPage() {
  const { state, updateBrief } = useStore();
  const brief = state?.brief;

  const [form, setForm] = useState(() => ({
    company_name: brief?.company_name ?? "",
    website_url: brief?.website_url ?? "",
    business_description: brief?.business_description ?? "",
    core_offer: brief?.core_offer ?? "",
    ideal_customer_profile: brief?.ideal_customer_profile ?? "",
    goals: (brief?.goals ?? []).join("\n"),
    voice_rules: (brief?.voice_rules ?? []).join("\n"),
    working_hours: brief?.working_hours ?? "",
    timezone: brief?.timezone ?? "",
  }));
  const [phrases, setPhrases] = useState<string[]>(brief?.restricted_phrases ?? []);
  const [newPhrase, setNewPhrase] = useState("");

  if (!state || !brief) return null;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addPhrase() {
    const p = newPhrase.trim();
    if (p && !phrases.includes(p)) setPhrases((arr) => [...arr, p]);
    setNewPhrase("");
  }

  function save() {
    updateBrief({
      company_name: form.company_name,
      website_url: form.website_url,
      business_description: form.business_description,
      core_offer: form.core_offer,
      ideal_customer_profile: form.ideal_customer_profile,
      goals: form.goals.split("\n").map((s) => s.trim()).filter(Boolean),
      voice_rules: form.voice_rules.split("\n").map((s) => s.trim()).filter(Boolean),
      restricted_phrases: phrases,
      working_hours: form.working_hours,
      timezone: form.timezone,
    });
  }

  return (
    <>
      <PageHeader
        title="Business brief"
        description="The context that powers every agent. Keep it sharp and they stay on-brand."
        actions={
          <Button size="sm" onClick={save}>
            <Save className="h-4 w-4" />
            Save changes
          </Button>
        }
      />
      <PageBody className="max-w-3xl">
        <div className="space-y-5">
          {/* Company */}
          <SectionCard icon={Sparkles} title="Company" subtitle="Who you are and what you sell">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name">
                <Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
              </Field>
              <Field label="Website">
                <Input value={form.website_url} onChange={(e) => set("website_url", e.target.value)} />
              </Field>
            </div>
            <Field label="What the business does">
              <Textarea value={form.business_description} onChange={(e) => set("business_description", e.target.value)} />
            </Field>
            <Field label="Core offer">
              <Textarea value={form.core_offer} onChange={(e) => set("core_offer", e.target.value)} />
            </Field>
          </SectionCard>

          {/* Customers & goals */}
          <SectionCard icon={Target} title="Customers & goals" subtitle="Who you serve and what you're aiming for">
            <Field label="Ideal customer profile">
              <Textarea value={form.ideal_customer_profile} onChange={(e) => set("ideal_customer_profile", e.target.value)} />
            </Field>
            <Field label="Primary goals" hint="One per line">
              <Textarea
                className="min-h-[110px]"
                value={form.goals}
                onChange={(e) => set("goals", e.target.value)}
              />
            </Field>
          </SectionCard>

          {/* Brand voice */}
          <SectionCard icon={Volume2} title="Brand voice" subtitle="How agents should sound — and what to avoid">
            <Field label="Voice rules" hint="One per line">
              <Textarea
                className="min-h-[110px]"
                value={form.voice_rules}
                onChange={(e) => set("voice_rules", e.target.value)}
              />
            </Field>
            <Field label="Restricted phrases" hint="Agents will never use these">
              <div className="flex flex-wrap gap-1.5">
                {phrases.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 py-1 pl-2.5 pr-1 text-[12.5px] font-medium text-red-700"
                  >
                    <Ban className="h-3 w-3" />
                    {p}
                    <button
                      onClick={() => setPhrases((arr) => arr.filter((x) => x !== p))}
                      className="rounded-full p-0.5 hover:bg-red-100"
                      aria-label={`Remove ${p}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={newPhrase}
                  onChange={(e) => setNewPhrase(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPhrase())}
                  placeholder="Add a phrase to avoid…"
                  className="h-9"
                />
                <Button variant="outline" size="sm" onClick={addPhrase} className="h-9">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </Field>
          </SectionCard>

          {/* Operating rules */}
          <SectionCard icon={Save} title="Operating rules" subtitle="Approvals, budgets, and working hours">
            <Field label="Approval rules">
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {brief.approval_rules.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="text-[13px]">{r.label}</span>
                    <PermissionBadge mode={r.mode} />
                  </div>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Budget limits">
                <div className="space-y-2">
                  {brief.budget_limits.map((b) => (
                    <div key={b.label} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]">
                      <span>{b.label}</span>
                      <span className="font-semibold tabular-nums">
                        {b.amount === 0 ? "Never auto" : `$${b.amount.toLocaleString()}/${b.period.replace("ly", "")}`}
                      </span>
                    </div>
                  ))}
                </div>
              </Field>
              <div className="space-y-4">
                <Field label="Working hours">
                  <Input value={form.working_hours} onChange={(e) => set("working_hours", e.target.value)} />
                </Field>
                <Field label="Timezone">
                  <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
                </Field>
              </div>
            </div>
          </SectionCard>

          <div className="flex justify-end">
            <Button onClick={save}>
              <Save className="h-4 w-4" />
              Save changes
            </Button>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Save;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
