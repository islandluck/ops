"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlarmClock,
  CheckCheck,
  ChevronsUpDown,
  CircleDot,
  FileText,
  FolderKanban,
  FolderOpen,
  Globe,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Plug,
  ScrollText,
  Settings,
  ShieldAlert,
  SquareKanban,
  Users,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { CATEGORY_ICONS } from "@/components/badges";
import { Avatar } from "@/components/ui/misc";
import { useStore } from "@/lib/store";
import { categoryCounts } from "@/lib/filters";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { Category } from "@/lib/types";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/approvals", label: "Approval Center", icon: SquareKanban },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/pages", label: "Pages", icon: Globe },
  { href: "/social", label: "Social", icon: Megaphone },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/activity", label: "Activity log", icon: ScrollText },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/brief", label: "Business brief", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

const SAVED_VIEWS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "needs_approval", label: "Needs my approval", icon: CheckCheck },
  { id: "high_risk", label: "High risk", icon: ShieldAlert },
  { id: "due_soon", label: "Due soon", icon: AlarmClock },
  { id: "recently_done", label: "Recently done", icon: CircleDot },
];

const AGENT_STATUS_DOT: Record<string, string> = {
  working: "bg-emerald-500",
  waiting: "bg-amber-500",
  idle: "bg-slate-300",
  paused: "bg-slate-400",
};

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { state, filters, setFilters, applySavedView, selectTask } = useStore();
  const pathname = usePathname();
  const router = useRouter();

  const counts = state ? categoryCounts(state.tasks) : null;

  function go(path: string) {
    router.push(path);
    onNavigate?.();
  }

  function pickCategory(cat: Category) {
    const isActive =
      pathname === "/approvals" &&
      filters.categories.length === 1 &&
      filters.categories[0] === cat;
    setFilters({
      categories: isActive ? [] : [cat],
      statuses: null,
      agentId: null,
    });
    selectTask(null);
    go("/approvals");
  }

  function pickView(id: string) {
    applySavedView(id);
    selectTask(null);
    go("/approvals");
  }

  function pickAgent(agentId: string) {
    const isActive = filters.agentId === agentId && pathname === "/approvals";
    setFilters({ agentId: isActive ? null : agentId, categories: [], statuses: null });
    selectTask(null);
    go("/approvals");
  }

  return (
    <div className="flex h-full w-[264px] flex-col border-r border-border bg-card">
      {/* Workspace switcher */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
          title="Switch workspace"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-sm font-bold text-white">
            N
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight">
              {state?.workspace.name ?? "Workspace"}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {state?.workspace.plan ?? "Operator"}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {/* Primary nav */}
        <div className="space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const ready =
              item.href === "/approvals" && counts
                ? Object.values(counts).reduce((a, c) => a + c.ready, 0)
                : 0;
            return (
              <button
                key={item.href}
                onClick={() => go(item.href)}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/75 hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className={cn("h-4.5 w-4.5", active ? "text-primary" : "text-muted-foreground")} />
                <span className="flex-1 text-left">{item.label}</span>
                {ready > 0 && (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700">
                    {ready}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Categories */}
        <Section title="Categories">
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const Icon = CATEGORY_ICONS[cat];
            const c = counts?.[cat];
            const active =
              pathname === "/approvals" &&
              filters.categories.length === 1 &&
              filters.categories[0] === cat;
            return (
              <button
                key={cat}
                onClick={() => pickCategory(cat)}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active ? "bg-accent font-medium text-foreground" : "text-foreground/75 hover:bg-accent",
                )}
              >
                <Icon className={cn("h-4 w-4", meta.text)} />
                <span className="flex-1 text-left">{meta.label}</span>
                {c && c.ready > 0 && (
                  <span className="inline-flex h-4 items-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                    {c.ready}
                  </span>
                )}
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {c?.active ?? 0}
                </span>
              </button>
            );
          })}
        </Section>

        {/* Saved views */}
        <Section title="Saved views">
          {SAVED_VIEWS.map((v) => {
            const active = filters.savedView === v.id && pathname === "/approvals";
            return (
              <button
                key={v.id}
                onClick={() => pickView(v.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active ? "bg-accent font-medium text-foreground" : "text-foreground/75 hover:bg-accent",
                )}
              >
                <v.icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">{v.label}</span>
              </button>
            );
          })}
        </Section>

        {/* Agents */}
        <Section title="Agents">
          {state?.agents
            .filter((agent) => agent.tier === "worker" && !agent.archived)
            .map((agent) => {
            const active = filters.agentId === agent.id && pathname === "/approvals";
            return (
              <button
                key={agent.id}
                onClick={() => pickAgent(agent.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active ? "bg-accent font-medium text-foreground" : "text-foreground/75 hover:bg-accent",
                )}
              >
                <span className="relative flex h-4 w-4 items-center justify-center">
                  <span className={cn("h-2 w-2 rounded-full", AGENT_STATUS_DOT[agent.status])} />
                </span>
                <span className="flex-1 truncate text-left">{agent.name}</span>
                {agent.status === "working" && (
                  <span className="text-[10px] font-medium text-emerald-600">working</span>
                )}
              </button>
            );
          })}
        </Section>
      </nav>

      {/* User */}
      <div className="shrink-0 border-t border-border p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
        >
          <Avatar name={state?.session.user_name ?? "User"} className="h-8 w-8" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-tight">
              {state?.session.user_name ?? "User"}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {state?.session.user_email ?? ""}
            </span>
          </span>
          <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
