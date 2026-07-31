// Confirms a completed test checkout end-to-end: (1) Stripe reports the session
// as paid, (2) delivering the signed checkout.session.completed event to our
// webhook (exactly as Stripe would) flips the order to "paid". Test mode only.
// Usage: node scripts/verify-payment.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createHmac } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

const key = process.env.STRIPE_SECRET_KEY || "";
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY is not a test key.");
  process.exit(1);
}
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === "laronburrows@gmail.com");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 2 });

let pass = false;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id=${u.id} limit 1`;
  const [order] = await sql`select id, stripe_session_id, status from orders
    where workspace_id=${wm.workspace_id} and stripe_session_id is not null order by created_at desc limit 1`;
  if (!order) throw new Error("no order with a session id found");
  const sid = order.stripe_session_id;
  console.log(`Latest order: ${order.status} · ${sid.slice(0, 18)}…`);

  // 1) Ask Stripe whether that session was actually paid.
  const sres = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const session = await sres.json();
  console.log(`① Stripe session → status=${session.status} payment_status=${session.payment_status} amount=${(session.amount_total / 100).toFixed(2)} ${session.currency}`);

  // 2) Deliver the completion event to our webhook, signed like Stripe does.
  const payload = JSON.stringify({
    id: "evt_verify",
    type: "checkout.session.completed",
    data: { object: { id: sid, customer_details: { email: session.customer_details?.email ?? "buyer-test@example.com" } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const wres = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` },
    body: payload,
  });
  console.log(`② Webhook (signed) → HTTP ${wres.status} ${await wres.text()}`);

  // Also confirm the handler REJECTS a bad signature (security check).
  const bad = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=deadbeef` },
    body: payload,
  });
  console.log(`③ Webhook (bad signature) → HTTP ${bad.status} (should be 400)`);

  const [after] = await sql`select status, customer_email from orders where id=${order.id}`;
  console.log(`④ Order after webhook → ${after.status.toUpperCase()} · ${after.customer_email ?? "—"}`);

  pass = session.payment_status === "paid" && after.status === "paid" && bad.status === 400;
  console.log(pass ? "\nPASS ✓ real test payment captured on Stripe + webhook marks the order paid + bad signatures rejected" : "\nsee above");
} finally {
  await sql.end();
}
process.exit(pass ? 0 : 1);
