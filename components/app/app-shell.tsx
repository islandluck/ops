"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Menu, TriangleAlert, X } from "lucide-react";
import { Sidebar } from "@/components/app/sidebar";
import { TrialBanner } from "@/components/billing/trial-banner";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useStore } from "@/lib/store";
import { categoryCounts } from "@/lib/filters";

// The task drawer (~1,100 lines) mounts in the shell on every product page but is
// only needed once a task is opened. Lazy-load it so it isn't in each page's
// initial bundle. ssr:false — it's a client-only overlay driven by the store.
const TaskDrawer = dynamic(
  () => import("@/components/board/task-drawer").then((m) => m.TaskDrawer),
  { ssr: false },
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { hydrated, state, loadError, reloadWorkspace } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!hydrated) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Spinner className="h-6 w-6 text-primary" />
          <p className="text-sm">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-canvas px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <TriangleAlert className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold">We couldn’t load your workspace</h2>
          <p className="text-sm text-muted-foreground">
            {loadError
              ? "The database didn’t respond. This can happen on a cold start — please try again."
              : "Your session may have expired. Sign in again to continue."}
          </p>
          {loadError ? (
            <Button size="sm" onClick={() => reloadWorkspace()}>
              Try again
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                window.location.href = "/login";
              }}
            >
              Sign in
            </Button>
          )}
        </div>
      </div>
    );
  }

  const ready = Object.values(categoryCounts(state.tasks)).reduce(
    (a, c) => a + c.ready,
    0,
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas">
      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 lg:flex">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full animate-slide-in-right">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute right-3 top-3 rounded-lg bg-card p-2 shadow-elevated"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 text-foreground hover:bg-accent"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Logo size="sm" />
          {ready > 0 && (
            <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 text-[12px] font-semibold text-amber-700">
              {ready} to approve
            </span>
          )}
        </div>

        <TrialBanner />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </main>

      {/* Global task detail drawer — openable from any page */}
      <TaskDrawer />
    </div>
  );
}
