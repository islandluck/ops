"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Plug, ShieldCheck, Wand2, Zap } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { useStore } from "@/lib/store";
import { hasSupabaseClientEnv } from "@/lib/config";
import { PERMISSION_META } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { Integration, PermissionMode } from "@/lib/types";

const PROVIDER_COLOR: Record<string, string> = {
  Gmail: "bg-red-50 text-red-600",
  "Google Calendar": "bg-blue-50 text-blue-600",
  Webflow: "bg-indigo-50 text-indigo-600",
  HubSpot: "bg-orange-50 text-orange-600",
  Stripe: "bg-violet-50 text-violet-600",
  "Google Sheets": "bg-emerald-50 text-emerald-600",
  LinkedIn: "bg-sky-50 text-sky-700",
  Slack: "bg-fuchsia-50 text-fuchsia-600",
  Notion: "bg-slate-100 text-slate-700",
};

const ERROR_LABELS: Record<string, string> = {
  not_configured: "That provider isn't configured on the server yet (see PHASE3.md).",
  no_encryption_key: "TOKEN_ENCRYPTION_KEY is missing on the server.",
  state_mismatch: "The connection request expired or didn't match. Please try again.",
  bad_state: "Invalid connection state. Please try again.",
  invalid_callback: "The provider returned an unexpected response.",
  no_workspace: "No workspace found for your account.",
  access_denied: "You declined the permission request.",
};

export default function IntegrationsPage() {
  const { state, connectIntegration, disconnectIntegration, setIntegrationMode } = useStore();
  const serverMode = hasSupabaseClientEnv;
  const [banner, setBanner] = useState<{ tone: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connected = p.get("connected");
    const error = p.get("error");
    if (connected) {
      setBanner({ tone: "success", msg: `${cap(connected)} connected successfully.` });
    } else if (error) {
      setBanner({ tone: "error", msg: ERROR_LABELS[error] ?? decodeURIComponent(error) });
    }
    if (connected || error) window.history.replaceState({}, "", "/integrations");
  }, []);

  if (!state) return null;

  const core = state.integrations.filter((i) => !i.optional);
  const optional = state.integrations.filter((i) => i.optional);
  const connectedCount = state.integrations.filter((i) => i.connected).length;

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect the tools your agents work across. Approved tasks execute against the real APIs."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <Plug className="h-3.5 w-3.5" />
            {connectedCount} connected
          </span>
        }
      />
      <PageBody>
        {banner && (
          <div
            className={cn(
              "mb-5 flex items-start gap-3 rounded-xl border p-4",
              banner.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            {banner.tone === "success" ? (
              <Check className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <p className="text-[13.5px]">{banner.msg}</p>
          </div>
        )}

        <div className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-[13.5px] font-medium text-foreground">
              You control what each integration is allowed to do.
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Set every connection to <strong>Suggest only</strong>, <strong>Approval required</strong>, or
              <strong> Auto-run within guardrails</strong>. Tokens are encrypted at rest and never leave the server.
            </p>
          </div>
        </div>

        <Section title="Core" subtitle="Recommended for every workspace">
          {core.map((i) => (
            <IntegrationCard
              key={i.id}
              integration={i}
              serverMode={serverMode}
              onConnect={() => connectIntegration(i.id)}
              onDisconnect={() => disconnectIntegration(i.id)}
              onMode={(m) => setIntegrationMode(i.id, m)}
            />
          ))}
        </Section>

        <Section title="Optional" subtitle="Add these when you need them">
          {optional.map((i) => (
            <IntegrationCard
              key={i.id}
              integration={i}
              serverMode={serverMode}
              onConnect={() => connectIntegration(i.id)}
              onDisconnect={() => disconnectIntegration(i.id)}
              onMode={(m) => setIntegrationMode(i.id, m)}
            />
          ))}
        </Section>
      </PageBody>
    </>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-7">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function IntegrationCard({
  integration: i,
  serverMode,
  onConnect,
  onDisconnect,
  onMode,
}: {
  integration: Integration;
  serverMode: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onMode: (m: PermissionMode) => void;
}) {
  // In server mode, only registry-backed providers (Gmail/Calendar/HubSpot/Stripe) are live.
  const wired = !serverMode || Boolean(i.oauth_provider);
  const needsSetup = serverMode && Boolean(i.oauth_provider) && !i.configured;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
            PROVIDER_COLOR[i.name] ?? "bg-slate-100 text-slate-700",
          )}
        >
          {i.name[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold">{i.name}</h3>
            {i.connected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                <Check className="h-3 w-3" /> Connected
              </span>
            ) : needsSetup ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700">
                Setup required
              </span>
            ) : !wired ? (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">
                Coming soon
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {i.connected ? i.account : `Connect your ${i.provider} account`}
          </p>
          {i.action_label && (
            <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
              <Zap className="h-3 w-3" /> {i.action_label}
            </p>
          )}
        </div>
      </div>

      {i.connected ? (
        <div className="mt-4 space-y-2.5">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              When an agent uses this
            </p>
            <Segmented
              size="sm"
              options={[
                { value: "suggest", label: "Suggest" },
                { value: "approval", label: "Approval" },
                { value: "auto", label: "Auto" },
              ]}
              value={i.permission_mode}
              onChange={(m) => onMode(m as PermissionMode)}
            />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              {PERMISSION_META[i.permission_mode].description}
            </p>
          </div>
          <button
            onClick={onDisconnect}
            className="text-[12px] font-medium text-muted-foreground hover:text-red-600 hover:underline"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <Button
            size="sm"
            variant={needsSetup || !wired ? "outline" : "primary"}
            className="w-full"
            disabled={!wired}
            onClick={onConnect}
          >
            {needsSetup ? <Wand2 className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
            {!wired ? "Not yet available" : needsSetup ? "Set up to connect" : `Connect ${i.name}`}
          </Button>
        </div>
      )}
    </Card>
  );
}
