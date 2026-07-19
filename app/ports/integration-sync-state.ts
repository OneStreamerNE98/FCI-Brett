export const INTEGRATION_SYNC_CURSOR_KINDS = [
  "gmail_history",
  "calendar_sync_token",
  "calendar_channel_token",
] as const;

export type IntegrationSyncCursorKind =
  typeof INTEGRATION_SYNC_CURSOR_KINDS[number];

export type IntegrationSyncCursorStatus =
  | "active"
  | "resync_required"
  | "disabled";

/**
 * One-to-one contract for the existing PostgreSQL `integration_cursors` row.
 * Provider cursor values remain encrypted and key-versioned at this boundary.
 */
export type IntegrationSyncCursor = Readonly<{
  id: string;
  resourceId: string;
  cursorKind: IntegrationSyncCursorKind;
  cursorCiphertext: Uint8Array | null;
  keyVersion: string | null;
  status: IntegrationSyncCursorStatus;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorCode: string | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  version: string;
}>;

type SaveActiveIntegrationSyncCursorBase = Readonly<{
  id: string;
  resourceId: string;
  cursorCiphertext: Uint8Array;
  keyVersion: string;
  expectedVersion: string | null;
}>;

export type SaveActiveIntegrationSyncCursor =
  | (SaveActiveIntegrationSyncCursorBase & Readonly<{
      cursorKind: "gmail_history" | "calendar_sync_token";
      expiresAt: number | null;
    }>)
  | (SaveActiveIntegrationSyncCursorBase & Readonly<{
      cursorKind: "calendar_channel_token";
      expiresAt: number;
    }>);

export type SaveActiveIntegrationSyncCursorResult =
  | Readonly<{ outcome: "saved"; cursor: IntegrationSyncCursor }>
  | Readonly<{ outcome: "conflict" }>
  | Readonly<{ outcome: "stale" }>;

export type RecordIntegrationSyncFailure = Readonly<{
  resourceId: string;
  cursorKind: IntegrationSyncCursorKind;
  expectedVersion: string;
  errorCode: string;
  disposition: "retain_cursor" | "resync_required";
}>;

export type RecordIntegrationSyncFailureResult =
  | Readonly<{ outcome: "recorded"; cursor: IntegrationSyncCursor }>
  | Readonly<{ outcome: "stale" }>;

export type DisableIntegrationSyncCursor = Readonly<{
  resourceId: string;
  cursorKind: IntegrationSyncCursorKind;
  expectedVersion: string;
}>;

export type DisableIntegrationSyncCursorResult =
  | Readonly<{ outcome: "disabled"; cursor: IntegrationSyncCursor }>
  | Readonly<{ outcome: "stale" }>;

export type ListExpiringIntegrationSyncCursors = Readonly<{
  expiresOnOrBefore: number;
  limit: number;
}>;

/**
 * No method starts a watch, creates an HTTPS channel, calls a provider, or
 * decrypts a cursor. Those operations remain outside the persistence port.
 */
export interface IntegrationSyncStateRepository {
  get(
    resourceId: string,
    cursorKind: IntegrationSyncCursorKind,
  ): Promise<IntegrationSyncCursor | null>;
  saveActive(
    input: SaveActiveIntegrationSyncCursor,
  ): Promise<SaveActiveIntegrationSyncCursorResult>;
  recordFailure(
    input: RecordIntegrationSyncFailure,
  ): Promise<RecordIntegrationSyncFailureResult>;
  disable(
    input: DisableIntegrationSyncCursor,
  ): Promise<DisableIntegrationSyncCursorResult>;
  listExpiring(
    input: ListExpiringIntegrationSyncCursors,
  ): Promise<IntegrationSyncCursor[]>;
}
