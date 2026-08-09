import { NextRequest, NextResponse } from "next/server";
import { GoogleDriveClient } from "../../../../../lib/google-drive";
import { assertExpectedGoogleAccount, assertGrantedGoogleServiceScopes, consumeGoogleOauthAttempt, exchangeGoogleAuthorizationCode, fetchGoogleUserProfile, getEffectiveGoogleRuntimeConfig, resolveGoogleMailboxConnectionConfig, saveGoogleConnection, writeGoogleOauthAttemptEvent } from "../../../../../lib/google-oauth-sites";
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
  const config = await getEffectiveGoogleRuntimeConfig();
  if (config.simulation) return appRedirect(request, "simulation-ready");
  if (!config.connectReady) return appRedirect(request, "setup-needed");

  const state = request.nextUrl.searchParams.get("state");
  const browserNonce = request.cookies.get(OAUTH_NONCE_COOKIE)?.value;
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    if (state && browserNonce) {
      try {
        const deniedConsent = await consumeGoogleOauthAttempt(
          config,
          state,
          browserNonce,
          auth.user.email,
        );
        await writeGoogleOauthAttemptEvent(
          config,
          deniedConsent.attemptId,
          "consumed",
          "oauth.authorization_denied",
          auth.user.email,
          "connection",
          config.connectionKey,
          `provider=${providerError}`,
        );
      } catch {
        // An invalid, expired, or reset attempt is not allowed to recreate
        // tenant-scoped diagnostic data after reset.
      }
    }
    return appRedirect(request, "authorization-cancelled");
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !state || !browserNonce) return appRedirect(request, "authorization-expired");

  let callbackConfig = config;
  let consentAttemptId: string | null = null;
  try {
    const consent = await consumeGoogleOauthAttempt(config, state, browserNonce, auth.user.email);
    consentAttemptId = consent.attemptId;
    const tokens = await exchangeGoogleAuthorizationCode(config, code, consent.verifier);
    assertGrantedGoogleServiceScopes(config, tokens.scope);
    const profile = await fetchGoogleUserProfile(tokens.accessToken);
    assertExpectedGoogleAccount(config, profile);
    callbackConfig = await resolveGoogleMailboxConnectionConfig(config, profile);
    if (callbackConfig.drive.rootFolderId) {
      const drive = new GoogleDriveClient(tokens.accessToken, callbackConfig);
      await drive.verifyRootFolder();
    }
    await saveGoogleConnection(
      callbackConfig,
      tokens,
      profile,
      auth.user.email,
      consent.attemptId,
    );
    const response = appRedirect(request, "connected");
    response.cookies.set({ name: OAUTH_NONCE_COOKIE, value: "", httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", maxAge: 0, path: "/api/v1/integrations/google/callback" });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: string }).code) : "connection_failed";
    // A derived mailbox key is not durable until the connection save succeeds.
    // Keep pre-save failures on the stable workspace scope so operations health
    // can enumerate them and tenant reset can remove them; the candidate key is
    // retained as the event entity for diagnosis.
    const failureEventConfig = Object.freeze({
      ...config,
      connectionKey: config.workspaceConnectionKey,
    });
    if (consentAttemptId) {
      await writeGoogleOauthAttemptEvent(
        failureEventConfig,
        consentAttemptId,
        "consumed",
        "oauth.connection_failed",
        auth.user.email,
        "connection",
        callbackConfig.authConnectionKey,
        code,
      );
    }
    return appRedirect(request, code === "google_tenant_reset_required" ? "tenant-reset-required" : "connection-failed");
  }
}
