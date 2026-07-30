import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe via secret API key (the operator's own account — no OAuth needed).
 * Supports real Checkout Sessions (a working buy button) + draft invoices.
 * Strongly recommend a test-mode key (sk_test_…) — nothing here should run
 * against a live key without an explicit, deliberate switch.
 */

const BASE = "https://api.stripe.com/v1";

/** True for a usable test-mode secret/restricted key. */
export function isStripeTestKey(key: string | undefined): boolean {
  return Boolean(key && (key.startsWith("sk_test_") || key.startsWith("rk_test_")));
}

function form(obj: Record<string, string | number>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) p.append(k, String(v));
  return p.toString();
}

async function stripe(
  path: string,
  secretKey: string,
  body?: Record<string, string | number>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? form(body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string })?.message;
    throw new Error(`Stripe: ${err ?? res.status}`);
  }
  return json;
}

export async function getStripeAccount(secretKey: string): Promise<string | null> {
  try {
    const acct = await stripe("/account", secretKey);
    const live = secretKey.startsWith("sk_live");
    const label = (acct.business_profile as { name?: string })?.name || acct.id;
    return `${label}${live ? " (live)" : " (test)"}`;
  } catch {
    return null;
  }
}

/** Create a Checkout Session for a one-off purchase; returns the hosted URL. */
export async function createCheckoutSession(
  secretKey: string,
  input: {
    productName: string;
    amountCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  },
): Promise<{ id: string; url: string }> {
  const body: Record<string, string | number> = {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": input.currency,
    "line_items[0][price_data][unit_amount]": Math.max(0, Math.round(input.amountCents)),
    "line_items[0][price_data][product_data][name]": input.productName.slice(0, 250) || "Purchase",
  };
  for (const [k, v] of Object.entries(input.metadata ?? {})) body[`metadata[${k}]`] = v;
  const session = await stripe("/checkout/sessions", secretKey, body);
  const url = typeof session.url === "string" ? session.url : "";
  if (!url) throw new Error("Stripe did not return a checkout URL.");
  return { id: String(session.id), url };
}

/**
 * Verify a Stripe webhook signature (Stripe-Signature header) without the SDK:
 * HMAC-SHA256 of `${t}.${rawBody}` must equal the v1 signature.
 */
export function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
): boolean {
  if (!sigHeader) return false;
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function createDraftInvoice(
  secretKey: string,
  inv: { customerEmail: string; amountCents: number; description: string },
): Promise<{ invoiceId: string; customerId: string }> {
  const customer = await stripe("/customers", secretKey, { email: inv.customerEmail });
  const customerId = String(customer.id);
  await stripe("/invoiceitems", secretKey, {
    customer: customerId,
    amount: Math.round(inv.amountCents),
    currency: "usd",
    description: inv.description,
  });
  const invoice = await stripe("/invoices", secretKey, {
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: 7,
    // left as a DRAFT — not finalized, not sent.
  });
  return { invoiceId: String(invoice.id), customerId };
}
