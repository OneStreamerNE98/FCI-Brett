import { GoogleIntegrationError } from "./google-integration-error";
import { resolveDriveWorkspace } from "./google-workspace";

export { GoogleIntegrationError } from "./google-integration-error";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOCATION_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const ENCRYPTION_VERSION = "v1";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const GOOGLE_GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export type GoogleFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GoogleEncryptionKey = Readonly<{
  version: string;
  keyMaterial: string;
}>;

/** Resolves exact key versions without ever guessing or falling back to the current writer. */
export interface GoogleSecretStore {
  current(): Promise<GoogleEncryptionKey>;
  get(version: string): Promise<string | null>;
}

export type StoredGoogleOauthAttempt = Readonly<{
  id: string;
  connectionKey: string;
  pkceVerifierCiphertext: string;
  browserNonceHash: string;
  initiatedBy: string;
  expiresAt: number;
  consumedAt: number | null;
}>;

export type StoredGoogleConnection = Readonly<{
  id: string;
  googleEmail: string;
  refreshTokenCiphertext: string;
  keyVersion: string;
  scopesJson?: string;
  status: string;
}>;

/** Development persistence seam. The Sites composition supplies the only D1 adapter. */
export interface GoogleOauthPersistence {
  createOauthAttempt(input: Readonly<{
    id: string;
    connectionKey: string;
    stateHash: string;
    pkceVerifierCiphertext: string;
    browserNonceHash: string;
    initiatedBy: string;
    scopesJson: string;
    expiresAt: number;
    createdAt: number;
  }>): Promise<void>;
  findOauthAttemptByStateHash(stateHash: string): Promise<StoredGoogleOauthAttempt | null>;
  consumeOauthAttempt(id: string, consumedAt: number): Promise<boolean>;
  findConnection(connectionKey: string): Promise<StoredGoogleConnection | null>;
  deleteConnection(connectionKey: string): Promise<void>;
  saveConnection(input: Readonly<{
    id: string;
    connectionKey: string;
    googleSubject: string;
    googleEmail: string;
    scopesJson: string;
    refreshTokenCiphertext: string;
    keyVersion: string;
    actor: string;
    now: number;
  }>): Promise<void>;
  markConnectionAccountRejected(id: string, now: number): Promise<void>;
  markConnectionRefreshSucceeded(id: string, now: number): Promise<void>;
  markConnectionRefreshFailed(input: Readonly<{
    id: string;
    errorCode: string;
    requiresReauthorization: boolean;
    now: number;
  }>): Promise<void>;
  writeIntegrationEvent(input: Readonly<{
    id: string;
    connectionKey: string;
    eventType: string;
    actor: string;
    entityType: string | null;
    entityId: string | null;
    detail: string | null;
    createdAt: number;
  }>): Promise<void>;
}

export type GoogleOauthDependencies = Readonly<{
  persistence: GoogleOauthPersistence;
  secrets: GoogleSecretStore;
  fetch: GoogleFetch;
  now: () => number;
  randomUUID: () => string;
  randomBytes?: (byteLength: number) => Uint8Array;
}>;

export type GoogleWorkspaceMode = "simulation" | "workspace";
export type GoogleService = "drive" | "gmail" | "calendar" | "sheets";

const SERVICE_SCOPES: Record<GoogleService, string> = {
  drive: GOOGLE_DRIVE_SCOPE,
  gmail: GOOGLE_GMAIL_MODIFY_SCOPE,
  calendar: GOOGLE_CALENDAR_EVENTS_SCOPE,
  sheets: GOOGLE_SHEETS_SCOPE,
};

export type GoogleRuntimeConfig = {
  environment: GoogleWorkspaceMode;
  simulation: boolean;
  modeIsValid: boolean;
  connectionKey: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenEncryptionKey?: string;
  tokenEncryptionKeyVersion: string;
  expectedGoogleEmails: string[];
  allowedDomains: string[];
  drive: ReturnType<typeof resolveDriveWorkspace>;
  clientDirectorySheetId?: string;
  clientDirectorySheetIdInvalid: boolean;
  intakeMailbox?: string;
  clientAppointmentsCalendarId?: string;
  fieldScheduleCalendarId?: string;
  enabledServices: GoogleService[];
  serviceScopes: Record<GoogleService, string>;
  scopes: string[];
  missing: string[];
  oauthReady: boolean;
  provisioningEnabled: boolean;
  gmailEnabled: boolean;
  calendarEnabled: boolean;
  sheetsEnabled: boolean;
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

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function workspaceValue(input: EnvironmentValues, name: string) {
  return input[`GOOGLE_WORKSPACE_${name}`];
}

function workspaceBoolean(input: EnvironmentValues, name: string) {
  return workspaceValue(input, name)?.trim().toLowerCase() === "true";
}

function workspaceServices(input: EnvironmentValues, simulation: boolean) {
  const configured = simulation ? ["drive", "gmail", "calendar", "sheets"] : list(workspaceValue(input, "ENABLED_SERVICES"));
  const known = new Set<GoogleService>(["drive", "gmail", "calendar", "sheets"]);
  const unknown = configured.filter((service) => !known.has(service as GoogleService));
  const requestedKnown = configured.filter((service): service is GoogleService => known.has(service as GoogleService));
  const enabled = Array.from(new Set<GoogleService>(["drive", ...requestedKnown]));
  return { enabled, unknown };
}

function optionalGoogleResourceId(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return { value: undefined, invalid: false };
  const valid = /^[A-Za-z0-9_-]{10,200}$/.test(normalized);
  return { value: valid ? normalized : undefined, invalid: !valid };
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

function randomValue(byteLength = 32, randomBytes?: (byteLength: number) => Uint8Array) {
  const bytes = randomBytes ? randomBytes(byteLength) : crypto.getRandomValues(new Uint8Array(byteLength));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== byteLength) {
    throw new GoogleIntegrationError("invalid_random_source", "Google authorization could not start safely.", 503);
  }
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

function encryptionKeyVersion(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new GoogleIntegrationError(
      "invalid_encryption_key_version",
      "Google token encryption key version is invalid.",
      503,
    );
  }
  return value;
}

/**
 * Creates an immutable keyring for production composition and tests. The current
 * version is always the writer; reads resolve the stored version exactly.
 */
export function createGoogleSecretStore(input: Readonly<{
  currentVersion: string;
  keys: Readonly<Record<string, string>>;
}>): GoogleSecretStore {
  const currentVersion = encryptionKeyVersion(input.currentVersion);
  const source = input.keys;
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new GoogleIntegrationError("invalid_encryption_key", "Google token encryption keys are invalid.", 503);
  }
  const keys = new Map<string, string>();
  for (const [versionValue, keyMaterial] of Object.entries(source)) {
    const version = encryptionKeyVersion(versionValue);
    if (!isValidEncryptionKey(keyMaterial)) {
      throw new GoogleIntegrationError("invalid_encryption_key", "Google token encryption must use 32-byte base64url keys.", 503);
    }
    keys.set(version, keyMaterial);
  }
  if (!keys.has(currentVersion)) {
    throw new GoogleIntegrationError("invalid_encryption_key", "The current Google encryption key version is unavailable.", 503);
  }
  return Object.freeze({
    async current() {
      return Object.freeze({ version: currentVersion, keyMaterial: keys.get(currentVersion)! });
    },
    async get(version: string) {
      return keys.get(encryptionKeyVersion(version)) ?? null;
    },
  });
}

/** Current-key-only store used by the controlled Sites/D1 connector. */
export function createCurrentGoogleSecretStore(config: Pick<GoogleRuntimeConfig, "tokenEncryptionKey" | "tokenEncryptionKeyVersion">) {
  const version = encryptionKeyVersion(config.tokenEncryptionKeyVersion);
  if (!isValidEncryptionKey(config.tokenEncryptionKey)) {
    throw new GoogleIntegrationError("invalid_encryption_key", "Google token encryption must be a 32-byte base64url key.", 503);
  }
  return createGoogleSecretStore({
    currentVersion: version,
    keys: { [version]: config.tokenEncryptionKey! },
  });
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

export async function encryptGoogleSecretWithStore(
  plaintext: string,
  secrets: GoogleSecretStore,
  context: string,
) {
  const current = await secrets.current();
  return Object.freeze({
    ciphertext: await encryptGoogleSecret(plaintext, current.keyMaterial, context),
    keyVersion: encryptionKeyVersion(current.version),
  });
}

export async function decryptGoogleSecretWithStore(
  ciphertext: string,
  storedKeyVersion: string,
  secrets: GoogleSecretStore,
  context: string,
) {
  const version = encryptionKeyVersion(storedKeyVersion);
  const keyMaterial = await secrets.get(version);
  if (!keyMaterial) {
    throw new GoogleIntegrationError(
      "encryption_key_version_unavailable",
      "Stored Google authorization uses an unavailable encryption-key version.",
      503,
    );
  }
  return decryptGoogleSecret(ciphertext, keyMaterial, context);
}

export function getGoogleRuntimeConfig(input: EnvironmentValues = {}) {
  const requested = input.GOOGLE_INTEGRATION_MODE?.trim().toLowerCase() ?? (input.NODE_ENV === "production" ? "workspace" : "simulation");
  const modeIsValid = requested === "simulation" || requested === "workspace";
  const environment: GoogleWorkspaceMode = requested === "workspace" ? "workspace" : "simulation";
  const simulation = environment === "simulation";
  const sharedDriveId = workspaceValue(input, "SHARED_DRIVE_ID");
  const drive = resolveDriveWorkspace({ sharedDriveId, simulation });
  const clientId = workspaceValue(input, "CLIENT_ID");
  const clientSecret = workspaceValue(input, "CLIENT_SECRET");
  const redirectUri = workspaceValue(input, "OAUTH_REDIRECT_URI");
  const tokenEncryptionKey = workspaceValue(input, "TOKEN_ENCRYPTION_KEY");
  const tokenEncryptionKeyVersion = workspaceValue(input, "TOKEN_ENCRYPTION_KEY_VERSION") ?? "1";
  const tokenEncryptionKeyVersionIsValid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(tokenEncryptionKeyVersion);
  const expectedGoogleEmails = list(workspaceValue(input, "AUTHORIZED_ACCOUNTS"));
  const allowedDomains = list(workspaceValue(input, "ALLOWED_DOMAINS")).map((domain) => domain.replace(/^@/, ""));
  const clientDirectorySheet = optionalGoogleResourceId(workspaceValue(input, "CLIENT_DIRECTORY_SHEET_ID"));
  const intakeMailbox = workspaceValue(input, "INTAKE_MAILBOX")?.trim().toLowerCase();
  const clientAppointmentsCalendarId = workspaceValue(input, "CLIENT_APPOINTMENTS_CALENDAR_ID")?.trim();
  const fieldScheduleCalendarId = workspaceValue(input, "FIELD_SCHEDULE_CALENDAR_ID")?.trim();
  const services = workspaceServices(input, simulation);
  const gmailEnabled = services.enabled.includes("gmail");
  const calendarEnabled = services.enabled.includes("calendar");
  const sheetsEnabled = services.enabled.includes("sheets");
  const broadScopeAcknowledged = true;
  const liveMissing = [
    ...(!modeIsValid ? ["Google integration mode (simulation or workspace)"] : []),
    ...(!drive.rootFolderId ? [drive.storageRequirementLabel] : []),
    ...(!clientId ? ["Google OAuth client ID"] : []),
    ...(!clientSecret ? ["Google OAuth client secret"] : []),
    ...(!redirectUri ? ["OAuth redirect URI"] : []),
    ...(!isValidEncryptionKey(tokenEncryptionKey) ? ["32-byte Google token encryption key"] : []),
    ...(!tokenEncryptionKeyVersionIsValid ? ["valid Google token encryption key version"] : []),
    ...(allowedDomains.length === 0 ? ["Google Workspace allowed domain"] : []),
    ...(expectedGoogleEmails.length === 0 ? ["approved Google Workspace connection account"] : []),
    ...(gmailEnabled && !intakeMailbox ? ["Google Workspace intake mailbox"] : []),
    ...(gmailEnabled
      && intakeMailbox
      && expectedGoogleEmails.length > 0
      && (expectedGoogleEmails.length !== 1 || expectedGoogleEmails[0] !== intakeMailbox)
      ? ["Google Workspace intake mailbox matching the single approved connection account"]
      : []),
    ...(calendarEnabled && !clientAppointmentsCalendarId ? ["client appointments calendar ID"] : []),
    ...(calendarEnabled && !fieldScheduleCalendarId ? ["field schedule calendar ID"] : []),
    ...(services.unknown.length ? [`valid Google services (unknown: ${services.unknown.join(", ")})`] : []),
  ];
  const missing = simulation ? [] : liveMissing;
  return {
    environment,
    simulation,
    modeIsValid,
    connectionKey: simulation ? "workspace-simulation" : "google-workspace",
    clientId,
    clientSecret,
    redirectUri,
    tokenEncryptionKey,
    tokenEncryptionKeyVersion,
    expectedGoogleEmails,
    allowedDomains,
    drive,
    clientDirectorySheetId: clientDirectorySheet.value,
    clientDirectorySheetIdInvalid: clientDirectorySheet.invalid,
    intakeMailbox: simulation ? "workspace-simulation@fci.example" : intakeMailbox,
    clientAppointmentsCalendarId: simulation ? "simulation-client-appointments" : clientAppointmentsCalendarId,
    fieldScheduleCalendarId: simulation ? "simulation-field-schedule" : fieldScheduleCalendarId,
    enabledServices: services.enabled,
    serviceScopes: SERVICE_SCOPES,
    scopes: ["openid", "email", ...services.enabled.map((service) => SERVICE_SCOPES[service])],
    missing,
    oauthReady: simulation || missing.length === 0,
    provisioningEnabled: simulation || workspaceBoolean(input, "DRIVE_PROVISIONING_ENABLED"),
    gmailEnabled,
    calendarEnabled,
    sheetsEnabled,
    broadScopeAcknowledged,
  } satisfies GoogleRuntimeConfig;
}

export function assertGoogleService(config: GoogleRuntimeConfig, service: GoogleService) {
  if (!config.enabledServices.includes(service)) {
    throw new GoogleIntegrationError("service_not_enabled", `Enable ${service} for the Google Workspace connection, then reconnect Google.`, 409);
  }
}

export function assertGrantedGoogleServiceScopes(config: GoogleRuntimeConfig, grantedScopes: string[]) {
  const missing = config.enabledServices
    .map((service) => config.serviceScopes[service])
    .filter((scope) => !grantedScopes.includes(scope));
  if (missing.length) {
    throw new GoogleIntegrationError("required_scopes_missing", "Google Workspace did not grant every selected service. Reconnect and approve the requested permissions.", 409);
  }
}

export function buildGoogleAuthorizationUrl(config: GoogleRuntimeConfig, state: string, codeChallenge: string) {
  if (!config.oauthReady || !config.clientId || !config.redirectUri) {
    throw new GoogleIntegrationError("configuration_required", "Google Workspace setup is incomplete.", 503);
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

export async function createGoogleOauthAttempt(
  config: GoogleRuntimeConfig,
  initiatedBy: string,
  browserNonce: string,
  dependencies: GoogleOauthDependencies,
) {
  const id = dependencies.randomUUID();
  const state = randomValue(32, dependencies.randomBytes);
  const verifier = randomValue(48, dependencies.randomBytes);
  const challenge = base64Url(await sha256Bytes(verifier));
  const now = dependencies.now();
  const encrypted = await encryptGoogleSecretWithStore(
    verifier,
    dependencies.secrets,
    `google-oauth-attempt:${id}`,
  );
  await dependencies.persistence.createOauthAttempt({
    id,
    connectionKey: config.connectionKey,
    stateHash: await sha256(state),
    pkceVerifierCiphertext: encrypted.ciphertext,
    browserNonceHash: await sha256(browserNonce),
    initiatedBy,
    scopesJson: JSON.stringify(config.scopes),
    expiresAt: now + 10 * 60 * 1000,
    createdAt: now,
  });
  return { state, codeChallenge: challenge };
}

export async function consumeGoogleOauthAttempt(
  config: GoogleRuntimeConfig,
  state: string,
  browserNonce: string,
  requesterEmail: string,
  dependencies: GoogleOauthDependencies,
) {
  const stateHash = await sha256(state);
  const attempt = await dependencies.persistence.findOauthAttemptByStateHash(stateHash);
  const now = dependencies.now();
  if (!attempt || attempt.connectionKey !== config.connectionKey || attempt.consumedAt || attempt.expiresAt < now) {
    throw new GoogleIntegrationError("invalid_oauth_state", "Google authorization expired or could not be verified. Start again.", 400);
  }
  if (attempt.initiatedBy !== requesterEmail || attempt.browserNonceHash !== await sha256(browserNonce)) {
    throw new GoogleIntegrationError("oauth_request_mismatch", "Google authorization must be completed by the administrator who started it.", 403);
  }
  if (!await dependencies.persistence.consumeOauthAttempt(attempt.id, now)) {
    throw new GoogleIntegrationError("oauth_state_reused", "Google authorization has already been used. Start again.", 400);
  }
  const current = await dependencies.secrets.current();
  return decryptGoogleSecret(
    attempt.pkceVerifierCiphertext,
    current.keyMaterial,
    `google-oauth-attempt:${attempt.id}`,
  );
}

type GoogleTokenRequestPurpose = "authorization-code" | "refresh-token";

class GoogleTokenRequestError extends GoogleIntegrationError {
  readonly requiresReauthorization: boolean;

  constructor(
    code: string,
    message: string,
    status: number,
    requiresReauthorization = false,
  ) {
    super(code, message, status);
    this.name = "GoogleTokenRequestError";
    this.requiresReauthorization = requiresReauthorization;
  }
}

async function tokenRequest(
  body: URLSearchParams,
  purpose: GoogleTokenRequestPurpose,
  fetcher: GoogleFetch,
) {
  let response: Response;
  try {
    response = await fetcher(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new GoogleIntegrationError("token_service_unavailable", "Google authorization is temporarily unavailable. Try again.", 503);
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.ok && data && typeof data.access_token === "string") {
    return data;
  }
  const providerError = typeof data?.error === "string" ? data.error : null;
  if (purpose === "refresh-token" && providerError === "invalid_grant") {
    throw new GoogleTokenRequestError(
      "refresh_token_rejected",
      "Google authorization needs to be reconnected.",
      409,
      true,
    );
  }
  if (response.status === 429 || response.status >= 500 || !data) {
    throw new GoogleIntegrationError("token_service_unavailable", "Google authorization is temporarily unavailable. Try again.", 503);
  }
  throw new GoogleIntegrationError("token_exchange_failed", "Google authorization could not be completed. Start again.", 409);
}

function tokenSet(data: Record<string, unknown>): GoogleTokenSet {
  return {
    accessToken: String(data.access_token),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    scope: typeof data.scope === "string" ? data.scope.split(" ").filter(Boolean) : [],
  };
}

export async function exchangeGoogleAuthorizationCode(
  config: GoogleRuntimeConfig,
  code: string,
  verifier: string,
  fetcher: GoogleFetch,
) {
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
  return tokenSet(await tokenRequest(body, "authorization-code", fetcher));
}

export async function fetchGoogleUserProfile(accessToken: string, fetcher: GoogleFetch) {
  const response = await fetcher(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
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
  if (!profile.emailVerified || !googleAccountIsAllowed(config, profile.email)) {
    throw new GoogleIntegrationError("unauthorized_google_account", "Use an approved account from the configured Google Workspace domain.", 403);
  }
}

function googleAccountIsAllowed(config: GoogleRuntimeConfig, value: string) {
  const email = value.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!config.allowedDomains.includes(domain)) return false;
  return config.expectedGoogleEmails.length > 0 && config.expectedGoogleEmails.includes(email);
}

function storedScopes(value: string | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    return [];
  }
}

function serviceIsGranted(config: GoogleRuntimeConfig, scopes: string[], service: GoogleService) {
  return scopes.includes(config.serviceScopes[service]);
}

export async function getGoogleConnectionStatus(
  config: GoogleRuntimeConfig,
  dependencies: Pick<GoogleOauthDependencies, "persistence">,
) {
  if (config.simulation) {
    return {
      connected: true,
      status: "connected",
      account: "Local Workspace simulation",
      services: { drive: true, gmail: true, calendar: true, sheets: true },
      requiresReauthorization: false,
    };
  }
  const connection = await dependencies.persistence.findConnection(config.connectionKey);
  const email = connection?.googleEmail ?? null;
  const scopes = storedScopes(connection?.scopesJson);
  const accountAllowed = Boolean(email && googleAccountIsAllowed(config, email));
  const hasUsableConnection = connection?.status === "connected" && accountAllowed;
  const services = {
    drive: Boolean(hasUsableConnection && serviceIsGranted(config, scopes, "drive")),
    gmail: Boolean(hasUsableConnection && config.gmailEnabled && serviceIsGranted(config, scopes, "gmail")),
    calendar: Boolean(hasUsableConnection && config.calendarEnabled && serviceIsGranted(config, scopes, "calendar")),
    sheets: Boolean(hasUsableConnection && config.sheetsEnabled && serviceIsGranted(config, scopes, "sheets")),
  };
  const requiresReauthorization = Boolean(connection && (!accountAllowed || (hasUsableConnection && config.enabledServices.some((service) => !serviceIsGranted(config, scopes, service)))));
  const status = !connection ? "not-connected" : requiresReauthorization ? "reauthorization-required" : connection.status;
  return {
    connected: status === "connected",
    status,
    account: email ? `${email.slice(0, 2)}•••@${email.split("@")[1] ?? ""}` : null,
    services,
    requiresReauthorization,
  };
}

export async function disconnectGoogleConnection(
  config: GoogleRuntimeConfig,
  dependencies: GoogleOauthDependencies,
) {
  if (config.simulation) return { revocationRequested: false };
  const connection = await dependencies.persistence.findConnection(config.connectionKey);
  let revocationRequested = false;
  if (connection?.refreshTokenCiphertext) {
    try {
      const refreshToken = await decryptGoogleSecretWithStore(
        connection.refreshTokenCiphertext,
        connection.keyVersion,
        dependencies.secrets,
        `google-connection:${config.connectionKey}:refresh`,
      );
      const response = await dependencies.fetch(GOOGLE_REVOCATION_URL, {
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
  await dependencies.persistence.deleteConnection(config.connectionKey);
  return { revocationRequested };
}

export async function saveGoogleConnection(
  config: GoogleRuntimeConfig,
  tokens: GoogleTokenSet,
  profile: GoogleUserProfile,
  actor: string,
  dependencies: GoogleOauthDependencies,
) {
  const now = dependencies.now();
  const existing = await dependencies.persistence.findConnection(config.connectionKey);
  const encrypted = tokens.refreshToken
    ? await encryptGoogleSecretWithStore(
      tokens.refreshToken,
      dependencies.secrets,
      `google-connection:${config.connectionKey}:refresh`,
    )
    : null;
  const refreshTokenCiphertext = encrypted?.ciphertext ?? existing?.refreshTokenCiphertext;
  const keyVersion = encrypted?.keyVersion ?? existing?.keyVersion;
  if (!refreshTokenCiphertext) {
    throw new GoogleIntegrationError("refresh_token_missing", "Google did not issue a reusable authorization. Remove this app from your Google Account and connect again.", 409);
  }
  await dependencies.persistence.saveConnection({
    id: existing?.id ?? dependencies.randomUUID(),
    connectionKey: config.connectionKey,
    googleSubject: profile.subject,
    googleEmail: profile.email,
    scopesJson: JSON.stringify(tokens.scope),
    refreshTokenCiphertext,
    keyVersion: keyVersion!,
    actor,
    now,
  });
}

export async function getGoogleAccessToken(
  config: GoogleRuntimeConfig,
  requiredService: GoogleService | undefined,
  dependencies: GoogleOauthDependencies,
) {
  if (config.simulation) {
    throw new GoogleIntegrationError("simulation_has_no_google_token", "Local Workspace simulation never creates or uses Google access tokens.", 409);
  }
  const connection = await dependencies.persistence.findConnection(config.connectionKey);
  if (!connection || connection.status !== "connected") {
    throw new GoogleIntegrationError("google_not_connected", "Connect the approved Google Workspace account before using this service.", 409);
  }
  if (!googleAccountIsAllowed(config, connection.googleEmail)) {
    await dependencies.persistence.markConnectionAccountRejected(connection.id, dependencies.now());
    throw new GoogleIntegrationError("unauthorized_google_account", "The stored Google account is no longer approved for this Workspace configuration. Reconnect the approved mailbox.", 409);
  }
  if (requiredService && !serviceIsGranted(config, storedScopes(connection.scopesJson), requiredService)) {
    throw new GoogleIntegrationError("google_scope_reauthorization_required", `Reconnect Google and approve the ${requiredService} permission before continuing.`, 409);
  }
  const refreshToken = await decryptGoogleSecretWithStore(
    connection.refreshTokenCiphertext,
    connection.keyVersion,
    dependencies.secrets,
    `google-connection:${config.connectionKey}:refresh`,
  );
  try {
    const data = await tokenRequest(new URLSearchParams({
      client_id: config.clientId ?? "",
      client_secret: config.clientSecret ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }), "refresh-token", dependencies.fetch);
    await dependencies.persistence.markConnectionRefreshSucceeded(connection.id, dependencies.now());
    return String(data.access_token);
  } catch (error) {
    const errorCode = error instanceof GoogleIntegrationError ? error.code : "refresh_failed";
    if (error instanceof GoogleTokenRequestError && error.requiresReauthorization) {
      await dependencies.persistence.markConnectionRefreshFailed({
        id: connection.id,
        errorCode,
        requiresReauthorization: true,
        now: dependencies.now(),
      });
    } else {
      await dependencies.persistence.markConnectionRefreshFailed({
        id: connection.id,
        errorCode,
        requiresReauthorization: false,
        now: dependencies.now(),
      });
    }
    if (error instanceof GoogleIntegrationError) throw error;
    throw new GoogleIntegrationError("refresh_failed", "Google authorization is temporarily unavailable. Try again.", 503);
  }
}

export async function writeGoogleIntegrationEvent(
  config: GoogleRuntimeConfig,
  eventType: string,
  actor: string,
  entityType: string | undefined,
  entityId: string | undefined,
  detail: string | undefined,
  dependencies: Pick<GoogleOauthDependencies, "persistence" | "randomUUID" | "now">,
) {
  await dependencies.persistence.writeIntegrationEvent({
    id: dependencies.randomUUID(),
    connectionKey: config.connectionKey,
    eventType,
    actor,
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    detail: detail ?? null,
    createdAt: dependencies.now(),
  });
}

/** Binds all provider and persistence dependencies for one request/runtime composition. */
export function createGoogleOauthOperations(
  config: GoogleRuntimeConfig,
  dependencies: GoogleOauthDependencies,
) {
  return Object.freeze({
    createOauthAttempt: (initiatedBy: string, browserNonce: string) =>
      createGoogleOauthAttempt(config, initiatedBy, browserNonce, dependencies),
    consumeOauthAttempt: (state: string, browserNonce: string, requesterEmail: string) =>
      consumeGoogleOauthAttempt(config, state, browserNonce, requesterEmail, dependencies),
    exchangeAuthorizationCode: (code: string, verifier: string) =>
      exchangeGoogleAuthorizationCode(config, code, verifier, dependencies.fetch),
    fetchUserProfile: (accessToken: string) => fetchGoogleUserProfile(accessToken, dependencies.fetch),
    connectionStatus: () => getGoogleConnectionStatus(config, dependencies),
    disconnect: () => disconnectGoogleConnection(config, dependencies),
    saveConnection: (tokens: GoogleTokenSet, profile: GoogleUserProfile, actor: string) =>
      saveGoogleConnection(config, tokens, profile, actor, dependencies),
    accessToken: (requiredService?: GoogleService) =>
      getGoogleAccessToken(config, requiredService, dependencies),
    writeEvent: (
      eventType: string,
      actor: string,
      entityType?: string,
      entityId?: string,
      detail?: string,
    ) => writeGoogleIntegrationEvent(
      config,
      eventType,
      actor,
      entityType,
      entityId,
      detail,
      dependencies,
    ),
  });
}
