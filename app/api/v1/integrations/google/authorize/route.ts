import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthorizationUrl, createGoogleOauthAttempt, getGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

const OAUTH_NONCE_COOKIE = "fci_google_oauth_nonce";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  if (config.simulation) {
    return NextResponse.json({ error: "Local Workspace simulation does not connect to a Google account." }, { status: 409 });
  }
  if (!config.oauthReady) {
    return NextResponse.json({ error: "Google Drive setup is incomplete.", missing: config.missing }, { status: 409 });
  }

  const browserNonce = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const attempt = await createGoogleOauthAttempt(config, auth.user.email, browserNonce);
  await writeGoogleIntegrationEvent(config, "oauth.authorization_started", auth.user.email, "connection", config.connectionKey, "mode=workspace");
  const response = NextResponse.json({ authorizationUrl: buildGoogleAuthorizationUrl(config, attempt.state, attempt.codeChallenge) });
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
