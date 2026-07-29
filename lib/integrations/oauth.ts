import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { ProviderDef } from "./registry";

/**
 * OAuth 2.0 authorization-code + refresh flows. Covers the standard form-body
 * variant (Google, HubSpot), Basic-auth + JSON (Notion), and Basic-auth + PKCE
 * (X/Twitter).
 */

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a PKCE verifier + its S256 challenge (X/Twitter). */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

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
  codeChallenge?: string,
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
  if (provider.pkce && codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
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
  codeVerifier?: string,
): Promise<OAuthTokens> {
  const clientId = process.env[provider.clientIdEnv ?? ""] ?? "";
  const clientSecret = process.env[provider.clientSecretEnv ?? ""] ?? "";
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

  let res: Response;
  if (provider.basicAuth && provider.jsonTokenBody) {
    // Notion: Basic auth + JSON body.
    res = await fetch(provider.tokenUrl ?? "", {
      method: "POST",
      headers: { Authorization: basic, "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
  } else if (provider.basicAuth) {
    // X/Twitter: Basic auth + form body, with the PKCE verifier.
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    if (provider.pkce) body.set("code_verifier", codeVerifier ?? "");
    res = await fetch(provider.tokenUrl ?? "", {
      method: "POST",
      headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } else {
    // Standard OAuth 2.0: form-encoded body carrying the client credentials.
    res = await fetch(provider.tokenUrl ?? "", {
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
  }

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
): Promise<{ access: string; refresh?: string; expiresAt?: Date } | null> {
  const clientId = process.env[provider.clientIdEnv ?? ""] ?? "";
  const clientSecret = process.env[provider.clientSecretEnv ?? ""] ?? "";
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider.basicAuth) {
    // X: client credentials go in the Basic auth header, not the body.
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }
  const res = await fetch(provider.tokenUrl ?? "", { method: "POST", headers, body });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  return {
    access: String(json.access_token),
    // X rotates the refresh token on every refresh — persist the new one.
    refresh: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000) : undefined,
  };
}
