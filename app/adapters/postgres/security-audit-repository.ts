import type {
  RecordedSecurityAuditEvent,
  SecurityAuditEvent,
  SecurityAuditExecutorType,
  SecurityAuditMetadataValue,
  SecurityAuditRepository,
  SecurityAuditResult,
} from "../../ports/security-audit";
import {
  SECURITY_AUDIT_EXECUTOR_TYPES,
  SECURITY_AUDIT_RESULTS,
} from "../../ports/security-audit";
import type { PostgresClient, PostgresPool } from "./postgres-database";
import { withPostgresTransaction } from "./postgres-database";
import {
  parsePostgresUuid,
  postgresSchemaName,
} from "./postgres-values";

export const MAX_SECURITY_AUDIT_METADATA_BYTES = 16_384;
export const MAX_SECURITY_AUDIT_METADATA_DEPTH = 8;
export const MAX_SECURITY_AUDIT_METADATA_NODES = 256;

const MAX_METADATA_KEY_LENGTH = 128;
const MAX_METADATA_STRING_LENGTH = 4_000;
const MAX_METADATA_ARRAY_LENGTH = 100;
const MAX_ACTION_LENGTH = 160;
const MAX_KEY_LENGTH = 255;
const MAX_TARGET_ID_LENGTH = 512;
const MAX_REQUEST_ID_LENGTH = 255;
const LOWER_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const RESTRICTED_METADATA_KEY_PARTS = new Set([
  "secret",
  "secrets",
  "token",
  "tokens",
  "password",
  "passwords",
  "passwd",
  "ciphertext",
  "ciphertexts",
  "body",
  "bodies",
  "authorization",
  "cookie",
  "cookies",
  "nonce",
  "nonces",
  "pkce",
  "state",
  "verifier",
  "verifiers",
]);
const RESERVED_METADATA_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type PreparedSecurityAuditEvent = Omit<SecurityAuditEvent, "metadata"> & {
  metadataJson: string;
};

export type PostgresSecurityAuditRepositoryOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

function invalid(label: string, expectation: string): never {
  throw new TypeError(`${label} must be ${expectation}`);
}

function safeTimestamp(value: unknown, label: string) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || !Number.isFinite(new Date(value).getTime())
  ) {
    invalid(label, "a nonnegative safe epoch-millisecond timestamp");
  }
  return value;
}

function requiredText(value: unknown, label: string, maximumLength: number) {
  if (
    typeof value !== "string"
    || value.length > maximumLength
    || value.trim() === ""
    || value !== value.trim()
    || value.includes("\u0000")
  ) {
    invalid(label, `trimmed nonempty text no longer than ${maximumLength} characters`);
  }
  return value;
}

function nullableText(value: unknown, label: string, maximumLength: number) {
  if (value === null) return null;
  return requiredText(value, label, maximumLength);
}

function lowercaseKey(value: unknown, label: string, maximumLength: number) {
  const key = requiredText(value, label, maximumLength);
  if (!LOWER_KEY_PATTERN.test(key)) {
    invalid(label, "a lowercase snake_case key");
  }
  return key;
}

function actionName(value: unknown) {
  const action = requiredText(value, "Security audit action", MAX_ACTION_LENGTH);
  if (!ACTION_PATTERN.test(action)) {
    invalid("Security audit action", "a dotted lowercase action key");
  }
  return action;
}

function executorType(value: unknown): SecurityAuditExecutorType {
  if (!SECURITY_AUDIT_EXECUTOR_TYPES.includes(value as SecurityAuditExecutorType)) {
    invalid("Security audit executor type", "a supported executor type");
  }
  return value as SecurityAuditExecutorType;
}

function auditResult(value: unknown): SecurityAuditResult {
  if (!SECURITY_AUDIT_RESULTS.includes(value as SecurityAuditResult)) {
    invalid("Security audit result", "a supported result");
  }
  return value as SecurityAuditResult;
}

function optionalUuid(value: unknown, label: string) {
  return value === null ? null : parsePostgresUuid(value, label);
}

function metadataKeyParts(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function assertSafeMetadataKey(key: string) {
  if (
    key.length === 0
    || key.length > MAX_METADATA_KEY_LENGTH
    || key.includes("\u0000")
    || RESERVED_METADATA_KEYS.has(key)
  ) {
    invalid(
      "Security audit metadata key",
      `safe nonempty text no longer than ${MAX_METADATA_KEY_LENGTH} characters`,
    );
  }
  if (metadataKeyParts(key).some((part) => RESTRICTED_METADATA_KEY_PARTS.has(part))) {
    throw new TypeError("Security audit metadata keys cannot name secret-bearing content");
  }
}

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

type MetadataState = { nodes: number };

function normalizedMetadataValue(
  value: unknown,
  depth: number,
  state: MetadataState,
  ancestors: Set<object>,
): SecurityAuditMetadataValue {
  state.nodes += 1;
  if (state.nodes > MAX_SECURITY_AUDIT_METADATA_NODES) {
    invalid(
      "Security audit metadata",
      `JSON with at most ${MAX_SECURITY_AUDIT_METADATA_NODES} values`,
    );
  }
  if (depth > MAX_SECURITY_AUDIT_METADATA_DEPTH) {
    invalid(
      "Security audit metadata",
      `JSON no deeper than ${MAX_SECURITY_AUDIT_METADATA_DEPTH} levels`,
    );
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Security audit metadata number", "finite");
    return value;
  }
  if (typeof value === "string") {
    if (
      value.length > MAX_METADATA_STRING_LENGTH
      || value.includes("\u0000")
      || hasUnpairedSurrogate(value)
    ) {
      invalid(
        "Security audit metadata string",
        `safe text no longer than ${MAX_METADATA_STRING_LENGTH} characters`,
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    invalid("Security audit metadata", "plain JSON data");
  }
  if (ancestors.has(value)) invalid("Security audit metadata", "acyclic JSON data");
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > MAX_METADATA_ARRAY_LENGTH
      ) {
        invalid(
          "Security audit metadata array",
          `a plain array with no more than ${MAX_METADATA_ARRAY_LENGTH} entries`,
        );
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const ownKeys = Reflect.ownKeys(descriptors);
      if (
        ownKeys.some((key) =>
          typeof key !== "string"
          || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))
        || ownKeys.length !== value.length + 1
      ) {
        invalid("Security audit metadata array", "a dense JSON array without custom properties");
      }
      const normalized: SecurityAuditMetadataValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          invalid("Security audit metadata array", "enumerable data properties without accessors");
        }
        normalized.push(normalizedMetadataValue(
          descriptor.value,
          depth + 1,
          state,
          ancestors,
        ));
      }
      return normalized;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid("Security audit metadata", "plain JSON objects and arrays");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.some((key) => typeof key !== "string")) {
      invalid("Security audit metadata object", "string-keyed JSON data");
    }
    const keys = descriptorKeys as string[];
    if (keys.some((key) => !descriptors[key]?.enumerable)) {
      invalid("Security audit metadata object", "enumerable JSON fields only");
    }

    const normalized: Record<string, SecurityAuditMetadataValue> = Object.create(null);
    for (const key of keys) {
      assertSafeMetadataKey(key);
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        invalid("Security audit metadata object", "data properties without accessors");
      }
      normalized[key] = normalizedMetadataValue(
        descriptor.value,
        depth + 1,
        state,
        ancestors,
      );
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function metadataJson(value: unknown) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
  ) {
    invalid("Security audit metadata", "a plain JSON object");
  }
  const normalized = normalizedMetadataValue(value, 0, { nodes: 0 }, new Set());
  const json = JSON.stringify(normalized);
  if (new TextEncoder().encode(json).byteLength > MAX_SECURITY_AUDIT_METADATA_BYTES) {
    invalid(
      "Security audit metadata",
      `JSON no larger than ${MAX_SECURITY_AUDIT_METADATA_BYTES} bytes`,
    );
  }
  return json;
}

function prepareSecurityAuditEvent(event: SecurityAuditEvent): PreparedSecurityAuditEvent {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    invalid("Security audit event", "an object");
  }

  const id = parsePostgresUuid(event.id, "Security audit event ID");
  const safeExecutorType = executorType(event.executorType);
  const executorUserId = optionalUuid(
    event.executorUserId,
    "Security audit executor user ID",
  );
  if (
    (safeExecutorType === "user" && executorUserId === null)
    || (safeExecutorType !== "user" && executorUserId !== null)
  ) {
    invalid(
      "Security audit executor user ID",
      safeExecutorType === "user"
        ? "a UUID for a user executor"
        : "null for a non-user executor",
    );
  }
  const executorKey = requiredText(
    event.executorKey,
    "Security audit executor key",
    MAX_KEY_LENGTH,
  );

  const originatingUserId = optionalUuid(
    event.originatingUserId,
    "Security audit originating user ID",
  );
  const originatingActorKey = nullableText(
    event.originatingActorKey,
    "Security audit originating actor key",
    MAX_KEY_LENGTH,
  );
  if (originatingUserId !== null && originatingActorKey === null) {
    invalid(
      "Security audit originating actor key",
      "nonempty text when an originating user is present",
    );
  }

  const targetType = event.targetType === null
    ? null
    : lowercaseKey(event.targetType, "Security audit target type", 64);
  const targetId = nullableText(
    event.targetId,
    "Security audit target ID",
    MAX_TARGET_ID_LENGTH,
  );
  if ((targetType === null) !== (targetId === null)) {
    invalid("Security audit target", "both a type and ID, or neither");
  }

  const occurredAt = safeTimestamp(event.occurredAt, "Security audit occurrence time");
  const retentionUntil = event.retentionUntil === null
    ? null
    : safeTimestamp(event.retentionUntil, "Security audit retention time");
  if (retentionUntil !== null && retentionUntil < occurredAt) {
    invalid("Security audit retention time", "at or after the occurrence time");
  }

  return {
    id,
    executorType: safeExecutorType,
    executorUserId,
    executorKey,
    originatingUserId,
    originatingActorKey,
    action: actionName(event.action),
    targetType,
    targetId,
    result: auditResult(event.result),
    reasonCode: event.reasonCode === null
      ? null
      : lowercaseKey(event.reasonCode, "Security audit reason code", 128),
    requestId: nullableText(
      event.requestId,
      "Security audit request ID",
      MAX_REQUEST_ID_LENGTH,
    ),
    correlationId: requiredText(
      event.correlationId,
      "Security audit correlation ID",
      MAX_KEY_LENGTH,
    ),
    source: lowercaseKey(event.source, "Security audit source", 64),
    metadataJson: metadataJson(event.metadata),
    occurredAt,
    retentionPolicyKey: lowercaseKey(
      event.retentionPolicyKey,
      "Security audit retention policy key",
      64,
    ),
    retentionUntil,
  };
}

async function insertPreparedSecurityAuditEvent(
  client: PostgresClient,
  event: PreparedSecurityAuditEvent,
): Promise<RecordedSecurityAuditEvent> {
  const inserted = await client.query(
    `INSERT INTO audit_events (
       id, executor_type, executor_user_id, executor_key,
       originating_user_id, originating_actor_key, action,
       target_type, target_id, result, reason_code, request_id,
       correlation_id, source, metadata, occurred_at,
       retention_policy_key, retention_until
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18
     )`,
    [
      event.id,
      event.executorType,
      event.executorUserId,
      event.executorKey,
      event.originatingUserId,
      event.originatingActorKey,
      event.action,
      event.targetType,
      event.targetId,
      event.result,
      event.reasonCode,
      event.requestId,
      event.correlationId,
      event.source,
      event.metadataJson,
      new Date(event.occurredAt),
      event.retentionPolicyKey,
      event.retentionUntil === null ? null : new Date(event.retentionUntil),
    ],
  );
  if (inserted.rowCount !== 1) {
    throw new Error("PostgreSQL security audit event was not inserted exactly once");
  }
  return { id: event.id };
}

/**
 * Inserts audit evidence on a caller-owned PostgreSQL transaction. This helper
 * deliberately does not BEGIN or COMMIT so identity, integration, and file
 * mutations can make their evidence atomic with the protected state change.
 */
export function insertPostgresSecurityAuditEvent(
  client: PostgresClient,
  event: SecurityAuditEvent,
) {
  return insertPreparedSecurityAuditEvent(client, prepareSecurityAuditEvent(event));
}

export function createPostgresSecurityAuditRepository(
  pool: PostgresPool,
  options: PostgresSecurityAuditRepositoryOptions = {},
): SecurityAuditRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  return {
    async append(event) {
      // Validate and serialize before borrowing a scarce database connection.
      const prepared = prepareSecurityAuditEvent(event);
      return withPostgresTransaction(pool, transactionOptions, (client) =>
        insertPreparedSecurityAuditEvent(client, prepared));
    },
  };
}
