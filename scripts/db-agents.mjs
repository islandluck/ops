import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 8 });
try {
  const rows = await sql`select name, tier, premium, created_by_type, permissions_mode, left(instructions,60) as instr from agents order by created_by_type, name`;
  console.log(JSON.stringify(rows, null, 2));
} catch(e){ console.error("FAIL:", e.message); } finally { await sql.end({timeout:5}); }
process.exit(0);
