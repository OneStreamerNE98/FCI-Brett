export type ProviderActionQueued = Readonly<{
  outcome: "queued";
  operationId: string;
}>;

export type ProviderPublicFile = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  byteSize: number | null;
  webUrl: string | null;
}>;

export type ProviderFilesListed = Readonly<{
  outcome: "listed";
  files: readonly ProviderPublicFile[];
}>;

export type ProviderFileUploaded = Readonly<{
  outcome: "uploaded";
  file: ProviderPublicFile;
}>;

export type ProviderFileShared = Readonly<{
  outcome: "shared";
  fileId: string;
}>;

export type ProviderGmailFiled = Readonly<{
  outcome: "filed";
  operationId: string;
}>;

export type ProviderCalendarCreated = Readonly<{
  outcome: "created";
  operationId: string;
}>;

export type ProviderActionSuccessByRoute = Readonly<{
  files: ProviderFilesListed;
  files_upload: ProviderFileUploaded;
  files_share: ProviderFileShared;
  gmail_file: ProviderGmailFiled;
  calendar_create: ProviderCalendarCreated;
}>;

export type ProviderActionRouteKind = keyof ProviderActionSuccessByRoute;

const PROVIDER_ACTION_ROUTE_KINDS = new Set<ProviderActionRouteKind>([
  "files",
  "files_upload",
  "files_share",
  "gmail_file",
  "calendar_create",
]);

export function isProviderActionRouteKind(
  value: string,
): value is ProviderActionRouteKind {
  return PROVIDER_ACTION_ROUTE_KINDS.has(value as ProviderActionRouteKind);
}

const SAFE_OPERATION_ID = /^[^\u0000-\u001f\u007f]{1,255}$/;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const MAX_PROVIDER_FILES = 100;
const MAX_PROVIDER_NAME_LENGTH = 512;
const MAX_PROVIDER_MIME_LENGTH = 255;
const MAX_PROVIDER_URL_LENGTH = 2_048;

function invalidProviderSuccess(): never {
  // A malformed success value is a composed-provider contract failure. Treat
  // it as terminal and never serialize any part of the untrusted value.
  throw new ProviderDegradedError({ retryable: false });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    return invalidProviderSuccess();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string")
    || ownKeys.length !== keys.length
    || ownKeys.some((key) => !keys.includes(key as string))
  ) {
    return invalidProviderSuccess();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    ownKeys.some((key) => {
      const descriptor = descriptors[key as string];
      return !descriptor || !("value" in descriptor);
    })
  ) {
    return invalidProviderSuccess();
  }
  return Object.freeze(Object.fromEntries(
    keys.map((key) => [key, descriptors[key]!.value]),
  ));
}

function providerId(value: unknown) {
  if (typeof value !== "string" || !SAFE_PROVIDER_ID.test(value)) {
    return invalidProviderSuccess();
  }
  return value;
}

function providerText(value: unknown, maximumLength: number) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximumLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return invalidProviderSuccess();
  }
  return value;
}

function providerByteSize(value: unknown) {
  if (
    value !== null
    && (
      typeof value !== "number"
      || !Number.isSafeInteger(value)
      || value < 0
    )
  ) {
    return invalidProviderSuccess();
  }
  return value as number | null;
}

function providerWebUrl(value: unknown) {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAX_PROVIDER_URL_LENGTH
  ) {
    return invalidProviderSuccess();
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
    ) {
      return invalidProviderSuccess();
    }
    return parsed.toString();
  } catch {
    return invalidProviderSuccess();
  }
}

function publicFile(value: unknown): ProviderPublicFile {
  const record = closedRecord(
    value,
    ["id", "name", "mimeType", "byteSize", "webUrl"],
  );
  return Object.freeze({
    id: providerId(record.id),
    name: providerText(record.name, MAX_PROVIDER_NAME_LENGTH),
    mimeType: providerText(record.mimeType, MAX_PROVIDER_MIME_LENGTH),
    byteSize: providerByteSize(record.byteSize),
    webUrl: providerWebUrl(record.webUrl),
  });
}

/**
 * Provider adapters are an untrusted serialization boundary. Each route gets
 * one closed public DTO; raw Google objects and additional keys fail closed.
 */
export function normalizeProviderActionSuccess(
  routeKind: ProviderActionRouteKind,
  value: unknown,
): ProviderActionSuccessByRoute[ProviderActionRouteKind] {
  if (routeKind === "files") {
    const record = closedRecord(value, ["outcome", "files"]);
    if (
      record.outcome !== "listed"
      || !Array.isArray(record.files)
      || record.files.length > MAX_PROVIDER_FILES
    ) {
      return invalidProviderSuccess();
    }
    return Object.freeze({
      outcome: "listed",
      files: Object.freeze(record.files.map(publicFile)),
    });
  }
  if (routeKind === "files_upload") {
    const record = closedRecord(value, ["outcome", "file"]);
    if (record.outcome !== "uploaded") return invalidProviderSuccess();
    return Object.freeze({
      outcome: "uploaded",
      file: publicFile(record.file),
    });
  }
  if (routeKind === "files_share") {
    const record = closedRecord(value, ["outcome", "fileId"]);
    if (record.outcome !== "shared") return invalidProviderSuccess();
    return Object.freeze({
      outcome: "shared",
      fileId: providerId(record.fileId),
    });
  }
  if (routeKind === "gmail_file") {
    const record = closedRecord(value, ["outcome", "operationId"]);
    if (record.outcome !== "filed") return invalidProviderSuccess();
    return Object.freeze({
      outcome: "filed",
      operationId: providerId(record.operationId),
    });
  }
  if (routeKind === "calendar_create") {
    const record = closedRecord(value, ["outcome", "operationId"]);
    if (record.outcome !== "created") return invalidProviderSuccess();
    return Object.freeze({
      outcome: "created",
      operationId: providerId(record.operationId),
    });
  }
  return invalidProviderSuccess();
}

function normalizedOperationId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized === value && SAFE_OPERATION_ID.test(normalized)
    ? normalized
    : null;
}

/**
 * A queue callback may return this value only after its durable intent commits.
 * The HTTP layer then acknowledges the intent with 202 and does not ask the
 * caller to submit the same side effect again.
 */
export function providerActionQueued(operationId: string): ProviderActionQueued {
  const normalized = operationId.trim();
  if (!SAFE_OPERATION_ID.test(normalized)) {
    throw new TypeError(
      "Queued provider operation ID must be 1 to 255 safe characters",
    );
  }
  return Object.freeze({ outcome: "queued", operationId: normalized });
}

function queuedOperationId(value: unknown) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    return null;
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2
    || keys.some(
      (key) => key !== "outcome" && key !== "operationId",
    )
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    !descriptors.outcome
    || !("value" in descriptors.outcome)
    || !descriptors.operationId
    || !("value" in descriptors.operationId)
  ) {
    return null;
  }
  return descriptors.outcome.value === "queued"
    ? normalizedOperationId(descriptors.operationId.value)
    : null;
}

export function isProviderActionQueued(
  value: unknown,
): value is ProviderActionQueued {
  return queuedOperationId(value) !== null;
}

export function normalizeProviderActionQueued(
  value: unknown,
): ProviderActionQueued | null {
  const operationId = queuedOperationId(value);
  return operationId === null ? null : providerActionQueued(operationId);
}

export class ProviderDegradedError extends Error {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(input: Readonly<{
    retryable: boolean;
    retryAfterSeconds?: number;
  }>) {
    super("The composed provider is temporarily unavailable");
    this.name = "ProviderDegradedError";
    if (typeof input.retryable !== "boolean") {
      throw new TypeError("Provider retryability must be a boolean");
    }
    this.retryable = input.retryable;
    const retryAfterSeconds = input.retryAfterSeconds;
    if (
      retryAfterSeconds !== undefined
      && (
        !Number.isSafeInteger(retryAfterSeconds)
        || retryAfterSeconds < 1
        || retryAfterSeconds > 86_400
      )
    ) {
      throw new TypeError("Provider retry delay must be an integer from 1 to 86400 seconds");
    }
    this.retryAfterSeconds = retryAfterSeconds ?? null;
  }
}
