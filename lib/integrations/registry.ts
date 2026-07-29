/**
 * Provider registry — maps the workspace's integration rows (by display name)
 * to a real OAuth / API provider, its endpoints, scopes, and the env vars that
 * configure it. Importable anywhere; `isProviderConfigured` is only meaningful
 * server-side (env vars are server-only), so a `configured` flag is computed at
 * bundle-load time and passed to the client for display.
 */

export type ProviderKey = "google" | "hubspot" | "stripe" | "notion";

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
  /** Google-style offline access (access_type=offline & prompt=consent) for refresh tokens. */
  offlineAccess?: boolean;
  /** Exchange the code with HTTP Basic auth + JSON body (Notion) instead of a form body. */
  basicAuth?: boolean;
  /** Extra params appended to the authorize URL (e.g. Notion's owner=user). */
  authorizeParams?: Record<string, string>;
  /** What approving a task does, in plain English (shown in the UI). */
  actionLabel: string;
}

export const PROVIDERS: Record<ProviderKey, ProviderDef> = {
  google: {
    key: "google",
    label: "Google",
    integrationNames: ["Gmail", "Google Calendar", "Google Sheets"],
    auth: "oauth",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
      "openid",
      "email",
    ],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    offlineAccess: true,
    actionLabel: "Read + triage inbox, send approved emails, calendar & Sheets",
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
  notion: {
    key: "notion",
    label: "Notion",
    integrationNames: ["Notion"],
    auth: "oauth",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    basicAuth: true,
    authorizeParams: { owner: "user" },
    actionLabel: "Create pages in your Notion workspace",
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
