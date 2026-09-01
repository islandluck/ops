import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseClientEnv } from "@/lib/config";
import { MEMBER_NEVER_KEYS } from "@/lib/access/pages";

const PROTECTED_PREFIXES = [
  "/admin",
  "/today",
  "/approvals",
  "/dashboard",
  "/agents",
  "/social",
  "/documents",
  "/activity",
  "/integrations",
  "/brief",
  "/settings",
  "/billing",
  "/onboarding",
  "/team",
  "/portal",
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
  const isOnboarding = path.startsWith("/onboarding");
  // Onboarding state lives in the Supabase user's metadata so it's readable here
  // (getUser() returns fresh metadata) without a per-request DB round-trip.
  const meta = user?.user_metadata as
    | { onboarded?: boolean; pending_invite?: boolean; member?: boolean }
    | undefined;
  const onboarded = Boolean(meta?.onboarded);
  const pendingInvite = Boolean(meta?.pending_invite);
  const isMember = Boolean(meta?.member);

  // Not signed in → gate protected routes.
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // A pending invitee must accept before they can go anywhere else.
  if (user && pendingInvite && !path.startsWith("/invite") && !isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/invite/accept";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Operator Lite: a team member can never reach the owner-only surfaces
  // (Executive, Business brief, Activity log, Billing) — they hold the owner's
  // private plane. Fast static gate from the session metadata (no DB round-trip);
  // the authoritative check is a server guard on each of those routes.
  if (user && isMember && MEMBER_NEVER_KEYS.some((k) => path === k || path.startsWith(k + "/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Signed in but hasn't finished guided setup → send to onboarding.
  if (user && !onboarded && isProtected && !isOnboarding) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Signed in on an auth page, or an onboarded user revisiting onboarding → home.
  if (user && (isAuthPage || (onboarded && isOnboarding))) {
    const url = request.nextUrl.clone();
    url.pathname = onboarded ? "/today" : "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
