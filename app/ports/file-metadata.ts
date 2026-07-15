import type { SecurityAuditEvent } from "./security-audit";

export type ReserveProjectUploadIntent = Readonly<{
  fileId: string;
  fileVersionId: string;
  storageObjectId: string;
  fileLinkId: string;
  projectId: string;
  category: string;
  relationshipKey: string;
  sourceKey: string;
  originalFilename: string;
  declaredMediaType: string;
  storageProvider: string;
  storageContainer: string;
  objectKey: string;
  retentionPolicyKey: string;
  retentionUntil: number | null;
  createdByUserId: string | null;
  createdByActorKey: string;
  createdAt: number;
  audit: SecurityAuditEvent;
}>;

export type FinalizeStoredUploadIntent = Readonly<{
  fileVersionId: string;
  storageObjectId: string;
  expectedFileVersion: string;
  expectedStorageVersion: string;
  opaqueGeneration: string;
  detectedMediaType: string;
  byteSize: string;
  sha256Checksum: string;
  verifiedAt: number;
  audit: SecurityAuditEvent;
}>;

export type FailStoredUploadIntent = Readonly<{
  fileVersionId: string;
  storageObjectId: string;
  expectedFileVersion: string;
  expectedStorageVersion: string;
  failureCode: string;
  failedAt: number;
  audit: SecurityAuditEvent;
}>;

export type StorageReference = Readonly<{
  fileId: string;
  fileVersionId: string;
  storageObjectId: string;
  provider: string;
  container: string;
  objectKey: string;
  opaqueGeneration: string;
  mediaType: string;
  byteSize: string;
  sha256Checksum: string;
}>;

export type FileMetadataResult =
  | { outcome: "accepted"; fileVersion: string; storageVersion: string }
  | { outcome: "conflict" }
  | { outcome: "stale" };

/**
 * Database-only file lifecycle. Bytes are streamed through ObjectStorage
 * outside PostgreSQL transactions, then finalized with version/status fences.
 */
export interface FileMetadataRepository {
  reserveProjectUpload(intent: ReserveProjectUploadIntent): Promise<FileMetadataResult>;
  finalizeStoredUpload(intent: FinalizeStoredUploadIntent): Promise<FileMetadataResult>;
  failStoredUpload(intent: FailStoredUploadIntent): Promise<FileMetadataResult>;
  findReleasedStorageReference(fileId: string): Promise<StorageReference | null>;
}
