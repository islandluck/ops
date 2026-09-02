import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessBriefs, emailSettings } from "@/lib/db/schema";
import type { EmailCadence, EmailSettings } from "@/lib/types";

/**
 * Email personalization resolved per plane: the OWNER's settings live on the
 * business brief; a team member's live on their own `email_settings` row. Used by
 * the inbox (drafted replies), the outbound composer, and the auto-triage cron so a
 * member's mail is always in their OWN voice — never the owner's.
 */

const CADENCES: EmailCadence[] = ["off", "hourly", "daily"];
function normCadence(c: string | null | undefined): EmailCadence {
  return (CADENCES as string[]).includes(c ?? "") ? (c as EmailCadence) : "off";
}

/** Signature + reply style + cadence for a plane (owner = brief, member = own row). */
export async function getEmailSettingsFor(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<EmailSettings> {
  if (scopeUserId) {
    const [s] = await db
      .select()
      .from(emailSettings)
      .where(and(eq(emailSettings.workspace_id, workspaceId), eq(emailSettings.member_user_id, scopeUserId)))
      .limit(1);
    return { signature: s?.signature ?? "", reply_style: s?.reply_style ?? "", cadence: normCadence(s?.cadence) };
  }
  const [b] = await db
    .select({
      signature: businessBriefs.email_signature,
      reply_style: businessBriefs.email_reply_style,
      cadence: businessBriefs.email_triage_cadence,
    })
    .from(businessBriefs)
    .where(eq(businessBriefs.workspace_id, workspaceId))
    .limit(1);
  return { signature: b?.signature ?? "", reply_style: b?.reply_style ?? "", cadence: normCadence(b?.cadence) };
}

/** Persist settings for a plane (owner → brief; member → upsert their own row). */
export async function saveEmailSettingsFor(
  workspaceId: string,
  settings: EmailSettings,
  scopeUserId: string | null = null,
): Promise<void> {
  const cadence = normCadence(settings.cadence);
  const signature = settings.signature.slice(0, 2000);
  const reply_style = settings.reply_style.slice(0, 2000);
  if (scopeUserId) {
    const [ex] = await db
      .select({ id: emailSettings.id })
      .from(emailSettings)
      .where(and(eq(emailSettings.workspace_id, workspaceId), eq(emailSettings.member_user_id, scopeUserId)))
      .limit(1);
    if (ex) {
      await db
        .update(emailSettings)
        .set({ signature, reply_style, cadence, updated_at: new Date() })
        .where(eq(emailSettings.id, ex.id));
    } else {
      await db
        .insert(emailSettings)
        .values({ workspace_id: workspaceId, member_user_id: scopeUserId, signature, reply_style, cadence });
    }
    return;
  }
  await db
    .update(businessBriefs)
    .set({ email_signature: signature, email_reply_style: reply_style, email_triage_cadence: cadence, updated_at: new Date() })
    .where(eq(businessBriefs.workspace_id, workspaceId));
}

/** Just the drafting persona (signature + reply style) for a plane. */
export async function getEmailPersona(
  workspaceId: string,
  scopeUserId: string | null = null,
): Promise<{ signature: string; replyStyle: string }> {
  const s = await getEmailSettingsFor(workspaceId, scopeUserId);
  return { signature: s.signature.trim(), replyStyle: s.reply_style };
}
