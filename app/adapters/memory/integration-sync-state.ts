import type {
  DisableIntegrationSyncCursor,
  DisableIntegrationSyncCursorResult,
  IntegrationSyncCursor,
  IntegrationSyncCursorKind,
  IntegrationSyncStateRepository,
  ListExpiringIntegrationSyncCursors,
  RecordIntegrationSyncFailure,
  RecordIntegrationSyncFailureResult,
  SaveActiveIntegrationSyncCursor,
  SaveActiveIntegrationSyncCursorResult,
} from "../../ports/integration-sync-state.ts";
import {
  memoryCiphertext,
  memoryKey,
  memoryPositiveInteger,
  memoryText,
  memoryTime,
  memoryUuid,
  memoryVersion,
  nextMemoryVersion,
} from "./contract-values.ts";

export type MemoryIntegrationSyncStateRepositoryOptions = Readonly<{
  now?: () => number;
}>;

function cursorKind(value: unknown): IntegrationSyncCursorKind {
  if (
    value !== "gmail_history"
    && value !== "calendar_sync_token"
    && value !== "calendar_channel_token"
  ) {
    throw new TypeError("Integration sync cursor kind is invalid");
  }
  return value;
}

function cursorKey(resourceId: string, kind: IntegrationSyncCursorKind) {
  return `${resourceId}:${kind}`;
}

function snapshot(cursor: IntegrationSyncCursor): IntegrationSyncCursor {
  return Object.freeze({
    ...cursor,
    cursorCiphertext: cursor.cursorCiphertext?.slice() ?? null,
  });
}

/** Local-only fake for encrypted Gmail/Calendar cursor-state behavior. */
export class MemoryIntegrationSyncStateRepository implements IntegrationSyncStateRepository {
  readonly #cursors = new Map<string, IntegrationSyncCursor>();
  readonly #keysById = new Map<string, string>();
  readonly #now: () => number;

  constructor(options: MemoryIntegrationSyncStateRepositoryOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  #currentTime() {
    return memoryTime(this.#now(), "Memory sync-state clock");
  }

  #replace(key: string, cursor: IntegrationSyncCursor) {
    if (!this.#cursors.has(key)) {
      throw new Error("Memory sync cursor disappeared during a state transition");
    }
    this.#cursors.set(key, cursor);
    return snapshot(cursor);
  }

  async get(
    resourceIdValue: string,
    cursorKindValue: IntegrationSyncCursorKind,
  ): Promise<IntegrationSyncCursor | null> {
    const resourceId = memoryUuid(resourceIdValue, "Integration resource ID");
    const kind = cursorKind(cursorKindValue);
    const cursor = this.#cursors.get(cursorKey(resourceId, kind));
    return cursor ? snapshot(cursor) : null;
  }

  async saveActive(
    input: SaveActiveIntegrationSyncCursor,
  ): Promise<SaveActiveIntegrationSyncCursorResult> {
    const id = memoryUuid(input.id, "Integration cursor ID");
    const resourceId = memoryUuid(input.resourceId, "Integration resource ID");
    const kind = cursorKind(input.cursorKind);
    const ciphertext = memoryCiphertext(
      input.cursorCiphertext,
      "Integration cursor ciphertext",
    );
    const keyVersion = memoryText(
      input.keyVersion,
      "Integration cursor key version",
      255,
    );
    const now = this.#currentTime();
    const expiresAt = input.expiresAt === null
      ? null
      : memoryTime(input.expiresAt, "Integration cursor expiry");
    if (kind === "calendar_channel_token" && expiresAt === null) {
      throw new TypeError("An active Calendar notification channel requires an expiry");
    }
    if (expiresAt !== null && expiresAt <= now) {
      throw new TypeError("An active integration cursor expiry must be in the future");
    }
    const key = cursorKey(resourceId, kind);
    const existing = this.#cursors.get(key);

    if (input.expectedVersion === null) {
      if (existing || this.#keysById.has(id)) return { outcome: "conflict" };
      const cursor = Object.freeze({
        id,
        resourceId,
        cursorKind: kind,
        cursorCiphertext: ciphertext,
        keyVersion,
        status: "active" as const,
        lastSuccessAt: now,
        lastErrorAt: null,
        lastErrorCode: null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        version: "1",
      });
      this.#cursors.set(key, cursor);
      this.#keysById.set(id, key);
      return { outcome: "saved", cursor: snapshot(cursor) };
    }

    const expectedVersion = memoryVersion(
      input.expectedVersion,
      "Expected integration cursor version",
    );
    if (
      !existing
      || existing.id !== id
      || existing.status === "disabled"
      || existing.version !== expectedVersion
    ) {
      return { outcome: "stale" };
    }
    const cursor = this.#replace(key, Object.freeze({
      ...existing,
      cursorCiphertext: ciphertext,
      keyVersion,
      status: "active" as const,
      lastSuccessAt: now,
      lastErrorAt: null,
      lastErrorCode: null,
      expiresAt,
      updatedAt: now,
      version: nextMemoryVersion(existing.version),
    }));
    return { outcome: "saved", cursor };
  }

  async recordFailure(
    input: RecordIntegrationSyncFailure,
  ): Promise<RecordIntegrationSyncFailureResult> {
    const resourceId = memoryUuid(input.resourceId, "Integration resource ID");
    const kind = cursorKind(input.cursorKind);
    const expectedVersion = memoryVersion(
      input.expectedVersion,
      "Expected integration cursor version",
    );
    const errorCode = memoryKey(input.errorCode, "Integration sync error code");
    if (
      input.disposition !== "retain_cursor"
      && input.disposition !== "resync_required"
    ) {
      throw new TypeError("Integration sync failure disposition is invalid");
    }
    if (
      kind === "calendar_channel_token"
      && input.disposition === "resync_required"
    ) {
      throw new TypeError("Calendar notification channels must be disabled, not marked for resync");
    }
    const key = cursorKey(resourceId, kind);
    const existing = this.#cursors.get(key);
    if (
      !existing
      || existing.status === "disabled"
      || existing.version !== expectedVersion
      || (input.disposition === "retain_cursor" && existing.status !== "active")
    ) {
      return { outcome: "stale" };
    }
    const now = this.#currentTime();
    const requiresResync = input.disposition === "resync_required";
    const cursor = this.#replace(key, Object.freeze({
      ...existing,
      cursorCiphertext: requiresResync ? null : existing.cursorCiphertext,
      keyVersion: requiresResync ? null : existing.keyVersion,
      status: requiresResync ? "resync_required" as const : "active" as const,
      lastErrorAt: now,
      lastErrorCode: errorCode,
      expiresAt: requiresResync ? null : existing.expiresAt,
      updatedAt: now,
      version: nextMemoryVersion(existing.version),
    }));
    return { outcome: "recorded", cursor };
  }

  async disable(
    input: DisableIntegrationSyncCursor,
  ): Promise<DisableIntegrationSyncCursorResult> {
    const resourceId = memoryUuid(input.resourceId, "Integration resource ID");
    const kind = cursorKind(input.cursorKind);
    const expectedVersion = memoryVersion(
      input.expectedVersion,
      "Expected integration cursor version",
    );
    const key = cursorKey(resourceId, kind);
    const existing = this.#cursors.get(key);
    if (
      !existing
      || existing.status === "disabled"
      || existing.version !== expectedVersion
    ) {
      return { outcome: "stale" };
    }
    const now = this.#currentTime();
    const cursor = this.#replace(key, Object.freeze({
      ...existing,
      cursorCiphertext: null,
      keyVersion: null,
      status: "disabled" as const,
      expiresAt: null,
      updatedAt: now,
      version: nextMemoryVersion(existing.version),
    }));
    return { outcome: "disabled", cursor };
  }

  async listExpiring(
    input: ListExpiringIntegrationSyncCursors,
  ): Promise<IntegrationSyncCursor[]> {
    const expiresOnOrBefore = memoryTime(
      input.expiresOnOrBefore,
      "Integration cursor expiry boundary",
    );
    const limit = memoryPositiveInteger(input.limit, "Integration cursor list limit", 100);
    return [...this.#cursors.values()]
      .filter((cursor) =>
        cursor.status === "active"
        && cursor.expiresAt !== null
        && cursor.expiresAt <= expiresOnOrBefore)
      .sort((left, right) =>
        (left.expiresAt ?? 0) - (right.expiresAt ?? 0)
        || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(snapshot);
  }
}
