import "server-only";

/**
 * Stripe via secret API key (the operator's own account — no OAuth needed).
 * Creates a DRAFT invoice (never auto-finalized/sent) so nothing is charged.
 * Strongly recommend a test-mode key (sk_test_…).
 */

const BASE = "https://api.stripe.com/v1";

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
