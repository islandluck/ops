import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrations } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { providerForIntegrationName, type ProviderDef } from "./registry";
import { refreshOAuthToken, type OAuthTokens } from "./oauth";
import type { PermissionMode } from "@/lib/types";

/** Store tokens on every integration row a provider powers (e.g. Gmail + Calendar). */
export async function storeProviderTokens(
  workspaceId: string,
  provider: ProviderDef,
  tokens: OAuthTokens,
  account: string | null,
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
      .where(and(eq(integrations.workspace_id, workspaceId), eq(integrations.name, name)));
  }
}

/** Mark an api-key provider (Stripe) connected without storing the key (it lives in env). */
export async function markApiKeyConnected(
  workspaceId: string,
  provider: ProviderDef,
  account: string | null,
): Promise<void> {
  for (const name of provider.integrationNames) {
    await db
      .update(integrations)
      .set({ connected: true, account })
      .where(and(eq(integrations.workspace_id, workspaceId), eq(integrations.name, name)));
  }
}

/** Clear connection + tokens for the integration (and its provider siblings). */
export async function clearIntegration(
  workspaceId: string,
  integrationId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspace_id, workspaceId), eq(integrations.id, integrationId)))
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
      .where(and(eq(integrations.workspace_id, workspaceId), eq(integrations.name, name)));
  }
}

export async function setIntegrationPermissionMode(
  workspaceId: string,
  integrationId: string,
  mode: PermissionMode,
): Promise<void> {
  await db
    .update(integrations)
    .set({ permission_mode: mode })
    .where(and(eq(integrations.workspace_id, workspaceId), eq(integrations.id, integrationId)));
}

/**
 * Get a usable access token for an integration by name, refreshing if it's
 * within 60s of expiry. Returns null if not connected.
 */
export async function getValidAccessToken(
  workspaceId: string,
  integrationName: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspace_id, workspaceId), eq(integrations.name, integrationName)))
    .limit(1);
  if (!row || !row.connected || !row.access_token) return null;

  let access = decryptSecret(row.access_token);
  const expMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  const provider = providerForIntegrationName(integrationName);

  if (expMs && expMs < Date.now() + 60_000 && row.refresh_token && provider?.auth === "oauth") {
    const refreshed = await refreshOAuthToken(provider, decryptSecret(row.refresh_token));
    if (refreshed) {
      access = refreshed.access;
      // Persist the rotated access token across all sibling rows. Some providers
      // (X) also rotate the refresh token on every refresh — store it or the next
      // refresh will fail with an invalid_grant.
      for (const name of provider.integrationNames) {
        await db
          .update(integrations)
          .set({
            access_token: encryptSecret(refreshed.access),
            token_expires_at: refreshed.expiresAt ?? null,
            ...(refreshed.refresh ? { refresh_token: encryptSecret(refreshed.refresh) } : {}),
          })
          .where(and(eq(integrations.workspace_id, workspaceId), eq(integrations.name, name)));
      }
    }
  }
  return access;
}
