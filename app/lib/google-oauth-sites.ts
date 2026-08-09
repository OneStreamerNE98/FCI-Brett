import { env } from "cloudflare:workers";

import type { D1Database } from "../adapters/d1/d1-database";
import { createD1GoogleOauthPersistence } from "../adapters/d1/google-oauth-persistence";
import { createD1WorkspaceSettingsRepository } from "../adapters/d1/workspace-settings-repository";
import { getWorkspaceBlueprint } from "../adapters/d1/workspace-blueprints";
import { listWorkspaceResources } from "../adapters/d1/workspace-resources";
import {
  normalizeWorkspacePreferences,
  WORKSPACE_SETTINGS_ID,
} from "../domain/workspace-settings";
import type { WorkspaceSettingsRecord } from "../ports/workspace-settings-repository";
import * as oauth from "./google-oauth";
import { seedWorkspaceBlueprint, type WorkspaceBlueprint } from "./workspace-blueprint";
import {
  applyEffectiveWorkspaceConfig,
  resolveEffectiveWorkspaceResources,
  type EffectiveGoogleRuntimeConfig,
  type EffectiveWorkspaceResources,
} from "./workspace-effective-config";

export * from "./google-oauth";

function providerFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, init);
}

export function getGoogleRuntimeConfig(input?: oauth.EnvironmentValues) {
  return oauth.getGoogleRuntimeConfig(input ?? env as unknown as oauth.EnvironmentValues);
}

/** Cheap synchronous scope for list routes; it performs no persistence reads. */
export function getConnectionScope(input?: oauth.EnvironmentValues) {
  const config = getGoogleRuntimeConfig(input);
  return Object.freeze({
    connectionKey: config.connectionKey,
    simulation: config.simulation,
  });
}

export type GoogleConnectionScopes = Readonly<{
  workspaceConnectionKey: string;
  mailboxConnectionKeys: readonly string[];
  simulation: boolean;
}>;

/**
 * Server-only data scopes for readers that must span every attached mailbox.
 *
 * The stable workspace key remains in the mailbox set for legacy Gmail rows
 * written before WS-20 introduced per-mailbox keys. Callers never return these
 * internal keys to the browser.
 */
export async function getGoogleConnectionScopes(
  input?: oauth.EnvironmentValues,
): Promise<GoogleConnectionScopes> {
  const config = getGoogleRuntimeConfig(input);
  if (config.simulation) {
    return Object.freeze({
      workspaceConnectionKey: config.workspaceConnectionKey,
      mailboxConnectionKeys: Object.freeze([config.workspaceConnectionKey]),
      simulation: true,
    });
  }
  const connectionKeys = await googleOauthPersistence().listConnectionKeys();
  return Object.freeze({
    workspaceConnectionKey: config.workspaceConnectionKey,
    mailboxConnectionKeys: Object.freeze([
      ...new Set([
        config.workspaceConnectionKey,
        ...connectionKeys,
      ]),
    ]),
    simulation: false,
  });
}

type GoogleConnectionIdentityRow = Readonly<{
  google_email: string;
  status: string;
}>;

type SetupGoogleConnection = Readonly<{
  id: string;
  connectionKey: string;
  googleEmail: string;
  status: string;
  refreshTokenCiphertext?: string;
}>;

function googleOauthPersistence() {
  return createD1GoogleOauthPersistence(env.DB);
}

function normalizedMailboxEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  if (!email) return undefined;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new oauth.GoogleIntegrationError(
      "invalid_google_mailbox",
      "Choose a valid attached Google mailbox.",
      400,
    );
  }
  return email;
}

function connectionIdentity(connection: SetupGoogleConnection | null) {
  if (!connection) return null;
  return Object.freeze({
    google_email: connection.googleEmail,
    status: connection.status,
  }) satisfies GoogleConnectionIdentityRow;
}

async function findSetupGoogleConnection(
  baseConfig: oauth.GoogleRuntimeConfig,
  selectedMailboxEmail: string | undefined,
  includeCredentialGeneration: boolean,
): Promise<SetupGoogleConnection | null> {
  if (baseConfig.simulation) return null;
  if (includeCredentialGeneration) {
    return selectedMailboxEmail
      ? googleOauthPersistence().findConnectionByGoogleEmail(selectedMailboxEmail)
      : googleOauthPersistence().findConnection(baseConfig.authConnectionKey);
  }
  const row = selectedMailboxEmail
    ? await env.DB.prepare(
      "SELECT id, connection_key, google_email, status FROM google_connections WHERE lower(google_email) = ? ORDER BY updated_at DESC LIMIT 1",
    ).bind(selectedMailboxEmail).first<{
      id: string;
      connection_key: string;
      google_email: string;
      status: string;
    }>()
    : await env.DB.prepare(
      "SELECT id, connection_key, google_email, status FROM google_connections WHERE connection_key = ?",
    ).bind(baseConfig.authConnectionKey).first<{
      id: string;
      connection_key: string;
      google_email: string;
      status: string;
    }>();
  return row ? Object.freeze({
    id: row.id,
    connectionKey: row.connection_key,
    googleEmail: row.google_email,
    status: row.status,
  }) : null;
}

function applyConnectedMailboxReadiness(
  config: EffectiveGoogleRuntimeConfig,
  identity: GoogleConnectionIdentityRow | null,
  selectedMailboxEmail: string | undefined,
): EffectiveGoogleRuntimeConfig {
  const selected = normalizedMailboxEmail(selectedMailboxEmail);
  const connected = normalizedMailboxEmail(identity?.google_email);
  if (
    !identity
    || identity.status === "revoked"
    || !selected
    || connected !== selected
  ) {
    return config;
  }
  const missingDetails = config.missingDetails.filter(
    ({ envVar }) => envVar !== "GOOGLE_WORKSPACE_INTAKE_MAILBOX",
  );
  if (missingDetails.length === config.missingDetails.length) return config;
  return Object.freeze({
    ...config,
    missingDetails: Object.freeze(missingDetails),
    missing: Object.freeze(missingDetails.map(({ label }) => label)),
    oauthReady: config.simulation || missingDetails.length === 0,
  });
}

export type EffectiveGoogleRuntimeSetup = Readonly<{
  config: EffectiveGoogleRuntimeConfig;
  connectionIdentity: GoogleConnectionIdentityRow | null;
  resources: Awaited<ReturnType<typeof listWorkspaceResources>>;
  effectiveResources: EffectiveWorkspaceResources;
  blueprint: WorkspaceBlueprint;
  blueprintVersion: number;
}>;

function savedWorkspaceRuntimeValues(
  record: WorkspaceSettingsRecord | null,
) {
  const preferences = normalizeWorkspacePreferences(record?.settings);
  return Object.freeze({
    clientDirectorySheetId: record?.clientDirectorySheetId,
    clientAppointmentsCalendarId: preferences.appointmentCalendarId,
    fieldScheduleCalendarId: preferences.fieldCalendarId,
    intakeMailbox: preferences.intakeMailbox,
    driveProvisioningEnabled:
      typeof record?.settings.driveProvisioningEnabled === "boolean"
        ? record.settings.driveProvisioningEnabled
        : null,
  });
}

async function loadEffectiveGoogleRuntimeSetup(
  mailboxEmail?: string | null,
  mailboxScoped = false,
  includeCredentialGeneration = true,
): Promise<EffectiveGoogleRuntimeSetup> {
  const baseConfig = getGoogleRuntimeConfig();
  const workspaceSettings = createD1WorkspaceSettingsRepository(
    env.DB as unknown as D1Database,
  );
  const [savedRows, persistedBlueprint, persistedSettings] = await Promise.all([
    listWorkspaceResources(env.DB, baseConfig.workspaceConnectionKey),
    getWorkspaceBlueprint(env.DB, baseConfig.workspaceConnectionKey),
    workspaceSettings.findById(WORKSPACE_SETTINGS_ID),
  ]);
  const savedValues = savedWorkspaceRuntimeValues(persistedSettings);
  const requestedMailbox = normalizedMailboxEmail(mailboxEmail);
  const simulationMailbox = normalizedMailboxEmail(baseConfig.selectedMailboxEmail);
  if (
    baseConfig.simulation
    && requestedMailbox
    && requestedMailbox !== simulationMailbox
  ) {
    throw new oauth.GoogleIntegrationError(
      "google_mailbox_not_connected",
      "That Google mailbox is not attached to this workspace.",
      404,
    );
  }
  const selectedMailboxEmail = requestedMailbox
    ?? normalizedMailboxEmail(savedValues.intakeMailbox)
    ?? normalizedMailboxEmail(baseConfig.intakeMailbox);
  const storedConnection = await findSetupGoogleConnection(
    baseConfig,
    selectedMailboxEmail,
    includeCredentialGeneration,
  );
  if (requestedMailbox && !baseConfig.simulation && !storedConnection) {
    throw new oauth.GoogleIntegrationError(
      "google_mailbox_not_connected",
      "That Google mailbox is not attached to this workspace.",
      404,
    );
  }
  const identity = connectionIdentity(storedConnection);
  const blueprint = persistedBlueprint?.blueprint ?? seedWorkspaceBlueprint();
  const effectiveResources = resolveEffectiveWorkspaceResources(
    baseConfig,
    savedRows,
    savedValues,
  );
  const effective = applyConnectedMailboxReadiness(
    applyEffectiveWorkspaceConfig(
      baseConfig,
      effectiveResources,
      requestedMailbox
        ? Object.freeze({ ...savedValues, intakeMailbox: requestedMailbox })
        : savedValues,
      identity && identity.status !== "revoked" ? identity.google_email : null,
    ),
    identity,
    selectedMailboxEmail,
  );
  const namedConfig = Object.freeze({
    ...effective,
    connectionKey: mailboxScoped && storedConnection
      ? storedConnection.connectionKey
      : baseConfig.workspaceConnectionKey,
    authConnectionKey: storedConnection?.connectionKey ?? baseConfig.authConnectionKey,
    ...(storedConnection ? { authConnectionId: storedConnection.id } : {}),
    ...(storedConnection ? { authConnectionEmail: storedConnection.googleEmail } : {}),
    ...(storedConnection?.refreshTokenCiphertext ? {
      authConnectionRefreshTokenCiphertext: storedConnection.refreshTokenCiphertext,
    } : {}),
    workspaceConnectionKey: baseConfig.workspaceConnectionKey,
    selectedMailboxEmail,
    drive: Object.freeze({
      ...effective.drive,
      storageName: baseConfig.simulation
        ? `${blueprint.drive.sharedDriveName} (local simulation)`
        : blueprint.drive.sharedDriveName,
    }),
  });
  return Object.freeze({
    config: namedConfig,
    connectionIdentity: identity,
    resources: Object.freeze([...savedRows]),
    effectiveResources,
    blueprint,
    blueprintVersion: persistedBlueprint?.version ?? 0,
  });
}

export function getEffectiveGoogleRuntimeSetup(
  mailboxEmail?: string | null,
  options?: Readonly<{ includeCredentialGeneration?: boolean }>,
): Promise<EffectiveGoogleRuntimeSetup> {
  return loadEffectiveGoogleRuntimeSetup(
    mailboxEmail,
    false,
    options?.includeCredentialGeneration !== false,
  );
}

export async function getEffectiveGoogleRuntimeConfig(): Promise<EffectiveGoogleRuntimeConfig> {
  const baseConfig = getGoogleRuntimeConfig();
  const workspaceSettings = createD1WorkspaceSettingsRepository(
    env.DB as unknown as D1Database,
  );
  const [savedRows, persistedSettings] = await Promise.all([
    listWorkspaceResources(env.DB, baseConfig.workspaceConnectionKey),
    workspaceSettings.findById(WORKSPACE_SETTINGS_ID),
  ]);
  const savedValues = savedWorkspaceRuntimeValues(persistedSettings);
  const selectedMailboxEmail = normalizedMailboxEmail(savedValues.intakeMailbox)
    ?? normalizedMailboxEmail(baseConfig.intakeMailbox);
  const storedConnection = baseConfig.simulation
    ? null
    : selectedMailboxEmail
      ? await googleOauthPersistence().findConnectionByGoogleEmail(selectedMailboxEmail)
      : await googleOauthPersistence().findConnection(baseConfig.authConnectionKey);
  const identity = connectionIdentity(storedConnection);
  const effective = applyConnectedMailboxReadiness(
    applyEffectiveWorkspaceConfig(
      baseConfig,
      resolveEffectiveWorkspaceResources(
        baseConfig,
        savedRows,
        savedValues,
      ),
      savedValues,
      identity && identity.status !== "revoked" ? identity.google_email : null,
    ),
    identity,
    selectedMailboxEmail,
  );
  return Object.freeze({
    ...effective,
    connectionKey: baseConfig.workspaceConnectionKey,
    authConnectionKey: storedConnection?.connectionKey ?? baseConfig.authConnectionKey,
    ...(storedConnection ? { authConnectionId: storedConnection.id } : {}),
    ...(storedConnection ? { authConnectionEmail: storedConnection.googleEmail } : {}),
    ...(storedConnection ? {
      authConnectionRefreshTokenCiphertext: storedConnection.refreshTokenCiphertext,
    } : {}),
    workspaceConnectionKey: baseConfig.workspaceConnectionKey,
    selectedMailboxEmail,
  });
}

/** Selected Gmail mailbox config: both data and credential scopes use its key. */
export async function getGoogleMailboxRuntimeConfig(mailboxEmail?: string | null) {
  return (await loadEffectiveGoogleRuntimeSetup(mailboxEmail, true)).config;
}

export async function resolveGoogleMailboxConnectionConfig<TConfig extends oauth.GoogleRuntimeConfig>(
  config: TConfig,
  profile: oauth.GoogleUserProfile,
) {
  return oauth.resolveGoogleMailboxConnectionConfig(
    config,
    profile,
    getSitesGoogleOauthDependencies(config),
  );
}

export type GoogleMailboxConnectionSummary = Readonly<{
  email: string;
  status: string;
  connected: boolean;
  services: Readonly<Record<oauth.GoogleService, boolean>>;
  grantedServices: Readonly<Record<oauth.GoogleService, boolean>> | null;
  requiresReauthorization: boolean;
}>;

export async function listGoogleMailboxConnections(
  config: oauth.GoogleRuntimeConfig = getGoogleRuntimeConfig(),
): Promise<readonly GoogleMailboxConnectionSummary[]> {
  if (config.simulation) {
    const status = await getGoogleConnectionStatus(config);
    return Object.freeze([Object.freeze({
      email: config.selectedMailboxEmail ?? "workspace-simulation@fci.example",
      status: status.status,
      connected: status.connected,
      services: status.services,
      grantedServices: status.grantedServices,
      requiresReauthorization: status.requiresReauthorization,
    })]);
  }
  const connections = (await googleOauthPersistence().listConnectionMetadata()).filter(
    (connection) => connection.status !== "revoked",
  );
  return Object.freeze(connections.map((connection) => {
    const mailboxConfig = Object.freeze({
      ...config,
      authConnectionKey: connection.connectionKey,
      authConnectionId: connection.id,
      authConnectionEmail: connection.googleEmail,
      selectedMailboxEmail: connection.googleEmail,
    });
    const status = oauth.describeGoogleConnectionStatus(mailboxConfig, connection);
    return Object.freeze({
      email: connection.googleEmail,
      status: status.status,
      connected: status.connected,
      services: status.services,
      grantedServices: status.grantedServices,
      requiresReauthorization: status.requiresReauthorization,
    });
  }));
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

export function disconnectGoogleConnection(config: oauth.GoogleRuntimeConfig, actor: string) {
  return operations(config).disconnect(actor);
}

export function saveGoogleConnection(
  config: oauth.GoogleRuntimeConfig,
  tokens: oauth.GoogleTokenSet,
  profile: oauth.GoogleUserProfile,
  actor: string,
  oauthAttemptId?: string,
) {
  return operations(config).saveConnection(tokens, profile, actor, oauthAttemptId);
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

export function writeGoogleOauthAttemptEvent(
  config: oauth.GoogleRuntimeConfig,
  attemptId: string,
  phase: "pending" | "consumed",
  eventType: string,
  actor: string,
  entityType?: string,
  entityId?: string,
  detail?: string,
) {
  return operations(config).writeAttemptEvent(
    attemptId,
    phase,
    eventType,
    actor,
    entityType,
    entityId,
    detail,
  );
}
