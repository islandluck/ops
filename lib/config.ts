/**
 * Runtime configuration. The app runs in two modes:
 *
 *  - "demo"   — no Supabase env set. Data lives in localStorage (the prototype
 *               experience). Lets anyone open the app and try it instantly.
 *  - "server" — Supabase env set. Real auth + Postgres persistence.
 *
 * NEXT_PUBLIC_* vars are inlined at build time and are safe to read on the client.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when Supabase client env is present (safe to evaluate on the client). */
export const hasSupabaseClientEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Server-side check: full backend (auth + database) is configured. */
export function isBackendConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && process.env.DATABASE_URL);
}

/** Server-side check: real AI drafting (Anthropic) is configured. */
export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
