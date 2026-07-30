import { NextResponse, type NextRequest } from "next/server";
import { createPendingOrder, getProduct, getPublishedPageBySlug } from "@/lib/pages";
import { createCheckoutSession } from "@/lib/integrations/stripe";

export const runtime = "nodejs";

/**
 * Public buy-button endpoint. A published page's buy button POSTs its slug here;
 * we create a Stripe Checkout Session + a pending order and redirect to Stripe.
 * Degrades gracefully (a query-param message on the page) until a Stripe test
 * key is configured.
 */
function baseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  const fd = await req.formData().catch(() => null);
  const slug = String(fd?.get("page") ?? "");
  const base = baseUrl(req);
  const back = `${base}/p/${encodeURIComponent(slug)}`;

  const page = slug ? await getPublishedPageBySlug(slug) : null;
  if (!page) return NextResponse.redirect(base, 303);
  if (!page.product_id) return NextResponse.redirect(`${back}?error=no-product`, 303);

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.redirect(`${back}?error=payments-not-configured`, 303);

  const product = await getProduct(page.workspace_id, page.product_id);
  if (!product) return NextResponse.redirect(`${back}?error=no-product`, 303);

  try {
    const session = await createCheckoutSession(key, {
      productName: product.name,
      amountCents: product.price_cents,
      currency: product.currency,
      successUrl: `${back}?paid=1`,
      cancelUrl: `${back}?canceled=1`,
      metadata: { page_id: page.id, product_id: product.id, workspace_id: page.workspace_id },
    });
    await createPendingOrder({
      workspaceId: page.workspace_id,
      pageId: page.id,
      productId: product.id,
      amountCents: product.price_cents,
      currency: product.currency,
      stripeSessionId: session.id,
    });
    return NextResponse.redirect(session.url, 303);
  } catch (e) {
    console.error("[checkout] failed:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(`${back}?error=checkout-failed`, 303);
  }
}
