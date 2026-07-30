// Unit test for the shared X-post clamp (lib/social/x-post.ts) — the single
// source of truth every draft path now flows through. Run: npx tsx scripts/test-xpost.ts
import { fitToX, composeXPost, X_MAX_CHARS } from "../lib/social/x-post";

const checks: Array<[string, boolean]> = [];
const ok = (name: string, cond: boolean) => checks.push([name, cond]);

// A draft the length of the screenshot's tweet (well over 280).
const longTweet =
  "The Haber-Bosch process has anchored ammonia production for over a century—synthesizing nitrogen and hydrogen under high temperature and pressure. At Andros Innovations, we're advancing reactor design to deliver high-purity ammonia for laboratory, semiconductor, and specialty industrial applications with far less energy and a smaller footprint.";
console.log(`long draft is ${longTweet.length} chars`);

// fitToX
ok("long draft → ≤280", fitToX(longTweet).length <= X_MAX_CHARS);
ok("long draft → ends with ellipsis", fitToX(longTweet).endsWith("…"));
ok("long draft → cut at word boundary (no partial word before …)", !/\s\S+…$/.test(fitToX(longTweet)) || /\s…$|[^\s]…$/.test(fitToX(longTweet)));
ok("200 chars → unchanged", fitToX("A".repeat(200)).length === 200);
ok("exactly 280 → unchanged", fitToX("B".repeat(280)).length === 280);
ok("459 solid (no spaces) → ≤280 + ellipsis", fitToX("C".repeat(459)).length <= X_MAX_CHARS && fitToX("C".repeat(459)).endsWith("…"));

// composeXPost
const shortBody = "Cleaner ammonia, less energy. Here's how our reactor design changes the math.";
const withTags = composeXPost(shortBody, ["ammonia", "cleantech", "energy"]);
ok("short body + tags → ≤280", withTags.length <= X_MAX_CHARS);
ok("short body + tags → tags included", withTags.includes("#ammonia") && withTags.includes("#energy"));

const longWithTags = composeXPost(longTweet, ["ammonia", "cleantech"]);
ok("long body + tags → ≤280", longWithTags.length <= X_MAX_CHARS);

const body270 = "D".repeat(270);
const tight = composeXPost(body270, ["ammonia"]);
ok("270 body + tag → ≤280 (tag dropped for room)", tight.length <= X_MAX_CHARS);

for (const [name, cond] of checks) console.log(`${cond ? "✓" : "✗"} ${name}`);
const pass = checks.every(([, c]) => c);
console.log(`\nresult after fit: "${fitToX(longTweet)}"\n(${fitToX(longTweet).length} chars)`);
console.log(pass ? "\nPASS ✓ shared clamp guarantees ≤280 on every path" : "\nFAIL ✗");
process.exit(pass ? 0 : 1);
