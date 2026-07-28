import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client (server-only). Bypasses RLS and can perform
 * admin auth operations (e.g. confirming a user during dev testing). NEVER
 * import this into a client component.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
