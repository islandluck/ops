// Live check of the Pexels stock integration — replicates lib/ai/stock.ts
// (same endpoint, header, and parse shape) and searches brief-relevant queries.
// Never prints the key. Usage: node scripts/verify-stock.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

const key = process.env.PEXELS_API_KEY;
if (!key) { console.error("PEXELS_API_KEY missing in .env.local"); process.exit(1); }

// Mirror of searchStockImages() in lib/ai/stock.ts
async function searchStockImages(query, limit = 8) {
  const q = query.trim();
  if (!q) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${limit}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    console.log(`   API error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
    return null; // signals an auth/API failure vs. simply no matches
  }
  const rl = res.headers.get("x-ratelimit-remaining");
  if (rl) console.log(`   (rate limit remaining: ${rl})`);
  const json = await res.json();
  return (json.photos ?? [])
    .map((p) => ({
      url: p.src?.large2x || p.src?.large || p.src?.original || "",
      thumb: p.src?.medium || p.src?.small || "",
      alt: p.alt || q,
      width: p.width,
      height: p.height,
      attribution: p.photographer ? `Photo by ${p.photographer} on Pexels` : "Pexels",
    }))
    .filter((s) => s.url);
}

const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 2 });

let authOk = false, anyResults = false;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id=${u.id} limit 1`;
  const [brief] = await sql`select company_name, business_description, core_offer from business_briefs where workspace_id=${wm.workspace_id} limit 1`;
  const niche = (brief?.core_offer || brief?.business_description || "")
    .split(/[\s,.]+/).filter(Boolean).slice(0, 3).join(" ").trim();
  const queries = [niche || "clean energy", "clean energy technology"].filter(Boolean);

  for (const q of queries) {
    console.log(`\nSearch "${q}":`);
    const imgs = await searchStockImages(q);
    if (imgs === null) continue; // API/auth error already logged
    authOk = true; // the key authenticated
    console.log(`   ${imgs.length} result(s)`);
    imgs.slice(0, 3).forEach((im, i) =>
      console.log(`   ${i + 1}. ${im.width}x${im.height} · ${im.attribution} · url:${im.url ? "ok" : "MISSING"} thumb:${im.thumb ? "ok" : "MISSING"}`),
    );
    if (imgs.length && imgs.every((im) => im.url && im.attribution)) anyResults = true;
  }

  const pass = authOk && anyResults;
  console.log(pass ? "\nPASS ✓ Pexels key authenticates and returns usable results" : authOk ? "\nPARTIAL — key works but those queries returned nothing" : "\nFAIL ✗ key did not authenticate");
  process.exitCode = pass ? 0 : 1;
} finally {
  await sql.end();
}
