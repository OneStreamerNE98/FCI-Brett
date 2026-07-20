import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  AUTHORIZATION_DOMAIN,
  normalizeAuthorizationCompanyEmail,
} from "../../application/authorization-policy";
import type { ProductionEmployeeOidcConfig } from "./production-config";

export const EMPLOYEE_OIDC_ATTEMPT_COOKIE_NAME = "__Host-fci_oidc_attempt";
export const CLEAR_EMPLOYEE_OIDC_ATTEMPT_COOKIE =
  `${EMPLOYEE_OIDC_ATTEMPT_COOKIE_NAME}=; Path=/; Max-Age=0; ` +
  "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax";

export const EMPLOYEE_OIDC_ATTEMPT_LIFETIME_MS = 10 * 60 * 1_000;

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CANONICAL_GOOGLE_ISSUER = "https://accounts.google.com";
const LOGIN_SCOPES = "openid email profile";
const COOKIE_AAD = Buffer.from("fci-employee-oidc-attempt:v1", "utf8");
const COOKIE_PREFIX = "v1";
const MAX_COOKIE_HEADER_LENGTH = 8_192;
const MAX_ATTEMPT_COOKIE_LENGTH = 3_500;
const MAX_AUTHORIZATION_CODE_LENGTH = 4_096;
const MAX_ID_TOKEN_LENGTH = 24_000;
const MAX_JWT_HEADER_BYTES = 4_096;
const MAX_JWT_PAYLOAD_BYTES = 16_384;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1_024;
const MAX_JWKS_RESPONSE_BYTES = 256 * 1_024;
const MAX_JWKS_KEYS = 32;
const DEFAULT_JWKS_CACHE_MS = 5 * 60 * 1_000;
const MAX_JWKS_CACHE_MS = 60 * 60 * 1_000;
const PROVIDER_TIMEOUT_MS = 10_000;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const JWT_PART_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_SUBJECT_PATTERN = /^[^\u0000-\u001f\u007f]{1,512}$/;

type JsonObject = Record<string, unknown>;

export type EmployeeOidcFailureReason =
  | "attempt_missing"
  | "attempt_invalid"
  | "attempt_expired"
  | "state_invalid"
  | "authorization_denied"
  | "code_invalid"
  | "provider_unavailable"
  | "token_invalid"
  | "signature_invalid"
  | "outside_domain";

export class EmployeeOidcFailure extends Error {
  constructor(
    readonly reason: EmployeeOidcFailureReason,
    readonly retryable = false,
  ) {
    super("Employee OIDC authentication failed");
    this.name = "EmployeeOidcFailure";
  }
}

export type VerifiedEmployeeOidcIdentity = Readonly<{
  provider: "google_oidc";
  issuer: typeof CANONICAL_GOOGLE_ISSUER;
  subject: string;
  email: string;
  hostedDomain: typeof AUTHORIZATION_DOMAIN;
  emailVerified: true;
  displayName: string;
}>;

export type EmployeeOidcInitiation = Readonly<{
  authorizationUrl: string;
  attemptCookie: string;
}>;

export type EmployeeOidcCompletion = Readonly<{
  identity: VerifiedEmployeeOidcIdentity;
  invitationCredential: string | null;
}>;

export interface EmployeeOidcClient {
  initiate(invitationCredential: string | null, initiatedAt: number): EmployeeOidcInitiation;
  complete(input: Readonly<{
    attemptCookie: string;
    state: string;
    code: string;
    completedAt: number;
  }>): Promise<EmployeeOidcCompletion>;
}

export type EmployeeOidcFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type EmployeeOidcDependencies = Readonly<{
  fetch?: EmployeeOidcFetch;
  randomBytes?: (size: number) => Buffer;
}>;

type EmployeeOidcAttempt = Readonly<{
  state: string;
  nonce: string;
  pkceVerifier: string;
  invitationCredential: string | null;
  initiatedAt: number;
  expiresAt: number;
}>;

type EmployeeJwk = JsonWebKey & Readonly<{
  kid?: string;
  use?: string;
}>;

type JwksCache = {
  expiresAt: number;
  keys: readonly EmployeeJwk[];
} | null;

function invalid(reason: EmployeeOidcFailureReason, retryable = false): never {
  throw new EmployeeOidcFailure(reason, retryable);
}

function safeTimestamp(value: number, label: string) {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || !Number.isFinite(new Date(value).getTime())
  ) {
    throw new TypeError(`${label} must be a nonnegative safe epoch-millisecond timestamp`);
  }
  return value;
}

function canonicalBase64url(bytes: Buffer) {
  return bytes.toString("base64url");
}

function decodeBase64url(
  value: unknown,
  maximumBytes: number,
  reason: EmployeeOidcFailureReason,
) {
  if (
    typeof value !== "string"
    || value.length === 0
    || !JWT_PART_PATTERN.test(value)
  ) {
    return invalid(reason);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch {
    return invalid(reason);
  }
  if (
    bytes.length === 0
    || bytes.length > maximumBytes
    || canonicalBase64url(bytes) !== value
  ) {
    return invalid(reason);
  }
  return bytes;
}

function jsonObject(bytes: Buffer, reason: EmployeeOidcFailureReason): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return invalid(reason);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid(reason);
  }
  return parsed as JsonObject;
}

function secureEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function credential(value: unknown, reason: EmployeeOidcFailureReason) {
  if (typeof value !== "string" || !CREDENTIAL_PATTERN.test(value)) {
    return invalid(reason);
  }
  return value;
}

function optionalInvitationCredential(value: unknown) {
  return value === null ? null : credential(value, "attempt_invalid");
}

function displayName(value: unknown, email: string) {
  const fallback = email.slice(0, email.indexOf("@"));
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length === 0
    || value.length > 255
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }
  return value;
}

function exactAttempt(value: JsonObject): EmployeeOidcAttempt {
  const expectedKeys = [
    "expiresAt",
    "initiatedAt",
    "invitationCredential",
    "nonce",
    "pkceVerifier",
    "state",
  ];
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return invalid("attempt_invalid");
  }
  if (typeof value.initiatedAt !== "number" || typeof value.expiresAt !== "number") {
    return invalid("attempt_invalid");
  }
  const initiatedAt = safeTimestamp(value.initiatedAt, "OIDC initiation time");
  const expiresAt = safeTimestamp(value.expiresAt, "OIDC attempt expiry");
  if (expiresAt - initiatedAt !== EMPLOYEE_OIDC_ATTEMPT_LIFETIME_MS) {
    return invalid("attempt_invalid");
  }
  return Object.freeze({
    state: credential(value.state, "attempt_invalid"),
    nonce: credential(value.nonce, "attempt_invalid"),
    pkceVerifier: credential(value.pkceVerifier, "attempt_invalid"),
    invitationCredential: optionalInvitationCredential(value.invitationCredential),
    initiatedAt,
    expiresAt,
  });
}

function attemptEncryptionKey(sessionSecret: string) {
  let key: Buffer;
  try {
    key = Buffer.from(sessionSecret, "base64url");
  } catch {
    throw new TypeError("Employee session secret is invalid");
  }
  if (key.length !== 32 || canonicalBase64url(key) !== sessionSecret) {
    throw new TypeError("Employee session secret must be a canonical 32-byte base64url value");
  }
  return key;
}

function encryptAttempt(
  attempt: EmployeeOidcAttempt,
  key: Buffer,
  nextRandomBytes: (size: number) => Buffer,
) {
  const iv = nextRandomBytes(12);
  if (!Buffer.isBuffer(iv) || iv.length !== 12) {
    throw new Error("Employee OIDC random source returned invalid bytes");
  }
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(COOKIE_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(attempt), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const encoded = [
    COOKIE_PREFIX,
    canonicalBase64url(iv),
    canonicalBase64url(ciphertext),
    canonicalBase64url(tag),
  ].join(".");
  if (encoded.length > MAX_ATTEMPT_COOKIE_LENGTH) {
    throw new Error("Employee OIDC attempt cookie exceeded its bounded size");
  }
  return encoded;
}

function decryptAttempt(value: string, key: Buffer) {
  if (value.length === 0 || value.length > MAX_ATTEMPT_COOKIE_LENGTH) {
    return invalid("attempt_invalid");
  }
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== COOKIE_PREFIX) {
    return invalid("attempt_invalid");
  }
  const iv = decodeBase64url(parts[1], 12, "attempt_invalid");
  const ciphertext = decodeBase64url(parts[2], 3_000, "attempt_invalid");
  const tag = decodeBase64url(parts[3], 16, "attempt_invalid");
  if (iv.length !== 12 || tag.length !== 16) return invalid("attempt_invalid");
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(COOKIE_AAD);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return invalid("attempt_invalid");
  }
  return exactAttempt(jsonObject(plaintext, "attempt_invalid"));
}

function parseCacheLifetime(response: Response) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  const match = cacheControl.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);
  if (!match) return DEFAULT_JWKS_CACHE_MS;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return DEFAULT_JWKS_CACHE_MS;
  return Math.min(seconds * 1_000, MAX_JWKS_CACHE_MS);
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
  reason: EmployeeOidcFailureReason,
) {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
    return invalid(reason, true);
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return invalid(reason, true);
  }
  if (Buffer.byteLength(text, "utf8") > maximumBytes) return invalid(reason, true);
  return jsonObject(Buffer.from(text, "utf8"), reason);
}

function jwtAudienceMatches(audience: unknown, authorizedParty: unknown, clientId: string) {
  if (audience === clientId) {
    return authorizedParty === undefined || authorizedParty === clientId;
  }
  if (
    Array.isArray(audience)
    && audience.length > 0
    && audience.length <= 8
    && audience.every((entry) => typeof entry === "string")
    && audience.includes(clientId)
  ) {
    return authorizedParty === clientId;
  }
  return false;
}

function verifiedClaims(
  claims: JsonObject,
  config: ProductionEmployeeOidcConfig,
  expectedNonce: string,
  verifiedAt: number,
): VerifiedEmployeeOidcIdentity {
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) {
    return invalid("token_invalid");
  }
  if (!jwtAudienceMatches(claims.aud, claims.azp, config.clientId)) {
    return invalid("token_invalid");
  }
  if (
    typeof claims.exp !== "number"
    || !Number.isSafeInteger(claims.exp)
    || claims.exp * 1_000 <= verifiedAt
  ) {
    return invalid("token_invalid");
  }
  if (
    claims.iat !== undefined
    && (
      typeof claims.iat !== "number"
      || !Number.isSafeInteger(claims.iat)
      || claims.iat * 1_000 > verifiedAt + 60_000
    )
  ) {
    return invalid("token_invalid");
  }
  if (
    claims.nbf !== undefined
    && (
      typeof claims.nbf !== "number"
      || !Number.isSafeInteger(claims.nbf)
      || claims.nbf * 1_000 > verifiedAt
    )
  ) {
    return invalid("token_invalid");
  }
  if (typeof claims.nonce !== "string" || !secureEqual(claims.nonce, expectedNonce)) {
    return invalid("token_invalid");
  }
  if (claims.email_verified !== true) return invalid("token_invalid");
  if (claims.hd !== config.allowedHostedDomain) return invalid("outside_domain");
  if (typeof claims.sub !== "string" || !SAFE_SUBJECT_PATTERN.test(claims.sub)) {
    return invalid("token_invalid");
  }
  if (typeof claims.email !== "string") return invalid("token_invalid");
  const email = normalizeAuthorizationCompanyEmail(claims.email);
  if (email === null) return invalid("outside_domain");
  return Object.freeze({
    provider: "google_oidc" as const,
    issuer: CANONICAL_GOOGLE_ISSUER,
    subject: claims.sub,
    email,
    hostedDomain: AUTHORIZATION_DOMAIN,
    emailVerified: true as const,
    displayName: displayName(claims.name, email),
  });
}

function attemptCookieHeader(value: string) {
  return `${EMPLOYEE_OIDC_ATTEMPT_COOKIE_NAME}=${value}; Path=/; ` +
    `Max-Age=${Math.floor(EMPLOYEE_OIDC_ATTEMPT_LIFETIME_MS / 1_000)}; ` +
    "Secure; HttpOnly; SameSite=Lax";
}

export function readEmployeeOidcAttemptCookie(request: IncomingMessage) {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  if (Array.isArray(header) || header.length === 0 || header.length > MAX_COOKIE_HEADER_LENGTH) {
    return invalid("attempt_invalid");
  }
  const values: string[] = [];
  for (const item of header.split(";")) {
    const cookie = item.trim();
    if (cookie.length === 0) continue;
    const separator = cookie.indexOf("=");
    if (separator < 0) {
      if (cookie === EMPLOYEE_OIDC_ATTEMPT_COOKIE_NAME) {
        return invalid("attempt_invalid");
      }
      continue;
    }
    const name = cookie.slice(0, separator).trim();
    if (name !== EMPLOYEE_OIDC_ATTEMPT_COOKIE_NAME) continue;
    const value = cookie.slice(separator + 1).trim();
    if (!value) return invalid("attempt_invalid");
    values.push(value);
  }
  if (values.length === 0) return null;
  if (values.length !== 1) return invalid("attempt_invalid");
  return values[0] ?? null;
}

export function createEmployeeOidcClient(
  config: ProductionEmployeeOidcConfig,
  dependencies: EmployeeOidcDependencies = {},
): EmployeeOidcClient {
  const providerFetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const nextRandomBytes = dependencies.randomBytes ?? randomBytes;
  const encryptionKey = attemptEncryptionKey(config.sessionSecret);
  let jwksCache: JwksCache = null;

  function randomCredential() {
    const bytes = nextRandomBytes(32);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
      throw new Error("Employee OIDC random source returned invalid bytes");
    }
    return credential(canonicalBase64url(bytes), "attempt_invalid");
  }

  async function fetchJson(url: string, init: RequestInit, maximumBytes: number) {
    let response: Response;
    try {
      response = await providerFetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      return invalid("provider_unavailable", true);
    }
    if (!response.ok) return invalid("provider_unavailable", response.status >= 500);
    return {
      response,
      body: await boundedJson(response, maximumBytes, "provider_unavailable"),
    };
  }

  async function jwks(now: number, forceRefresh = false) {
    if (!forceRefresh && jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;
    const result = await fetchJson(
      GOOGLE_JWKS_ENDPOINT,
      { method: "GET", headers: { Accept: "application/json" } },
      MAX_JWKS_RESPONSE_BYTES,
    );
    const keys = result.body.keys;
    if (
      !Array.isArray(keys)
      || keys.length === 0
      || keys.length > MAX_JWKS_KEYS
      || keys.some((key) => !key || typeof key !== "object" || Array.isArray(key))
    ) {
      return invalid("provider_unavailable", true);
    }
    const frozenKeys = Object.freeze(
      keys.map((key) => Object.freeze({ ...(key as EmployeeJwk) })),
    );
    jwksCache = {
      keys: frozenKeys,
      expiresAt: now + parseCacheLifetime(result.response),
    };
    return frozenKeys;
  }

  async function verifyIdToken(idToken: unknown, expectedNonce: string, verifiedAt: number) {
    if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > MAX_ID_TOKEN_LENGTH) {
      return invalid("token_invalid");
    }
    const parts = idToken.split(".");
    if (parts.length !== 3) return invalid("token_invalid");
    const header = jsonObject(
      decodeBase64url(parts[0], MAX_JWT_HEADER_BYTES, "token_invalid"),
      "token_invalid",
    );
    const claims = jsonObject(
      decodeBase64url(parts[1], MAX_JWT_PAYLOAD_BYTES, "token_invalid"),
      "token_invalid",
    );
    const signature = decodeBase64url(parts[2], 1_024, "token_invalid");
    if (
      header.alg !== "RS256"
      || typeof header.kid !== "string"
      || header.kid.length === 0
      || header.kid.length > 255
      || header.jku !== undefined
      || header.x5u !== undefined
      || header.crit !== undefined
    ) {
      return invalid("token_invalid");
    }

    let keys = await jwks(verifiedAt);
    let key = keys.find((candidate) => candidate.kid === header.kid);
    if (!key) {
      keys = await jwks(verifiedAt, true);
      key = keys.find((candidate) => candidate.kid === header.kid);
    }
    if (
      !key
      || key.kty !== "RSA"
      || (key.use !== undefined && key.use !== "sig")
      || (key.alg !== undefined && key.alg !== "RS256")
    ) {
      return invalid("signature_invalid");
    }
    let publicKey: ReturnType<typeof createPublicKey>;
    try {
      publicKey = createPublicKey({ key, format: "jwk" });
    } catch {
      return invalid("provider_unavailable", true);
    }
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, "ascii");
    if (!verify("RSA-SHA256", signingInput, publicKey, signature)) {
      return invalid("signature_invalid");
    }
    return verifiedClaims(claims, config, expectedNonce, verifiedAt);
  }

  const client: EmployeeOidcClient = {
    initiate(invitationCredential: string | null, initiatedAt: number) {
      safeTimestamp(initiatedAt, "OIDC initiation time");
      const safeInvitation = invitationCredential === null
        ? null
        : credential(invitationCredential, "attempt_invalid");
      const state = randomCredential();
      const nonce = randomCredential();
      const pkceVerifier = randomCredential();
      const codeChallenge = createHash("sha256")
        .update(pkceVerifier, "ascii")
        .digest("base64url");
      const attempt: EmployeeOidcAttempt = Object.freeze({
        state,
        nonce,
        pkceVerifier,
        invitationCredential: safeInvitation,
        initiatedAt,
        expiresAt: initiatedAt + EMPLOYEE_OIDC_ATTEMPT_LIFETIME_MS,
      });
      const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      authorizationUrl.searchParams.set("client_id", config.clientId);
      authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", LOGIN_SCOPES);
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("nonce", nonce);
      authorizationUrl.searchParams.set("code_challenge", codeChallenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("hd", config.allowedHostedDomain);
      authorizationUrl.searchParams.set("prompt", "select_account");
      return Object.freeze({
        authorizationUrl: authorizationUrl.toString(),
        attemptCookie: attemptCookieHeader(encryptAttempt(attempt, encryptionKey, nextRandomBytes)),
      });
    },

    async complete(input: Parameters<EmployeeOidcClient["complete"]>[0]) {
      const completedAt = safeTimestamp(input.completedAt, "OIDC completion time");
      const state = credential(input.state, "state_invalid");
      if (
        typeof input.code !== "string"
        || input.code.length === 0
        || input.code.length > MAX_AUTHORIZATION_CODE_LENGTH
        || /[\u0000-\u001f\u007f]/.test(input.code)
      ) {
        return invalid("code_invalid");
      }
      // The encrypted attempt is stateless rather than server-consumed. Google makes each
      // authorization code one-use and the router clears this cookie on every callback;
      // any fresh-code reuse of a retained attempt remains bounded by the fixed expiry.
      // See docs/authorization-simulation.md for the accepted source-only boundary.
      const attempt = decryptAttempt(input.attemptCookie, encryptionKey);
      if (attempt.expiresAt <= completedAt) return invalid("attempt_expired");
      if (!secureEqual(attempt.state, state)) return invalid("state_invalid");

      const tokenBody = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: input.code,
        code_verifier: attempt.pkceVerifier,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      });
      const token = await fetchJson(
        GOOGLE_TOKEN_ENDPOINT,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: tokenBody.toString(),
        },
        MAX_TOKEN_RESPONSE_BYTES,
      );
      const identity = await verifyIdToken(token.body.id_token, attempt.nonce, completedAt);
      return Object.freeze({
        identity,
        invitationCredential: attempt.invitationCredential,
      });
    },
  };
  return Object.freeze(client);
}
