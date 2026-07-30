import type {
  GoogleOauthPersistence,
  StoredGoogleConnection,
  StoredGoogleOauthAttempt,
} from "../../lib/google-oauth";

type D1RunResultLike = Readonly<{ meta?: Readonly<{ changes?: number }> }>;

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
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
  google_email: string;
  refresh_token_ciphertext: string;
  key_version: string;
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
    googleEmail: row.google_email,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    keyVersion: row.key_version,
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
      const row = await database.prepare("SELECT id, google_email, refresh_token_ciphertext, key_version, scopes_json, status FROM google_connections WHERE connection_key = ?")
        .bind(connectionKey)
        .first<ConnectionRow>();
      return connection(row);
    },

    async revokeConnection(input) {
      const [result, eventResult] = await database.batch([
        database.prepare("UPDATE google_connections SET refresh_token_ciphertext = '', key_version = '', status = 'revoked', last_error_code = NULL, updated_at = ?, revoked_at = ? WHERE connection_key = ?")
          .bind(input.revokedAt, input.revokedAt, input.connectionKey),
        database.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM google_connections WHERE connection_key = ?)")
          .bind(
            input.event.id,
            input.connectionKey,
            input.event.eventType,
            input.event.actor,
            input.event.entityType,
            input.event.entityId,
            input.event.detail,
            input.revokedAt,
            input.connectionKey,
          ),
      ]);
      if (result?.meta?.changes !== 1) {
        if ((eventResult?.meta?.changes ?? 0) !== 0) {
          throw new TypeError("Missing Google connection revocation unexpectedly created an integration event.");
        }
        return false;
      }
      if (eventResult?.meta?.changes !== 1) {
        throw new TypeError("Google connection revocation did not create its integration event.");
      }
      return true;
    },

    async saveConnection(input) {
      if (input.credentialSource === "reused") {
        const reused = await database.prepare("UPDATE google_connections SET google_subject = ?, google_email = ?, scopes_json = ?, status = 'connected', last_error_code = NULL, last_success_at = ?, created_by = ?, updated_at = ?, revoked_at = NULL WHERE connection_key = ? AND status <> 'revoked' AND refresh_token_ciphertext = ? AND key_version = ?")
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
          )
          .run();
        return reused.meta?.changes === 1 ? "saved" : "stale";
      }
      const fresh = await database.prepare("INSERT INTO google_connections (id, connection_key, google_subject, google_email, scopes_json, refresh_token_ciphertext, key_version, status, last_error_code, last_success_at, created_by, created_at, updated_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', NULL, ?, ?, ?, ?, NULL) ON CONFLICT(connection_key) DO UPDATE SET google_subject = excluded.google_subject, google_email = excluded.google_email, scopes_json = excluded.scopes_json, refresh_token_ciphertext = excluded.refresh_token_ciphertext, key_version = excluded.key_version, status = 'connected', last_error_code = NULL, last_success_at = excluded.last_success_at, created_by = excluded.created_by, updated_at = excluded.updated_at, revoked_at = NULL")
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
        )
        .run();
      return fresh.meta?.changes === 1 ? "saved" : "stale";
    },

    async markConnectionAccountRejected(id, now) {
      await database.prepare("UPDATE google_connections SET status = 'reauthorization-required', last_error_code = 'account_no_longer_allowed', updated_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now, id)
        .run();
    },

    async markConnectionRefreshSucceeded(id, now) {
      await database.prepare("UPDATE google_connections SET last_success_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(now, now, id)
        .run();
    },

    async markConnectionRefreshFailed(input) {
      const status = input.requiresReauthorization
        ? "status = 'reauthorization-required', "
        : "";
      await database.prepare(`UPDATE google_connections SET ${status}last_error_code = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL`)
        .bind(input.errorCode, input.now, input.id)
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
  });
}
