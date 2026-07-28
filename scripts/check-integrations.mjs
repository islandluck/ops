// Show the connection state of a workspace's integrations (no secrets printed —
// only whether an encrypted token exists). Usage: node scripts/check-integrations.mjs [email]
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
if (!u) { console.error("No user:", email); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  const rows = await sql`
    select name, connected, account,
           (access_token is not null) as has_token,
           (refresh_token is not null) as has_refresh,
           scope
    from integrations where workspace_id = ${wm.workspace_id} order by name`;
  console.log("name                | conn  | token | refresh | account / scope");
  console.log("-".repeat(88));
  for (const r of rows) {
    const scopeShort = (r.scope || "").replace(/https:\/\/www\.googleapis\.com\/auth\//g, "").slice(0, 44);
    console.log(
      `${r.name.padEnd(19)} | ${String(r.connected).padEnd(5)} | ${String(r.has_token).padEnd(5)} | ${String(r.has_refresh).padEnd(7)} | ${r.account ?? ""}${scopeShort ? "  [" + scopeShort + "]" : ""}`,
    );
  }
} finally {
  await sql.end();
}
process.exit(0);
