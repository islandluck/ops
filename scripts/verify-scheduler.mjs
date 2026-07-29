// End-to-end check for the auto-publish scheduler.
// Inserts a DUE scheduled task with no connected systems (execution is simulated
// — no external posting), hits the cron endpoint, verifies the task auto-ran,
// then deletes the throwaway task. Safe to run repeatedly.
// Usage: node scripts/verify-scheduler.mjs [email]
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
if (!u) { console.error("No user for", email); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 2 });
const taskId = randomUUID();
let pass = false;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id=${u.id} limit 1`;
  const ws = wm.workspace_id;
  const past = new Date(Date.now() - 120_000); // 2 min ago → due

  await sql`
    insert into tasks (id, workspace_id, category, title, description, rationale, status,
      risk_level, priority, scheduled_at, created_by_type, requires_approval,
      approval_status, execution_status, affected_systems, proposed_actions, impact_score)
    values (${taskId}, ${ws}, 'content', 'Scheduler self-test (safe — no external post)',
      'Temporary task to verify the auto-publish scheduler.', 'self-test', 'approved',
      'low', 'medium', ${past}, 'agent', true, 'approved', 'queued', '{}', 1, 10)`;
  await sql`
    insert into task_assets (id, task_id, asset_type, title, content, metadata)
    values (${randomUUID()}, ${taskId}, 'social_post', 'X post', 'Scheduler self-test — safe.', ${sql.json({ channel: "none" })})`;
  console.log("① Inserted DUE test task (scheduled_at = 2 min ago, no live systems)");

  const key = process.env.CRON_SECRET;
  if (!key) { console.error("CRON_SECRET missing in .env.local"); process.exit(1); }
  const res = await fetch("http://localhost:3000/api/social/publish", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`② Cron endpoint → HTTP ${res.status}:`, JSON.stringify(body));

  const [t] = await sql`select status, execution_status, scheduled_at from tasks where id=${taskId}`;
  const runs = await sql`select status, result_summary from execution_runs where task_id=${taskId}`;
  console.log("③ Task after run:", JSON.stringify(t));
  console.log("   Execution run:", JSON.stringify(runs[0] ?? null));

  pass =
    res.ok &&
    body.published >= 1 &&
    t.status === "done" &&
    t.execution_status === "completed" &&
    runs.length >= 1;
  console.log(pass ? "\nPASS ✓ scheduler auto-executed the due task" : "\nFAIL ✗ (see above)");
} finally {
  await sql`delete from tasks where id=${taskId}`;
  console.log("④ Cleaned up test task");
  await sql.end();
}
process.exit(pass ? 0 : 1);
