import { env } from "cloudflare:workers";
import { resolveDriveWorkspace } from "./google-workspace";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOCATION_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const ENCRYPTION_VERSION = "v1";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

type EnvironmentValues = Record<string, string | undefined>;

export type GoogleConnectionEnvironment = "test" | "production";

export type GoogleRuntimeConfig = {
  environment: GoogleConnectionEnvironment;
  environmentIsValid: boolean;
  connectionKey: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenEncryptionKey?: string;
  tokenEncryptionKeyVersion: string;
  expectedGoogleEmails: string[];
  drive: ReturnType<typeof resolveDriveWorkspace>;
  scopes: string[];
  missing: string[];
  oauthReady: boolean;
  provisioningEnabled: boolean;
  // Intentionally hard-disabled until a separate Gmail review/archival adapter exists.
  gmailFilingEnabled: boolean;
  broadScopeAcknowledged: boolean;
};

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken?: string;
  scope: string[];
};

export type GoogleUserProfile = {
  subject: string;
  email: string;
  emailVerified: boolean;
};

export class GoogleIntegrationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
  }
}

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function profileValue(input: EnvironmentValues, environment: GoogleConnectionEnvironment, name: string) {
  const profileKey = `GOOGLE_${environment === "test" ? "TEST" : "PRODUCTION"}_${name}`;
  if (input[profileKey]) return input[profileKey];
  return environment === "test" ? input[`GOOGLE_${name}`] : undefined;
}

function profileBoolean(input: EnvironmentValues, environment: GoogleConnectionEnvironment, name: string) {
  return profileValue(input, environment, name)?.trim().toLowerCase() === "true";
}

function decodeBase64Url(value: string) {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomValue(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function sha256Bytes(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function isValidEncryptionKey(value: string | undefined) {
  if (!value) return false;
  try {
    return decodeBase64Url(value).length === 32;
  } catch {
    return false;
  }
}

async function encryptionKey(value: string | undefined) {
  if (!isValidEncryptionKey(value)) {
    throw new GoogleIntegrationError("invalid_encryption_key", "Google token encryption must be a 32-byte base64url key.", 503);
  }
  return crypto.subtle.importKey("raw", decodeBase64Url(value!), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptGoogleSecret(plaintext: string, keyMaterial: string | undefined, context: string) {
  const key = await encryptionKey(keyMaterial);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENCRYPTION_VERSION}.${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptGoogleSecret(ciphertext: string, keyMaterial: string | undefined, context: string) {
  const [version, ivValue, payload] = ciphertext.split(".");
  if (version !== ENCRYPTION_VERSION || !ivValue || !payload) {
    throw new GoogleIntegrationError("invalid_ciphertext", "Stored Google authorization needs to be reconnected.", 409);
  }
  try {
    const key = await encryptionKey(keyMaterial);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(ivValue), additionalData: new TextEncoder().encode(context) },
      key,
      decodeBase64Url(payload),
    );
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    if (error instanceof GoogleIntegrationError) throw error;
    throw new GoogleIntegrationError("invalid_ciphertext", "Stored Google authorization needs to be reconnected.", 409);
  }
}

export function getGoogleRuntimeConfig(input: EnvironmentValues = process.env) {
  const requested = input.GOOGLE_CONNECTION_ENVIRONMENT?.trim().toLowerCase() ?? "test";
  const environmentIsValid = requested === "test" || requested === "production";
  const environment: GoogleConnectionEnvironment = requested === "production" ? "production" : "test";
  const mode = profileValue(input, environment, "DRIVE_MODE");
  const rootFolderId = profileValue(input, environment, "DRIVE_ROOT_FOLDER_ID");
  const sharedDriveId = profileValue(input, environment, "SHARED_DRIVE_ID");
  const drive = resolveDriveWorkspace({ mode, rootFolderId, sharedDriveId });
  const clientId = profileValue(input, environment, "CLIENT_ID");
  const clientSecret = profileValue(input, environment, "CLIENT_SECRET");
  const redirectUri = profileValue(input, environment, "OAUTH_REDIRECT_URI");
  const tokenEncryptionKey = profileValue(input, environment, "TOKEN_ENCRYPTION_KEY");
  const expectedGoogleEmails = list(profileValue(input, environment, "AUTHORIZED_ACCOUNT_EMAILS"));
  // A server-side Drive token against any My Drive folder carries a broad Drive scope.
  // Require an explicit acknowledgement for both profiles so a production profile cannot
  // silently fall back to an individual employee's My Drive.
  const broadScopeAcknowledged = drive.mode !== "my-drive" || profileBoolean(input, environment, "MY_DRIVE_BROAD_SCOPE_ACKNOWLEDGED");
  const missing = [
    ...(!environmentIsValid ? ["Google connection environment (test or production)"] : []),
    ...(!drive.modeIsValid ? ["Google Drive mode (shared-drive or my-drive)"] : []),
    ...(!drive.rootFolderId ? [drive.storageRequirementLabel] : []),
    ...(!clientId ? ["Google OAuth client ID"] : []),
    ...(!clientSecret ? ["Google OAuth client secret"] : []),
    ...(!redirectUri ? ["OAuth redirect URI"] : []),
    ...(!isValidEncryptionKey(tokenEncryptionKey) ? ["32-byte Google token encryption key"] : []),
    ...(expectedGoogleEmails.length === 0 ? ["authorized Google account email"] : []),
    ...(!broadScopeAcknowledged ? ["My Drive broad-scope test acknowledgement"] : []),
  ];
  return {
    environment,
    environmentIsValid,
    connectionKey: `${environment}-drive`,
    clientId,
    clientSecret,
    redirectUri,
    tokenEncryptionKey,
    tokenEncryptionKeyVersion: profileValue(input, environment, "TOKEN_ENCRYPTION_KEY_VERSION") ?? "1",
    expectedGoogleEmails,
    drive,
    scopes: ["openid", "email", GOOGLE_DRIVE_SCOPE],
    missing,
    oauthReady: missing.length === 0,
    provisioningEnabled: profileBoolean(input, environment, "DRIVE_PROVISIONING_ENABLED"),
    gmailFilingEnabled: false,
    broadScopeAcknowledged,
  } satisfies GoogleRuntimeConfig;
}

export function buildGoogleAuthorizationUrl(config: GoogleRuntimeConfig, state: string, codeChallenge: string) {
  if (!config.oauthReady || !config.clientId || !config.redirectUri) {
    throw new GoogleIntegrationError("configuration_required", "Google Drive setup is incomplete.", 503);
  }
  const parameters = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTH_URL}?${parameters.toString()}`;
}

export async function createGoogleOauthAttempt(config: GoogleRuntimeConfig, initiatedBy: string, browserNonce: string) {
  const id = crypto.randomUUID();
  const state = randomValue();
  const verifier = randomValue(48);
  const challenge = base64Url(await sha256Bytes(verifier));
  const now = Date.now();
  await env.DB.prepare("INSERT INTO google_oauth_attempts (id, connection_key, state_hash, pkce_verifier_ciphertext, browser_nonce_hash, initiated_by, scopes_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(
      id,
      config.connectionKey,
      await sha256(state),
      await encryptGoogleSecret(verifier, config.tokenEncryptionKey, `google-oauth-attempt:${id}`),
      await sha256(browserNonce),
      initiatedBy,
      JSON.stringify(config.scopes),
      now + 10 * 60 * 1000,
      now,
    )
    .run();
  return { state, codeChallenge: challenge };
}

type OAuthAttemptRow = {
  id: string;
  connection_key: string;
  pkce_verifier_ciphertext: string;
  browser_nonce_hash: string;
  initiated_by: string;
  expires_at: number;
  consumed_at: number | null;
};

export async function consumeGoogleOauthAttempt(config: GoogleRuntimeConfig, state: string, browserNonce: string, requesterEmail: string) {
  const stateHash = await sha256(state);
  const attempt = await env.DB.prepare("SELECT id, connection_key, pkce_verifier_ciphertext, browser_nonce_hash, initiated_by, expires_at, consumed_at FROM google_oauth_attempts WHERE state_hash = ?")
    .bind(stateHash)
    .first<OAuthAttemptRow>();
  if (!attempt || attempt.connection_key !== config.connectionKey || attempt.consumed_at || attempt.expires_at < Date.now()) {
    throw new GoogleIntegrationError("invalid_oauth_state", "Google authorization expired or could not be verified. Start again.", 400);
  }
  if (attempt.initiated_by !== requesterEmail || attempt.browser_nonce_hash !== await sha256(browserNonce)) {
    throw new GoogleIntegrationError("oauth_request_mismatch", "Google authorization must be completed by the administrator who started it.", 403);
  }
  const consumed = await env.DB.prepare("UPDATE google_oauth_attempts SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at >= ?")
    .bind(Date.now(), attempt.id, Date.now())
    .run();
  if (consumed.meta.changes !== 1) {
    throw new GoogleIntegrationError("oauth_state_reused", "Google authorization has already been used. Start again.", 400);
  }
  return decryptGoogleSecret(attempt.pkce_verifier_ciphertext, config.tokenEncryptionKey, `google-oauth-attempt:${attempt.id}`);
}

async function tokenRequest(body: URLSearchParams) {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new GoogleIntegrationError("token_service_unavailable", "Google authorization is temporarily unavailable. Try again.", 503);
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data || typeof data.access_token !== "string") {
    throw new GoogleIntegrationError("token_exchange_failed", "Google authorization could not be completed. Start again.", 409);
  }
  return data;
}

function tokenSet(data: Record<string, unknown>): GoogleTokenSet {
  return {
    accessToken: String(data.access_token),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    scope: typeof data.scope === "string" ? data.scope.split(" ").filter(Boolean) : [],
  };
}

export async function exchangeGoogleAuthorizationCode(config: GoogleRuntimeConfig, code: string, verifier: string) {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new GoogleIntegrationError("configuration_required", "Google Drive setup is incomplete.", 503);
  }
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  return tokenSet(await tokenRequest(body));
}

export async function fetchGoogleUserProfile(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !data || typeof data.sub !== "string" || typeof data.email !== "string") {
    throw new GoogleIntegrationError("google_identity_unavailable", "Google account identity could not be verified.", 409);
  }
  return {
    subject: data.sub,
    email: data.email.toLowerCase(),
    emailVerified: data.email_verified === true,
  } satisfies GoogleUserProfile;
}

export function assertExpectedGoogleAccount(config: GoogleRuntimeConfig, profile: GoogleUserProfile) {
  if (!profile.emailVerified || !config.expectedGoogleEmails.includes(profile.email)) {
    throw new GoogleIntegrationError("unauthorized_google_account", "Use the Google account approved for this connection profile.", 403);
  }
}

type ConnectionRow = {
  id: string;
  google_email: string;
  refresh_token_ciphertext: string;
  status: string;
};

export async function getGoogleConnectionStatus(config: GoogleRuntimeConfig) {
  const connection = await env.DB.prepare("SELECT id, google_email, status FROM google_connections WHERE connection_key = ?")
    .bind(config.connectionKey)
    .first<{ id: string; google_email: string; status: string }>();
  const email = connection?.google_email ?? null;
  return {
    connected: connection?.status === "connected",
    status: connection?.status ?? "not-connected",
    account: email ? `${email.slice(0, 2)}•••@${email.split("@")[1] ?? ""}` : null,
  };
}

export async function disconnectGoogleConnection(config: GoogleRuntimeConfig) {
  const connection = await env.DB.prepare("SELECT id, google_email, refresh_token_ciphertext, status FROM google_connections WHERE connection_key = ?")
    .bind(config.connectionKey)
    .first<ConnectionRow>();
  let revocationRequested = false;
  if (connection?.refresh_token_ciphertext) {
    try {
      const refreshToken = await decryptGoogleSecret(connection.refresh_token_ciphertext, config.tokenEncryptionKey, `google-connection:${config.connectionKey}:refresh`);
      const response = await fetch(GOOGLE_REVOCATION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
      revocationRequested = response.ok;
    } catch {
      // The local disconnect still proceeds, ensuring this app no longer retains a usable token.
      revocationRequested = false;
    }
  }
  await env.DB.prepare("DELETE FROM google_connections WHERE connection_key = ?").bind(config.connectionKey).run();
  return { revocationRequested };
}

export async function saveGoogleConnection(config: GoogleRuntimeConfig, tokens: GoogleTokenSet, profile: GoogleUserProfile, actor: string) {
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT id, google_email, refresh_token_ciphertext, status FROM google_connections WHERE connection_key = ?")
    .bind(config.connectionKey)
    .first<ConnectionRow>();
  const refreshTokenCiphertext = tokens.refreshToken
    ? await encryptGoogleSecret(tokens.refreshToken, config.tokenEncryptionKey, `google-connection:${config.connectionKey}:refresh`)
    : existing?.refresh_token_ciphertext;
  if (!refreshTokenCiphertext) {
    throw new GoogleIntegrationError("refresh_token_missing", "Google did not issue a reusable authorization. Remove this app from your Google Account and connect again.", 409);
  }
  await env.DB.prepare("INSERT INTO google_connections (id, connection_key, google_subject, google_email, scopes_json, refresh_token_ciphertext, key_version, status, last_error_code, last_success_at, created_by, created_at, updated_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', NULL, ?, ?, ?, ?, NULL) ON CONFLICT(connection_key) DO UPDATE SET google_subject = excluded.google_subject, google_email = excluded.google_email, scopes_json = excluded.scopes_json, refresh_token_ciphertext = excluded.refresh_token_ciphertext, key_version = excluded.key_version, status = 'connected', last_error_code = NULL, last_success_at = excluded.last_success_at, created_by = excluded.created_by, updated_at = excluded.updated_at, revoked_at = NULL")
    .bind(existing?.id ?? crypto.randomUUID(), config.connectionKey, profile.subject, profile.email, JSON.stringify(tokens.scope), refreshTokenCiphertext, config.tokenEncryptionKeyVersion, now, actor, existing ? now : now, now)
    .run();
}

export async function getGoogleAccessToken(config: GoogleRuntimeConfig) {
  const connection = await env.DB.prepare("SELECT id, google_email, refresh_token_ciphertext, status FROM google_connections WHERE connection_key = ?")
    .bind(config.connectionKey)
    .first<ConnectionRow>();
  if (!connection || connection.status !== "connected") {
    throw new GoogleIntegrationError("google_not_connected", "Connect the approved Google account before creating project folders.", 409);
  }
  const refreshToken = await decryptGoogleSecret(connection.refresh_token_ciphertext, config.tokenEncryptionKey, `google-connection:${config.connectionKey}:refresh`);
  try {
    const data = await tokenRequest(new URLSearchParams({
      client_id: config.clientId ?? "",
      client_secret: config.clientSecret ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }));
    await env.DB.prepare("UPDATE google_connections SET last_success_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ?")
      .bind(Date.now(), Date.now(), connection.id)
      .run();
    return String(data.access_token);
  } catch (error) {
    await env.DB.prepare("UPDATE google_connections SET status = 'reauthorization-required', last_error_code = 'refresh_failed', updated_at = ? WHERE id = ?")
      .bind(Date.now(), connection.id)
      .run();
    if (error instanceof GoogleIntegrationError) throw error;
    throw new GoogleIntegrationError("refresh_failed", "Google authorization needs to be reconnected.", 409);
  }
}

export async function writeGoogleIntegrationEvent(config: GoogleRuntimeConfig, eventType: string, actor: string, entityType?: string, entityId?: string, detail?: string) {
  await env.DB.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), config.connectionKey, eventType, actor, entityType ?? null, entityId ?? null, detail ?? null, Date.now())
    .run();
}
