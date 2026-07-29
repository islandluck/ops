// Verify the triage classifier on synthetic emails (no inbox access needed).
// Makes one Claude call; creates/sends nothing. Usage: node scripts/verify-triage.mjs [email]
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
let brief;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  [brief] = await sql`select company_name, business_description, core_offer, ideal_customer_profile, voice_rules from business_briefs where workspace_id = ${wm.workspace_id}`;
} finally {
  await sql.end();
}

const emails = [
  { from: { name: "Sarah Chen", email: "sarah@sequoiacap.com" }, subject: "Following up — Series A diligence", date: "Mon", body: "Hi Laron, great meeting last week. We'd love to move forward with diligence on Andros. Could you share your data room and find 30 minutes this week to discuss terms?" },
  { from: { name: "Growth Ninja", email: "bd@leadgenpro.io" }, subject: "10x your pipeline with AI 🚀", date: "Mon", body: "Hey, I help founders book 20+ qualified meetings a month on autopilot. Worth a quick 15-min call this week?" },
  { from: { name: "Mike Alvarez", email: "mike@acmecorp.com" }, subject: "Urgent: pilot telemetry issue blocking eval", date: "Mon", body: "We're seeing dropped readings from the reactor telemetry integration since this morning and it's blocking our evaluation. Can someone help today?" },
  { from: { name: "TLDR", email: "newsletter@tldr.tech" }, subject: "Your daily tech digest", date: "Mon", body: "Today's top stories in tech and startups. Unsubscribe at the bottom." },
];

const system = [
  "You are an email triage assistant for a busy founder.",
  `They run ${brief.company_name || "a company"}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
  brief.ideal_customer_profile ? `Their customers: ${brief.ideal_customer_profile}` : "",
  brief.voice_rules?.length ? `Their brand voice: ${brief.voice_rules.join("; ")}` : "",
  "",
  "For EACH email, infer the sender relationship, intent, urgency, and the single best next action, then write a 1–2 sentence summary. Write a suggested_reply ONLY when a reply is genuinely warranted; otherwise empty string.",
  "ALSO: if the email implies WORK beyond replying (schedule, prepare/send a doc, investigate, follow up, update CRM, pay/file), produce task_title (imperative), task_detail (what to do + first step), and task_department (growth, admin, content, research, finance). Otherwise leave task_title empty. An email can have both a reply and a task.",
  "",
  "category: Investor, Customer, Internal, Admin, Noise.",
  "urgency: Critical, High, Normal, Low.",
  "action_type: Reply, Schedule, Read, Delegate, Archive.",
  "Guardrails: never suggest deleting, forwarding externally, or auto-sending. Anything involving money, legal terms, or commitments → summarize + flag, and keep any suggested reply cautious and non-committal.",
  "",
  "Respond with ONLY a JSON array — one object per email, in the SAME ORDER — no markdown or code fences:",
  '[{"category": string, "urgency": string, "intent": string, "relationship": string, "action_type": string, "summary": string, "suggested_reply": string, "task_title": string, "task_detail": string, "task_department": string}]',
]
  .filter(Boolean)
  .join("\n");

const list = emails
  .map((e, i) => `--- Email [${i}] ---\nFrom: ${e.from.name} <${e.from.email}>\nSubject: ${e.subject}\nDate: ${e.date}\nBody: ${e.body}`)
  .join("\n\n");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
const message = await client.messages.create({
  model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
  max_tokens: 8000,
  system,
  messages: [{ role: "user", content: `Triage these ${emails.length} emails:\n\n${list}` }],
});
const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
const arr = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());

let replyCount = 0, taskCount = 0;
emails.forEach((e, i) => {
  const t = arr[i] ?? {};
  if (t.suggested_reply) replyCount++;
  if (t.task_title) taskCount++;
  console.log(`\n[${i}] ${e.from.name} — "${e.subject}"`);
  console.log(`    category=${t.category}  urgency=${t.urgency}  action=${t.action_type}`);
  console.log(`    summary: ${t.summary}`);
  if (t.suggested_reply) console.log(`    reply : ${String(t.suggested_reply).replace(/\n/g, " ").slice(0, 130)}…`);
  if (t.task_title) console.log(`    TASK  : [${t.task_department}] ${t.task_title} — ${String(t.task_detail || "").replace(/\n/g, " ").slice(0, 120)}`);
});
console.log(`\n→ ${replyCount} reply task(s) + ${taskCount} action task(s) from ${emails.length} emails.`);
process.exit(0);
