import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

async function test(label, url) {
  if (!url) return console.log(label, "NO URL");
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 8, idle_timeout: 3 });
  try {
    const t0 = Date.now();
    await sql`select 1 as ok`;
    const counts = {};
    for (const t of ["workspaces", "agents", "tasks", "task_assets", "activity_events"]) {
      try {
        const c = await sql.unsafe(`select count(*)::int as n from ${t}`);
        counts[t] = c[0].n;
      } catch (e) {
        counts[t] = "ERR:" + e.message.slice(0, 30);
      }
    }
    console.log(label, "OK", Date.now() - t0 + "ms", JSON.stringify(counts));
  } catch (e) {
    console.log(label, "FAIL:", e.message.slice(0, 140));
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
}

await test("TX-POOLER(6543)", process.env.DATABASE_URL);
await test("SESSION-POOLER(5432)", process.env.DIRECT_URL);
process.exit(0);
