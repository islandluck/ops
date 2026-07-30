// Verifies the public page path (no LLM, no Stripe, no auth): seed a published
// page + product, render it at /p/[slug], confirm the buy button degrades
// gracefully without a Stripe key, then clean up. Usage: node scripts/verify-pages.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 2 });

const productId = randomUUID();
const pageId = randomUUID();
const slug = `verify-${randomUUID().slice(0, 8)}`;
let pass = false;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id=${u.id} limit 1`;
  const ws = wm.workspace_id;

  await sql`insert into products (id, workspace_id, name, price_cents, currency)
    values (${productId}, ${ws}, ${"Verify Product"}, 4900, ${"usd"})`;
  const content = {
    headline: "Verify Headline Works",
    subheadline: "A test subheadline to confirm rendering.",
    cta_label: "Buy the thing",
    sections: [{ heading: "How it works", body: "Body copy for section A." }],
    features: [{ title: "Feature one", body: "Does a useful thing." }],
  };
  await sql`insert into pages (id, workspace_id, product_id, slug, title, status, page_type, content)
    values (${pageId}, ${ws}, ${productId}, ${slug}, ${"Verify Page"}, ${"published"}, ${"landing"}, ${sql.json(content)})`;
  console.log(`① seeded product + published page → /p/${slug}`);

  const res = await fetch(`http://localhost:3000/p/${slug}`);
  const html = await res.text();
  const hasHeadline = html.includes("Verify Headline Works");
  const hasCta = html.includes("Buy the thing");
  const hasForm = html.includes('action="/api/checkout"');
  console.log(`② GET /p/${slug} → ${res.status} · headline:${hasHeadline} cta:${hasCta} buyForm:${hasForm}`);

  const co = await fetch("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `page=${slug}`,
    redirect: "manual",
  });
  const loc = co.headers.get("location") || "";
  const graceful = co.status >= 300 && co.status < 400 && loc.includes("payments-not-configured");
  console.log(`③ POST /api/checkout (no Stripe key) → ${co.status} → ${loc.replace("http://localhost:3000", "")} · graceful:${graceful}`);

  pass = res.ok && hasHeadline && hasCta && hasForm && graceful;
  console.log(
    pass
      ? "\nPASS ✓ published page renders publicly; buy button degrades gracefully without Stripe"
      : "\nFAIL ✗ (see above)",
  );
} finally {
  await sql`delete from pages where id=${pageId}`;
  await sql`delete from products where id=${productId}`;
  console.log("④ cleaned up");
  await sql.end();
}
process.exit(pass ? 0 : 1);
