import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 8 });
const like = process.argv[2] || "June product-update";
try {
  const rows = await sql`
    select t.title, t.status, a.title as asset_title, a.asset_type, left(a.content, 240) as preview, length(a.content) as len
    from tasks t left join task_assets a on a.task_id = t.id
    where t.title ilike ${"%" + like + "%"} limit 3`;
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(0);
