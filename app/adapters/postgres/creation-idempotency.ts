import { createHash } from "node:crypto";
import type { PostgresClient } from "./postgres-database";
import { isPostgresUuid, parsePostgresJsonObject } from "./postgres-values";

export const POSTGRES_CREATION_OPERATIONS = {
  client: "clients.create",
  project: "projects.create",
  lead: "leads.create",
  projectMeeting: "project_meetings.create",
} as const;

export type PostgresCreationOperation = typeof POSTGRES_CREATION_OPERATIONS[keyof typeof POSTGRES_CREATION_OPERATIONS];

export type PostgresCreationRequest = {
  idempotencyRequestId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  correlationId: string;
  expiresAt: number;
  outboxEventId: string;
};

/**
 * Caller-supplied request metadata. The repository adapter derives the
 * fingerprint from the normalized business intent and never trusts a hash
 * supplied by an HTTP client or composition layer.
 */
export type PostgresCreationRequestMetadata = Omit<PostgresCreationRequest, "requestFingerprint"> & {
  requestFingerprint?: never;
};

export type PostgresCreationClaim<T> =
  | { outcome: "claimed" }
  | { outcome: "replayed"; value: T }
  | {
      outcome: "failed-replay";
      responseStatus: number;
      responseBody: Record<string, unknown>;
    }
  | { outcome: "idempotency-conflict" }
  | { outcome: "in-progress" };

type IdempotencyRow = Record<string, unknown> & {
  request_fingerprint: unknown;
  status: unknown;
  response_status: unknown;
  response_body: unknown;
};

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Request fingerprints require finite JSON numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Request fingerprints do not accept circular values");
    ancestors.add(value);
    const result = `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("Request fingerprints do not accept circular values");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Request fingerprints accept only JSON objects");
    }
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    const result = `{${Object.keys(record).sort().map((key) => {
      if (record[key] === undefined) throw new TypeError("Request fingerprints do not accept undefined values");
      return `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`;
    }).join(",")}}`;
    ancestors.delete(value);
    return result;
  }
  throw new TypeError("Request fingerprints accept only JSON values");
}

/**
 * Calculate this from normalized, actor-visible request fields before any UUIDs
 * or timestamps are generated. Never accept a client-supplied fingerprint.
 */
export function calculatePostgresRequestFingerprint(value: unknown) {
  const canonical = canonicalJson(value, new Set());
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function bindPostgresCreationRequest(
  request: PostgresCreationRequestMetadata,
  normalizedBusinessIntent: unknown,
): PostgresCreationRequest {
  return {
    idempotencyRequestId: request.idempotencyRequestId,
    idempotencyKey: request.idempotencyKey,
    requestFingerprint: calculatePostgresRequestFingerprint(normalizedBusinessIntent),
    correlationId: request.correlationId,
    expiresAt: request.expiresAt,
    outboxEventId: request.outboxEventId,
  };
}

function boundedTrimmedText(value: string, label: string) {
  if (!value || value !== value.trim() || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be trimmed text from 1 to 255 characters`);
  }
  return value;
}

export function validatePostgresCreationRequest(request: PostgresCreationRequest, createdAt: number) {
  if (!isPostgresUuid(request.idempotencyRequestId)) {
    throw new TypeError("PostgreSQL idempotency request ID must be a UUID");
  }
  if (!isPostgresUuid(request.outboxEventId)) {
    throw new TypeError("PostgreSQL outbox event ID must be a UUID");
  }
  boundedTrimmedText(request.idempotencyKey, "PostgreSQL idempotency key");
  boundedTrimmedText(request.correlationId, "PostgreSQL correlation ID");
  if (!/^sha256:[0-9a-f]{64}$/.test(request.requestFingerprint)) {
    throw new TypeError("PostgreSQL request fingerprint must be a lowercase SHA-256 value");
  }
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= createdAt) {
    throw new TypeError("PostgreSQL idempotency expiry must be a safe epoch millisecond after creation");
  }
}

export async function claimPostgresCreation<T>(
  client: PostgresClient,
  operation: PostgresCreationOperation,
  actorId: string,
  createdAt: number,
  request: PostgresCreationRequest,
  parseStoredResponse: (value: unknown) => T,
): Promise<PostgresCreationClaim<T>> {
  validatePostgresCreationRequest(request, createdAt);
  const claim = await client.query(
    `INSERT INTO idempotency_requests (
       id, actor_id, operation, idempotency_key, request_fingerprint,
       created_at, updated_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
     ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      request.idempotencyRequestId,
      actorId,
      operation,
      request.idempotencyKey,
      request.requestFingerprint,
      new Date(createdAt),
      new Date(request.expiresAt),
    ],
  );
  if (claim.rowCount === 1) return { outcome: "claimed" };

  const existing = await client.query<IdempotencyRow>(
    `SELECT request_fingerprint, status, response_status, response_body,
            version::text AS version
     FROM idempotency_requests
     WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3
     FOR UPDATE`,
    [actorId, operation, request.idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("PostgreSQL idempotency conflict did not resolve to a stored request");
  if (row.request_fingerprint !== request.requestFingerprint) {
    return { outcome: "idempotency-conflict" };
  }
  if (row.status === "processing") return { outcome: "in-progress" };
  if (row.status === "failed") {
    if (
      typeof row.response_status !== "number"
      || !Number.isSafeInteger(row.response_status)
      || row.response_status < 400
      || row.response_status > 499
    ) {
      throw new Error("Failed PostgreSQL creation idempotency response has an unexpected status");
    }
    return {
      outcome: "failed-replay",
      responseStatus: row.response_status,
      responseBody: parsePostgresJsonObject(
        row.response_body,
        "PostgreSQL stored creation failure",
      ),
    };
  }
  if (row.status !== "completed" || row.response_status !== 201) {
    throw new Error("Completed PostgreSQL creation idempotency response has an unexpected status");
  }
  return { outcome: "replayed", value: parseStoredResponse(row.response_body) };
}

export async function failPostgresCreation(
  client: PostgresClient,
  operation: PostgresCreationOperation,
  actorId: string,
  updatedAt: number,
  request: PostgresCreationRequest,
  responseStatus: number,
  responseBody: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(responseStatus) || responseStatus < 400 || responseStatus > 499) {
    throw new TypeError("PostgreSQL idempotency failure status must be a 4xx integer");
  }
  parsePostgresJsonObject(responseBody, "PostgreSQL creation failure response");
  const failed = await client.query(
    `UPDATE idempotency_requests
     SET status = 'failed', response_status = $1, response_body = $2::jsonb,
         updated_at = $3, version = version + 1
     WHERE id = $4 AND actor_id = $5 AND operation = $6
       AND idempotency_key = $7 AND request_fingerprint = $8
       AND status = 'processing'
     RETURNING version::text AS version`,
    [
      responseStatus,
      JSON.stringify(responseBody),
      new Date(updatedAt),
      request.idempotencyRequestId,
      actorId,
      operation,
      request.idempotencyKey,
      request.requestFingerprint,
    ],
  );
  if (failed.rowCount !== 1) {
    throw new Error("PostgreSQL idempotency failure was not recorded exactly once");
  }
}

export async function completePostgresCreation<T>(
  client: PostgresClient,
  operation: PostgresCreationOperation,
  actorId: string,
  updatedAt: number,
  request: PostgresCreationRequest,
  value: T,
) {
  const completed = await client.query(
    `UPDATE idempotency_requests
     SET status = 'completed', response_status = 201, response_body = $1::jsonb,
         updated_at = $2, version = version + 1
     WHERE id = $3 AND actor_id = $4 AND operation = $5
       AND idempotency_key = $6 AND request_fingerprint = $7
       AND status = 'processing'
     RETURNING version::text AS version`,
    [
      JSON.stringify(value),
      new Date(updatedAt),
      request.idempotencyRequestId,
      actorId,
      operation,
      request.idempotencyKey,
      request.requestFingerprint,
    ],
  );
  if (completed.rowCount !== 1) {
    throw new Error("PostgreSQL idempotency request was not completed exactly once");
  }
}
