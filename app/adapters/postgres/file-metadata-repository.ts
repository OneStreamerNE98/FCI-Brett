import type {
  FailStoredUploadIntent,
  FileMetadataRepository,
  FinalizeStoredUploadIntent,
  ReserveProjectUploadIntent,
  StorageReference,
} from "../../ports/file-metadata";
import {
  objectStorageByteSize,
  objectStorageContentType,
  objectStorageGeneration,
  objectStorageKey,
  objectStorageSha256,
} from "../../ports/object-storage";
import type { SecurityAuditEvent } from "../../ports/security-audit";
import { insertPostgresSecurityAuditEvent } from "./security-audit-repository";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  assertPersistenceKey,
  assertPersistenceText,
  assertPersistenceUuid,
  isNamedPostgresConstraint,
  persistenceAuditEvent,
  persistenceDate,
  persistenceVersion,
} from "./persistence-repository-values";
import {
  parsePostgresBigint,
  parsePostgresUuid,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresFileMetadataOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

const FILE_CONFLICT_CONSTRAINTS = [
  "files_pkey",
  "file_versions_pkey",
  "file_versions_file_version_key",
  "file_versions_source_key_key",
  "storage_objects_pkey",
  "storage_objects_file_version_purpose_key",
  "storage_objects_provider_container_object_key",
  "file_links_pkey",
  "file_links_active_project_idx",
] as const;

function nonnegativeBigint(value: unknown, label: string) {
  const parsed = parsePostgresBigint(value, label);
  return String(objectStorageByteSize(Number(parsed)));
}

function mutationAudit(
  event: SecurityAuditEvent,
  action: string,
  targetType: string,
  targetId: string,
  denialReason: string | null = null,
) {
  return persistenceAuditEvent(event, {
    action,
    targetType,
    targetId,
    result: denialReason === null ? "succeeded" : "denied",
    reasonCode: denialReason,
  });
}

function filenameToken(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function validateReservation(intent: ReserveProjectUploadIntent) {
  for (const [value, label] of [
    [intent.fileId, "File ID"],
    [intent.fileVersionId, "File version ID"],
    [intent.storageObjectId, "Storage object ID"],
    [intent.fileLinkId, "File link ID"],
    [intent.projectId, "File project ID"],
  ] as const) assertPersistenceUuid(value, label);
  assertPersistenceKey(intent.category, "File category");
  assertPersistenceKey(intent.relationshipKey, "File relationship key");
  assertPersistenceText(intent.sourceKey, "File source key", 1_024);
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(intent.sourceKey)) {
    throw new TypeError("File source key must be an opaque lowercase key");
  }
  assertPersistenceText(intent.originalFilename, "Original filename", 512);
  objectStorageContentType(intent.declaredMediaType);
  assertPersistenceKey(intent.storageProvider, "Storage provider");
  assertPersistenceText(intent.storageContainer, "Storage container", 255);
  objectStorageKey(intent.objectKey);
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(intent.objectKey)) {
    throw new TypeError("Storage object key must be an opaque lowercase key without a filename");
  }
  const normalizedObjectKey = filenameToken(intent.objectKey);
  const normalizedFilename = filenameToken(intent.originalFilename);
  const normalizedStem = filenameToken(intent.originalFilename.replace(/\.[^.]*$/, ""));
  if (
    (normalizedFilename.length >= 4 && normalizedObjectKey.includes(normalizedFilename)) ||
    (normalizedStem.length >= 4 && normalizedObjectKey.includes(normalizedStem))
  ) {
    throw new TypeError("Storage object key must not contain the original filename");
  }
  assertPersistenceKey(intent.retentionPolicyKey, "File retention policy key");
  if (intent.createdByUserId !== null) {
    assertPersistenceUuid(intent.createdByUserId, "File creator user ID");
  }
  assertPersistenceText(intent.createdByActorKey, "File creator actor key", 255);
  const createdAt = persistenceDate(intent.createdAt, "File created_at");
  const retentionUntil = intent.retentionUntil === null
    ? null
    : persistenceDate(intent.retentionUntil, "File retention_until");
  if (retentionUntil !== null && retentionUntil < createdAt) {
    throw new TypeError("File retention time cannot predate creation");
  }
  return { createdAt, retentionUntil };
}

function validateFinalization(intent: FinalizeStoredUploadIntent) {
  assertPersistenceUuid(intent.fileVersionId, "File version ID");
  assertPersistenceUuid(intent.storageObjectId, "Storage object ID");
  const expectedFileVersion = persistenceVersion(
    intent.expectedFileVersion,
    "Expected file version",
  );
  const expectedStorageVersion = persistenceVersion(
    intent.expectedStorageVersion,
    "Expected storage version",
  );
  objectStorageGeneration(intent.opaqueGeneration);
  objectStorageContentType(intent.detectedMediaType);
  const byteSize = nonnegativeBigint(intent.byteSize, "Stored object byte size");
  objectStorageSha256(intent.sha256Checksum);
  const verifiedAt = persistenceDate(intent.verifiedAt, "Stored object verified_at");
  return { expectedFileVersion, expectedStorageVersion, byteSize, verifiedAt };
}

function validateFailure(intent: FailStoredUploadIntent) {
  assertPersistenceUuid(intent.fileVersionId, "File version ID");
  assertPersistenceUuid(intent.storageObjectId, "Storage object ID");
  const expectedFileVersion = persistenceVersion(
    intent.expectedFileVersion,
    "Expected file version",
  );
  const expectedStorageVersion = persistenceVersion(
    intent.expectedStorageVersion,
    "Expected storage version",
  );
  assertPersistenceKey(intent.failureCode, "Upload failure code");
  const failedAt = persistenceDate(intent.failedAt, "Upload failed_at");
  return { expectedFileVersion, expectedStorageVersion, failedAt };
}

type LockedUploadRows = {
  file_version: unknown;
  file_status: unknown;
  storage_version: unknown;
  storage_status: unknown;
};

async function lockUploadState(
  client: Parameters<Parameters<typeof withPostgresTransaction>[2]>[0],
  fileVersionId: string,
  storageObjectId: string,
) {
  const locked = await client.query<LockedUploadRows>(
    `SELECT file_version.row_version::text AS file_version,
            file_version.status AS file_status,
            storage.version::text AS storage_version,
            storage.status AS storage_status
     FROM file_versions AS file_version
     JOIN storage_objects AS storage
       ON storage.file_version_id = file_version.id
     WHERE file_version.id = $1 AND storage.id = $2
     FOR UPDATE OF file_version, storage`,
    [fileVersionId, storageObjectId],
  );
  if (locked.rowCount === 0 && locked.rows.length === 0) return null;
  if (locked.rowCount !== 1 || locked.rows.length !== 1) {
    throw new Error("PostgreSQL upload state did not resolve exactly once");
  }
  const row = locked.rows[0];
  return {
    fileVersion: persistenceVersion(row?.file_version, "PostgreSQL file row version"),
    fileStatus: row?.file_status,
    storageVersion: persistenceVersion(row?.storage_version, "PostgreSQL storage version"),
    storageStatus: row?.storage_status,
  };
}

function exactUpdatedVersion(
  result: { rowCount: number | null; rows: Array<{ version?: unknown }> },
  label: string,
) {
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new Error(`${label} was not updated exactly once`);
  }
  return persistenceVersion(result.rows[0]?.version, `${label} version`);
}

function referenceFromRow(row: Record<string, unknown>): StorageReference {
  for (const [key, label] of [
    ["file_id", "PostgreSQL file ID"],
    ["file_version_id", "PostgreSQL file version ID"],
    ["storage_object_id", "PostgreSQL storage object ID"],
  ] as const) parsePostgresUuid(row[key], label);
  assertPersistenceKey(row.provider, "PostgreSQL storage provider");
  assertPersistenceText(row.container, "PostgreSQL storage container", 255);
  const objectKey = objectStorageKey(row.object_key);
  const opaqueGeneration = objectStorageGeneration(row.generation);
  const mediaType = objectStorageContentType(row.media_type);
  const byteSize = nonnegativeBigint(row.byte_size, "PostgreSQL object byte size");
  const sha256Checksum = objectStorageSha256(row.sha256_checksum);
  return {
    fileId: parsePostgresUuid(row.file_id, "PostgreSQL file ID"),
    fileVersionId: parsePostgresUuid(row.file_version_id, "PostgreSQL file version ID"),
    storageObjectId: parsePostgresUuid(row.storage_object_id, "PostgreSQL storage object ID"),
    provider: row.provider as string,
    container: row.container as string,
    objectKey,
    opaqueGeneration,
    mediaType,
    byteSize,
    sha256Checksum,
  };
}

export function createPostgresFileMetadataRepository(
  pool: PostgresPool,
  options: PostgresFileMetadataOptions = {},
): FileMetadataRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  return {
    async reserveProjectUpload(intent) {
      const values = validateReservation(intent);
      try {
        return await withPostgresTransaction(pool, transactionOptions, async (client) => {
          const project = await client.query(
            "SELECT id FROM projects WHERE id = $1 FOR KEY SHARE",
            [intent.projectId],
          );
          if (project.rowCount !== 1 || project.rows.length !== 1) {
            await insertPostgresSecurityAuditEvent(client, mutationAudit(
              intent.audit,
              "file.upload_reserved",
              "file",
              intent.fileId,
              "conflict",
            ));
            return { outcome: "conflict" as const };
          }
          const file = await client.query(
            `INSERT INTO files (
               id, category, status, current_version_number,
               retention_policy_key, retention_until,
               created_by_user_id, created_by_actor_key,
               created_at, updated_at, version
             ) VALUES ($1, $2, 'active', 1, $3, $4, $5, $6, $7, $7, 1)`,
            [intent.fileId, intent.category, intent.retentionPolicyKey,
              values.retentionUntil, intent.createdByUserId,
              intent.createdByActorKey, values.createdAt],
          );
          if (file.rowCount !== 1) throw new Error("PostgreSQL file was not inserted exactly once");
          const fileVersion = await client.query<{ version: unknown }>(
            `INSERT INTO file_versions (
               id, file_id, version_number, status, source_key,
               original_filename, declared_media_type,
               created_by_user_id, created_by_actor_key,
               created_at, updated_at, row_version
             ) VALUES ($1, $2, 1, 'registered', $3, $4, $5, $6, $7, $8, $8, 1)
             RETURNING row_version::text AS version`,
            [intent.fileVersionId, intent.fileId, intent.sourceKey,
              intent.originalFilename, intent.declaredMediaType,
              intent.createdByUserId, intent.createdByActorKey, values.createdAt],
          );
          const fileVersionValue = exactUpdatedVersion(fileVersion, "PostgreSQL file version");
          const storage = await client.query<{ version: unknown }>(
            `INSERT INTO storage_objects (
               id, file_version_id, purpose, provider, container,
               object_key, status, metadata, retention_until,
               created_at, updated_at, version
             ) VALUES ($1, $2, 'quarantine', $3, $4, $5,
               'pending', '{}'::jsonb, $6, $7, $7, 1)
             RETURNING version::text AS version`,
            [intent.storageObjectId, intent.fileVersionId,
              intent.storageProvider, intent.storageContainer,
              intent.objectKey, values.retentionUntil, values.createdAt],
          );
          const storageVersion = exactUpdatedVersion(storage, "PostgreSQL storage reservation");
          const link = await client.query(
            `INSERT INTO file_links (
               id, file_id, project_id, relationship_key,
               linked_by_user_id, linked_by_actor_key, linked_at, version
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
            [intent.fileLinkId, intent.fileId, intent.projectId,
              intent.relationshipKey, intent.createdByUserId,
              intent.createdByActorKey, values.createdAt],
          );
          if (link.rowCount !== 1) throw new Error("PostgreSQL file link was not inserted exactly once");
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "file.upload_reserved",
            "file",
            intent.fileId,
          ));
          return {
            outcome: "accepted" as const,
            fileVersion: fileVersionValue,
            storageVersion,
          };
        });
      } catch (error) {
        if (isNamedPostgresConstraint(error, "23505", FILE_CONFLICT_CONSTRAINTS)) {
          await withPostgresTransaction(pool, transactionOptions, (client) =>
            insertPostgresSecurityAuditEvent(client, mutationAudit(
              intent.audit,
              "file.upload_reserved",
              "file",
              intent.fileId,
              "conflict",
            )));
          return { outcome: "conflict" };
        }
        throw error;
      }
    },

    async finalizeStoredUpload(intent: FinalizeStoredUploadIntent) {
      const values = validateFinalization(intent);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const locked = await lockUploadState(client, intent.fileVersionId, intent.storageObjectId);
        if (
          !locked || locked.fileStatus !== "registered" || locked.storageStatus !== "pending" ||
          locked.fileVersion !== values.expectedFileVersion ||
          locked.storageVersion !== values.expectedStorageVersion
        ) {
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "file.upload_stored",
            "file_version",
            intent.fileVersionId,
            "stale_state",
          ));
          return { outcome: "stale" as const };
        }
        const storage = await client.query<{ version: unknown }>(
          `UPDATE storage_objects
           SET generation = $3, status = 'available', media_type = $4,
               byte_size = $5::bigint, sha256_checksum = $6,
               verified_at = $7, updated_at = $7, version = version + 1
           WHERE id = $1 AND file_version_id = $2
             AND version = $8::bigint AND status = 'pending'
           RETURNING version::text AS version`,
          [intent.storageObjectId, intent.fileVersionId,
            intent.opaqueGeneration, intent.detectedMediaType, values.byteSize,
            intent.sha256Checksum, values.verifiedAt, values.expectedStorageVersion],
        );
        const storageVersion = exactUpdatedVersion(storage, "PostgreSQL storage object");
        const fileVersion = await client.query<{ version: unknown }>(
          `UPDATE file_versions
           SET status = 'quarantined', detected_media_type = $2,
               byte_size = $3::bigint, sha256_checksum = $4,
               updated_at = $5, row_version = row_version + 1
           WHERE id = $1 AND row_version = $6::bigint AND status = 'registered'
           RETURNING row_version::text AS version`,
          [intent.fileVersionId, intent.detectedMediaType, values.byteSize,
            intent.sha256Checksum, values.verifiedAt, values.expectedFileVersion],
        );
        const fileVersionValue = exactUpdatedVersion(fileVersion, "PostgreSQL file version");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "file.upload_stored",
          "file_version",
          intent.fileVersionId,
        ));
        return { outcome: "accepted" as const, fileVersion: fileVersionValue, storageVersion };
      });
    },

    async failStoredUpload(intent: FailStoredUploadIntent) {
      const values = validateFailure(intent);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const locked = await lockUploadState(client, intent.fileVersionId, intent.storageObjectId);
        if (
          !locked || locked.fileStatus !== "registered" || locked.storageStatus !== "pending" ||
          locked.fileVersion !== values.expectedFileVersion ||
          locked.storageVersion !== values.expectedStorageVersion
        ) {
          await insertPostgresSecurityAuditEvent(client, mutationAudit(
            intent.audit,
            "file.upload_failed",
            "file_version",
            intent.fileVersionId,
            "stale_state",
          ));
          return { outcome: "stale" as const };
        }
        const storage = await client.query<{ version: unknown }>(
          `UPDATE storage_objects
           SET status = 'failed', failure_code = $3,
               updated_at = $4, version = version + 1
           WHERE id = $1 AND file_version_id = $2
             AND version = $5::bigint AND status = 'pending'
           RETURNING version::text AS version`,
          [intent.storageObjectId, intent.fileVersionId,
            intent.failureCode, values.failedAt, values.expectedStorageVersion],
        );
        const storageVersion = exactUpdatedVersion(storage, "PostgreSQL failed storage object");
        const fileVersion = await client.query<{ version: unknown }>(
          `UPDATE file_versions
           SET status = 'rejected', rejection_code = $2,
               rejected_at = $3, updated_at = $3,
               row_version = row_version + 1
           WHERE id = $1 AND row_version = $4::bigint AND status = 'registered'
           RETURNING row_version::text AS version`,
          [intent.fileVersionId, intent.failureCode,
            values.failedAt, values.expectedFileVersion],
        );
        const fileVersionValue = exactUpdatedVersion(fileVersion, "PostgreSQL rejected file version");
        await insertPostgresSecurityAuditEvent(client, mutationAudit(
          intent.audit,
          "file.upload_failed",
          "file_version",
          intent.fileVersionId,
        ));
        return { outcome: "accepted" as const, fileVersion: fileVersionValue, storageVersion };
      });
    },

    async findReleasedStorageReference(fileId: string) {
      assertPersistenceUuid(fileId, "File ID");
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const found = await client.query<Record<string, unknown>>(
          `SELECT file.id::text AS file_id,
                  file_version.id::text AS file_version_id,
                  storage.id::text AS storage_object_id,
                  storage.provider, storage.container, storage.object_key,
                  storage.generation, storage.media_type,
                  storage.byte_size::text AS byte_size,
                  storage.sha256_checksum
           FROM files AS file
           JOIN file_versions AS file_version
             ON file_version.file_id = file.id
            AND file_version.version_number = file.current_version_number
           JOIN storage_objects AS storage
             ON storage.file_version_id = file_version.id
            AND storage.status = 'available'
           WHERE file.id = $1
             AND file.status = 'active'
             AND file_version.status = 'released'
             AND storage.purpose = 'released'`,
          [fileId],
        );
        if (found.rowCount === 0 && found.rows.length === 0) return null;
        if (found.rowCount !== 1 || found.rows.length !== 1) {
          throw new Error("PostgreSQL released storage reference was not unique");
        }
        return referenceFromRow(found.rows[0]);
      });
    },
  };
}
