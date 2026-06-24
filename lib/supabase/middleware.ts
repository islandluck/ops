import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseClientEnv } from "@/lib/config";

const PROTECTED_PREFIXES = [
  "/approvals",
  "/dashboard",
  "/activity",
  "/integrations",
  "/brief",
  "/settings",
  "/onboarding",
];

const AUTH_PAGES = ["/login", "/signup"];

/**
 * Refreshes the Supabase session cookie and enforces route protection.
 * When the backend isn't configured (demo mode), this is a pass-through.
 */
export async function updateSession(request: NextRequest) {
  if (!hasSupabaseClientEnv) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path.startsWith(p));
  const isAuthPage = AUTH_PAGES.some((p) => path.startsWith(p));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/approvals";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
