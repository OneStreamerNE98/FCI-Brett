const POSTGRES_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const POSTGRES_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTGRES_BIGINT_PATTERN = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/;
const POSTGRES_WHOLE_NUMERIC_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.0+)?$/;
const POSTGRES_BIGINT_MIN = BigInt("-9223372036854775808");
const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");
const ZERO_BIGINT = BigInt(0);
const ONE_BIGINT = BigInt(1);
const JAVASCRIPT_SAFE_INTEGER_MAX = BigInt(Number.MAX_SAFE_INTEGER);

function parsingError(label: string, expectation: string) {
  return new TypeError(`${label} must be ${expectation}`);
}

/** Validates a schema or relation name before it is interpolated into SQL. */
export function postgresSchemaName(value: unknown = "public") {
  if (
    typeof value !== "string" ||
    value.length > 63 ||
    !POSTGRES_IDENTIFIER_PATTERN.test(value)
  ) {
    throw parsingError("PostgreSQL schema name", "a lowercase PostgreSQL identifier");
  }
  return value;
}

/** Backwards-compatible descriptive alias for callers that prefer a parser name. */
export const parsePostgresSchemaName = postgresSchemaName;

/** Returns a safely quoted, schema-qualified name after validating both parts. */
export function qualifiedPostgresName(schema: unknown, relation: unknown) {
  const safeSchema = postgresSchemaName(schema);
  if (
    typeof relation !== "string" ||
    relation.length > 63 ||
    !POSTGRES_IDENTIFIER_PATTERN.test(relation)
  ) {
    throw parsingError("PostgreSQL relation name", "a lowercase PostgreSQL identifier");
  }
  return `"${safeSchema}"."${relation}"`;
}

export function isPostgresUuid(value: unknown): value is string {
  return typeof value === "string" && POSTGRES_UUID_PATTERN.test(value);
}

export function parsePostgresUuid(value: unknown, label = "PostgreSQL UUID") {
  if (!isPostgresUuid(value)) throw parsingError(label, "a canonical UUID");
  return value.toLowerCase();
}

/**
 * Parses PostgreSQL `bigint` without passing through an unsafe JavaScript
 * number. The returned decimal string is canonical and within PostgreSQL's
 * signed 64-bit range.
 */
export function parsePostgresBigint(value: unknown, label = "PostgreSQL bigint") {
  let canonical: string;
  if (typeof value === "string") {
    if (!POSTGRES_BIGINT_PATTERN.test(value)) {
      throw parsingError(label, "a canonical signed 64-bit integer");
    }
    canonical = value;
  } else if (typeof value === "bigint") {
    canonical = value.toString();
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    canonical = String(value);
  } else {
    throw parsingError(label, "a canonical signed 64-bit integer");
  }

  const parsed = BigInt(canonical);
  if (parsed < POSTGRES_BIGINT_MIN || parsed > POSTGRES_BIGINT_MAX) {
    throw parsingError(label, "a canonical signed 64-bit integer");
  }
  return canonical;
}

export function parsePostgresPositiveBigint(value: unknown, label = "PostgreSQL version") {
  const canonical = parsePostgresBigint(value, label);
  if (BigInt(canonical) < ONE_BIGINT) {
    throw parsingError(label, "a positive signed 64-bit integer");
  }
  return canonical;
}

export type PostgresNumericParseOptions = {
  nullable?: boolean;
};

export function parsePostgresNumericSafeInteger(
  value: unknown,
  label: string,
  options: { nullable: true },
): number | null;
export function parsePostgresNumericSafeInteger(
  value: unknown,
  label?: string,
  options?: PostgresNumericParseOptions,
): number;
/**
 * Parses the production model's nonnegative, whole-number `numeric` values.
 * PostgreSQL may retain a zero-only scale (for example `125.000`), which is
 * accepted without permitting a fractional or unsafe JavaScript number.
 */
export function parsePostgresNumericSafeInteger(
  value: unknown,
  label = "PostgreSQL numeric",
  options: PostgresNumericParseOptions = {},
) {
  if (value === null) {
    if (options.nullable) return null;
    throw parsingError(label, "a nonnegative JavaScript-safe whole number");
  }

  let integer: bigint;
  if (typeof value === "string") {
    if (!POSTGRES_WHOLE_NUMERIC_PATTERN.test(value)) {
      throw parsingError(label, "a nonnegative JavaScript-safe whole number");
    }
    integer = BigInt(value.split(".", 1)[0]);
  } else if (typeof value === "bigint") {
    integer = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    integer = BigInt(value);
  } else {
    throw parsingError(label, "a nonnegative JavaScript-safe whole number");
  }

  if (integer < ZERO_BIGINT || integer > JAVASCRIPT_SAFE_INTEGER_MAX) {
    throw parsingError(label, "a nonnegative JavaScript-safe whole number");
  }
  return Number(integer);
}

export const parsePostgresSafeWholeNumber = parsePostgresNumericSafeInteger;

export function parseNullablePostgresSafeWholeNumber(
  value: unknown,
  label = "PostgreSQL numeric",
) {
  return parsePostgresNumericSafeInteger(value, label, { nullable: true });
}

/** Converts a `timestamptz` driver value into a validated epoch-millisecond value. */
export function parsePostgresTimestamp(value: unknown, label = "PostgreSQL timestamptz") {
  let milliseconds: number;
  if (value instanceof Date) {
    milliseconds = value.getTime();
  } else if (typeof value === "string" && /(?:z|[+-][0-9]{2}(?::?[0-9]{2})?)$/i.test(value)) {
    milliseconds = Date.parse(value);
  } else {
    throw parsingError(label, "a valid timezone-aware timestamp");
  }

  if (!Number.isSafeInteger(milliseconds)) {
    throw parsingError(label, "a valid timezone-aware timestamp");
  }
  return milliseconds;
}

export const parsePostgresTimestampMs = parsePostgresTimestamp;

/** Allows only the object shape guaranteed by a JSONB object constraint. */
export function parsePostgresJsonObject(
  value: unknown,
  label = "PostgreSQL JSON object",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw parsingError(label, "a JSON object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw parsingError(label, "a JSON object");
  }
  return value as Record<string, unknown>;
}
