"use client";

import { useEffect } from "react";
import { cn } from "@/lib/cn";

/**
 * Right-side slide-over. Renders inline (no portal) — the board is fully
 * client-rendered, so fixed positioning + high z-index is enough and avoids
 * SSR portal pitfalls. Handles Esc, overlay click, and body scroll lock.
 */
export function Drawer({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div
        className="absolute inset-0 animate-fade-in bg-slate-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-[560px] animate-slide-in-right flex-col border-l border-border bg-card shadow-drawer",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
