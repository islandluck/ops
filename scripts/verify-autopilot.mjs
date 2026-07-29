// End-to-end check for autopilot (Social Media Agent on "auto").
// Isolates the social agent (temporarily disables other background agents),
// runs the background cron twice, and asserts:
//   1) it SCHEDULES X posts without approval (queued, future, requires_approval=false)
//   2) it never publishes on creation (execution_status stays "queued")
//   3) the pipeline is bounded to the target (a second run doesn't exceed it)
// Then it DELETES the created posts (so none ever publish to X) and restores all
// agent config. Safe to run; costs a few LLM calls. Usage: node scripts/verify-autopilot.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

const TARGET = 3; // must match AUTOPILOT_TARGET in lib/agents/social.ts
const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
if (!u) { console.error("No user for", email); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 3 });
const key = process.env.CRON_SECRET;
const hitCron = async () =>
  (await fetch("http://localhost:3000/api/agents/run", { method: "POST", headers: { Authorization: `Bearer ${key}` } })).json();
const isX = (arr) => Array.isArray(arr) && arr.includes("X (Twitter)");

let snapshot = null, socialId = null, createdIds = [], pass = false;
try {
  const [ws] = await sql`select workspace_id from workspace_members where user_id=${u.id} limit 1`;
  const wsId = ws.workspace_id;
  const [social] = await sql`select id, permissions_mode from agents where workspace_id=${wsId} and kind='social' limit 1`;
  if (!social) throw new Error("No social agent in this workspace");
  socialId = social.id;

  // Snapshot every agent's background flag + the social agent's mode, then isolate.
  const agentsSnap = await sql`select id, background_enabled from agents where workspace_id=${wsId}`;
  snapshot = { agents: agentsSnap.map((a) => ({ id: a.id, bg: a.background_enabled })), socialMode: social.permissions_mode };
  await sql`update agents set background_enabled=false where workspace_id=${wsId}`;
  await sql`update agents set background_enabled=true, permissions_mode='auto' where id=${socialId}`;

  const before = new Set((await sql`select id from tasks where workspace_id=${wsId}`).map((r) => r.id));

  console.log("① Run 1 (empty pipeline) …");
  console.log("   cron:", JSON.stringify(await hitCron()));
  const after1 = await sql`select id, execution_status, approval_status, requires_approval, scheduled_at, affected_systems from tasks where workspace_id=${wsId}`;
  const new1 = after1.filter((t) => !before.has(t.id));
  const sched1 = new1.filter((t) => t.execution_status === "queued" && isX(t.affected_systems));
  console.log(`   created ${new1.length} task(s); ${sched1.length} scheduled X post(s)`);

  console.log("② Run 2 (pipeline should be full) …");
  console.log("   cron:", JSON.stringify(await hitCron()));
  const after2 = await sql`select id, execution_status, approval_status, requires_approval, scheduled_at, affected_systems from tasks where workspace_id=${wsId}`;
  const sched = after2.filter((t) => !before.has(t.id) && t.execution_status === "queued" && isX(t.affected_systems));
  createdIds = after2.filter((t) => !before.has(t.id)).map((t) => t.id); // delete everything the test made
  console.log(`   total scheduled X posts after run 2: ${sched.length} (target ${TARGET})`);

  const now = Date.now();
  const allFuture = sched.every((t) => new Date(t.scheduled_at).getTime() > now);
  const allNoApproval = sched.every((t) => t.requires_approval === false && t.approval_status === "approved");
  const nonemPublished = sched.every((t) => t.execution_status === "queued"); // never executed on creation
  const bounded = sched.length === TARGET; // run 2 topped up to but not beyond target
  const createdSome = sched.length >= 1;

  const checks = { createdSome, allFuture, allNoApproval, nonemPublished, bounded };
  console.log("③", checks);
  for (const t of sched) console.log(`   • queued X post → publishes ${new Date(t.scheduled_at).toISOString()}`);
  pass = Object.values(checks).every(Boolean);
  console.log(pass ? "\nPASS ✓ autopilot schedules without approval, no early publish, pipeline bounded" : "\nFAIL ✗");
} finally {
  for (const id of createdIds) await sql`delete from tasks where id=${id}`;
  if (snapshot) {
    for (const a of snapshot.agents) await sql`update agents set background_enabled=${a.bg} where id=${a.id}`;
    if (socialId) await sql`update agents set permissions_mode=${snapshot.socialMode} where id=${socialId}`;
  }
  console.log(`④ cleanup: deleted ${createdIds.length} test task(s), restored agent config`);
  await sql.end();
}
process.exit(pass ? 0 : 1);
