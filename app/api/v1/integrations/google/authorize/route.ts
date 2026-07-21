import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthorizationUrl, createGoogleOauthAttempt, getEffectiveGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

const OAUTH_NONCE_COOKIE = "fci_google_oauth_nonce";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = await getEffectiveGoogleRuntimeConfig();
  if (config.simulation) {
    return NextResponse.json({ error: "Local Workspace simulation does not connect to a Google account." }, { status: 409 });
  }
  if (!config.connectReady) {
    return NextResponse.json({ error: "Google Drive setup is incomplete.", missing: config.missing }, { status: 409 });
  }

  // Resource IDs are intentionally allowed to remain absent until after the
  // company account connects. The core URL builder still protects its legacy
  // callers with oauthReady, so only this connect-ready flow receives the
  // narrowly derived start configuration.
  const oauthStartConfig = Object.freeze({ ...config, oauthReady: config.connectReady });
  const browserNonce = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const attempt = await createGoogleOauthAttempt(oauthStartConfig, auth.user.email, browserNonce);
  await writeGoogleIntegrationEvent(oauthStartConfig, "oauth.authorization_started", auth.user.email, "connection", config.connectionKey, "mode=workspace");
  const response = NextResponse.json({ authorizationUrl: buildGoogleAuthorizationUrl(oauthStartConfig, attempt.state, attempt.codeChallenge) });
  response.cookies.set({
    name: OAUTH_NONCE_COOKIE,
    value: browserNonce,
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/v1/integrations/google/callback",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
