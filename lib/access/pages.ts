/**
 * The page-access model for "Operator Lite" — team members get the same app shell as
 * the owner, but only the pages the owner grants them. This registry is the single
 * source of truth for which pages exist, which are on by default for a member, which
 * the owner can optionally grant, and which are owner-only. Client-safe (no server imports).
 */

export type MemberAccess = "default" | "grantable" | "never" | "member-only";

export interface PageDef {
  /** Stable key = the route path (also used as the permission key). */
  key: string;
  label: string;
  group: string;
  /** default = on for members out of the box (owner-toggleable); grantable = off until
   *  the owner grants (owner-toggleable); never = owner-only; member-only = always on
   *  for members + hidden from the owner (their Team Assistant, no owner equivalent). */
  member: MemberAccess;
}

export const PAGES: PageDef[] = [
  // Command
  { key: "/today", label: "Today", group: "Command", member: "default" },
  { key: "/approvals", label: "Approval Center", group: "Command", member: "default" },
  { key: "/executive", label: "Executive", group: "Command", member: "never" },
  { key: "/assistant", label: "Assistant", group: "Command", member: "member-only" },
  { key: "/boardroom", label: "Boardroom", group: "Command", member: "grantable" },
  { key: "/team", label: "Team", group: "Command", member: "default" },
  { key: "/command-center", label: "Command Center", group: "Command", member: "default" },
  { key: "/email", label: "Email Manager", group: "Command", member: "default" },
  { key: "/notes", label: "Notes", group: "Command", member: "default" },
  // Create
  { key: "/projects", label: "Projects", group: "Create", member: "default" },
  { key: "/marketing", label: "Marketing", group: "Create", member: "grantable" },
  { key: "/content", label: "Content", group: "Create", member: "grantable" },
  { key: "/social", label: "Social", group: "Create", member: "grantable" },
  { key: "/ads", label: "Ads Manager", group: "Create", member: "grantable" },
  { key: "/pages", label: "Pages", group: "Create", member: "grantable" },
  { key: "/documents", label: "Documents", group: "Create", member: "default" },
  // Intelligence
  { key: "/dashboard", label: "Dashboard", group: "Intelligence", member: "default" },
  { key: "/talent", label: "Talent", group: "Intelligence", member: "grantable" },
  { key: "/quotes", label: "Quotes", group: "Intelligence", member: "grantable" },
  { key: "/outreach", label: "Outreach", group: "Intelligence", member: "grantable" },
  { key: "/deep-dive", label: "Deep Dive", group: "Intelligence", member: "grantable" },
  { key: "/opportunities", label: "Opportunities", group: "Intelligence", member: "grantable" },
  // Setup
  { key: "/agents", label: "Agents", group: "Setup", member: "default" },
  { key: "/integrations", label: "Integrations", group: "Setup", member: "default" },
  { key: "/brief", label: "Business brief", group: "Setup", member: "never" },
  { key: "/activity", label: "Activity log", group: "Setup", member: "never" },
  { key: "/settings", label: "Settings", group: "Setup", member: "default" },
  { key: "/billing", label: "Billing", group: "Setup", member: "never" },
];

const BY_KEY = new Map(PAGES.map((p) => [p.key, p]));

/** Pages a member gets with no explicit grants set (the owner-toggleable defaults). */
export const MEMBER_DEFAULT_KEYS: string[] = PAGES.filter((p) => p.member === "default").map((p) => p.key);

/** Pages the owner can toggle for a member (defaults start on, grantables start off). */
export const MEMBER_TOGGLEABLE = PAGES.filter((p) => p.member === "default" || p.member === "grantable");

/** Owner-only page keys a member can never reach, whatever the grants say. */
export const MEMBER_NEVER_KEYS: string[] = PAGES.filter((p) => p.member === "never").map((p) => p.key);
const MEMBER_NEVER = new Set(MEMBER_NEVER_KEYS);

/** Member-only page keys — always on for members, never shown to the owner. */
export const MEMBER_ONLY_KEYS: string[] = PAGES.filter((p) => p.member === "member-only").map((p) => p.key);

/**
 * Resolve a member's allowed page keys from their stored grants. An empty/undefined
 * grant list falls back to the defaults; "never" pages are always excluded and
 * "member-only" pages are always included.
 */
export function resolveMemberPages(access: string[] | null | undefined): Set<string> {
  const chosen = access && access.length ? access : MEMBER_DEFAULT_KEYS;
  const set = new Set(chosen.filter((k) => BY_KEY.has(k) && !MEMBER_NEVER.has(k)));
  for (const k of MEMBER_ONLY_KEYS) set.add(k);
  return set;
}

/** Does a member with these grants have access to this path? (prefix-aware). */
export function memberCanAccess(pathname: string, allowed: Set<string>): boolean {
  // Match the most specific page key that prefixes the path.
  let best: string | null = null;
  for (const p of PAGES) {
    if (pathname === p.key || pathname.startsWith(p.key + "/")) {
      if (!best || p.key.length > best.length) best = p.key;
    }
  }
  if (!best) return true; // unknown/util routes (e.g. /invite) aren't gated here
  if (MEMBER_NEVER.has(best)) return false;
  return allowed.has(best);
}
