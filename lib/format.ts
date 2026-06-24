/** Lightweight date / text formatting helpers (no external deps). */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "2h ago", "3 days ago", "just now". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = now - t;
  const past = diff >= 0;
  const abs = Math.abs(diff);

  if (abs < MIN) return past ? "just now" : "in a moment";
  if (abs < HOUR) {
    const m = Math.round(abs / MIN);
    return past ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return past ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / DAY);
  if (d < 30) return past ? `${d}d ago` : `in ${d}d`;
  const mo = Math.round(d / 30);
  return past ? `${mo}mo ago` : `in ${mo}mo`;
}

/** Due-date language with urgency colour. */
export function dueLabel(
  iso: string | null,
  now: number = Date.now(),
): { text: string; tone: "muted" | "soon" | "overdue" | "none" } {
  if (!iso) return { text: "No due date", tone: "none" };
  const t = new Date(iso).getTime();
  const diff = t - now;
  if (diff < 0) {
    const d = Math.max(1, Math.round(-diff / DAY));
    const h = Math.round(-diff / HOUR);
    return {
      text: h < 24 ? `Overdue ${h}h` : `Overdue ${d}d`,
      tone: "overdue",
    };
  }
  if (diff < 12 * HOUR) {
    const h = Math.max(1, Math.round(diff / HOUR));
    return { text: `Due in ${h}h`, tone: "soon" };
  }
  if (diff < 2 * DAY) {
    const h = Math.round(diff / HOUR);
    return { text: h < 36 ? "Due tomorrow" : "Due in 2d", tone: "soon" };
  }
  const d = Math.round(diff / DAY);
  return { text: `Due in ${d}d`, tone: "muted" };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : plural ?? `${singular}s`;
}

/**
 * UUID generator for client-side mutations. Real UUIDs so records persist
 * cleanly to Postgres in server mode. Falls back to an RFC4122-v4 string if
 * crypto.randomUUID is unavailable. (The `prefix` arg is ignored, kept for
 * call-site compatibility.)
 */
export function makeId(_prefix?: string): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
