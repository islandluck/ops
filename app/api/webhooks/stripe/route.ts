import { NextResponse, type NextRequest } from "next/server";
import { getSubscription, parseSubscription, verifyStripeSignature } from "@/lib/integrations/stripe";
import { applySubscriptionToWorkspace, resolveWorkspaceByCustomer } from "@/lib/billing/service";
import { platformStripeKey } from "@/lib/billing/plans";
import { markOrderPaidBySession } from "@/lib/pages";

export const runtime = "nodejs";

/**
 * Stripe webhook. Two concerns share this endpoint on the platform account:
 *  - one-off product orders (checkout mode "payment") → mark the order paid;
 *  - Operator's own subscriptions (mode "subscription" + subscription.* events) →
 *    sync the workspace's plan/status.
 * Every event is verified against STRIPE_WEBHOOK_SECRET; no charge is trusted
 * without a valid signature. Point Stripe at /api/webhooks/stripe.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const raw = await req.text();
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured (set STRIPE_WEBHOOK_SECRET)" }, { status: 503 });
  }
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: unknown } };
  try {
    event = JSON.parse(raw) as { type?: string; data?: { object?: unknown } };
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  try {
    const obj = (event.data?.object ?? {}) as Record<string, unknown>;

    if (event.type === "checkout.session.completed") {
      if (obj.mode === "subscription") {
        // A workspace subscribed to an Operator plan.
        let wsId: string | null = (typeof obj.client_reference_id === "string" && obj.client_reference_id) || null;
        if (!wsId) wsId = (obj.metadata as Record<string, string> | undefined)?.workspace_id ?? null;
        if (!wsId) wsId = await resolveWorkspaceByCustomer(typeof obj.customer === "string" ? obj.customer : null);
        const subId = typeof obj.subscription === "string" ? obj.subscription : null;
        const key = platformStripeKey();
        if (wsId && subId && key) {
          const sub = await getSubscription(key, subId);
          await applySubscriptionToWorkspace(wsId, sub);
        }
      } else {
        // A one-off product order (existing behavior).
        const s = obj as { id?: string; customer_email?: string; customer_details?: { email?: string } };
        const email = s.customer_details?.email ?? s.customer_email ?? null;
        if (s.id) await markOrderPaidBySession(s.id, email);
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = parseSubscription(obj);
      const wsId = await resolveWorkspaceByCustomer(sub.customerId);
      if (wsId) await applySubscriptionToWorkspace(wsId, sub);
    }
  } catch (e) {
    console.error("[stripe webhook] handler error:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ received: true });
}
