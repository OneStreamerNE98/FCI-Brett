import type { IntegrationMetadataRepository } from "../ports/integration-metadata";
import type { SecurityAuditEvent } from "../ports/security-audit";
import {
  GoogleIntegrationError,
  assertExpectedGoogleAccount,
  assertGrantedGoogleServiceScopes,
  buildGoogleAuthorizationUrl,
  decryptGoogleSecretWithStore,
  encryptGoogleSecretWithStore,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserProfile,
  type GoogleFetch,
  type GoogleRuntimeConfig,
  type GoogleSecretStore,
} from "../lib/google-oauth";

const GOOGLE_ACCOUNTS_ISSUER = "https://accounts.google.com";
const OAUTH_ATTEMPT_LIFETIME_MS = 10 * 60 * 1_000;
const OAUTH_ATTEMPT_PURGE_DELAY_MS = 24 * 60 * 60 * 1_000;

export type ProductionGoogleOauthDependencies = Readonly<{
  repository: IntegrationMetadataRepository;
  secrets: GoogleSecretStore;
  fetch: GoogleFetch;
  now: () => number;
  randomUUID: () => string;
  randomBytes: (byteLength: number) => Uint8Array;
}>;

export type BeginProductionGoogleOauth = Readonly<{
  connectionId: string;
  initiatedByUserId: string;
  browserNonce: string;
  audit: SecurityAuditEvent;
}>;

export type FinishProductionGoogleOauth = Readonly<{
  connectionId: string;
  expectedConnectionVersion: string;
  expectedAttemptVersion: string;
  initiatedByUserId: string;
  completedByActorKey: string;
  browserNonce: string;
  state: string;
  code: string;
  consumeAudit: SecurityAuditEvent;
  completionAudit: SecurityAuditEvent;
}>;

export type RotateProductionGoogleCredential = Readonly<{
  connectionId: string;
  audit: SecurityAuditEvent;
}>;

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function randomValue(dependencies: ProductionGoogleOauthDependencies, byteLength: number) {
  const bytes = dependencies.randomBytes(byteLength);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== byteLength) {
    throw new GoogleIntegrationError("invalid_random_source", "Google authorization could not start safely.", 503);
  }
  return base64Url(bytes);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function ciphertextBytes(value: string) {
  return new TextEncoder().encode(value);
}

function ciphertextText(value: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  if (text.length === 0 || text.length > 16_384) {
    throw new GoogleIntegrationError("invalid_ciphertext", "Stored Google authorization needs to be reconnected.", 409);
  }
  return text;
}

function pkceContext(connectionId: string, attemptId: string) {
  return `google-integration:${connectionId}:oauth-attempt:${attemptId}:pkce`;
}

function refreshContext(connectionId: string) {
  return `google-integration:${connectionId}:refresh-token`;
}

function requireProductionConfig(config: GoogleRuntimeConfig) {
  if (config.simulation || !config.oauthReady) {
    throw new GoogleIntegrationError("configuration_required", "Google Workspace production setup is incomplete.", 503);
  }
}

/** Decrypts an exact stored refresh-token version; it never falls back to the current writer key. */
export function decryptProductionGoogleCredential(
  connectionId: string,
  ciphertext: Uint8Array,
  keyVersion: string,
  secrets: GoogleSecretStore,
) {
  return decryptGoogleSecretWithStore(
    ciphertextText(ciphertext),
    keyVersion,
    secrets,
    refreshContext(connectionId),
  );
}

/**
 * Source-only production OAuth workflow. No provider route composes this service
 * until Gate C and its credential-specific database grants are approved.
 */
export function createProductionGoogleOauth(
  config: GoogleRuntimeConfig,
  dependencies: ProductionGoogleOauthDependencies,
) {
  requireProductionConfig(config);

  return Object.freeze({
    async begin(input: BeginProductionGoogleOauth) {
      const id = dependencies.randomUUID();
      const state = randomValue(dependencies, 32);
      const verifier = randomValue(dependencies, 48);
      const encrypted = await encryptGoogleSecretWithStore(
        verifier,
        dependencies.secrets,
        pkceContext(input.connectionId, id),
      );
      const createdAt = dependencies.now();
      const result = await dependencies.repository.createOauthAttempt({
        id,
        connectionId: input.connectionId,
        initiatedByUserId: input.initiatedByUserId,
        stateHash: await sha256Hex(state),
        browserNonceHash: await sha256Hex(input.browserNonce),
        pkceVerifierCiphertext: ciphertextBytes(encrypted.ciphertext),
        keyVersion: encrypted.keyVersion,
        requestedScopes: config.scopes,
        expiresAt: createdAt + OAUTH_ATTEMPT_LIFETIME_MS,
        purgeAfter: createdAt + OAUTH_ATTEMPT_PURGE_DELAY_MS,
        createdAt,
        audit: input.audit,
      });
      if (result.outcome !== "accepted") {
        throw new GoogleIntegrationError("oauth_attempt_conflict", "Google authorization could not start safely. Try again.", 409);
      }
      const challenge = await pkceChallenge(verifier);
      return Object.freeze({
        attemptId: id,
        attemptVersion: result.version,
        state,
        authorizationUrl: buildGoogleAuthorizationUrl(config, state, challenge),
      });
    },

    async finish(input: FinishProductionGoogleOauth) {
      const consumedAt = dependencies.now();
      const consumed = await dependencies.repository.consumeOauthAttempt({
        connectionId: input.connectionId,
        stateHash: await sha256Hex(input.state),
        browserNonceHash: await sha256Hex(input.browserNonce),
        initiatedByUserId: input.initiatedByUserId,
        consumedAt,
        expectedVersion: input.expectedAttemptVersion,
        audit: input.consumeAudit,
      });
      if (consumed.outcome !== "consumed") {
        throw new GoogleIntegrationError("invalid_oauth_state", "Google authorization expired or was already used. Start again.", 400);
      }
      const verifier = await decryptGoogleSecretWithStore(
        ciphertextText(consumed.value.pkceVerifierCiphertext),
        consumed.value.keyVersion,
        dependencies.secrets,
        pkceContext(input.connectionId, consumed.value.id),
      );
      const tokens = await exchangeGoogleAuthorizationCode(config, input.code, verifier, dependencies.fetch);
      assertGrantedGoogleServiceScopes(config, tokens.scope);
      const profile = await fetchGoogleUserProfile(tokens.accessToken, dependencies.fetch);
      assertExpectedGoogleAccount(config, profile);
      if (!tokens.refreshToken) {
        throw new GoogleIntegrationError(
          "refresh_token_missing",
          "Google did not issue a reusable authorization. Remove this app from the Google Account and connect again.",
          409,
        );
      }
      const refresh = await encryptGoogleSecretWithStore(
        tokens.refreshToken,
        dependencies.secrets,
        refreshContext(input.connectionId),
      );
      const hostedDomain = profile.email.split("@")[1] ?? "";
      const completed = await dependencies.repository.completeOauthConnection({
        connectionId: input.connectionId,
        expectedConnectionVersion: input.expectedConnectionVersion,
        issuer: GOOGLE_ACCOUNTS_ISSUER,
        externalSubject: profile.subject,
        externalEmail: profile.email,
        hostedDomain,
        credentialId: dependencies.randomUUID(),
        refreshTokenCiphertext: ciphertextBytes(refresh.ciphertext),
        keyVersion: refresh.keyVersion,
        grantedScopes: tokens.scope,
        completedByUserId: input.initiatedByUserId,
        completedByActorKey: input.completedByActorKey,
        completedAt: dependencies.now(),
        audit: input.completionAudit,
      });
      if (completed.outcome !== "accepted") {
        const code = completed.outcome === "stale"
          ? "stale_google_connection"
          : "google_connection_conflict";
        throw new GoogleIntegrationError(code, "Google authorization could not be saved safely. Start again.", 409);
      }
      return Object.freeze({
        connectionVersion: completed.version,
        account: profile.email,
        grantedScopes: Object.freeze([...tokens.scope]),
      });
    },

    async rotateRefreshCredential(input: RotateProductionGoogleCredential) {
      const stored = await dependencies.repository.getActiveCredential(
        input.connectionId,
        "refresh_token",
      );
      if (!stored) {
        throw new GoogleIntegrationError(
          "google_credential_missing",
          "Google authorization needs to be reconnected.",
          409,
        );
      }
      const current = await dependencies.secrets.current();
      if (stored.keyVersion === current.version) {
        return Object.freeze({ rotated: false, version: stored.version, keyVersion: stored.keyVersion });
      }
      const plaintext = await decryptProductionGoogleCredential(
        input.connectionId,
        stored.ciphertext,
        stored.keyVersion,
        dependencies.secrets,
      );
      const encrypted = await encryptGoogleSecretWithStore(
        plaintext,
        dependencies.secrets,
        refreshContext(input.connectionId),
      );
      const verified = await decryptProductionGoogleCredential(
        input.connectionId,
        ciphertextBytes(encrypted.ciphertext),
        encrypted.keyVersion,
        dependencies.secrets,
      );
      if (verified !== plaintext) {
        throw new GoogleIntegrationError(
          "credential_rotation_verification_failed",
          "Google credential rotation could not be verified.",
          503,
        );
      }
      const rotated = await dependencies.repository.rotateCredential({
        connectionId: input.connectionId,
        credentialId: stored.id,
        credentialKind: stored.credentialKind,
        expectedVersion: stored.version,
        ciphertext: ciphertextBytes(encrypted.ciphertext),
        keyVersion: encrypted.keyVersion,
        rotatedAt: dependencies.now(),
        audit: input.audit,
      });
      if (rotated.outcome !== "accepted") {
        throw new GoogleIntegrationError(
          "stale_google_credential",
          "Google credential changed during rotation. Retry safely.",
          409,
        );
      }
      return Object.freeze({
        rotated: true,
        version: rotated.version,
        keyVersion: encrypted.keyVersion,
      });
    },
  });
}
