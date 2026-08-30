import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import {
  createBillingPortalSession,
  createStripeCustomer,
  createSubscriptionCheckout,
  type StripeSubInfo,
} from "@/lib/integrations/stripe";
import type { BillingPlanView, BillingState } from "@/lib/types";
import {
  billingConfigured,
  planByTier,
  platformStripeKey,
  PLANS,
  priceIdForTier,
  purchasableTiers,
  tierForPriceId,
  type PlanTier,
} from "./plans";

/**
 * Operator's own subscription billing. Reads/writes the workspace's subscription
 * state and drives Stripe Checkout / the Billing Portal on the platform account.
 * `workspaces` is the root tenant table (no workspace_id column), so it's outside
 * the tenant-scoping guard — every query here is already keyed by the workspace id.
 */

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://ops-ai-launch.vercel.app").replace(/\/$/, "");
}

/** The workspace's billing state + the tiers to render on the billing page. */
export async function getBillingState(workspaceId: string): Promise<BillingState> {
  const [ws] = await db
    .select({
      tier: workspaces.subscription_tier,
      status: workspaces.subscription_status,
      customer: workspaces.stripe_customer_id,
      periodEnd: workspaces.subscription_period_end,
      trialEndsAt: workspaces.trial_ends_at,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const tier = ws?.tier ?? "free";
  const status = ws?.status ?? "none";
  const purchasable = new Set(purchasableTiers());
  const plans: BillingPlanView[] = PLANS.map((p) => ({
    key: p.key,
    name: p.name,
    amountLabel: p.amountLabel,
    cadence: p.cadence,
    tagline: p.tagline,
    features: p.features,
    anchor: !!p.anchor,
    purchasable: p.key !== "free" && purchasable.has(p.key),
    current: p.key === tier,
  }));

  return {
    configured: billingConfigured(),
    tier,
    tierName: planByTier(tier).name,
    status,
    hasSubscription: !!ws?.customer,
    periodEnd: ws?.periodEnd ? new Date(ws.periodEnd).toISOString() : null,
    trialEndsAt: ws?.trialEndsAt ? new Date(ws.trialEndsAt).toISOString() : null,
    plans,
  };
}

/** Begin a subscription: ensure a Stripe customer, then a hosted Checkout URL. */
export async function startCheckout(
  workspaceId: string,
  tier: PlanTier,
  actor: { email: string; name?: string },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const key = platformStripeKey();
  if (!key) return { ok: false, error: "Billing isn't configured yet (no platform Stripe key on the server)." };
  const priceId = priceIdForTier(tier);
  if (!priceId) return { ok: false, error: `The ${tier} plan isn't set up in Stripe yet.` };
  if (!actor.email) return { ok: false, error: "Your account needs an email address to start checkout." };

  try {
    const [ws] = await db
      .select({ customer: workspaces.stripe_customer_id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    let customerId = ws?.customer ?? null;
    if (!customerId) {
      customerId = await createStripeCustomer(key, {
        email: actor.email,
        name: actor.name,
        metadata: { workspace_id: workspaceId },
      });
      await db
        .update(workspaces)
        .set({ stripe_customer_id: customerId, updated_at: new Date() })
        .where(eq(workspaces.id, workspaceId));
    }
    const base = appUrl();
    const { url } = await createSubscriptionCheckout(key, {
      priceId,
      customerId,
      successUrl: `${base}/billing?checkout=success`,
      cancelUrl: `${base}/billing?checkout=cancel`,
      clientReferenceId: workspaceId,
      metadata: { workspace_id: workspaceId, tier },
    });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't start checkout." };
  }
}

/** Open the Stripe Billing Portal so the owner can manage/cancel their plan. */
export async function openPortal(
  workspaceId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const key = platformStripeKey();
  if (!key) return { ok: false, error: "Billing isn't configured yet." };
  try {
    const [ws] = await db
      .select({ customer: workspaces.stripe_customer_id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws?.customer) return { ok: false, error: "No billing account yet — subscribe to a plan first." };
    const { url } = await createBillingPortalSession(key, {
      customerId: ws.customer,
      returnUrl: `${appUrl()}/billing`,
    });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't open the billing portal." };
  }
}

/** True when `userId` owns the workspace — billing is owner-only. */
export async function isWorkspaceOwner(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db
    .select({ owner: workspaces.owner_id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return !!ws && ws.owner === userId;
}

/** Map a Stripe customer id back to its workspace (webhook has no tenant context). */
export async function resolveWorkspaceByCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.stripe_customer_id, customerId))
    .limit(1);
  return ws?.id ?? null;
}

/** Write a Stripe subscription's state onto a workspace (the source of truth). */
export async function applySubscriptionToWorkspace(workspaceId: string, sub: StripeSubInfo): Promise<void> {
  const mapped = tierForPriceId(sub.priceId);
  const live = ["active", "trialing", "past_due"].includes(sub.status);
  const nextTier: PlanTier = live && mapped ? mapped : "free";
  await db
    .update(workspaces)
    .set({
      stripe_subscription_id: sub.id || null,
      ...(sub.customerId ? { stripe_customer_id: sub.customerId } : {}),
      subscription_tier: nextTier,
      subscription_status: sub.status,
      subscription_period_end: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000) : null,
      updated_at: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));
}
