import "server-only";

import type { ProviderDef } from "./registry";

/** Standard OAuth 2.0 authorization-code + refresh flows (Google, HubSpot). */

export interface OAuthTokens {
  access: string;
  refresh?: string;
  expiresAt?: Date;
  scope?: string;
  /** Human-readable connected-account label (e.g. Notion workspace name). */
  account?: string;
}

export function buildAuthorizeUrl(
  provider: ProviderDef,
  redirectUri: string,
  state: string,
): string {
  const clientId = process.env[provider.clientIdEnv ?? ""] ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  if (provider.scopes?.length) params.set("scope", provider.scopes.join(" "));
  if (provider.offlineAccess) {
    // Google: request a refresh_token and force the consent screen.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  for (const [k, v] of Object.entries(provider.authorizeParams ?? {})) {
    params.set(k, v);
  }
  return `${provider.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  provider: ProviderDef,
  code: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const clientId = process.env[provider.clientIdEnv ?? ""] ?? "";
  const clientSecret = process.env[provider.clientSecretEnv ?? ""] ?? "";

  const res = provider.basicAuth
    ? // Notion: HTTP Basic auth + JSON body.
      await fetch(provider.tokenUrl ?? "", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      })
    : // Standard OAuth 2.0: form-encoded body carrying the client credentials.
      await fetch(provider.tokenUrl ?? "", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      String(json.error_description || json.message || json.error || "Token exchange failed"),
    );
  }
  return {
    access: String(json.access_token),
    refresh: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000) : undefined,
    scope: json.scope ? String(json.scope) : undefined,
    account: json.workspace_name ? String(json.workspace_name) : undefined,
  };
}

export async function refreshOAuthToken(
  provider: ProviderDef,
  refreshToken: string,
): Promise<{ access: string; expiresAt?: Date } | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env[provider.clientIdEnv ?? ""] ?? "",
    client_secret: process.env[provider.clientSecretEnv ?? ""] ?? "",
  });
  const res = await fetch(provider.tokenUrl ?? "", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  return {
    access: String(json.access_token),
    expiresAt: json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000) : undefined,
  };
}
