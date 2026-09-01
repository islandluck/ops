"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/brand";
import { acceptInviteAction, acceptInviteWithPasswordAction, getInviteAction } from "@/app/actions";

type Mode = "loading" | "create" | "signin" | "working" | "done" | "invalid" | "mismatch";

/**
 * Self-contained invite acceptance. The token authorizes it — no prior login needed.
 *  - Not signed in, no account → set a password, we create the account + join.
 *  - Not signed in, account exists → sign in, then join.
 *  - Already signed in (matching email) → join straight away.
 */
export default function AcceptInvitePage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [invite, setInvite] = useState<{ email: string; workspaceName: string } | null>(null);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedInAs, setSignedInAs] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = new URLSearchParams(window.location.search).get("token") ?? "";
      setToken(t);
      const inv = await getInviteAction(t);
      if (cancelled) return;
      if (!inv.valid) {
        setError(inv.error ?? "This invite link is invalid.");
        setMode("invalid");
        return;
      }
      setInvite({ email: inv.email, workspaceName: inv.workspaceName });

      // Already signed in? Accept directly (or flag an email mismatch).
      try {
        const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
        const { data } = await createSupabaseBrowserClient().auth.getUser();
        const authed = data.user?.email?.toLowerCase() ?? "";
        if (cancelled) return;
        if (authed) {
          if (authed === inv.email.toLowerCase()) return finishLoggedIn(t);
          setSignedInAs(authed);
          setMode("mismatch");
          return;
        }
      } catch {
        /* not signed in — show the create form */
      }
      setMode("create");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finishLoggedIn(t: string) {
    setMode("working");
    const r = await acceptInviteAction(t);
    if ("ok" in r && r.ok) {
      try {
        const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
        await createSupabaseBrowserClient().auth.refreshSession();
      } catch {
        /* ignore */
      }
      setMode("done");
      window.location.href = "/portal";
    } else {
      setError("error" in r ? r.error : "Couldn't join the workspace.");
      setMode("invalid");
    }
  }

  /** Establish the browser session with the password, then reload — the logged-in
   *  path above finishes the join + hands off to the portal. */
  async function signInAndReload(pw: string): Promise<string | null> {
    if (!invite) return "Something went wrong.";
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const { error: sErr } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: invite.email, password: pw });
    if (sErr) return sErr.message;
    window.location.href = `/invite/accept?token=${encodeURIComponent(token)}`;
    return null;
  }

  async function createThenJoin() {
    setBusy(true);
    setError("");
    const r = await acceptInviteWithPasswordAction(token, password);
    if ("ok" in r && r.ok) {
      const err = await signInAndReload(password);
      if (err) {
        // Account made + joined, but auto sign-in hiccuped — send them to sign in.
        window.location.href = "/login?next=/portal";
      }
      return;
    }
    setBusy(false);
    if ("existing" in r && r.existing) {
      setMode("signin");
      setError("You already have an account with this email — enter your password to join.");
      setPassword("");
      return;
    }
    setError("error" in r ? r.error : "Couldn't create your account.");
  }

  async function signInThenJoin() {
    setBusy(true);
    setError("");
    const err = await signInAndReload(password);
    if (err) {
      setBusy(false);
      setError(/invalid|credentials|password/i.test(err) ? "That password didn't match. Try again." : err);
    }
  }

  async function signOut() {
    try {
      const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      /* ignore */
    }
    window.location.reload();
  }

  const isForm = mode === "create" || mode === "signin";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <Logo />

        {(mode === "loading" || mode === "working") && (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {mode === "working" ? "Joining the workspace…" : "Loading your invite…"}
            </p>
          </>
        )}

        {mode === "done" && (
          <>
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm text-muted-foreground">You're in — taking you to your portal…</p>
          </>
        )}

        {isForm && invite && (
          <div className="flex w-full flex-col gap-3">
            <div>
              <h1 className="text-lg font-semibold">Join {invite.workspaceName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {mode === "create"
                  ? "Set a password to create your account and join."
                  : "Sign in to join the workspace."}
              </p>
            </div>
            <div className="text-left">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input value={invite.email} disabled className="mt-1" />
            </div>
            <div className="text-left">
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "create" ? "Create a password (8+ characters)" : "Your password"}
                className="mt-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void (mode === "create" ? createThenJoin() : signInThenJoin());
                }}
              />
            </div>
            {error && <p className="text-left text-[13px] text-red-600">{error}</p>}
            <Button
              className="w-full"
              disabled={busy || password.length < (mode === "create" ? 8 : 1)}
              onClick={() => void (mode === "create" ? createThenJoin() : signInThenJoin())}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "create" ? "Create account & join" : "Sign in & join"}
            </Button>
            <button
              type="button"
              className="text-[12px] text-muted-foreground transition hover:text-foreground"
              onClick={() => {
                setMode(mode === "create" ? "signin" : "create");
                setError("");
              }}
            >
              {mode === "create" ? "Already have an account? Sign in" : "Need an account? Create one"}
            </button>
          </div>
        )}

        {mode === "mismatch" && invite && (
          <>
            <XCircle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-medium">Wrong account</p>
            <p className="text-sm text-muted-foreground">
              You're signed in as {signedInAs}, but this invite is for {invite.email}. Sign out to accept it.
            </p>
            <Button variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </>
        )}

        {mode === "invalid" && (
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
