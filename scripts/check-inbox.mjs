// Diagnose how many emails triage could see: unread vs. total inbox estimates.
// Read-only. Usage: node scripts/check-inbox.mjs [email]
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
let row;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  [row] = await sql`select access_token, refresh_token, token_expires_at, scope from integrations where workspace_id = ${wm.workspace_id} and name = 'Gmail'`;
} finally {
  await sql.end();
}
if (!row?.access_token) { console.log("Gmail not connected."); process.exit(0); }

console.log("gmail.readonly granted:", (row.scope || "").includes("gmail.readonly") ? "YES ✓" : "NO — reconnect needed");
let token = decrypt(row.access_token);
const exp = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
if (exp && exp < Date.now() + 60000 && row.refresh_token) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decrypt(row.refresh_token),
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (j.access_token) token = j.access_token;
}
async function estimate(q) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=1`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return r.ok ? (j.resultSizeEstimate ?? 0) : `ERR ${j.error?.message || r.status}`;
}
console.log("\nInbox size estimates (Gmail resultSizeEstimate):");
console.log("  in:inbox is:unread      →", await estimate("in:inbox is:unread"));
console.log("  in:inbox (all)          →", await estimate("in:inbox"));
console.log("  in:inbox newer_than:2d  →", await estimate("in:inbox newer_than:2d"));
console.log("  in:inbox newer_than:7d  →", await estimate("in:inbox newer_than:7d"));
console.log("\nTriage currently reads: `in:inbox is:unread`, capped at 15.");
process.exit(0);
