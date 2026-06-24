// Dev utility: wipe all workspace data (keeps auth users). Use to reset seed.
import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 8 });
try {
  await sql`truncate table workspaces cascade`;
  console.log("OK — truncated workspaces (cascade clears all workspace data)");
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(0);
