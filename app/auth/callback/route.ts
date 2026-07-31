import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseClientEnv } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Only allow app-relative redirect targets — never an open redirect. */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/onboarding";
  return next;
}

/**
 * Landing route for Supabase email links — signup confirmation, magic link, and
 * password recovery. Exchanges the PKCE `code` (or verifies a `token_hash` OTP),
 * writes the session cookie onto the redirect response, and forwards into the
 * app. Uses the request's own origin, so it works on any deployment URL.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  const dest = url.clone();
  dest.pathname = next;
  dest.search = "";

  if (!hasSupabaseClientEnv) return NextResponse.redirect(dest);

  const response = NextResponse.redirect(dest);
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  let errorMsg: string | null = null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    errorMsg = error?.message ?? null;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    errorMsg = error?.message ?? null;
  } else {
    errorMsg = "This link is missing its verification code.";
  }

  if (errorMsg) {
    const fail = url.clone();
    fail.pathname = "/login";
    fail.search = "";
    fail.searchParams.set("error", errorMsg);
    return NextResponse.redirect(fail);
  }
  return response;
}
