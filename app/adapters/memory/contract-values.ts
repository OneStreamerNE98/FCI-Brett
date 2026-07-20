const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOWER_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const VERSION_PATTERN = /^(?:[1-9][0-9]*)$/;
const RESERVED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SENSITIVE_JSON_KEY_PARTS = new Set([
  "authorization",
  "body",
  "bodies",
  "ciphertext",
  "ciphertexts",
  "cookie",
  "cookies",
  "nonce",
  "nonces",
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

const encoder = new TextEncoder();

function keyParts(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function memoryUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UUID`);
  }
  return value.toLowerCase();
}

export function memoryKey(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.length > 192
    || !LOWER_KEY_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded lowercase key`);
  }
  return value;
}

export function memoryText(
  value: unknown,
  label: string,
  maximum = 512,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} must be bounded nonblank text`);
  }
  return value;
}

export function memoryTime(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be nonnegative safe epoch milliseconds`);
  }
  if (!Number.isFinite(new Date(value).getTime())) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return value;
}

export function memoryPositiveInteger(
  value: unknown,
  label: string,
  maximum: number,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > maximum
  ) {
    throw new TypeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

export function memoryDuration(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 31 * 24 * 60 * 60 * 1_000
  ) {
    throw new TypeError(`${label} must be a bounded nonnegative duration`);
  }
  return value;
}

export function memoryVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a positive decimal version`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt("9223372036854775807")) {
    throw new TypeError(`${label} must fit a signed 64-bit integer`);
  }
  return parsed.toString();
}

export function nextMemoryVersion(value: string): string {
  return memoryVersion(
    (BigInt(memoryVersion(value, "Version")) + BigInt(1)).toString(),
    "Next version",
  );
}

function cloneJsonValue(
  value: unknown,
  path: string,
  depth: number,
  state: { nodes: number },
  ancestors: Set<object>,
): unknown {
  state.nodes += 1;
  if (state.nodes > 256) throw new TypeError(`${path} exceeds the JSON value limit`);
  if (depth > 8) throw new TypeError(`${path} is nested too deeply`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 4_000 || value.includes("\u0000")) {
      throw new TypeError(`${path} contains unsafe or oversized text`);
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
          typeof key !== "string"
          || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))
        || keys.length !== value.length + 1
      ) {
        throw new TypeError(`${path} must be a dense JSON array without custom properties`);
      }
      return value.map((_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${path} must contain data properties without accessors`);
        }
        return cloneJsonValue(
          descriptor.value,
          `${path}[${index}]`,
          depth + 1,
          state,
          ancestors,
        );
      });
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 100 || keys.some((key) => typeof key !== "string")) {
      throw new TypeError(`${path} must contain bounded string-keyed fields`);
    }
    const copy: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${path} must contain data properties without accessors`);
      }
      if (
        !key
        || key.length > 128
        || RESERVED_JSON_KEYS.has(key)
        || keyParts(key).some((part) => SENSITIVE_JSON_KEY_PARTS.has(part))
      ) {
        throw new TypeError(`${path} contains a forbidden field`);
      }
      copy[key] = cloneJsonValue(
        descriptor.value,
        `${path}.${key}`,
        depth + 1,
        state,
        ancestors,
      );
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

export function memoryJsonObject(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  const copy = cloneJsonValue(value, label, 0, { nodes: 0 }, new Set()) as Record<string, unknown>;
  if (encoder.encode(JSON.stringify(copy)).byteLength > 16_384) {
    throw new TypeError(`${label} must be at most 16384 UTF-8 bytes`);
  }
  return copy;
}

function canonicalJsonValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(object[key])}`)
    .join(",")}}`;
}

export function memoryCanonicalJsonObject(value: unknown, label: string): string {
  return canonicalJsonValue(memoryJsonObject(value, label));
}

export function memoryCiphertext(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 16 || value.byteLength > 65_536) {
    throw new TypeError(`${label} must be a bounded encrypted byte sequence`);
  }
  return value.slice();
}
