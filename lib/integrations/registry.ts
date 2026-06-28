/**
 * Provider registry — maps the workspace's integration rows (by display name)
 * to a real OAuth / API provider, its endpoints, scopes, and the env vars that
 * configure it. Importable anywhere; `isProviderConfigured` is only meaningful
 * server-side (env vars are server-only), so a `configured` flag is computed at
 * bundle-load time and passed to the client for display.
 */

export type ProviderKey = "google" | "hubspot" | "stripe";

export interface ProviderDef {
  key: ProviderKey;
  label: string;
  /** Integration display names (rows) this provider powers. */
  integrationNames: string[];
  auth: "oauth" | "api_key";
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  clientIdEnv?: string;
  clientSecretEnv?: string;
  apiKeyEnv?: string;
  /** What approving a task does, in plain English (shown in the UI). */
  actionLabel: string;
}

export const PROVIDERS: Record<ProviderKey, ProviderDef> = {
  google: {
    key: "google",
    label: "Google",
    integrationNames: ["Gmail", "Google Calendar"],
    auth: "oauth",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.events",
      "openid",
      "email",
    ],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    actionLabel: "Send approved emails & create calendar events",
  },
  hubspot: {
    key: "hubspot",
    label: "HubSpot",
    integrationNames: ["HubSpot"],
    auth: "oauth",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "oauth"],
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
    actionLabel: "Create / update CRM contacts and log activity",
  },
  stripe: {
    key: "stripe",
    label: "Stripe",
    integrationNames: ["Stripe"],
    auth: "api_key",
    apiKeyEnv: "STRIPE_SECRET_KEY",
    actionLabel: "Create draft invoices (test mode)",
  },
};

export function providerForIntegrationName(name: string): ProviderDef | null {
  for (const p of Object.values(PROVIDERS)) {
    if (p.integrationNames.includes(name)) return p;
  }
  return null;
}

export function providerByKey(key: string): ProviderDef | null {
  return (PROVIDERS as Record<string, ProviderDef>)[key] ?? null;
}

/** Server-side: are this provider's credentials present in the environment? */
export function isProviderConfigured(p: ProviderDef): boolean {
  if (p.auth === "api_key") return Boolean(process.env[p.apiKeyEnv ?? ""]);
  return Boolean(process.env[p.clientIdEnv ?? ""] && process.env[p.clientSecretEnv ?? ""]);
}
