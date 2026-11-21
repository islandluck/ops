"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route error boundary — catches an uncaught render/data error in any route segment
 * (below the root layout) so a crash shows a recoverable screen instead of a blank
 * page. `reset()` re-renders the segment; "Go home" is the escape hatch.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <TriangleAlert className="h-6 w-6" />
        </div>
        <h2 className="text-base font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          This page hit an unexpected error. Try again — if it keeps happening, reload the app or head back home.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = "/today";
            }}
          >
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}
