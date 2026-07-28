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
console.log("AUTH.email        :", u?.email);
console.log("AUTH.full_name    :", JSON.stringify(u?.user_metadata?.full_name ?? null));
console.log("AUTH.metadata     :", JSON.stringify(u?.user_metadata ?? {}));

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
try {
  const wm = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  const wsId = wm[0]?.workspace_id;
  console.log("DB.workspace_id   :", wsId ?? "(none)");
  if (wsId) {
    const [ws] = await sql`select name, plan from workspaces where id = ${wsId}`;
    const [brief] = await sql`select company_name, website_url from business_briefs where workspace_id = ${wsId}`;
    const [tc] = await sql`select count(*)::int n from tasks where workspace_id = ${wsId}`;
    const [ac] = await sql`select count(*)::int n from activity_events where workspace_id = ${wsId}`;
    const [gc] = await sql`select count(*)::int n from agents where workspace_id = ${wsId}`;
    console.log("DB.workspace.name :", ws?.name);
    console.log("DB.brief.company  :", brief?.company_name);
    console.log("DB.counts         :", `tasks=${tc.n} activity=${ac.n} agents=${gc.n}`);
  }
} finally {
  await sql.end();
}
process.exit(0);
