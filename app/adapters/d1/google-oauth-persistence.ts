import type {
  GoogleOauthPersistence,
  StoredGoogleConnection,
  StoredGoogleConnectionMetadata,
  StoredGoogleOauthAttempt,
} from "../../lib/google-oauth";

type D1RunResultLike = Readonly<{ meta?: Readonly<{ changes?: number }> }>;

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<Readonly<{ results?: T[] }>>;
  run(): Promise<D1RunResultLike>;
};

export type D1GoogleOauthDatabase = Readonly<{
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1RunResultLike[]>;
}>;

type OauthAttemptRow = Readonly<{
  id: string;
  connection_key: string;
  pkce_verifier_ciphertext: string;
  browser_nonce_hash: string;
  initiated_by: string;
  expires_at: number;
  consumed_at: number | null;
}>;

type ConnectionRow = Readonly<{
  id: string;
  connection_key: string;
  google_subject: string;
  google_email: string;
  refresh_token_ciphertext: string;
  key_version: string;
  scopes_json?: string;
  status: string;
}>;

type ConnectionKeyRow = Readonly<{
  connection_key: string;
}>;

type ConnectionMetadataRow = Readonly<{
  id: string;
  connection_key: string;
  google_subject: string;
  google_email: string;
  scopes_json?: string;
  status: string;
}>;

function oauthAttempt(row: OauthAttemptRow | null): StoredGoogleOauthAttempt | null {
  if (!row) return null;
  return {
    id: row.id,
    connectionKey: row.connection_key,
    pkceVerifierCiphertext: row.pkce_verifier_ciphertext,
    browserNonceHash: row.browser_nonce_hash,
    initiatedBy: row.initiated_by,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function connection(row: ConnectionRow | null): StoredGoogleConnection | null {
  if (!row) return null;
  return {
    id: row.id,
    connectionKey: row.connection_key,
    googleSubject: row.google_subject,
    googleEmail: row.google_email,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    keyVersion: row.key_version,
    scopesJson: row.scopes_json,
    status: row.status,
  };
}

function connectionMetadata(row: ConnectionMetadataRow): StoredGoogleConnectionMetadata {
  return {
    id: row.id,
    connectionKey: row.connection_key,
    googleSubject: row.google_subject,
    googleEmail: row.google_email,
    scopesJson: row.scopes_json,
    status: row.status,
  };
}

/** Thin D1 adapter retained only for the controlled Sites development connector. */
export function createD1GoogleOauthPersistence(database: D1GoogleOauthDatabase): GoogleOauthPersistence {
  return Object.freeze({
    async createOauthAttempt(input) {
      await database.prepare("INSERT INTO google_oauth_attempts (id, connection_key, state_hash, pkce_verifier_ciphertext, browser_nonce_hash, initiated_by, scopes_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          input.id,
          input.connectionKey,
          input.stateHash,
          input.pkceVerifierCiphertext,
          input.browserNonceHash,
          input.initiatedBy,
          input.scopesJson,
          input.expiresAt,
          input.createdAt,
        )
        .run();
    },

    async findOauthAttemptByStateHash(stateHash) {
      const row = await database.prepare("SELECT id, connection_key, pkce_verifier_ciphertext, browser_nonce_hash, initiated_by, expires_at, consumed_at FROM google_oauth_attempts WHERE state_hash = ?")
        .bind(stateHash)
        .first<OauthAttemptRow>();
      return oauthAttempt(row);
    },

    async consumeOauthAttempt(id, consumedAt) {
      const result = await database.prepare("UPDATE google_oauth_attempts SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at >= ?")
        .bind(consumedAt, id, consumedAt)
        .run();
      return result.meta?.changes === 1;
    },

    async findConnection(connectionKey) {
      const row = await database.prepare("SELECT id, connection_key, google_subject, google_email, refresh_token_ciphertext, key_version, scopes_json, status FROM google_connections WHERE connection_key = ?")
        .bind(connectionKey)
        .first<ConnectionRow>();
      return connection(row);
    },

    async findConnectionByGoogleSubject(googleSubject) {
      const row = await database.prepare("SELECT id, connection_key, google_subject, google_email, refresh_token_ciphertext, key_version, scopes_json, status FROM google_connections WHERE google_subject = ? ORDER BY updated_at DESC LIMIT 1")
        .bind(googleSubject)
        .first<ConnectionRow>();
      return connection(row);
    },

    async findConnectionByGoogleEmail(googleEmail) {
      const row = await database.prepare("SELECT id, connection_key, google_subject, google_email, refresh_token_ciphertext, key_version, scopes_json, status FROM google_connections WHERE lower(google_email) = ? ORDER BY updated_at DESC LIMIT 1")
        .bind(googleEmail.trim().toLowerCase())
        .first<ConnectionRow>();
      return connection(row);
    },

    async listConnectionKeys() {
      const result = await database.prepare("SELECT connection_key FROM google_connections ORDER BY connection_key")
        .all<ConnectionKeyRow>();
      return Object.freeze((result.results ?? []).map((row) => row.connection_key));
    },

    async listConnectionMetadata() {
      const result = await database.prepare("SELECT id, connection_key, google_subject, google_email, scopes_json, status FROM google_connections ORDER BY lower(google_email), connection_key")
        .all<ConnectionMetadataRow>();
      return Object.freeze((result.results ?? []).map(connectionMetadata));
    },

    async hasTenantScopedData(connectionKey) {
      const row = await database.prepare(`SELECT 1 AS tenant_data_exists
        WHERE EXISTS (SELECT 1 FROM google_form_lead_reviews WHERE connection_key = ?)
           OR EXISTS (SELECT 1 FROM google_form_lead_intake_watermarks WHERE connection_key = ?)
           OR EXISTS (SELECT 1 FROM mail_items WHERE connection_key = ?)
           OR EXISTS (
             SELECT 1
               FROM gmail_file_archives AS archives
               LEFT JOIN gmail_file_archive_artifacts AS artifacts ON artifacts.archive_id = archives.id
              WHERE archives.connection_key = ?
           )
           OR EXISTS (SELECT 1 FROM drive_folder_mappings WHERE connection_key = ?)
           OR EXISTS (SELECT 1 FROM google_drive_operations WHERE connection_key = ?)
           OR EXISTS (SELECT 1 FROM google_sheet_sync_state WHERE connection_key = ?)
           OR EXISTS (SELECT 1 FROM workspace_resources WHERE connection_key = ?)
           OR EXISTS (SELECT 1 FROM workspace_blueprints WHERE connection_key = ?)
           OR EXISTS (SELECT 1 FROM clients WHERE drive_folder_id IS NOT NULL OR drive_url IS NOT NULL)
           OR EXISTS (SELECT 1 FROM projects WHERE drive_folder_id IS NOT NULL OR drive_url IS NOT NULL)
           OR EXISTS (
             SELECT 1
               FROM workspace_settings
              WHERE shared_drive_id IS NOT NULL
                 OR client_directory_sheet_id IS NOT NULL
                 OR intake_mailbox IS NOT NULL
                 OR CASE WHEN json_valid(settings_json) THEN NULLIF(json_extract(settings_json, '$.appointmentCalendarId'), '') END IS NOT NULL
                 OR CASE WHEN json_valid(settings_json) THEN NULLIF(json_extract(settings_json, '$.fieldCalendarId'), '') END IS NOT NULL
                 OR CASE WHEN json_valid(settings_json) THEN NULLIF(json_extract(settings_json, '$.intakeMailbox'), '') END IS NOT NULL
           )
        LIMIT 1`)
        .bind(
          connectionKey,
          connectionKey,
          connectionKey,
          connectionKey,
          connectionKey,
          connectionKey,
          connectionKey,
          connectionKey,
          connectionKey,
        )
        .first<{ tenant_data_exists: number }>();
      return row?.tenant_data_exists === 1;
    },

    async revokeConnection(input) {
      const [, operationResult, result, eventResult] = await database.batch([
        database.prepare("UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = 'oauth_disconnect_interrupted', updated_at = ? WHERE connection_key IN (?, ?) AND operation_key = connection_key || ':oauth:disconnect' AND status = 'in-progress' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?")
          .bind(
            input.revokedAt,
            input.workspaceConnectionKey,
            input.connectionKey,
            input.revokedAt,
          ),
        database.prepare("INSERT INTO google_drive_operations (id, connection_key, operation_key, project_id, status, lease_expires_at, last_error_code, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, 'in-progress', ?, NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM google_connections WHERE id = ? AND connection_key = ? AND refresh_token_ciphertext = ? AND status <> 'revoked') AND NOT EXISTS (SELECT 1 FROM google_drive_operations WHERE connection_key IN (?, ?) AND status IN ('in-progress', 'committing')) ON CONFLICT(operation_key) DO UPDATE SET id = excluded.id, connection_key = excluded.connection_key, project_id = excluded.project_id, status = 'in-progress', lease_expires_at = excluded.lease_expires_at, last_error_code = NULL, created_by = excluded.created_by, created_at = excluded.created_at, updated_at = excluded.updated_at WHERE google_drive_operations.status NOT IN ('in-progress', 'committing')")
          .bind(
            input.operationId,
            input.connectionKey,
            input.operationKey,
            input.connectionId,
            input.leaseExpiresAt,
            input.event.actor,
            input.revokedAt,
            input.revokedAt,
            input.connectionId,
            input.connectionKey,
            input.refreshTokenCiphertext,
            input.workspaceConnectionKey,
            input.connectionKey,
          ),
        database.prepare("UPDATE google_connections SET refresh_token_ciphertext = '', key_version = '', status = 'revoked', last_error_code = NULL, updated_at = ?, revoked_at = ? WHERE id = ? AND connection_key = ? AND refresh_token_ciphertext = ? AND EXISTS (SELECT 1 FROM google_drive_operations WHERE id = ? AND operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?)")
          .bind(
            input.revokedAt,
            input.revokedAt,
            input.connectionId,
            input.connectionKey,
            input.refreshTokenCiphertext,
            input.operationId,
            input.operationKey,
            input.leaseExpiresAt,
          ),
        database.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM google_connections WHERE id = ? AND connection_key = ? AND status = 'revoked' AND revoked_at = ?) AND EXISTS (SELECT 1 FROM google_drive_operations WHERE id = ? AND operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?)")
          .bind(
            input.event.id,
            input.connectionKey,
            input.event.eventType,
            input.event.actor,
            input.event.entityType,
            input.event.entityId,
            input.event.detail,
            input.revokedAt,
            input.connectionId,
            input.connectionKey,
            input.revokedAt,
            input.operationId,
            input.operationKey,
            input.leaseExpiresAt,
          ),
      ]);
      if (operationResult?.meta?.changes !== 1) {
        if ((result?.meta?.changes ?? 0) !== 0 || (eventResult?.meta?.changes ?? 0) !== 0) {
          throw new TypeError("Blocked Google connection revocation unexpectedly changed durable state.");
        }
        const active = await database.prepare("SELECT 1 AS active_operation FROM google_drive_operations WHERE connection_key IN (?, ?) AND status IN ('in-progress', 'committing') LIMIT 1")
          .bind(input.workspaceConnectionKey, input.connectionKey)
          .first<{ active_operation: number }>();
        return active?.active_operation === 1 ? "busy" : "stale";
      }
      if (result?.meta?.changes !== 1) {
        if ((eventResult?.meta?.changes ?? 0) !== 0) {
          throw new TypeError("Missing Google connection revocation unexpectedly created an integration event.");
        }
        await database.prepare("UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = 'stale_google_connection', updated_at = ? WHERE id = ? AND operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
          .bind(input.revokedAt, input.operationId, input.operationKey, input.leaseExpiresAt)
          .run();
        throw new TypeError("Google connection revocation acquired its operation lease but did not tombstone the credential.");
      }
      if (eventResult?.meta?.changes !== 1) {
        throw new TypeError("Google connection revocation did not create its integration event.");
      }
      return "revoked";
    },

    async finishRevocationOperation(input) {
      const result = await database.prepare("UPDATE google_drive_operations SET status = ?, lease_expires_at = NULL, last_error_code = ?, updated_at = ? WHERE id = ? AND operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?")
        .bind(
          input.status,
          input.errorCode,
          input.now,
          input.operationId,
          input.operationKey,
          input.leaseExpiresAt,
        )
        .run();
      return result.meta?.changes === 1;
    },

    async writeRevocationOutcomeEvent(input) {
      const result = await database.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM google_connections WHERE id = ? AND connection_key = ? AND status = 'revoked' AND revoked_at = ?)")
        .bind(
          input.event.id,
          input.connectionKey,
          input.event.eventType,
          input.event.actor,
          input.event.entityType,
          input.event.entityId,
          input.event.detail,
          input.event.createdAt,
          input.connectionId,
          input.connectionKey,
          input.revokedAt,
        )
        .run();
      return result.meta?.changes === 1;
    },

    async saveConnection(input) {
      const googleDomain = input.googleEmail.trim().toLowerCase().split("@")[1] ?? "";
      const tenantDomainGuard = " AND NOT EXISTS (SELECT 1 FROM google_connections AS tenant_connection WHERE lower(substr(tenant_connection.google_email, instr(tenant_connection.google_email, '@') + 1)) <> ?)";
      const activeOperationGuard = " AND NOT EXISTS (SELECT 1 FROM google_drive_operations WHERE connection_key IN (?, ?) AND status IN ('in-progress', 'committing'))";
      const oauthAttemptGuard = input.oauthAttemptId
        ? " AND EXISTS (SELECT 1 FROM google_oauth_attempts WHERE id = ? AND consumed_at IS NOT NULL AND expires_at > 0 AND expires_at >= ?)"
        : "";
      const oauthAttemptValues = input.oauthAttemptId
        ? [input.oauthAttemptId, input.now]
        : [];
      const recoverExpiredRevocation = () => database.prepare("UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = 'oauth_disconnect_interrupted', updated_at = ? WHERE connection_key IN (?, ?) AND operation_key = connection_key || ':oauth:disconnect' AND status = 'in-progress' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?")
        .bind(
          input.now,
          input.workspaceConnectionKey,
          input.connectionKey,
          input.now,
        );
      const connectedEvent = () => database.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM google_connections WHERE connection_key = ? AND refresh_token_ciphertext = ? AND status = 'connected' AND revoked_at IS NULL)")
        .bind(
          input.event.id,
          input.connectionKey,
          input.event.eventType,
          input.event.actor,
          input.event.entityType,
          input.event.entityId,
          input.event.detail,
          input.event.createdAt,
          input.connectionKey,
          input.refreshTokenCiphertext,
        );
      const saveWithEvent = async (statement: D1PreparedStatementLike) => {
        const [, saveResult, eventResult] = await database.batch([
          recoverExpiredRevocation(),
          statement,
          connectedEvent(),
        ]);
        if (saveResult?.meta?.changes !== 1) {
          if ((eventResult?.meta?.changes ?? 0) !== 0) {
            throw new TypeError("A stale Google connection save unexpectedly created its integration event.");
          }
          return "stale" as const;
        }
        if (eventResult?.meta?.changes !== 1) {
          throw new TypeError("Google connection save did not create its exact-generation integration event.");
        }
        return "saved" as const;
      };
      if (input.credentialSource === "reused") {
        const reused = database.prepare(`UPDATE google_connections SET google_subject = ?, google_email = ?, scopes_json = ?, status = 'connected', last_error_code = NULL, last_success_at = ?, created_by = ?, updated_at = ?, revoked_at = NULL WHERE connection_key = ? AND status <> 'revoked' AND refresh_token_ciphertext = ? AND key_version = ?${oauthAttemptGuard}${tenantDomainGuard}${activeOperationGuard}`)
          .bind(
            input.googleSubject,
            input.googleEmail,
            input.scopesJson,
            input.now,
            input.actor,
            input.now,
            input.connectionKey,
            input.refreshTokenCiphertext,
            input.keyVersion,
            ...oauthAttemptValues,
            googleDomain,
            input.workspaceConnectionKey,
            input.connectionKey,
          );
        return saveWithEvent(reused);
      }
      const freshAttemptPredicate = input.oauthAttemptId
        ? "EXISTS (SELECT 1 FROM google_oauth_attempts WHERE id = ? AND consumed_at IS NOT NULL AND expires_at > 0 AND expires_at >= ?)"
        : "1 = 1";
      const fresh = database.prepare(`INSERT INTO google_connections (id, connection_key, google_subject, google_email, scopes_json, refresh_token_ciphertext, key_version, status, last_error_code, last_success_at, created_by, created_at, updated_at, revoked_at) SELECT ?, ?, ?, ?, ?, ?, ?, 'connected', NULL, ?, ?, ?, ?, NULL WHERE ${freshAttemptPredicate}${tenantDomainGuard}${activeOperationGuard} ON CONFLICT(connection_key) DO UPDATE SET google_subject = excluded.google_subject, google_email = excluded.google_email, scopes_json = excluded.scopes_json, refresh_token_ciphertext = excluded.refresh_token_ciphertext, key_version = excluded.key_version, status = 'connected', last_error_code = NULL, last_success_at = excluded.last_success_at, created_by = excluded.created_by, updated_at = excluded.updated_at, revoked_at = NULL`)
        .bind(
          input.id,
          input.connectionKey,
          input.googleSubject,
          input.googleEmail,
          input.scopesJson,
          input.refreshTokenCiphertext,
          input.keyVersion,
          input.now,
          input.actor,
          input.now,
          input.now,
          ...oauthAttemptValues,
          googleDomain,
          input.workspaceConnectionKey,
          input.connectionKey,
        );
      return saveWithEvent(fresh);
    },

    async markConnectionRefreshSucceeded(input) {
      await database.prepare("UPDATE google_connections SET last_success_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ? AND refresh_token_ciphertext = ? AND revoked_at IS NULL")
        .bind(input.now, input.now, input.id, input.refreshTokenCiphertext)
        .run();
    },

    async markConnectionRefreshFailed(input) {
      const status = input.requiresReauthorization
        ? "status = 'reauthorization-required', "
        : "";
      await database.prepare(`UPDATE google_connections SET ${status}last_error_code = ?, updated_at = ? WHERE id = ? AND refresh_token_ciphertext = ? AND revoked_at IS NULL`)
        .bind(input.errorCode, input.now, input.id, input.refreshTokenCiphertext)
        .run();
    },

    async writeIntegrationEvent(input) {
      await database.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          input.id,
          input.connectionKey,
          input.eventType,
          input.actor,
          input.entityType,
          input.entityId,
          input.detail,
          input.createdAt,
        )
        .run();
    },

    async writeOauthAttemptEvent(input) {
      const consumedPredicate = input.phase === "consumed"
        ? "consumed_at IS NOT NULL"
        : "consumed_at IS NULL";
      const result = await database.prepare(`INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM google_oauth_attempts WHERE id = ? AND connection_key = ? AND ${consumedPredicate} AND expires_at >= ?)`)
        .bind(
          input.event.id,
          input.connectionKey,
          input.event.eventType,
          input.event.actor,
          input.event.entityType,
          input.event.entityId,
          input.event.detail,
          input.event.createdAt,
          input.attemptId,
          input.connectionKey,
          input.event.createdAt,
        )
        .run();
      return result.meta?.changes === 1;
    },
  });
}
