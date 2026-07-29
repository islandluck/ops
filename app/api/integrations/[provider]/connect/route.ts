import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isProviderConfigured, providerByKey } from "@/lib/integrations/registry";
import { buildAuthorizeUrl, createPkcePair } from "@/lib/integrations/oauth";
import { encryptSecret, hasEncryptionKey } from "@/lib/crypto";

/** Start the OAuth flow: redirect the user to the provider's consent screen. */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await ctx.params;
  const origin = new URL(request.url).origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/integrations${q}`);

  const provider = providerByKey(providerKey);
  if (!provider || provider.auth !== "oauth") return back("?error=unknown_provider");
  if (!isProviderConfigured(provider)) {
    return back(`?error=not_configured&provider=${providerKey}`);
  }
  if (!hasEncryptionKey()) return back("?error=no_encryption_key");

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // PKCE (X): the verifier rides along inside the encrypted state, so the
  // callback can complete the exchange without server-side session storage.
  const pkce = provider.pkce ? createPkcePair() : null;
  const state = encryptSecret(
    JSON.stringify({ u: user.id, p: providerKey, t: Date.now(), ...(pkce ? { v: pkce.verifier } : {}) }),
  );
  const redirectUri = `${origin}/api/integrations/${providerKey}/callback`;
  return NextResponse.redirect(buildAuthorizeUrl(provider, redirectUri, state, pkce?.challenge));
}
