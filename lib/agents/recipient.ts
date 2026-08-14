import "server-only";

import { getValidAccessToken } from "@/lib/integrations/tokens";
import { hsSearchContactsByName } from "@/lib/integrations/hubspot";
import { getMessageDetail, getMessageMeta, listInboxMessages } from "@/lib/integrations/google";
import type { RecipientCandidate, RecipientSource } from "@/lib/types";

/**
 * Resolve who an outbound email should go to, for the Email Manager's AI composer.
 * Layered + auto: an explicit address in the ask wins; else the CRM address book
 * (HubSpot) by name; else the founder's own Gmail history ("you've emailed them
 * before"). Returns ALL candidates found (so the UI offers a picker when a name
 * matches more than one contact) plus a chosen primary. The source is surfaced so
 * the user can confirm before sending.
 */

export interface ResolvedRecipient {
  email: string;
  source: RecipientSource;
  /** A short "who this is" note (company/role) to enrich the draft, when known. */
  context?: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function firstEmailIn(s: string): string {
  return s.match(EMAIL_RE)?.[0] ?? "";
}

/** Find an address from the founder's Gmail history: first as a sender (they
 *  emailed you), then as a recipient (you emailed them). Best-effort. */
async function resolveViaGmail(workspaceId: string, name: string): Promise<string> {
  const token = await getValidAccessToken(workspaceId, "Gmail");
  if (!token) return "";
  const quoted = `"${name.replace(/"/g, "")}"`;
  try {
    // They emailed you → the From header is exactly their address.
    const fromHits = await listInboxMessages(token, { query: `from:${quoted}`, max: 3 });
    if (fromHits.length) {
      const meta = await getMessageMeta(token, fromHits[0].id);
      if (meta.from.email && EMAIL_RE.test(meta.from.email)) return meta.from.email;
    }
    // You emailed them → pull their address out of the To header.
    const toHits = await listInboxMessages(token, { query: `to:${quoted}`, max: 3 });
    if (toHits.length) {
      const detail = await getMessageDetail(token, toHits[0].id);
      const addr = firstEmailIn(detail.to);
      if (addr) return addr;
    }
  } catch {
    /* no read scope / API error → treat as not found */
  }
  return "";
}

/** Resolve to a set of candidate recipients + a chosen primary (the first). */
export async function resolveRecipientCandidates(
  workspaceId: string,
  name: string,
  explicitEmail?: string,
): Promise<{ primary: ResolvedRecipient; candidates: RecipientCandidate[] }> {
  // 1) An address stated right in the ask.
  const stated = (explicitEmail && EMAIL_RE.test(explicitEmail) && explicitEmail) || firstEmailIn(name);
  if (stated) {
    const c: RecipientCandidate = { email: stated, name: name.trim() || stated, source: "explicit" };
    return { primary: { email: stated, source: "explicit" }, candidates: [c] };
  }

  const cleanName = name.trim();
  if (!cleanName) return { primary: { email: "", source: "none" }, candidates: [] };

  const candidates: RecipientCandidate[] = [];

  // 2) The CRM address book (multiple matches possible → the user picks).
  const hsToken = await getValidAccessToken(workspaceId, "HubSpot");
  if (hsToken) {
    const contacts = await hsSearchContactsByName(hsToken, cleanName, 5);
    for (const c of contacts) {
      const ctx = [c.company && `at ${c.company}`, c.lifecycleStage].filter(Boolean).join(" ");
      candidates.push({ email: c.email, name: c.name, source: "hubspot", context: ctx || undefined });
    }
  }

  // 3) Your own Gmail history (add it if it's a new address).
  const fromGmail = await resolveViaGmail(workspaceId, cleanName);
  if (fromGmail && !candidates.some((c) => c.email.toLowerCase() === fromGmail.toLowerCase())) {
    candidates.push({ email: fromGmail, name: cleanName, source: "gmail" });
  }

  const top = candidates[0];
  const primary: ResolvedRecipient = top
    ? { email: top.email, source: top.source, context: top.context }
    : { email: "", source: "none" };
  return { primary, candidates };
}

/** The single best recipient (back-compat wrapper). */
export async function resolveRecipient(
  workspaceId: string,
  name: string,
  explicitEmail?: string,
): Promise<ResolvedRecipient> {
  const { primary } = await resolveRecipientCandidates(workspaceId, name, explicitEmail);
  return primary;
}
