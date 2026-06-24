"use client";

import { CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  working: Loader2,
} as const;

const TONES = {
  success: "text-emerald-600",
  error: "text-red-600",
  info: "text-primary",
  working: "text-primary",
} as const;

export function Toaster() {
  const { toasts, dismissToast } = useStore();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-elevated"
          >
            <Icon
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0",
                TONES[t.tone],
                t.tone === "working" && "animate-spin",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                  {t.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="rounded-md p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
