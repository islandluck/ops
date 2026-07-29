// Verify the Social Media Agent's research + drafting against a real brief.
// Read-only (creates no tasks). Usage: node scripts/verify-social.mjs [email]
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
  [brief] = await sql`select company_name, business_description, core_offer, ideal_customer_profile, voice_rules, restricted_phrases from business_briefs where workspace_id = ${wm.workspace_id}`;
} finally {
  await sql.end();
}

// Live research (Tavily) if the key is present.
let research = null;
if (process.env.TAVILY_API_KEY) {
  const q = `latest news, trends, and discussions relevant to this business: ${brief.business_description} ${brief.core_offer}`.slice(0, 380);
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: q, topic: "news", max_results: 6, days: 7, include_answer: true }),
  });
  if (r.ok) { const j = await r.json(); research = { sources: (j.results || []).map((x) => ({ title: x.title, snippet: (x.content || "").slice(0, 500) })) }; }
}
console.log(`Research: ${research ? `${research.sources.length} live sources (Tavily)` : "brief-grounded (no TAVILY_API_KEY yet)"}`);

const CONFIG = { x: 3, blog: 1 };
const persona = "You are the Social Media Agent — the company's social media manager. Match the brand voice, lead with value, never publish unverified claims.";
const system = [
  persona,
  `You work for ${brief.company_name}. ${[brief.business_description, brief.core_offer].filter(Boolean).join(" ")}`.trim(),
  brief.ideal_customer_profile ? `Audience: ${brief.ideal_customer_profile}` : "",
  brief.voice_rules?.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
  brief.restricted_phrases?.length ? `Never use / never claim: ${brief.restricted_phrases.join(", ")}` : "",
  "",
  `Create ${CONFIG.x} X/Twitter post(s) and ${CONFIG.blog} blog draft(s) — on-brand and useful.`,
  "X posts: <=260 chars body (NO hashtags in body), 2-3 lowercase hashtags separately. Blog: title + 3-5 short paragraphs. Never fabricate stats or claims.",
  "",
  "Respond with ONLY a JSON array — no fences:",
  '[{"channel": "x"|"blog", "title": string, "content": string, "hashtags": string[]}]',
].filter(Boolean).join("\n");
const topics = research?.sources.length
  ? "Current topics:\n" + research.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.snippet}`).join("\n")
  : "No live research available — draw on the company's industry and offering from the brief.";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
const message = await client.messages.create({ model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: 4000, system, messages: [{ role: "user", content: `${topics}\n\nCreate the content now.` }] });
const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
const arr = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());

for (const p of arr) {
  console.log(`\n[${p.channel === "blog" ? "BLOG" : "X"}] ${p.title}`);
  console.log("   " + String(p.content).replace(/\n/g, "\n   ").slice(0, 400));
  if (p.hashtags?.length) console.log("   hashtags: " + p.hashtags.map((h) => "#" + h).join(" "));
}
process.exit(0);
