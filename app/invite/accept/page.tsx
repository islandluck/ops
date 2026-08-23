"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { acceptInviteAction } from "@/app/actions";

export default function AcceptInvitePage() {
  const [state, setState] = useState<"working" | "done" | "error" | "signin">("working");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = new URLSearchParams(window.location.search).get("token") ?? "";
      const r = await acceptInviteAction(token);
      if (cancelled) return;
      if ("ok" in r && r.ok) {
        // Refresh the session so the cleared "pending invite" flag takes effect,
        // then hand off to the portal.
        try {
          await createSupabaseBrowserClient().auth.refreshSession();
        } catch {
          /* ignore */
        }
        setState("done");
        window.location.href = "/portal";
      } else {
        const msg = "error" in r ? r.error : "Couldn't accept the invite.";
        if (/sign in/i.test(msg)) setState("signin");
        else setState("error");
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <Logo />
        {state === "working" && (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Joining the workspace…</p>
          </>
        )}
        {state === "done" && (
          <>
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm text-muted-foreground">You're in — taking you to your portal…</p>
          </>
        )}
        {state === "signin" && (
          <>
            <p className="text-sm text-muted-foreground">Sign in with your invited email to join the workspace.</p>
            <Button
              onClick={() =>
                (window.location.href = `/login?next=${encodeURIComponent("/invite/accept" + window.location.search)}`)
              }
            >
              Sign in
            </Button>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle className="h-8 w-8 text-red-500" />
            <p className="text-sm font-medium">Couldn't join</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}
