/**
 * Autopilot posting-slot math. Pure + dependency-free (no db, no "server-only")
 * so it's unit-testable in isolation. Computes when the next auto-scheduled posts
 * should go out: future instants at preferred local hours, spread across days,
 * skipping times that are already taken.
 */

/** Preferred local posting hour(s), 24h. One entry ⇒ ~one post/day (safe default). */
export const POSTING_HOURS = [10];
/** Never schedule sooner than this — leaves a window to cancel before it posts. */
export const LEAD_MS = 2 * 60 * 60 * 1000;
/** Two times within this window count as the same slot (don't stack posts). */
export const SLOT_DEDUPE_MS = 45 * 60 * 1000;

/** Minutes that `tz`'s local wall-clock is ahead of UTC at instant `at`. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return 0; // unknown timezone → treat as UTC
  }
}

/**
 * The next `count` publish slots as absolute instants: preferred local hours in
 * `tz`, at least `LEAD_MS` out, one per slot across upcoming days, skipping any
 * already-`occupied` time (ms epoch). Deterministic given `now`.
 */
export function nextPublishSlots(
  count: number,
  tz: string | null | undefined,
  occupied: number[],
  now: Date,
): Date[] {
  if (count <= 0) return [];
  const offMin = tzOffsetMinutes(tz || "UTC", now);
  const taken = [...occupied];
  const slots: Date[] = [];
  // Local wall-clock "now" as a UTC-based Date, so we can walk the local calendar.
  const localNow = new Date(now.getTime() + offMin * 60000);

  for (let day = 0; day < 90 && slots.length < count; day++) {
    for (const h of POSTING_HOURS) {
      if (slots.length >= count) break;
      const localWall = Date.UTC(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate() + day,
        h,
        0,
        0,
      );
      const utcMs = localWall - offMin * 60000; // local wall-clock → true UTC instant
      if (utcMs < now.getTime() + LEAD_MS) continue;
      if (taken.some((t) => Math.abs(t - utcMs) < SLOT_DEDUPE_MS)) continue;
      slots.push(new Date(utcMs));
      taken.push(utcMs);
    }
  }
  return slots;
}
