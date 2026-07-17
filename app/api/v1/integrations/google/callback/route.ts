import { NextRequest, NextResponse } from "next/server";
import { GoogleDriveClient } from "../../../../../lib/google-drive";
import { assertExpectedGoogleAccount, assertGrantedGoogleServiceScopes, consumeGoogleOauthAttempt, exchangeGoogleAuthorizationCode, fetchGoogleUserProfile, getGoogleRuntimeConfig, saveGoogleConnection, writeGoogleIntegrationEvent } from "../../../../../lib/google-oauth";
import { requireOfficeUser } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

const OAUTH_NONCE_COOKIE = "fci_google_oauth_nonce";

function appRedirect(request: NextRequest, result: string) {
  return NextResponse.redirect(new URL(`/settings?section=google-workspace&google=${encodeURIComponent(result)}`, request.url), 302);
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return appRedirect(request, "admin-required");
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  if (config.simulation) return appRedirect(request, "simulation-ready");
  if (!config.oauthReady) return appRedirect(request, "setup-needed");

  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    await writeGoogleIntegrationEvent(config, "oauth.authorization_denied", auth.user.email, "connection", config.connectionKey, `provider=${providerError}`);
    return appRedirect(request, "authorization-cancelled");
  }
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const browserNonce = request.cookies.get(OAUTH_NONCE_COOKIE)?.value;
  if (!code || !state || !browserNonce) return appRedirect(request, "authorization-expired");

  try {
    const verifier = await consumeGoogleOauthAttempt(config, state, browserNonce, auth.user.email);
    const tokens = await exchangeGoogleAuthorizationCode(config, code, verifier);
    assertGrantedGoogleServiceScopes(config, tokens.scope);
    const profile = await fetchGoogleUserProfile(tokens.accessToken);
    assertExpectedGoogleAccount(config, profile);
    const drive = new GoogleDriveClient(tokens.accessToken, config);
    await drive.verifyRootFolder();
    await saveGoogleConnection(config, tokens, profile, auth.user.email);
    await writeGoogleIntegrationEvent(config, "oauth.connected", auth.user.email, "connection", config.connectionKey, "mode=workspace");
    const response = appRedirect(request, "connected");
    response.cookies.set({ name: OAUTH_NONCE_COOKIE, value: "", httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", maxAge: 0, path: "/api/v1/integrations/google/callback" });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: string }).code) : "connection_failed";
    await writeGoogleIntegrationEvent(config, "oauth.connection_failed", auth.user.email, "connection", config.connectionKey, code);
    return appRedirect(request, "connection-failed");
  }
}
