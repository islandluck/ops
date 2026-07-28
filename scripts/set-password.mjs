import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
function genPassword() {
  const raw = randomBytes(12).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  return `Op-${raw}-26`;
}
const password = process.argv[3] || genPassword();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.listUsers();
if (error) { console.error("ERROR listing:", error.message); process.exit(1); }
const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) { console.error(`No user with email ${email}`); process.exit(1); }

const { error: e2 } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
if (e2) { console.error("ERROR setting password:", e2.message); process.exit(1); }

// Verify the new credential actually works at the auth layer (self-test of the fix)
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: s, error: e3 } = await anon.auth.signInWithPassword({ email, password });
const verified = Boolean(s?.session) && !e3;
console.log("---RESULT---");
console.log(JSON.stringify({ ok: true, email, password, verified, verifyError: e3?.message ?? null }, null, 2));
process.exit(0);
