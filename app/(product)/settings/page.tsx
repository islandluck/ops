"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw, Save, UserRound } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { CategoryIcon } from "@/components/badges";
import { useStore } from "@/lib/store";
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
        </div>
      </PageBody>
    </>
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
