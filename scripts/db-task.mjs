import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 8 });
try {
  const t = await sql`select title, status, approval_status, execution_status from tasks where title ilike '%warm leads%' limit 1`;
  const runs = await sql`select status, count(*)::int n from execution_runs group by status`;
  const acts = await sql`select count(*)::int n from activity_events`;
  const decisions = await sql`select count(*)::int n from approval_decisions`;
  console.log(JSON.stringify({ heroTask: t[0], runsByStatus: runs, activity: acts[0].n, decisions: decisions[0].n }, null, 2));
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(0);
