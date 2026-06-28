import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { workspaceIdForUser } from "@/lib/db/queries";
import { providerByKey } from "@/lib/integrations/registry";
import { exchangeCodeForTokens } from "@/lib/integrations/oauth";
import { storeProviderTokens } from "@/lib/integrations/tokens";
import { decryptSecret } from "@/lib/crypto";
import { getGoogleEmail } from "@/lib/integrations/google";
import { getHubSpotAccount } from "@/lib/integrations/hubspot";

/** OAuth callback: verify state, exchange the code, store encrypted tokens. */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await ctx.params;
  const url = new URL(request.url);
  const origin = url.origin;
  const back = (q: string) => NextResponse.redirect(`${origin}/integrations${q}`);

  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const provider = providerByKey(providerKey);

  if (oauthError) return back(`?error=${encodeURIComponent(oauthError)}`);
  if (!provider || !code || !stateRaw) return back("?error=invalid_callback");

  let state: { u: string; p: string; t: number };
  try {
    state = JSON.parse(decryptSecret(stateRaw));
  } catch {
    return back("?error=bad_state");
  }

  const user = await getCurrentUser();
  if (
    !user ||
    state.u !== user.id ||
    state.p !== providerKey ||
    Date.now() - state.t > 600_000
  ) {
    return back("?error=state_mismatch");
  }

  const wsId = await workspaceIdForUser(user.id);
  if (!wsId) return back("?error=no_workspace");

  try {
    const redirectUri = `${origin}/api/integrations/${providerKey}/callback`;
    const tokens = await exchangeCodeForTokens(provider, code, redirectUri);
    const account =
      providerKey === "google"
        ? await getGoogleEmail(tokens.access)
        : providerKey === "hubspot"
          ? await getHubSpotAccount(tokens.access)
          : null;
    await storeProviderTokens(wsId, provider, tokens, account);
    return back(`?connected=${providerKey}`);
  } catch (e) {
    return back(`?error=${encodeURIComponent(e instanceof Error ? e.message : "connect_failed")}`);
  }
}
