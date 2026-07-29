// Add the Social Media Agent to an existing workspace (new/reset workspaces get
// it from the seed). Idempotent. Usage: node scripts/add-social-agent.mjs [email]
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const INSTRUCTIONS =
  "You are the Social Media Agent — the company's social media manager. You research current, relevant industry topics and turn them into on-brand X/Twitter posts and blog drafts that inform and engage the target audience. Match the brand voice exactly, lead with value (not hype), and never publish unverified claims or numbers. Everything you produce goes to the owner for approval before it ships.";

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  const ws = wm.workspace_id;
  const [existing] = await sql`select id from agents where workspace_id = ${ws} and kind = 'social' limit 1`;
  if (existing) {
    console.log("Social Media Agent already exists:", existing.id);
    process.exit(0);
  }
  const id = randomUUID();
  await sql`insert into agents
    (id, workspace_id, name, category, description, instructions, folder, background_enabled, emoji, accent, kind)
    values (${id}, ${ws}, ${"Social Media Agent"}, ${"content"},
      ${"Researches your industry and drafts on-brand X posts and blog content for your approval."},
      ${INSTRUCTIONS}, ${"Social"}, ${true}, ${"📣"}, ${"violet"}, ${"social"})`;
  console.log("Inserted Social Media Agent:", id);
} finally {
  await sql.end();
}
process.exit(0);
