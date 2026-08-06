"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, LogOut, RefreshCw, Save, Trash2, UserRound } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { CategoryIcon } from "@/components/badges";
import { useStore } from "@/lib/store";
import { hardResetAccountAction } from "@/app/actions";
import { hasSupabaseClientEnv } from "@/lib/config";
import { CATEGORY_META, PERMISSION_META } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PermissionMode } from "@/lib/types";

export default function SettingsPage() {
  const { state, login, setAgentMode, resetDemo, logout } = useStore();
  const router = useRouter();
  const [name, setName] = useState(state?.session.user_name ?? "");
  const [email, setEmail] = useState(state?.session.user_email ?? "");
  const [notify, setNotify] = useState({ approvals: true, completions: true, failures: true });

  if (!state) return null;

  function signOut() {
    logout();
    router.push("/");
  }

  return (
    <>
      <PageHeader title="Settings" description="Manage your profile, agents, and workspace." />
      <PageBody className="max-w-3xl">
        <div className="space-y-5">
          {/* Profile */}
          <Card className="p-5">
            <SectionTitle icon={UserRound} title="Profile" subtitle="How you appear in the activity log" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="mt-4">
              <Button size="sm" onClick={() => login(name, email)}>
                <Save className="h-4 w-4" />
                Save profile
              </Button>
            </div>
          </Card>

          {/* Agents & permissions */}
          <Card className="p-5">
            <SectionTitle
              title="Agents & permissions"
              subtitle="Decide how much each agent can do on its own"
            />
            <div className="mt-4 space-y-2">
              {state.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex flex-col gap-3 rounded-xl border border-border p-3.5 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", CATEGORY_META[agent.category].iconBg)}>
                      <CategoryIcon category={agent.category} className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold">{agent.name}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {PERMISSION_META[agent.permissions_mode].label} · last run {relativeTime(agent.last_run_at)}
                      </p>
                    </div>
                  </div>
                  <Segmented
                    size="sm"
                    options={[
                      { value: "suggest", label: "Suggest" },
                      { value: "approval", label: "Approval" },
                      { value: "auto", label: "Auto" },
                    ]}
                    value={agent.permissions_mode}
                    onChange={(m) => setAgentMode(agent.id, m as PermissionMode)}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Notifications */}
          <Card className="p-5">
            <SectionTitle title="Notifications" subtitle="When should Operator nudge you?" />
            <div className="mt-3 divide-y divide-border">
              {([
                ["approvals", "Something is ready for my approval"],
                ["completions", "A task finishes executing"],
                ["failures", "An execution fails and needs me"],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between py-2.5">
                  <span className="text-[13.5px]">{label}</span>
                  <Switch
                    checked={notify[key]}
                    onCheckedChange={(v) => setNotify((n) => ({ ...n, [key]: v }))}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Workspace */}
          <Card className="p-5">
            <SectionTitle title="Workspace" subtitle="Demo controls and session" />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13.5px] font-medium">Reset demo data</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Restore the seeded Northwind Studio workspace and clear your changes.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={resetDemo}>
                <RefreshCw className="h-4 w-4" />
                Reset demo
              </Button>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <div>
                <p className="text-[13.5px] font-medium">Sign out</p>
                <p className="text-[12.5px] text-muted-foreground">End this session and return to the marketing site.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={signOut} className="text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </Card>

          {/* Danger zone — server mode only (hard reset needs a real account) */}
          {hasSupabaseClientEnv && <DangerZone />}
        </div>
      </PageBody>
    </>
  );
}

/** Permanently wipe the account, behind a 3-gate confirmation ending in
 *  type-to-confirm. On success the user is sent back through onboarding. */
function DangerZone() {
  const [step, setStep] = useState(0);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const matches = phrase.trim().toUpperCase() === "RESET";

  function cancel() {
    setStep(0);
    setPhrase("");
    setError("");
  }

  async function doReset() {
    if (!matches || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await hardResetAccountAction(phrase);
      if (r.ok) {
        // Everything is gone; the fresh workspace + onboarding load on reload.
        window.location.href = "/onboarding";
      } else {
        setError(r.error ?? "Couldn't reset the account.");
        setBusy(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-200 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600">
          <AlertTriangle className="h-4.5 w-4.5" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-red-700">Danger zone</h2>
          <p className="text-[12.5px] text-muted-foreground">Irreversible. Proceed with care.</p>
        </div>
      </div>

      {step === 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13.5px] font-medium">Reset account</p>
            <p className="text-[12.5px] text-muted-foreground">
              Permanently erase everything in this account and start fresh.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setStep(1)}>
            <Trash2 className="h-4 w-4" />
            Reset account
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50/50 p-4">
          <p className="text-[13.5px] font-semibold text-red-700">
            This permanently deletes everything in your account.
          </p>
          <p className="mt-1.5 text-[12.5px] text-foreground/80">Gone forever — there is no recovery:</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-foreground/80">
            <li>All tasks, projects, and their history</li>
            <li>Every Executive chat, daily brief, goal, and saved memory</li>
            <li>All notes, documents, pages, and content</li>
            <li>Your CRM &amp; calendar data, and all connected integrations (disconnected)</li>
            <li>Your business profile — you&apos;ll set it up again from scratch</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50/50 p-4">
          <p className="text-[13.5px] font-semibold text-red-700">Are you absolutely sure?</p>
          <p className="mt-1.5 text-[12.5px] text-foreground/80">
            This cannot be undone. Everything is erased immediately and you&apos;ll be returned to onboarding to set
            up a brand-new account. There is no way to get any of it back.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setStep(3)}>
              I understand — continue
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50/60 p-4">
          <p className="text-[13.5px] font-semibold text-red-700">Final confirmation</p>
          <p className="mt-1.5 text-[12.5px] text-foreground/80">
            Type <span className="rounded bg-red-100 px-1 font-mono font-semibold text-red-700">RESET</span> to
            permanently erase this account.
          </p>
          <Input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="RESET"
            autoFocus
            className="mt-2 max-w-[220px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") void doReset();
            }}
          />
          {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={doReset}
              disabled={busy || !matches}
              className="border-red-600 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Permanently reset account
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  subtitle,
}: {
  icon?: typeof Save;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {Icon && (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </span>
      )}
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
