// Verify the task planner against a workspace's real brief + integrations.
// Read-only: makes one Claude call, creates/sends nothing.
// Usage: node scripts/verify-planner.mjs [email] ["task text"]
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const taskInput = process.argv[3] || "send a test email to myself";

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false } });
let brief, integrations;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id = ${u.id} limit 1`;
  const ws = wm.workspace_id;
  [brief] = await sql`select company_name, business_description, core_offer, ideal_customer_profile, voice_rules, restricted_phrases from business_briefs where workspace_id = ${ws}`;
  integrations = await sql`select name, connected from integrations where workspace_id = ${ws} order by name`;
} finally {
  await sql.end();
}

const CATEGORIES = ["growth", "admin", "content", "research", "finance"];
const toolLines = integrations.map((i) => `- ${i.name}${i.connected ? " (connected)" : " (NOT connected)"}`).join("\n");
const system = [
  `You are Operator, an autonomous operations assistant for ${brief.company_name || "the business"}.`,
  [brief.business_description, brief.core_offer].filter(Boolean).join(" "),
  brief.ideal_customer_profile ? `Ideal customer: ${brief.ideal_customer_profile}` : "",
  brief.voice_rules?.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
  brief.restricted_phrases?.length ? `Never use: ${brief.restricted_phrases.join(", ")}` : "",
  "",
  "The owner has handed you a task. Think it through and PLAN it:",
  "1. Work out what they actually want done.",
  "2. Decide which tools are required — use ONLY the exact tool names listed below. If a required tool is NOT connected, still include it.",
  "3. Write a complete, ready-to-use DRAFT of the actual content the task acts on. No placeholders unless truly unknowable.",
  "4. Choose a category and a risk level.",
  "",
  "Available tools (use these EXACT names in affected_systems):",
  toolLines,
  "",
  `Categories: ${CATEGORIES.join(", ")}.`,
  'If the task sends an email, the draft MUST begin with a "Subject:" line, then a blank line, then the body.',
  "",
  "Respond with ONLY this JSON object (no markdown, no code fences):",
  '{"title": string, "category": string, "affected_systems": string[], "risk_level": "low"|"medium"|"high", "requires_approval": boolean, "rationale": string, "draft": string}',
]
  .filter(Boolean)
  .join("\n");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
const message = await client.messages.create({
  model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
  max_tokens: 3000,
  system,
  messages: [{ role: "user", content: `Task from the owner: ${taskInput}\n\nPlan it now.` }],
});
const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
const raw = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
const known = new Set(integrations.map((i) => i.name));
const affected = Array.isArray(raw.affected_systems) ? raw.affected_systems.filter((n) => typeof n === "string" && known.has(n)) : [];

console.log("INPUT :", JSON.stringify(taskInput));
console.log("PLAN  :");
console.log("  title            :", raw.title);
console.log("  category         :", raw.category);
console.log("  affected_systems :", affected);
console.log("  risk_level       :", raw.risk_level);
console.log("  requires_approval:", raw.requires_approval);
console.log("  rationale        :", raw.rationale);
console.log("  draft (first 500):");
console.log(String(raw.draft || "").slice(0, 500).split("\n").map((l) => "    " + l).join("\n"));
console.log("");
console.log("CHECK affected_systems→Gmail :", affected.includes("Gmail") ? "YES ✓" : "no");
console.log("CHECK draft has Subject line :", /^\s*Subject:/im.test(String(raw.draft || "")) ? "YES ✓" : "no");
process.exit(0);
