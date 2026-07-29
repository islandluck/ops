// Add the "X (Twitter)" integration row to an existing workspace (new/reset
// workspaces get it from the seed). Idempotent.
// Usage: node scripts/add-x-integration.mjs [email]
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  const ws = wm.workspace_id;
  const [existing] = await sql`select id, connected from integrations where workspace_id = ${ws} and name = ${"X (Twitter)"} limit 1`;
  if (existing) {
    console.log(`X (Twitter) integration already exists (connected=${existing.connected})`);
    process.exit(0);
  }
  await sql`insert into integrations (id, workspace_id, name, provider, category, connected, permission_mode, optional)
    values (${randomUUID()}, ${ws}, ${"X (Twitter)"}, ${"X"}, ${"other"}, ${false}, ${"approval"}, ${true})`;
  console.log("Inserted X (Twitter) integration row (not connected).");
} finally {
  await sql.end();
}
process.exit(0);
