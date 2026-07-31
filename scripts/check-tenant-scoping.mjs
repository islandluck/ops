#!/usr/bin/env node
/**
 * Tenant-scoping guard (a bounded stand-in for full RLS while the app connects
 * as the service role).
 *
 * Invariant: every SELECT / UPDATE / DELETE that touches a workspace-scoped
 * table (one with a `workspace_id` column) must filter by that table's
 * `workspace_id` OR by its primary `id` — i.e. it targets a single tenant, or a
 * single row by unguessable UUID obtained from a prior scoped read. Anything
 * else (a scan by some other column, or no WHERE at all) could return or mutate
 * another tenant's rows, and must be justified with an inline
 * `tenant-scope-exempt: <reason>` comment.
 *
 *   node scripts/check-tenant-scoping.mjs      (also: npm run check:tenancy)
 *
 * Exits 1 on any unscoped, unexempted access — wire it into CI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const EXEMPT = "tenant-scope-exempt";

// ---- 1. Derive workspace-scoped tables from the Drizzle schema ----
const schemaSrc = fs.readFileSync(path.join(root, "lib/db/schema.ts"), "utf8");
const tenantTables = new Set();
for (const chunk of schemaSrc.split(/\bexport const /).slice(1)) {
  const m = chunk.match(/^(\w+)\s*=\s*pgTable\(/);
  if (m && /\bworkspace_id\b/.test(chunk)) tenantTables.add(m[1]);
}

// ---- 2. Gather server source files ----
const files = [];
for (const dir of ["lib", "app"]) walk(path.join(root, dir));
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      files.push(p);
    }
  }
}

// ---- 3. Scan: anchor on the table-targeting call (.from/.update/.delete),
//         robust to `db\n  .select()` line breaks; examine only the WHERE. ----
const rel = (f) => path.relative(root, f).replace(/\\/g, "/");
const violations = [];
const exempted = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const anchorRe = /\.(?:from|update|delete)\(\s*(\w+)/g;
  let m;
  while ((m = anchorRe.exec(src))) {
    const table = m[1];
    if (!tenantTables.has(table)) continue;
    const anchor = m.index;
    const semi = src.indexOf(";", anchor);
    const tail = src.slice(anchor, semi === -1 ? src.length : semi).slice(0, 1600);
    if (isScoped(tail, table)) continue;

    const line = src.slice(0, anchor).split("\n").length;
    // Look back a few lines so a leading `tenant-scope-exempt` comment is seen.
    const context = src.slice(Math.max(0, anchor - 400), anchor) + tail;
    if (context.includes(EXEMPT)) exempted.push({ where: `${rel(file)}:${line}`, table });
    else violations.push({ where: `${rel(file)}:${line}`, table, snippet: firstLine(tail) });
  }
}

/** Safe if the WHERE clause filters by `<table>.workspace_id` or `<table>.id`. */
function isScoped(tail, table) {
  const w = whereClause(tail);
  if (!w) return false; // no WHERE on a tenant table = full-table access
  return (
    new RegExp(`\\b${table}\\.workspace_id\\b`).test(w) ||
    new RegExp(`\\b${table}\\.id\\b`).test(w)
  );
}

/** Balanced text inside the first `.where( ... )` of a statement tail. */
function whereClause(tail) {
  const i = tail.indexOf(".where(");
  if (i === -1) return null;
  const open = tail.indexOf("(", i);
  let depth = 0;
  for (let k = open; k < tail.length; k++) {
    if (tail[k] === "(") depth++;
    else if (tail[k] === ")" && --depth === 0) return tail.slice(open + 1, k);
  }
  return tail.slice(open + 1);
}

function firstLine(s) {
  return s.replace(/\s+/g, " ").trim().slice(0, 96);
}

// ---- 4. Report ----
console.log(`\nTenant-scoping guard — ${tenantTables.size} workspace-scoped tables:`);
console.log("  " + [...tenantTables].sort().join(", ") + "\n");

if (exempted.length) {
  console.log(`Intentional cross-workspace access (${EXEMPT}), ${exempted.length}:`);
  for (const e of exempted) console.log(`  · ${e.where}  [${e.table}]`);
  console.log("");
}

if (violations.length) {
  console.log(`✗ ${violations.length} unscoped tenant-table access(es):\n`);
  for (const v of violations) console.log(`  ✗ ${v.where}  [${v.table}]\n      ${v.snippet}`);
  console.log(
    `\nEach must filter by ${"`workspace_id`"} or ${"`id`"} — or, if intentionally` +
      `\ncross-workspace, carry an inline "${EXEMPT}: <reason>" comment.\n`,
  );
  process.exit(1);
}
console.log("✓ every workspace-scoped query is tenant-filtered (or explicitly exempt).\n");
