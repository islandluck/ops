import "server-only";

import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

/** Supabase client for Server Components / Server Actions (cookie-based session). */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore; middleware refreshes.
        }
      },
    },
  });
}

/**
 * The current authenticated user, or null. Wrapped in React `cache()` so the
 * several callers in a single request (middleware aside — that's a separate
 * request) — the product layout, the page, and any nested server components —
 * share ONE `auth.getUser()` network round-trip instead of each paying for their
 * own. This is the biggest per-navigation win: getUser() hits the Supabase auth
 * server, and it was firing 2-3× per page load.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
