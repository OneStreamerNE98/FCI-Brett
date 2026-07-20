import { env } from "cloudflare:workers";

import { createD1GoogleOauthPersistence } from "../adapters/d1/google-oauth-persistence";
import * as oauth from "./google-oauth";

export * from "./google-oauth";

function providerFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, init);
}

export function getGoogleRuntimeConfig(input?: oauth.EnvironmentValues) {
  return oauth.getGoogleRuntimeConfig(input ?? env as unknown as oauth.EnvironmentValues);
}

function currentKeyOnlySecrets(config: oauth.GoogleRuntimeConfig): oauth.GoogleSecretStore {
  let resolved: oauth.GoogleSecretStore | undefined;
  const keyring = () => resolved ??= oauth.createCurrentGoogleSecretStore(config);
  return Object.freeze({
    current: () => keyring().current(),
    get: (version: string) => keyring().get(version),
  });
}

export function getSitesGoogleOauthDependencies(
  config: oauth.GoogleRuntimeConfig,
): oauth.GoogleOauthDependencies {
  return Object.freeze({
    persistence: createD1GoogleOauthPersistence(env.DB),
    // Keep configuration/status reads available while deferring secret validation
    // until an operation actually encrypts or decrypts connector material.
    secrets: currentKeyOnlySecrets(config),
    fetch: providerFetch,
    now: Date.now,
    randomUUID: () => crypto.randomUUID(),
  });
}

function operations(config: oauth.GoogleRuntimeConfig) {
  return oauth.createGoogleOauthOperations(config, getSitesGoogleOauthDependencies(config));
}

export function createGoogleOauthAttempt(
  config: oauth.GoogleRuntimeConfig,
  initiatedBy: string,
  browserNonce: string,
) {
  return operations(config).createOauthAttempt(initiatedBy, browserNonce);
}

export function consumeGoogleOauthAttempt(
  config: oauth.GoogleRuntimeConfig,
  state: string,
  browserNonce: string,
  requesterEmail: string,
) {
  return operations(config).consumeOauthAttempt(state, browserNonce, requesterEmail);
}

export function exchangeGoogleAuthorizationCode(
  config: oauth.GoogleRuntimeConfig,
  code: string,
  verifier: string,
) {
  return operations(config).exchangeAuthorizationCode(code, verifier);
}

export function fetchGoogleUserProfile(accessToken: string) {
  return oauth.fetchGoogleUserProfile(accessToken, providerFetch);
}

export function getGoogleConnectionStatus(config: oauth.GoogleRuntimeConfig) {
  return operations(config).connectionStatus();
}

export function disconnectGoogleConnection(config: oauth.GoogleRuntimeConfig) {
  return operations(config).disconnect();
}

export function saveGoogleConnection(
  config: oauth.GoogleRuntimeConfig,
  tokens: oauth.GoogleTokenSet,
  profile: oauth.GoogleUserProfile,
  actor: string,
) {
  return operations(config).saveConnection(tokens, profile, actor);
}

export function getGoogleAccessToken(
  config: oauth.GoogleRuntimeConfig,
  requiredService?: oauth.GoogleService,
) {
  return operations(config).accessToken(requiredService);
}

export function writeGoogleIntegrationEvent(
  config: oauth.GoogleRuntimeConfig,
  eventType: string,
  actor: string,
  entityType?: string,
  entityId?: string,
  detail?: string,
) {
  return operations(config).writeEvent(eventType, actor, entityType, entityId, detail);
}
