// One-time backfill: create documents from existing task assets so the file
// manager isn't empty. Idempotent — no-op if the workspace already has documents.
// Usage: node scripts/backfill-documents.mjs [email]
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
  const [existing] = await sql`select count(*)::int n from documents where workspace_id = ${ws}`;
  if (existing.n > 0) {
    console.log(`documents already exist (${existing.n}) — skipping backfill`);
    process.exit(0);
  }
  const agents = await sql`select id, name, folder from agents where workspace_id = ${ws}`;
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const rows = await sql`
    select ta.title as asset_title, ta.content, ta.asset_type, t.id as task_id,
           t.title as task_title, t.agent_id, t.created_at
    from task_assets ta join tasks t on t.id = ta.task_id
    where t.workspace_id = ${ws} and length(trim(ta.content)) > 60
    order by t.created_at desc`;
  let inserted = 0;
  for (const r of rows) {
    const a = r.agent_id ? agentMap.get(r.agent_id) : null;
    await sql`insert into documents
      (id, workspace_id, agent_id, author_name, task_id, task_title, name, content, folder, doc_type, created_at, updated_at)
      values (${randomUUID()}, ${ws}, ${r.agent_id || null}, ${a?.name || "Operator"}, ${r.task_id},
              ${r.task_title}, ${r.asset_title || r.task_title}, ${r.content}, ${a?.folder || ""},
              ${r.asset_type}, ${r.created_at}, now())`;
    inserted += 1;
  }
  console.log(`backfilled ${inserted} documents from existing task assets`);
  const byAuthor = await sql`select author_name, count(*)::int n from documents where workspace_id = ${ws} group by author_name order by n desc`;
  for (const b of byAuthor) console.log(`  ${b.author_name}: ${b.n}`);
} finally {
  await sql.end();
}
process.exit(0);
