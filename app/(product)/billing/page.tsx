"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getBillingStateAction, openBillingPortalAction, startSubscriptionCheckoutAction } from "@/app/actions";
import type { BillingState } from "@/lib/types";
import type { PlanTier } from "@/lib/billing/plans";

function statusLine(s: BillingState): { text: string; tone: "ok" | "warn" | "muted" } {
  const end = s.periodEnd ? new Date(s.periodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  const trial = s.trialEndsAt ? new Date(s.trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : null;
  if (s.status === "trialing") return { text: `Free trial${trial ? ` — ends ${trial}` : ""}.`, tone: "ok" };
  if (s.status === "active") return { text: `${s.tierName} · ${end ? `renews ${end}` : "active"}.`, tone: "ok" };
  if (s.status === "past_due") return { text: "Payment past due — update your card to keep access.", tone: "warn" };
  if (s.status === "canceled") return { text: `Canceled${end ? ` — access until ${end}` : ""}.`, tone: "warn" };
  return { text: "You're on the Free (beta) plan — no card on file.", tone: "muted" };
}

export default function BillingPage() {
  const [state, setState] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    getBillingStateAction()
      .then(setState)
      .catch(() => setState(null))
      .finally(() => setLoading(false));
    try {
      const q = new URLSearchParams(window.location.search).get("checkout");
      if (q === "success") setNotice({ text: "You're subscribed — welcome aboard. It may take a moment to reflect below.", tone: "ok" });
      else if (q === "cancel") setNotice({ text: "Checkout canceled — no charge was made.", tone: "warn" });
      if (q) window.history.replaceState({}, "", "/billing");
    } catch {
      /* ignore */
    }
  }, []);

  async function subscribe(tier: string) {
    setBusy(tier);
    const r: { ok: boolean; url?: string; error?: string } = await startSubscriptionCheckoutAction(tier as PlanTier).catch(
      () => ({ ok: false, error: "Something went wrong." }),
    );
    if (r.ok && r.url) {
      window.location.href = r.url;
      return;
    }
    setBusy(null);
    setNotice({ text: r.error ?? "Couldn't start checkout.", tone: "warn" });
  }

  async function manage() {
    setBusy("portal");
    const r: { ok: boolean; url?: string; error?: string } = await openBillingPortalAction().catch(
      () => ({ ok: false, error: "Something went wrong." }),
    );
    if (r.ok && r.url) {
      window.location.href = r.url;
      return;
    }
    setBusy(null);
    setNotice({ text: r.error ?? "Couldn't open the billing portal.", tone: "warn" });
  }

  const line = state ? statusLine(state) : null;

  return (
    <>
      <PageHeader title="Billing" description="Your Operator subscription and plan." />
      <PageBody className="max-w-4xl">
        {loading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !state ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load billing. Try refreshing.</p>
        ) : (
          <div className="space-y-5">
            {notice && (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-[13.5px]",
                  notice.tone === "ok"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
              >
                {notice.text}
              </div>
            )}

            {!state.configured && (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3 text-[13px] text-muted-foreground">
                <b className="text-foreground">Billing isn&apos;t live yet.</b> The subscribe &amp; manage flow is fully wired —
                it turns on once the platform <code className="rounded bg-muted px-1 py-0.5 text-[12px]">STRIPE_SECRET_KEY</code> and the
                per-tier <code className="rounded bg-muted px-1 py-0.5 text-[12px]">STRIPE_PRICE_*</code> IDs are set on the server.
              </div>
            )}

            {/* Current plan */}
            <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <CreditCard className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Current plan</p>
                  <p className="text-[17px] font-semibold leading-tight">{state.tierName}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-[12.5px]",
                      line?.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : line?.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                    )}
                  >
                    {line?.text}
                  </p>
                </div>
              </div>
              {state.hasSubscription && (
                <Button variant="outline" size="sm" onClick={manage} disabled={busy !== null}>
                  {busy === "portal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Manage billing
                </Button>
              )}
            </Card>

            {/* Plans */}
            <div className="grid gap-3 md:grid-cols-3">
              {state.plans
                .filter((p) => p.key !== "free")
                .map((p) => (
                  <Card
                    key={p.key}
                    className={cn(
                      "relative flex flex-col p-5",
                      p.anchor && "border-primary/40 ring-1 ring-primary/15",
                      p.current && "border-emerald-500/40 ring-1 ring-emerald-500/20",
                    )}
                  >
                    {p.anchor && !p.current && (
                      <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary">
                        <Sparkles className="h-3 w-3" /> Popular
                      </span>
                    )}
                    <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{p.name}</p>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-[26px] font-bold tracking-tight">{p.amountLabel}</span>
                      <span className="text-[13px] text-muted-foreground">{p.cadence}</span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">{p.tagline}</p>
                    <ul className="mt-3 flex-1 space-y-1.5">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-[12.5px]">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4">
                      {p.current ? (
                        <Button variant="outline" size="sm" className="w-full" disabled>
                          <Check className="h-4 w-4" /> Current plan
                        </Button>
                      ) : p.purchasable ? (
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => subscribe(p.key)}
                          disabled={busy !== null}
                        >
                          {busy === p.key ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {state.hasSubscription ? "Switch to this plan" : "Subscribe"}
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full" disabled title="This plan isn't set up in Stripe yet">
                          Not available yet
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
            </div>

            <p className="text-center text-[12px] text-muted-foreground">
              Plans are billed monthly through Stripe. Manage or cancel anytime from the billing portal. Prices in USD.
            </p>
          </div>
        )}
      </PageBody>
    </>
  );
}
