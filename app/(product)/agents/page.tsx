"use client";

import { useState } from "react";
import {
  Crown,
  Folder,
  Lock,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Zap,
  Loader2,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { Badge } from "@/components/ui/badge";
import { useStore, type CreateAgentInput } from "@/lib/store";
import { CATEGORY_META, CATEGORY_ORDER, PERMISSION_META } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Agent, Category, PermissionMode } from "@/lib/types";

const ACCENTS = ["indigo", "emerald", "sky", "violet", "amber", "rose", "teal", "slate"] as const;
const ACCENT_BG: Record<string, string> = {
  indigo: "bg-indigo-100 text-indigo-700",
  emerald: "bg-emerald-100 text-emerald-700",
  sky: "bg-sky-100 text-sky-700",
  violet: "bg-violet-100 text-violet-700",
  amber: "bg-amber-100 text-amber-700",
  rose: "bg-rose-100 text-rose-700",
  teal: "bg-teal-100 text-teal-700",
  slate: "bg-slate-200 text-slate-700",
};

const AUTONOMY_LABEL: Record<PermissionMode, string> = {
  suggest: "Suggests",
  approval: "Needs approval",
  auto: "Ships automatically",
};

function Avatar({ agent, size = "md" }: { agent: { emoji: string; accent: string; name: string }; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-2xl" : "h-10 w-10 text-xl";
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-xl", ACCENT_BG[agent.accent] ?? ACCENT_BG.indigo, dim)}>
      {agent.emoji || agent.name[0]}
    </span>
  );
}

export default function AgentsPage() {
  const { state, runAgent } = useStore();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  if (!state) return null;

  const team = state.agents.filter((a) => a.tier === "worker" && !a.archived);
  const leadership = state.agents.filter((a) => a.tier !== "worker");

  async function onRun(id: string) {
    setRunning(id);
    try {
      await runAgent(id);
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Agents"
        description="Your AI team. Give each a persona, decide how it works, and let it prepare work for you."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            Build an agent
          </Button>
        }
      />
      <PageBody>
        <h2 className="mb-3 text-[15px] font-semibold">Your team</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {team.map((a) => (
            <Card key={a.id} className="card-interactive flex flex-col p-4">
              <button className="flex items-start gap-3 text-left" onClick={() => setEditing(a.id)}>
                <Avatar agent={a} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[14px] font-semibold">{a.name}</h3>
                    {a.created_by_type === "user" && (
                      <Badge className="border-primary/20 bg-primary/10 text-primary">Custom</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{a.description}</p>
                </div>
              </button>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge className={cn("border-transparent", a.permissions_mode === "auto" ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground")}>
                  <Zap className="h-3 w-3" /> {AUTONOMY_LABEL[a.permissions_mode]}
                </Badge>
                {a.background_enabled && (
                  <Badge className="border-transparent bg-sky-50 text-sky-700">Background on</Badge>
                )}
                <Badge className="border-transparent bg-muted text-muted-foreground">
                  <Folder className="h-3 w-3" /> {a.folder || "General"}
                </Badge>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="text-[11px] text-muted-foreground">
                  {a.tasks_prepared} prepared · ran {relativeTime(a.last_run_at)}
                </span>
                <Button size="sm" variant="outline" disabled={running === a.id} onClick={() => onRun(a.id)}>
                  {running === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Run
                </Button>
              </div>
            </Card>
          ))}
        </div>

        {leadership.length > 0 && (
          <>
            <div className="mb-3 mt-8 flex items-center gap-2">
              <h2 className="text-[15px] font-semibold">Leadership</h2>
              <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                <Crown className="h-3 w-3" /> Premium
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {leadership.map((a) => (
                <Card key={a.id} className="relative flex flex-col overflow-hidden p-4">
                  <div className="flex items-start gap-3">
                    <Avatar agent={a} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[14px] font-semibold">{a.name}</h3>
                        <Badge className="border-amber-200 bg-amber-50 text-amber-700 capitalize">{a.tier}</Badge>
                      </div>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{a.description}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" /> Coming soon
                    </span>
                    <Button size="sm" variant="subtle" disabled>
                      Upgrade
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </PageBody>

      {editing && (
        <AgentEditor
          mode={editing === "new" ? "new" : "edit"}
          agent={editing === "new" ? null : state.agents.find((a) => a.id === editing) ?? null}
          onClose={() => setEditing(null)}
          onRun={editing !== "new" ? () => onRun(editing) : undefined}
        />
      )}
    </>
  );
}

function AgentEditor({
  mode,
  agent,
  onClose,
  onRun,
}: {
  mode: "new" | "edit";
  agent: Agent | null;
  onClose: () => void;
  onRun?: () => void;
}) {
  const { state, createAgent, updateAgent, deleteAgent } = useStore();
  const [form, setForm] = useState<CreateAgentInput>({
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    instructions: agent?.instructions ?? "",
    category: agent?.category ?? "growth",
    permissions_mode: agent?.permissions_mode ?? "approval",
    background_enabled: agent?.background_enabled ?? false,
    allowed_integrations: agent?.allowed_integrations ?? [],
    folder: agent?.folder ?? "",
    log_activity: agent?.log_activity ?? true,
    emoji: agent?.emoji ?? "🤖",
    accent: agent?.accent ?? "indigo",
  });

  const integrations = state?.integrations ?? [];
  const set = <K extends keyof CreateAgentInput>(k: K, v: CreateAgentInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function toggleIntegration(name: string) {
    const cur = form.allowed_integrations ?? [];
    set("allowed_integrations", cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]);
  }

  function save() {
    if (!form.name.trim()) return;
    if (mode === "new") createAgent(form);
    else if (agent) updateAgent(agent.id, { ...form });
    onClose();
  }

  return (
    <Drawer open onClose={onClose}>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <Avatar agent={{ emoji: form.emoji || "🤖", accent: form.accent || "indigo", name: form.name }} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-muted-foreground">
            {mode === "new" ? "Build an agent" : "Edit agent"}
          </p>
          <h2 className="truncate text-[17px] font-semibold">{form.name || "New agent"}</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <div className="space-y-1.5">
            <Label>Emoji</Label>
            <Input
              value={form.emoji}
              onChange={(e) => set("emoji", e.target.value.slice(0, 4))}
              className="w-16 text-center text-lg"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Partnerships Agent" autoFocus />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Accent</Label>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                onClick={() => set("accent", c)}
                className={cn(
                  "h-7 w-7 rounded-full ring-2 ring-offset-2",
                  ACCENT_BG[c],
                  form.accent === c ? "ring-foreground/40" : "ring-transparent",
                )}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="One line about what this agent does" />
        </div>

        <div className="space-y-1.5">
          <Label>Instructions (persona)</Label>
          <Textarea
            value={form.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            className="min-h-[120px]"
            placeholder="You are the … agent. You … Write in … Never …"
          />
          <p className="text-[11.5px] text-muted-foreground">
            This is the agent's persona — it's injected into every draft it writes, on top of your business brief.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={form.category} onChange={(e) => set("category", e.target.value as Category)}>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{CATEGORY_META[c].label}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Folder</Label>
            <Input value={form.folder} onChange={(e) => set("folder", e.target.value)} placeholder="Where it documents work" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Autonomy</Label>
          <Segmented
            options={[
              { value: "suggest", label: "Suggest" },
              { value: "approval", label: "Approval" },
              { value: "auto", label: "Auto-ship" },
            ]}
            value={form.permissions_mode ?? "approval"}
            onChange={(m) => set("permissions_mode", m as PermissionMode)}
          />
          <p className="text-[11.5px] text-muted-foreground">
            {PERMISSION_META[form.permissions_mode ?? "approval"].description}
          </p>
        </div>

        <div className="space-y-2 rounded-xl border border-border p-3">
          <ToggleRow
            label="Work in the background"
            hint="Let this agent run on a schedule (and via cron in production)."
            checked={form.background_enabled ?? false}
            onChange={(v) => set("background_enabled", v)}
          />
          <ToggleRow
            label="Document to the activity log"
            hint="Record everything this agent does."
            checked={form.log_activity ?? true}
            onChange={(v) => set("log_activity", v)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Integration access</Label>
          <p className="text-[11.5px] text-muted-foreground">Which tools this agent may use.</p>
          <div className="flex flex-wrap gap-1.5">
            {integrations.map((i) => {
              const on = (form.allowed_integrations ?? []).includes(i.name);
              return (
                <button
                  key={i.id}
                  onClick={() => toggleIntegration(i.name)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors",
                    on ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {i.name}
                  {i.connected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3.5">
        <Button variant="success" className="flex-1" onClick={save} disabled={!form.name.trim()}>
          {mode === "new" ? "Create agent" : "Save changes"}
        </Button>
        {mode === "edit" && onRun && (
          <Button variant="outline" onClick={onRun} title="Run now">
            <Sparkles className="h-4 w-4" /> Run
          </Button>
        )}
        {mode === "edit" && agent?.created_by_type === "user" && (
          <Button
            variant="destructive"
            onClick={() => {
              deleteAgent(agent.id);
              onClose();
            }}
            title="Delete agent"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Drawer>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
