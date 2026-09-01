import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scopeFilter } from "@/lib/access/scope";
import { providerForIntegrationName, type ProviderDef } from "./registry";
import { refreshOAuthToken, type OAuthTokens } from "./oauth";
import type { PermissionMode } from "@/lib/types";

/**
 * Operator Lite: every integration op is scoped to a plane. `scopeUserId` defaults
 * to null = the workspace owner's connections (so every existing owner call is
 * unchanged); a member's id targets that member's OWN connections (their Gmail,
 * etc.), which live in separate rows sharing the same name.
 */

/** Store tokens on every integration row a provider powers (e.g. Gmail + Calendar). */
export async function storeProviderTokens(
  workspaceId: string,
  provider: ProviderDef,
  tokens: OAuthTokens,
  account: string | null,
  scopeUserId: string | null = null,
): Promise<void> {
  for (const name of provider.integrationNames) {
    await db
      .update(integrations)
      .set({
        connected: true,
        account,
        access_token: encryptSecret(tokens.access),
        refresh_token: tokens.refresh ? encryptSecret(tokens.refresh) : null,
        token_expires_at: tokens.expiresAt ?? null,
        scope: tokens.scope ?? null,
      })
      .where(
        and(
          eq(integrations.workspace_id, workspaceId),
          eq(integrations.name, name),
          scopeFilter(integrations.member_user_id, scopeUserId),
        ),
      );
  }
}

/** Mark an api-key provider (Stripe) connected without storing the key (it lives in env). */
export async function markApiKeyConnected(
  workspaceId: string,
  provider: ProviderDef,
  account: string | null,
  scopeUserId: string | null = null,
): Promise<void> {
  for (const name of provider.integrationNames) {
    await db
      .update(integrations)
      .set({ connected: true, account })
      .where(
        and(
          eq(integrations.workspace_id, workspaceId),
          eq(integrations.name, name),
          scopeFilter(integrations.member_user_id, scopeUserId),
        ),
      );
  }
}

/** Clear connection + tokens for the integration (and its provider siblings), within one plane. */
export async function clearIntegration(
  workspaceId: string,
  integrationId: string,
  scopeUserId: string | null = null,
): Promise<void> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.workspace_id, workspaceId),
        eq(integrations.id, integrationId),
        scopeFilter(integrations.member_user_id, scopeUserId),
      ),
    )
    .limit(1);
  if (!row) return;
  const provider = providerForIntegrationName(row.name);
  const names = provider ? provider.integrationNames : [row.name];
  for (const name of names) {
    await db
      .update(integrations)
      .set({
        connected: false,
        account: null,
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        scope: null,
      })
      .where(
        and(
          eq(integrations.workspace_id, workspaceId),
          eq(integrations.name, name),
          scopeFilter(integrations.member_user_id, scopeUserId),
        ),
      );
  }
}

export async function setIntegrationPermissionMode(
  workspaceId: string,
  integrationId: string,
  mode: PermissionMode,
  scopeUserId: string | null = null,
): Promise<void> {
  await db
    .update(integrations)
    .set({ permission_mode: mode })
    .where(
      and(
        eq(integrations.workspace_id, workspaceId),
        eq(integrations.id, integrationId),
        scopeFilter(integrations.member_user_id, scopeUserId),
      ),
    );
}

/**
 * Get a usable access token for an integration by name, refreshing if it's
 * within 60s of expiry. Returns null if not connected. Scoped to a plane:
 * the owner's connection by default, or a member's own when scopeUserId is set.
 */
export async function getValidAccessToken(
  workspaceId: string,
  integrationName: string,
  scopeUserId: string | null = null,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.workspace_id, workspaceId),
        eq(integrations.name, integrationName),
        scopeFilter(integrations.member_user_id, scopeUserId),
      ),
    )
    .limit(1);
  if (!row || !row.connected || !row.access_token) return null;

  let access = decryptSecret(row.access_token);
  const expMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  const provider = providerForIntegrationName(integrationName);

  if (expMs && expMs < Date.now() + 60_000 && row.refresh_token && provider?.auth === "oauth") {
    const refreshed = await refreshOAuthToken(provider, decryptSecret(row.refresh_token));
    if (refreshed) {
      access = refreshed.access;
      // Persist the rotated access token across all sibling rows (same plane). Some
      // providers (X) also rotate the refresh token on every refresh — store it or
      // the next refresh will fail with an invalid_grant.
      for (const name of provider.integrationNames) {
        await db
          .update(integrations)
          .set({
            access_token: encryptSecret(refreshed.access),
            token_expires_at: refreshed.expiresAt ?? null,
            ...(refreshed.refresh ? { refresh_token: encryptSecret(refreshed.refresh) } : {}),
          })
          .where(
            and(
              eq(integrations.workspace_id, workspaceId),
              eq(integrations.name, name),
              scopeFilter(integrations.member_user_id, scopeUserId),
            ),
          );
      }
    }
  }
  return access;
}
