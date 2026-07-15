import { isPostgresUuid, parsePostgresPositiveBigint } from "./postgres-values";
import type {
  SecurityAuditEvent,
  SecurityAuditResult,
} from "../../ports/security-audit";

const LOWER_KEY = /^[a-z][a-z0-9_]*$/;
const DOTTED_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SENSITIVE_METADATA_KEY_PARTS = new Set([
  "authorization",
  "bodies",
  "body",
  "ciphertext",
  "ciphertexts",
  "cookie",
  "cookies",
  "nonce",
  "nonces",
  "passwd",
  "password",
  "passwords",
  "pkce",
  "secret",
  "secrets",
  "state",
  "token",
  "tokens",
  "verifier",
  "verifiers",
]);
const RESERVED_METADATA_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_METADATA_NODES = 256;
const MAX_METADATA_STRING_LENGTH = 4_000;

export function assertPersistenceUuid(value: unknown, label: string): asserts value is string {
  if (!isPostgresUuid(value)) throw new TypeError(`${label} must be a UUID`);
}

export function persistenceDate(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be safe epoch milliseconds`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} must be a valid timestamp`);
  return date;
}

export function assertPersistenceText(
  value: unknown,
  label: string,
  maximum = 512,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new TypeError(`${label} must be nonblank and at most ${maximum} characters`);
  }
}

export function assertPersistenceKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length > 128 || !LOWER_KEY.test(value)) {
    throw new TypeError(`${label} must be a lowercase key`);
  }
}

export function assertPersistenceDottedKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length > 192 || !DOTTED_KEY.test(value)) {
    throw new TypeError(`${label} must be a lowercase dotted key`);
  }
}

export function assertPersistenceHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a canonical SHA-256 digest`);
  }
}

export function persistenceVersion(value: unknown, label: string) {
  return parsePostgresPositiveBigint(value, label);
}

export function assertPersistenceCiphertext(
  value: unknown,
  label: string,
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 16 || value.byteLength > 65_536) {
    throw new TypeError(`${label} must be a bounded encrypted byte sequence`);
  }
}

function metadataKeyParts(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizedJsonValue(
  value: unknown,
  path: string,
  depth: number,
  state: { nodes: number },
  ancestors: Set<object>,
): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_METADATA_NODES) {
    throw new TypeError(`${path} exceeds the metadata value limit`);
  }
  if (depth > 8) throw new TypeError(`${path} is nested too deeply`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_METADATA_STRING_LENGTH || value.includes("\u0000")) {
      throw new TypeError(`${path} contains unsafe or oversized metadata text`);
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") {
    throw new TypeError(`${path} must contain only plain JSON values`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path} must be acyclic JSON data`);
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 100) {
        throw new TypeError(`${path} must be a bounded plain JSON array`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (
        keys.some((key) =>
          typeof key !== "string" ||
          (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key))) ||
        keys.length !== value.length + 1
      ) {
        throw new TypeError(`${path} must be a dense JSON array without custom properties`);
      }
      const normalized: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${path} must contain data properties without accessors`);
        }
        normalized.push(normalizedJsonValue(
          descriptor.value,
          `${path}[${index}]`,
          depth + 1,
          state,
          ancestors,
        ));
      }
      return normalized;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON values`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 100) throw new TypeError(`${path} has too many fields`);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError(`${path} must contain only string-keyed JSON fields`);
    }

    const normalized: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${path} must contain enumerable data properties without accessors`);
      }
      if (
        !key || key.length > 128 || RESERVED_METADATA_KEYS.has(key) ||
        metadataKeyParts(key).some((part) => SENSITIVE_METADATA_KEY_PARTS.has(part))
      ) {
        throw new TypeError(`${path} contains a forbidden metadata key`);
      }
      normalized[key] = normalizedJsonValue(
        descriptor.value,
        `${path}.${key}`,
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

export function persistenceJsonObject(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  const normalized = normalizedJsonValue(value, label, 0, { nodes: 0 }, new Set());
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > 16_384) {
    throw new TypeError(`${label} must be at most 16384 UTF-8 bytes`);
  }
  return serialized;
}

export type PersistenceAuditSemantics = Readonly<{
  action: string;
  targetType: string;
  targetId: string;
  result: SecurityAuditResult;
  reasonCode: string | null;
}>;

/**
 * Keeps actor/request context supplied by the application while making the
 * repository authoritative for the mutation and outcome it actually observed.
 */
export function persistenceAuditEvent(
  event: SecurityAuditEvent,
  semantics: PersistenceAuditSemantics,
): SecurityAuditEvent {
  return {
    id: event.id,
    executorType: event.executorType,
    executorUserId: event.executorUserId,
    executorKey: event.executorKey,
    originatingUserId: event.originatingUserId,
    originatingActorKey: event.originatingActorKey,
    action: semantics.action,
    targetType: semantics.targetType,
    targetId: semantics.targetId,
    result: semantics.result,
    reasonCode: semantics.reasonCode,
    requestId: event.requestId,
    correlationId: event.correlationId,
    source: event.source,
    metadata: event.metadata,
    occurredAt: event.occurredAt,
    retentionPolicyKey: event.retentionPolicyKey,
    retentionUntil: event.retentionUntil,
  };
}

export function isNamedPostgresConstraint(
  error: unknown,
  code: string,
  constraints: readonly string[],
) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === code &&
    typeof candidate.constraint === "string" &&
    constraints.includes(candidate.constraint);
}
