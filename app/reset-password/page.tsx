"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { updatePasswordAction } from "@/app/actions";

/** Landing after a password-recovery link (the /auth/callback route establishes
 *  a recovery session first, then forwards here to set the new password). */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await updatePasswordAction(password);
    if (res?.error) {
      setError(res.error);
      setLoading(false);
    }
    // success redirects server-side
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-canvas px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-elevated">
          <h1 className="text-center text-xl font-semibold tracking-tight">Set a new password</h1>
          <p className="mt-1 text-center text-[13.5px] text-muted-foreground">
            Choose a new password for your account.
          </p>
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </div>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Update password
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
