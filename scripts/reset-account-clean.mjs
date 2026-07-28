// Reset an account to a pristine, not-yet-onboarded state so the guided
// onboarding → clean board flow can be tested from scratch.
// Usage: node scripts/reset-account-clean.mjs [email]
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
  const wsId = wm?.workspace_id;
  if (!wsId) {
    console.log("No workspace yet — will be provisioned clean on first load.");
  } else {
    const [before] = await sql`select
      (select count(*) from tasks where workspace_id=${wsId})::int as tasks,
      (select count(*) from activity_events where workspace_id=${wsId})::int as activity`;
    const tids = (await sql`select id from tasks where workspace_id=${wsId}`).map((r) => r.id);
    if (tids.length) {
      await sql`delete from execution_runs where task_id in ${sql(tids)}`;
      await sql`delete from approval_decisions where task_id in ${sql(tids)}`;
      await sql`delete from task_assets where task_id in ${sql(tids)}`;
    }
    await sql`delete from tasks where workspace_id=${wsId}`;
    await sql`delete from activity_events where workspace_id=${wsId}`;
    await sql`update business_briefs set company_name='', website_url='', business_description='',
      core_offer='', ideal_customer_profile='', goals='{}', voice_rules='{}', updated_at=now()
      where workspace_id=${wsId}`;
    await sql`update workspaces set name='My workspace', updated_at=now() where id=${wsId}`;
    const [after] = await sql`select
      (select count(*) from tasks where workspace_id=${wsId})::int as tasks,
      (select count(*) from activity_events where workspace_id=${wsId})::int as activity`;
    console.log("board  BEFORE:", before, " AFTER:", after);
  }
} finally {
  await sql.end();
}

// Unset the onboarded flag so middleware routes them into guided onboarding.
const meta = { ...(u.user_metadata || {}) };
await supa.auth.admin.updateUserById(u.id, { user_metadata: { ...meta, onboarded: false } });
console.log("onboarded flag: false ✓  (next visit → /onboarding)");
console.log("full_name kept:", JSON.stringify(u.user_metadata?.full_name ?? null));
process.exit(0);
