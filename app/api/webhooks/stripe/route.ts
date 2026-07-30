import { NextResponse, type NextRequest } from "next/server";
import { verifyStripeSignature } from "@/lib/integrations/stripe";
import { markOrderPaidBySession } from "@/lib/pages";

export const runtime = "nodejs";

/**
 * Stripe webhook — marks an order paid on checkout.session.completed. Verifies
 * the Stripe-Signature against STRIPE_WEBHOOK_SECRET (no charge is trusted
 * without a valid signature). Point Stripe (or `stripe listen`) at /api/webhooks/stripe.
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
    if (event.type === "checkout.session.completed") {
      const s = (event.data?.object ?? {}) as {
        id?: string;
        customer_email?: string;
        customer_details?: { email?: string };
      };
      const email = s.customer_details?.email ?? s.customer_email ?? null;
      if (s.id) await markOrderPaidBySession(s.id, email);
    }
  } catch (e) {
    console.error("[stripe webhook] handler error:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ received: true });
}
