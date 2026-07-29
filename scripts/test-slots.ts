// Unit test for the autopilot slot allocator (pure, no DB). Run: npx tsx scripts/test-slots.ts
import { nextPublishSlots } from "../lib/agents/slots";

function localHour(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit" })
    .formatToParts(d)
    .find((x) => x.type === "hour");
  return Number(p?.value ?? "0") % 24;
}

const now = new Date("2026-07-15T14:00:00Z"); // fixed instant (July → EDT, UTC-4)
const tz = "America/New_York";
const lead = now.getTime() + 2 * 60 * 60 * 1000;

const slots = nextPublishSlots(3, tz, [], now);
console.log("3 slots for", tz, "from", now.toISOString());
for (const s of slots) console.log("  ", s.toISOString(), "→ local hour", localHour(s, tz));

const ok1 = slots.length === 3;
const ok2 = slots.every((s) => s.getTime() >= lead); // all past the lead window
const ok3 = slots.every((s) => localHour(s, tz) === 10); // preferred hour honoured in tz
const ok4 = slots.every((s, i) => i === 0 || s.getTime() - slots[i - 1].getTime() >= 20 * 3600 * 1000); // ~1/day
const occ = [slots[0].getTime()];
const slots2 = nextPublishSlots(3, tz, occ, now);
const ok5 = !slots2.some((s) => Math.abs(s.getTime() - occ[0]) < 60_000); // occupied slot skipped
const ok6 = nextPublishSlots(0, tz, [], now).length === 0;
const su = nextPublishSlots(1, undefined, [], now);
const ok7 = localHour(su[0], "UTC") === 10; // undefined tz → UTC

const results = { ok1, ok2, ok3, ok4, ok5, ok6, ok7 };
console.log(results);
const pass = Object.values(results).every(Boolean);
console.log(pass ? "\nPASS ✓ slot allocator correct" : "\nFAIL ✗");
process.exit(pass ? 0 : 1);
