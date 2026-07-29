// Read-only: show which Notion page the old vs new parent logic targets.
// Creates nothing. Usage: node scripts/verify-notion-parent.mjs [email]
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createDecipheriv } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
function decrypt(blob) {
  const [iv, tag, data] = blob.split(".");
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "base64");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
let token;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  const [row] = await sql`select access_token from integrations where workspace_id = ${wm.workspace_id} and name = 'Notion'`;
  if (!row?.access_token) { console.log("Notion not connected."); process.exit(0); }
  token = decrypt(row.access_token);
} finally {
  await sql.end();
}

const res = await fetch("https://api.notion.com/v1/search", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
  body: JSON.stringify({ filter: { property: "object", value: "page" }, page_size: 100 }),
});
const json = await res.json();
if (!res.ok) { console.error("search failed:", json.message || res.status); process.exit(1); }
const pages = (json.results || []).filter((r) => r.object === "page");
const title = (p) => {
  const t = Object.values(p.properties || {}).find((x) => x.type === "title");
  return (t?.title || []).map((x) => x.plain_text).join("") || "(untitled)";
};

console.log(`Accessible pages: ${pages.length}`);
for (const p of pages)
  console.log(`  • "${title(p)}"  parent=${p.parent?.type}  created=${(p.created_time || "").slice(0, 10)}  edited=${(p.last_edited_time || "").slice(0, 16)}`);

const oldPick = [...pages].sort((a, b) => new Date(b.last_edited_time) - new Date(a.last_edited_time))[0];
const shared = pages.filter((p) => p.parent?.type === "workspace");
const pool = shared.length ? shared : pages;
const newPick = [...pool].sort((a, b) => new Date(a.created_time) - new Date(b.created_time))[0];

console.log(`\nOLD (most-recently-edited) → "${oldPick ? title(oldPick) : "none"}"  ← drifts to each new page after a send (the cascade)`);
console.log(`NEW (stable shared top-level) → "${newPick ? title(newPick) : "none"}"  ← same every time`);
process.exit(0);
