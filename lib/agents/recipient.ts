import "server-only";

import { getValidAccessToken } from "@/lib/integrations/tokens";
import { hsSearchContactByName } from "@/lib/integrations/hubspot";
import { getMessageDetail, getMessageMeta, listInboxMessages } from "@/lib/integrations/google";

/**
 * Resolve who an outbound email should go to, for the Email Manager's AI composer.
 * Layered + auto: an explicit address in the ask wins; else the CRM address book
 * (HubSpot) by name; else the founder's own Gmail history ("you've emailed them
 * before"); else nothing — the user fills it in. The source is returned so the UI
 * can show where the address came from and the user can confirm before sending.
 */

export type RecipientSource = "explicit" | "hubspot" | "gmail" | "manual" | "none";

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

export async function resolveRecipient(
  workspaceId: string,
  name: string,
  explicitEmail?: string,
): Promise<ResolvedRecipient> {
  // 1) An address stated right in the ask.
  const stated = (explicitEmail && EMAIL_RE.test(explicitEmail) && explicitEmail) || firstEmailIn(name);
  if (stated) return { email: stated, source: "explicit" };

  const cleanName = name.trim();
  if (!cleanName) return { email: "", source: "none" };

  // 2) The CRM address book.
  const hsToken = await getValidAccessToken(workspaceId, "HubSpot");
  if (hsToken) {
    const contact = await hsSearchContactByName(hsToken, cleanName);
    if (contact?.email) {
      const ctx = [contact.name, contact.company && `at ${contact.company}`, contact.lifecycleStage]
        .filter(Boolean)
        .join(" ");
      return { email: contact.email, source: "hubspot", context: ctx };
    }
  }

  // 3) Your own Gmail history.
  const fromGmail = await resolveViaGmail(workspaceId, cleanName);
  if (fromGmail) return { email: fromGmail, source: "gmail" };

  // 4) Unknown — the user will add it.
  return { email: "", source: "none" };
}
