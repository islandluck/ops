#!/usr/bin/env node
/**
 * Deploy preflight — verifies environment config before a private-beta go-live.
 * Reads .env.local (falling back to process.env) and reports a pass/warn/fail
 * table. NEVER prints secret values — only presence, length, and shape.
 *
 *   node scripts/preflight.mjs
 *
 * Exits non-zero if any REQUIRED var is missing or a hard safety check fails
 * (e.g. a LIVE Stripe key), so it can gate CI / a deploy script.
 */
import fs from "node:fs";

const root = new URL("../", import.meta.url);

function loadEnvLocal() {
  try {
    const text = fs.readFileSync(new URL(".env.local", root), "utf8");
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = loadEnvLocal();
const usingFile = Object.keys(fileEnv).length > 0;
const get = (k) => String(fileEnv[k] ?? process.env[k] ?? "").trim();
const has = (k) => get(k).length > 0;
const truthy = (k) => ["1", "true", "on", "yes"].includes(get(k).toLowerCase());

const rows = [];
let hardFail = false;
// level: FAIL (blocks), WARN (should fix for prod), OK, INFO (feature off)
function add(level, name, note) {
  if (level === "FAIL") hardFail = true;
  rows.push({ level, name, note });
}
function required(k, note) {
  if (has(k)) add("OK", k, "set");
  else add("FAIL", k, note);
}
function prod(k, note) {
  if (has(k)) add("OK", k, "set");
  else add("WARN", k, note);
}
function feature(k, note) {
  add(has(k) ? "OK" : "INFO", k, has(k) ? "set" : note);
}

// --- Required to boot + load a workspace ---
required("DATABASE_URL", "app can't reach Postgres — workspace load fails");
required("NEXT_PUBLIC_SUPABASE_URL", "Supabase auth won't initialise");
required("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase auth won't initialise");
required("SUPABASE_SERVICE_ROLE_KEY", "server-side auth / admin calls fail");
required("NEXT_PUBLIC_APP_URL", "OAuth redirects + absolute links break");

// --- Shape checks ---
if (has("DATABASE_URL") && !get("DATABASE_URL").includes(":6543")) {
  add("WARN", "DATABASE_URL", "not the transaction pooler (:6543) — recommended for Vercel serverless");
}
prod("DIRECT_URL", "needed only to run DB migrations (port 5432)");

// --- Required in production for automation + integrations ---
prod("CRON_SECRET", "cron routes return 503 — scheduled posts + background agents won't run");
if (has("TOKEN_ENCRYPTION_KEY")) {
  if (get("TOKEN_ENCRYPTION_KEY").length < 43) {
    add("WARN", "TOKEN_ENCRYPTION_KEY", "looks short — use `openssl rand -base64 32` (>= 32 bytes)");
  } else add("OK", "TOKEN_ENCRYPTION_KEY", "set");
} else {
  add("WARN", "TOKEN_ENCRYPTION_KEY", "OAuth connect will fail — no key to encrypt stored tokens");
}

// --- Stripe: TEST MODE ONLY (hard rule) ---
if (has("STRIPE_SECRET_KEY")) {
  const k = get("STRIPE_SECRET_KEY");
  if (k.startsWith("sk_live_") || k.startsWith("rk_live_")) {
    add("FAIL", "STRIPE_SECRET_KEY", "LIVE key detected — Operator is TEST-MODE ONLY. Use sk_test_…");
  } else if (k.startsWith("sk_test_") || k.startsWith("rk_test_")) {
    add("OK", "STRIPE_SECRET_KEY", "test key");
  } else {
    add("WARN", "STRIPE_SECRET_KEY", "unrecognised format — expected sk_test_…");
  }
  if (!has("STRIPE_WEBHOOK_SECRET")) {
    add("WARN", "STRIPE_WEBHOOK_SECRET", "orders won't be marked paid without the webhook signing secret");
  } else add("OK", "STRIPE_WEBHOOK_SECRET", "set");
} else {
  add("INFO", "STRIPE_SECRET_KEY", "page buy-buttons + invoices off until a TEST key is set");
}

// --- Safety switches ---
if (truthy("OPERATOR_EXECUTION_DISABLED")) {
  add("WARN", "OPERATOR_EXECUTION_DISABLED", "KILL SWITCH IS ON — all task execution is halted");
} else add("OK", "OPERATOR_EXECUTION_DISABLED", "off (normal operation)");
{
  const cap = Number(get("OPERATOR_DAILY_ACTION_CAP"));
  if (has("OPERATOR_DAILY_ACTION_CAP") && !(Number.isFinite(cap) && cap > 0)) {
    add("WARN", "OPERATOR_DAILY_ACTION_CAP", "not a positive number — falls back to default 50");
  } else add("OK", "OPERATOR_DAILY_ACTION_CAP", has("OPERATOR_DAILY_ACTION_CAP") ? `cap=${cap}` : "default 50");
}
if (truthy("AUTH_AUTOCONFIRM")) {
  add("WARN", "AUTH_AUTOCONFIRM", "ON — dev-only. Disable in prod; configure Supabase SMTP for real confirmation");
} else add("OK", "AUTH_AUTOCONFIRM", "off (real email confirmation)");

// --- Feature integrations (degrade gracefully) ---
feature("ANTHROPIC_API_KEY", "AI drafting off — agents fall back to canned drafts");
feature("TAVILY_API_KEY", "Social agent drafts from the brief only (no live research)");
feature("PEXELS_API_KEY", "stock-photo search off (uploads still work)");
for (const [id, secret, label] of [
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "Google (Gmail/Calendar/Sheets)"],
  ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET", "HubSpot (CRM)"],
  ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "Notion (pages)"],
  ["X_CLIENT_ID", "X_CLIENT_SECRET", "X (posts)"],
]) {
  const ok = has(id) && has(secret);
  add(ok ? "OK" : "INFO", label, ok ? "configured" : "not configured — integration unavailable");
}

// --- Report ---
const ICON = { OK: "✓", WARN: "⚠", FAIL: "✗", INFO: "·" };
const order = { FAIL: 0, WARN: 1, INFO: 2, OK: 3 };
rows.sort((a, b) => order[a.level] - order[b.level]);

console.log(`\nOperator preflight — source: ${usingFile ? ".env.local" : "process.env"}\n`);
for (const r of rows) {
  const pad = r.name.padEnd(30, " ");
  console.log(`  ${ICON[r.level]} ${pad} ${r.note}`);
}
const fails = rows.filter((r) => r.level === "FAIL").length;
const warns = rows.filter((r) => r.level === "WARN").length;
console.log(
  `\n${fails ? `✗ ${fails} blocking` : "✓ no blockers"}` +
    `${warns ? `, ⚠ ${warns} to review` : ""}. ` +
    (hardFail ? "Fix blockers before deploying.\n" : "Safe to deploy for a private beta.\n"),
);
process.exit(hardFail ? 1 : 0);
