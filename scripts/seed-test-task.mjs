// Insert one approval-ready task that touches Gmail + Google Sheets + Notion, so
// approving it in the UI fires all three live integrations. Idempotent (replaces
// any prior copy). Usage: node scripts/seed-test-task.mjs [email]
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
if (!u) { console.error("No user:", email); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  const ws = wm.workspace_id;
  const TITLE = "✅ Live integration test — approve to fire Gmail, Sheets & Notion";

  const old = await sql`select id from tasks where workspace_id = ${ws} and title = ${TITLE}`;
  for (const r of old) await sql`delete from task_assets where task_id = ${r.id}`;
  await sql`delete from tasks where workspace_id = ${ws} and title = ${TITLE}`;

  const taskId = randomUUID();
  const now = new Date();
  await sql`insert into tasks ${sql({
    id: taskId,
    workspace_id: ws,
    category: "research",
    title: TITLE,
    description:
      "Approving this runs all three connected integrations for real: it emails you (Gmail), creates a spreadsheet in your Drive (Sheets), and creates a page in the Notion page you shared.",
    rationale: "End-to-end check that the live OAuth integrations execute real actions.",
    status: "ready",
    risk_level: "low",
    priority: "high",
    due_at: null,
    agent_id: null,
    created_by_type: "agent",
    requires_approval: true,
    approval_status: "pending",
    execution_status: "none",
    affected_systems: ["Gmail", "Google Sheets", "Notion"],
    proposed_actions: 3,
    impact_score: 60,
    created_at: now,
    updated_at: now,
  })}`;
  await sql`insert into task_assets ${sql({
    id: randomUUID(),
    task_id: taskId,
    asset_type: "email_batch",
    title: "What Operator will do on approval",
    content:
      "Subject: Operator live test — all systems go\n\n" +
      "This message was sent by Operator after you approved the live integration test.\n\n" +
      "If you're reading this in Gmail, email works. You should also see a new \"Operator — …\" " +
      "spreadsheet in your Google Drive, and a new \"[Operator] …\" page in the Notion page you shared.\n\n" +
      "— Operator (Andros Innovations)",
    metadata: null,
  })}`;
  console.log("Inserted test task:", taskId);
} finally {
  await sql.end();
}
process.exit(0);
