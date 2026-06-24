"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { hasSupabaseClientEnv } from "@/lib/config";
import { signInAction, signUpAction } from "@/app/actions";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useStore();
  const configured = hasSupabaseClientEnv;

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(configured ? "" : "alex@northwindstudio.com");
  const [password, setPassword] = useState(configured ? "" : "demo-password");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!configured) {
      // Demo mode — any credentials work.
      const display =
        name.trim() ||
        (email
          ? email.split("@")[0].split(/[.\-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
          : undefined);
      login(display, email || undefined);
      router.push(mode === "signup" ? "/onboarding" : "/approvals");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const res = await signUpAction(email, password, name.trim());
        if (res?.error) setError(res.error);
        else if (res?.needsConfirmation)
          setNotice("Check your email to confirm your account, then sign in.");
        // success redirects server-side
      } else {
        const res = await signInAction(email, password);
        if (res?.error) setError(res.error);
        // success redirects server-side
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-canvas px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <Link
        href="/"
        className="absolute left-5 top-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-elevated">
          <h1 className="text-center text-xl font-semibold tracking-tight">
            {isSignup ? "Create your workspace" : "Sign in to Operator"}
          </h1>
          <p className="mt-1 text-center text-[13.5px] text-muted-foreground">
            {isSignup
              ? "A populated Approval Center will be ready in seconds."
              : "Welcome back. Your Approval Center is waiting."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {isSignup && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? "At least 6 characters" : "••••••••"}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
            )}
            {notice && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{notice}</p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSignup ? "Create workspace" : "Sign in"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <p className="mt-5 text-center text-[12.5px] text-muted-foreground">
            {configured
              ? isSignup
                ? "Already have an account?"
                : "New to Operator?"
              : "This is a demo — any email and password will work."}{" "}
            {configured && (
              <button
                onClick={() => {
                  setMode(isSignup ? "signin" : "signup");
                  setError(null);
                  setNotice(null);
                }}
                className="font-semibold text-primary hover:underline"
              >
                {isSignup ? "Sign in" : "Create one"}
              </button>
            )}
          </p>
        </div>

        {!configured && (
          <p className="mt-5 text-center text-[13.5px] text-muted-foreground">
            New here?{" "}
            <Link href="/onboarding" className="font-semibold text-primary hover:underline">
              Set up your workspace
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
