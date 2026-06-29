import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 8 });
try {
  const t = await sql`select t.title, t.status, t.created_by_type, ag.name as agent, left(a.content,200) as draft, length(a.content) as len
    from tasks t left join agents ag on ag.id=t.agent_id left join task_assets a on a.task_id=t.id
    order by t.created_at desc limit 1`;
  const counts = await sql`select name, tasks_prepared from agents where name='Growth Agent'`;
  console.log(JSON.stringify({ newest: t[0], growth: counts[0] }, null, 2));
} catch(e){ console.error("FAIL:", e.message); } finally { await sql.end({timeout:5}); }
process.exit(0);
