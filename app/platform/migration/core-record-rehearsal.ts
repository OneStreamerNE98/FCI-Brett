import { createHash } from "node:crypto";

import { normalizeClientNameKey } from "../../domain/client-name-key.ts";
import {
  EXPECTED_PRODUCTION_SCHEMA_HISTORY,
  productionSchemaHistoryMatches,
  type ProductionMigrationHistoryRow,
} from "../google-cloud/database-readiness.ts";

export const CORE_REHEARSAL_ACKNOWLEDGMENT =
  "FCI TEST — DO NOT USE — I ACKNOWLEDGE THIS NON-PRODUCTION CORE REHEARSAL";
export const CORE_REHEARSAL_SCHEMA_PREFIX = "fci_rehearsal_";
export const CORE_REHEARSAL_SCHEMA_PATTERN = /^fci_rehearsal_[a-z0-9_]{1,49}$/;
export const CORE_REHEARSAL_IMPORTER_ROLE = "fci_rehearsal_importer";
export const CORE_REHEARSAL_ADVISORY_LOCK_ID = "7314269172071302";
export const CORE_REHEARSAL_TEST_MARKER = "FCI TEST — DO NOT USE";
export const CORE_REHEARSAL_SOURCE_SYSTEM = "d1-development-test-export";
export const CORE_REHEARSAL_MAX_ROWS = 5_000;

export const DEFERRED_SOURCE_CATEGORIES = [
  "records",
  "webhook_receipts",
  "leads",
  "project_meetings",
  "filing_rules",
  "workspace_settings",
  "user_preferences",
  "mail_items",
  "gmail_file_archives",
  "gmail_file_archive_artifacts",
  "google_oauth_attempts",
  "google_connections",
  "drive_folder_mappings",
  "google_drive_operations",
  "google_sheet_sync_state",
  "google_integration_events",
  "workspace_simulation_state",
  "unclassified_activity_events",
  "r2_objects",
] as const;

type DeferredSourceCategory = (typeof DEFERRED_SOURCE_CATEGORIES)[number];
type RehearsalEnvironment = "development" | "staging";
type ActivityResult = "succeeded" | "failed" | "denied";
type ActivityRecordType = "client" | "project";

type PreparedClient = {
  id: string;
  clientCode: string;
  name: string;
  normalizedNameKey: string;
  status: "active" | "prospect" | "inactive" | "archived";
  industry: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: "1";
};

type PreparedContact = {
  id: string;
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  version: "1";
};

type PreparedProject = {
  id: string;
  projectNumber: string;
  clientId: string;
  name: string;
  status:
    | "planning"
    | "mobilizing"
    | "installation"
    | "closeout"
    | "completed"
    | "cancelled"
    | "archived";
  site: string | null;
  projectManager: string | null;
  estimatedValue: number | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: "1";
};

type PreparedActivityEvent = {
  id: string;
  recordType: ActivityRecordType;
  recordId: string;
  action: string;
  actorId: string;
  correlationId: string;
  result: ActivityResult;
  reason: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
};

export type PreparedCoreRecordSnapshot = {
  clients: PreparedClient[];
  contacts: PreparedContact[];
  projects: PreparedProject[];
  activityEvents: PreparedActivityEvent[];
};

export type CoreRecordTableEvidence = {
  count: number;
  contentSha256: string;
  identifiersSha256: string;
};

export type CoreRecordEvidence = {
  clients: CoreRecordTableEvidence;
  contacts: CoreRecordTableEvidence;
  projects: CoreRecordTableEvidence;
  activityEvents: CoreRecordTableEvidence;
};

export type CoreRecordRehearsalOptions = {
  targetEnvironment: string;
  targetSchema: string;
  acknowledgment: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

export type CoreRecordRehearsalPlan = {
  targetEnvironment: RehearsalEnvironment;
  targetSchema: string;
  rows: PreparedCoreRecordSnapshot;
  sourceEvidence: CoreRecordEvidence;
  deferredSourceCounts: Record<DeferredSourceCategory, 0>;
};

export type CoreRecordRehearsalReport = {
  formatVersion: 1;
  dataClassification: "test";
  scope: "bounded-core-only";
  targetEnvironment: RehearsalEnvironment;
  targetSchema: string;
  status: "reconciled";
  tables: {
    clients: ReconciledTableEvidence;
    contacts: ReconciledTableEvidence;
    projects: ReconciledTableEvidence;
    activityEvents: ReconciledTableEvidence;
  };
  sideEffects: {
    idempotencyRequestsInserted: 0;
    outboxEventsInserted: 0;
    providerCalls: 0;
  };
  deferredSourceCounts: Record<DeferredSourceCategory, 0>;
  cutoverReady: false;
};

type ReconciledTableEvidence = {
  sourceCount: number;
  destinationCount: number;
  sourceContentSha256: string;
  destinationContentSha256: string;
  sourceIdentifiersSha256: string;
  destinationIdentifiersSha256: string;
  matched: true;
};

export interface CoreRehearsalQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  rows: Row[];
  rowCount: number | null;
}

export interface CoreRehearsalClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<CoreRehearsalQueryResult<Row>>;
  release(error?: Error): void;
}

export interface CoreRehearsalPool {
  connect(): Promise<CoreRehearsalClient>;
}

export class CoreRecordRehearsalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CoreRecordRehearsalError";
    this.code = code;
  }
}

const CLIENT_STATUSES = new Set(["active", "prospect", "inactive", "archived"]);
const PROJECT_STATUSES = new Set([
  "planning",
  "mobilizing",
  "installation",
  "closeout",
  "completed",
  "cancelled",
  "archived",
]);
const ACTIVITY_RESULTS = new Set(["succeeded", "failed", "denied"]);
const POSTGRES_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_CODE_PATTERN = /^CL-[A-Z0-9]{8}$/;
const PROJECT_NUMBER_PATTERN = /^CF-[0-9]{4}-[A-Z0-9]{8}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_TEXT_LENGTH = 20_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const INSERT_BATCH_SIZE = 50;

const TOP_LEVEL_KEYS = [
  "formatVersion",
  "dataClassification",
  "sourceSystem",
  "deferredSourceCounts",
  "clients",
  "contacts",
  "projects",
  "activityEvents",
] as const;
const CLIENT_KEYS = [
  "id",
  "clientCode",
  "name",
  "normalizedNameKey",
  "status",
  "industry",
  "driveFolderId",
  "driveUrl",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "version",
] as const;
const CONTACT_KEYS = [
  "id",
  "clientId",
  "name",
  "email",
  "phone",
  "role",
  "isPrimary",
  "createdAt",
  "updatedAt",
  "version",
] as const;
const PROJECT_KEYS = [
  "id",
  "projectNumber",
  "clientId",
  "name",
  "status",
  "site",
  "projectManager",
  "estimatedValue",
  "driveFolderId",
  "driveUrl",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "version",
] as const;
const ACTIVITY_KEYS = [
  "id",
  "recordType",
  "recordId",
  "action",
  "actorId",
  "correlationId",
  "result",
  "reason",
  "detail",
  "occurredAt",
] as const;

function fail(code: string, message: string): never {
  throw new CoreRecordRehearsalError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) fail("invalid_snapshot_shape", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("unsupported_snapshot_field", `${label} contains missing or unsupported fields`);
  }
  return value;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail("invalid_snapshot_shape", `${label} must be an array`);
  return value;
}

function requiredText(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maxLength ||
    /[\u0000]/u.test(value)
  ) {
    fail("invalid_snapshot_value", `${label} must be a nonempty bounded string`);
  }
  return value;
}

function markedTestRecordName(value: string) {
  return (
    value === CORE_REHEARSAL_TEST_MARKER ||
    value.startsWith(`${CORE_REHEARSAL_TEST_MARKER} `)
  );
}

function nullableText(value: unknown, label: string, allowBlank = true): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || /[\u0000]/u.test(value)) {
    fail("invalid_snapshot_value", `${label} must be null or a bounded string`);
  }
  if (!allowBlank && value.trim() === "") {
    fail("invalid_snapshot_value", `${label} must be null or a nonempty string`);
  }
  return value;
}

function canonicalUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    fail("invalid_identifier", `${label} must be a lowercase canonical UUID`);
  }
  return value;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail("invalid_timestamp", `${label} must be a canonical UTC timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isSafeInteger(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("invalid_timestamp", `${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function databaseTimestamp(value: unknown, label: string): string {
  if (value instanceof Date && Number.isSafeInteger(value.getTime())) return value.toISOString();
  return canonicalTimestamp(value, label);
}

function versionOne(value: unknown, label: string): "1" {
  if (value !== "1") fail("invalid_version", `${label} must be the explicit migration baseline version`);
  return "1";
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("invalid_snapshot_value", `${label} must be a nonnegative safe integer`);
  }
  return value;
}

function nullableEstimatedValue(value: unknown, label: string): number | null {
  if (value === null) return null;
  return nonnegativeSafeInteger(value, label);
}

function databaseEstimatedValue(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value === "number") return nullableEstimatedValue(value, label);
  if (typeof value === "bigint") {
    if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail("invalid_destination_value", `${label} is outside the safe whole-number range`);
    }
    return Number(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.0+)?$/.test(value)) {
    const parsed = BigInt(value.split(".", 1)[0]);
    if (parsed <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(parsed);
  }
  fail("invalid_destination_value", `${label} is not a safe whole-number numeric`);
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail("invalid_snapshot_value", `${label} must be a JSON object`);
  validateJsonValue(value, label, new Set(), 0);
  return value;
}

function validateJsonValue(
  value: unknown,
  label: string,
  ancestors: Set<object>,
  depth: number,
): void {
  if (depth > 30) fail("invalid_snapshot_value", `${label} exceeds the JSON depth limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_snapshot_value", `${label} contains a non-JSON number`);
    return;
  }
  if (!value || typeof value !== "object") {
    fail("invalid_snapshot_value", `${label} contains a non-JSON value`);
  }
  if (ancestors.has(value)) fail("invalid_snapshot_value", `${label} contains a circular value`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, label, ancestors, depth + 1);
  } else {
    if (!isPlainObject(value)) fail("invalid_snapshot_value", `${label} contains a non-JSON object`);
    for (const item of Object.values(value)) validateJsonValue(item, label, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sha256Evidence(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(namespace).update("\n").update(stableJson(value)).digest("hex")}`;
}

function tableEvidence<T extends { id: string }>(table: string, rows: readonly T[]): CoreRecordTableEvidence {
  const ordered = [...rows].sort((left, right) => left.id.localeCompare(right.id));
  return {
    count: ordered.length,
    contentSha256: sha256Evidence(`${table}:content:v1`, ordered),
    identifiersSha256: sha256Evidence(
      `${table}:identifiers:v1`,
      ordered.map((row) => row.id),
    ),
  };
}

function createEvidence(rows: PreparedCoreRecordSnapshot): CoreRecordEvidence {
  return {
    clients: tableEvidence("clients", rows.clients),
    contacts: tableEvidence("contacts", rows.contacts),
    projects: tableEvidence("projects", rows.projects),
    activityEvents: tableEvidence("activity_events", rows.activityEvents),
  };
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    fail("duplicate_source_value", `${label} must be unique in the rehearsal snapshot`);
  }
}

function deferredCounts(value: unknown): Record<DeferredSourceCategory, 0> {
  const source = exactObject(value, DEFERRED_SOURCE_CATEGORIES, "deferredSourceCounts");
  const result = {} as Record<DeferredSourceCategory, 0>;
  for (const category of DEFERRED_SOURCE_CATEGORIES) {
    const count = nonnegativeSafeInteger(source[category], `deferredSourceCounts.${category}`);
    if (count !== 0) {
      fail(
        "deferred_source_data_present",
        `The bounded core rehearsal refuses deferred source category ${category}`,
      );
    }
    result[category] = 0;
  }
  return result;
}

function prepareSnapshot(value: unknown): {
  rows: PreparedCoreRecordSnapshot;
  deferredSourceCounts: Record<DeferredSourceCategory, 0>;
} {
  const source = exactObject(value, TOP_LEVEL_KEYS, "snapshot");
  if (source.formatVersion !== 1) fail("unsupported_snapshot_version", "snapshot.formatVersion must be 1");
  if (source.dataClassification !== "test") {
    fail("unsafe_data_classification", "snapshot.dataClassification must be test");
  }
  if (source.sourceSystem !== CORE_REHEARSAL_SOURCE_SYSTEM) {
    fail("unsupported_source", `snapshot.sourceSystem must be ${CORE_REHEARSAL_SOURCE_SYSTEM}`);
  }
  const deferredSourceCounts = deferredCounts(source.deferredSourceCounts);
  const clientEntries = arrayValue(source.clients, "snapshot.clients");
  const contactEntries = arrayValue(source.contacts, "snapshot.contacts");
  const projectEntries = arrayValue(source.projects, "snapshot.projects");
  const activityEntries = arrayValue(source.activityEvents, "snapshot.activityEvents");
  const totalRows =
    clientEntries.length +
    contactEntries.length +
    projectEntries.length +
    activityEntries.length;
  if (totalRows > CORE_REHEARSAL_MAX_ROWS) {
    fail(
      "snapshot_too_large",
      `The bounded rehearsal accepts at most ${CORE_REHEARSAL_MAX_ROWS} rows`,
    );
  }

  const clients = clientEntries.map((entry, index) => {
    const row = exactObject(entry, CLIENT_KEYS, `clients[${index}]`);
    const id = canonicalUuid(row.id, `clients[${index}].id`);
    const clientCode = requiredText(row.clientCode, `clients[${index}].clientCode`, 11);
    if (!CLIENT_CODE_PATTERN.test(clientCode)) {
      fail("invalid_identifier", `clients[${index}].clientCode is not production-compatible`);
    }
    const name = requiredText(row.name, `clients[${index}].name`);
    if (!markedTestRecordName(name)) {
      fail("unsafe_test_record", `clients[${index}].name must include the test-data marker`);
    }
    const normalizedNameKey = requiredText(
      row.normalizedNameKey,
      `clients[${index}].normalizedNameKey`,
    );
    if (normalizedNameKey !== normalizeClientNameKey(name)) {
      fail("invalid_normalized_key", `clients[${index}].normalizedNameKey does not match the canonical algorithm`);
    }
    const status = requiredText(row.status, `clients[${index}].status`) as PreparedClient["status"];
    if (!CLIENT_STATUSES.has(status)) fail("invalid_status", `clients[${index}].status is unsupported`);
    if (row.driveFolderId !== null || row.driveUrl !== null) {
      fail("unsupported_legacy_drive_data", `clients[${index}] contains deferred legacy Drive fields`);
    }
    const createdAt = canonicalTimestamp(row.createdAt, `clients[${index}].createdAt`);
    const updatedAt = canonicalTimestamp(row.updatedAt, `clients[${index}].updatedAt`);
    if (updatedAt < createdAt) fail("invalid_timestamp_order", `clients[${index}] timestamps are out of order`);
    return {
      id,
      clientCode,
      name,
      normalizedNameKey,
      status,
      industry: nullableText(row.industry, `clients[${index}].industry`),
      createdBy: requiredText(row.createdBy, `clients[${index}].createdBy`),
      updatedBy: requiredText(row.updatedBy, `clients[${index}].updatedBy`),
      createdAt,
      updatedAt,
      version: versionOne(row.version, `clients[${index}].version`),
    } satisfies PreparedClient;
  });

  assertUnique(clients.map((row) => row.id), "Client IDs");
  assertUnique(clients.map((row) => row.clientCode), "Client codes");
  assertUnique(clients.map((row) => row.normalizedNameKey), "Normalized client names");
  const clientIds = new Set(clients.map((row) => row.id));

  const contacts = contactEntries.map((entry, index) => {
    const row = exactObject(entry, CONTACT_KEYS, `contacts[${index}]`);
    const id = canonicalUuid(row.id, `contacts[${index}].id`);
    const clientId = canonicalUuid(row.clientId, `contacts[${index}].clientId`);
    if (!clientIds.has(clientId)) fail("orphan_source_record", `contacts[${index}] has no source client`);
    const createdAt = canonicalTimestamp(row.createdAt, `contacts[${index}].createdAt`);
    const updatedAt = canonicalTimestamp(row.updatedAt, `contacts[${index}].updatedAt`);
    if (updatedAt < createdAt) fail("invalid_timestamp_order", `contacts[${index}] timestamps are out of order`);
    if (typeof row.isPrimary !== "boolean") {
      fail("invalid_snapshot_value", `contacts[${index}].isPrimary must be boolean`);
    }
    return {
      id,
      clientId,
      name: requiredText(row.name, `contacts[${index}].name`),
      email: nullableText(row.email, `contacts[${index}].email`, false),
      phone: nullableText(row.phone, `contacts[${index}].phone`, false),
      role: requiredText(row.role, `contacts[${index}].role`),
      isPrimary: row.isPrimary,
      createdAt,
      updatedAt,
      version: versionOne(row.version, `contacts[${index}].version`),
    } satisfies PreparedContact;
  });

  assertUnique(contacts.map((row) => row.id), "Contact IDs");
  const primaryClientIds = contacts.filter((row) => row.isPrimary).map((row) => row.clientId);
  assertUnique(primaryClientIds, "Primary-contact client IDs");

  const projects = projectEntries.map((entry, index) => {
    const row = exactObject(entry, PROJECT_KEYS, `projects[${index}]`);
    const id = canonicalUuid(row.id, `projects[${index}].id`);
    const clientId = canonicalUuid(row.clientId, `projects[${index}].clientId`);
    if (!clientIds.has(clientId)) fail("orphan_source_record", `projects[${index}] has no source client`);
    const projectNumber = requiredText(row.projectNumber, `projects[${index}].projectNumber`, 16);
    if (!PROJECT_NUMBER_PATTERN.test(projectNumber)) {
      fail("invalid_identifier", `projects[${index}].projectNumber is not production-compatible`);
    }
    const name = requiredText(row.name, `projects[${index}].name`);
    if (!markedTestRecordName(name)) {
      fail("unsafe_test_record", `projects[${index}].name must include the test-data marker`);
    }
    const status = requiredText(row.status, `projects[${index}].status`) as PreparedProject["status"];
    if (!PROJECT_STATUSES.has(status)) fail("invalid_status", `projects[${index}].status is unsupported`);
    if (row.driveFolderId !== null || row.driveUrl !== null) {
      fail("unsupported_legacy_drive_data", `projects[${index}] contains deferred legacy Drive fields`);
    }
    const createdAt = canonicalTimestamp(row.createdAt, `projects[${index}].createdAt`);
    const updatedAt = canonicalTimestamp(row.updatedAt, `projects[${index}].updatedAt`);
    if (updatedAt < createdAt) fail("invalid_timestamp_order", `projects[${index}] timestamps are out of order`);
    return {
      id,
      projectNumber,
      clientId,
      name,
      status,
      site: nullableText(row.site, `projects[${index}].site`),
      projectManager: nullableText(row.projectManager, `projects[${index}].projectManager`),
      estimatedValue: nullableEstimatedValue(row.estimatedValue, `projects[${index}].estimatedValue`),
      createdBy: requiredText(row.createdBy, `projects[${index}].createdBy`),
      updatedBy: requiredText(row.updatedBy, `projects[${index}].updatedBy`),
      createdAt,
      updatedAt,
      version: versionOne(row.version, `projects[${index}].version`),
    } satisfies PreparedProject;
  });

  assertUnique(projects.map((row) => row.id), "Project IDs");
  assertUnique(projects.map((row) => row.projectNumber), "Project numbers");
  const projectIds = new Set(projects.map((row) => row.id));

  const activityEvents = activityEntries.map(
    (entry, index) => {
      const row = exactObject(entry, ACTIVITY_KEYS, `activityEvents[${index}]`);
      const id = canonicalUuid(row.id, `activityEvents[${index}].id`);
      if (row.recordType !== "client" && row.recordType !== "project") {
        fail("unclassified_activity", `activityEvents[${index}].recordType must be explicit`);
      }
      const recordType = row.recordType;
      const recordId = canonicalUuid(row.recordId, `activityEvents[${index}].recordId`);
      const knownRecord = recordType === "client" ? clientIds.has(recordId) : projectIds.has(recordId);
      if (!knownRecord) fail("orphan_source_record", `activityEvents[${index}] has no classified source record`);
      const result = requiredText(row.result, `activityEvents[${index}].result`) as ActivityResult;
      if (!ACTIVITY_RESULTS.has(result)) {
        fail("unclassified_activity", `activityEvents[${index}].result must be explicit`);
      }
      return {
        id,
        recordType,
        recordId,
        action: requiredText(row.action, `activityEvents[${index}].action`),
        actorId: requiredText(row.actorId, `activityEvents[${index}].actorId`),
        correlationId: requiredText(row.correlationId, `activityEvents[${index}].correlationId`),
        result,
        reason: nullableText(row.reason, `activityEvents[${index}].reason`, false),
        detail: jsonObject(row.detail, `activityEvents[${index}].detail`),
        occurredAt: canonicalTimestamp(row.occurredAt, `activityEvents[${index}].occurredAt`),
      } satisfies PreparedActivityEvent;
    },
  );
  assertUnique(activityEvents.map((row) => row.id), "Activity-event IDs");

  return { rows: { clients, contacts, projects, activityEvents }, deferredSourceCounts };
}

function timeout(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_TIMEOUT_MS) {
    fail("invalid_rehearsal_option", `${label} must be an integer from 1 to ${MAX_TIMEOUT_MS} ms`);
  }
  return resolved;
}

function rehearsalGuard(options: CoreRecordRehearsalOptions): {
  targetEnvironment: RehearsalEnvironment;
  targetSchema: string;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
} {
  if (options.targetEnvironment !== "development" && options.targetEnvironment !== "staging") {
    fail("production_target_refused", "Core rehearsal target must be development or staging, never production");
  }
  if (
    typeof options.targetSchema !== "string" ||
    !CORE_REHEARSAL_SCHEMA_PATTERN.test(options.targetSchema)
  ) {
    fail(
      "unsafe_target_schema",
      `Core rehearsal schema must be a lowercase identifier beginning with ${CORE_REHEARSAL_SCHEMA_PREFIX}`,
    );
  }
  if (options.acknowledgment !== CORE_REHEARSAL_ACKNOWLEDGMENT) {
    fail("acknowledgment_required", "The exact core rehearsal acknowledgment is required");
  }
  return {
    targetEnvironment: options.targetEnvironment,
    targetSchema: options.targetSchema,
    lockTimeoutMs: timeout(options.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS, "Rehearsal lock timeout"),
    statementTimeoutMs: timeout(
      options.statementTimeoutMs,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      "Rehearsal statement timeout",
    ),
  };
}

export function createCoreRecordRehearsalPlan(
  snapshot: unknown,
  options: CoreRecordRehearsalOptions,
): CoreRecordRehearsalPlan {
  const guard = rehearsalGuard(options);
  const prepared = prepareSnapshot(snapshot);
  return {
    targetEnvironment: guard.targetEnvironment,
    targetSchema: guard.targetSchema,
    rows: prepared.rows,
    sourceEvidence: createEvidence(prepared.rows),
    deferredSourceCounts: prepared.deferredSourceCounts,
  };
}

function insertValues<T>(rows: readonly T[], values: (row: T) => readonly unknown[]): unknown[][] {
  return rows.map((row) => [...values(row)]);
}

async function insertBatches(
  client: CoreRehearsalClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    const bound: unknown[] = [];
    const placeholders = batch.map((row) => {
      const tuple = row.map((value) => {
        bound.push(value);
        return `$${bound.length}`;
      });
      return `(${tuple.join(", ")})`;
    });
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      bound,
    );
    if (result.rowCount !== batch.length) {
      fail("database_write_mismatch", `Core rehearsal did not insert the expected ${table} row count`);
    }
  }
}

async function insertPreparedRows(
  client: CoreRehearsalClient,
  rows: PreparedCoreRecordSnapshot,
): Promise<void> {
  await insertBatches(
    client,
    "clients",
    [
      "id",
      "client_code",
      "name",
      "normalized_name_key",
      "status",
      "industry",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
      "version",
    ],
    insertValues(rows.clients, (row) => [
      row.id,
      row.clientCode,
      row.name,
      row.normalizedNameKey,
      row.status,
      row.industry,
      row.createdBy,
      row.updatedBy,
      row.createdAt,
      row.updatedAt,
      row.version,
    ]),
  );
  await insertBatches(
    client,
    "contacts",
    ["id", "client_id", "name", "email", "phone", "role", "is_primary", "created_at", "updated_at", "version"],
    insertValues(rows.contacts, (row) => [
      row.id,
      row.clientId,
      row.name,
      row.email,
      row.phone,
      row.role,
      row.isPrimary,
      row.createdAt,
      row.updatedAt,
      row.version,
    ]),
  );
  await insertBatches(
    client,
    "projects",
    [
      "id",
      "project_number",
      "client_id",
      "name",
      "status",
      "site",
      "project_manager",
      "estimated_value",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
      "version",
    ],
    insertValues(rows.projects, (row) => [
      row.id,
      row.projectNumber,
      row.clientId,
      row.name,
      row.status,
      row.site,
      row.projectManager,
      row.estimatedValue,
      row.createdBy,
      row.updatedBy,
      row.createdAt,
      row.updatedAt,
      row.version,
    ]),
  );
  await insertBatches(
    client,
    "activity_events",
    [
      "id",
      "client_id",
      "project_id",
      "action",
      "actor_id",
      "correlation_id",
      "result",
      "reason",
      "detail",
      "occurred_at",
    ],
    insertValues(rows.activityEvents, (row) => [
      row.id,
      row.recordType === "client" ? row.recordId : null,
      row.recordType === "project" ? row.recordId : null,
      row.action,
      row.actorId,
      row.correlationId,
      row.result,
      row.reason,
      JSON.stringify(row.detail),
      row.occurredAt,
    ]),
  );
}

function queryRow(result: CoreRehearsalQueryResult, label: string): Record<string, unknown> {
  if (result.rowCount !== 1 || result.rows.length !== 1 || !isPlainObject(result.rows[0])) {
    fail("invalid_database_response", `${label} did not return exactly one row`);
  }
  return result.rows[0];
}

function databaseCount(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  fail("invalid_database_response", `${label} is not a nonnegative count`);
}

async function assertEmptyTarget(client: CoreRehearsalClient): Promise<void> {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::text FROM clients) AS "clients",
       (SELECT count(*)::text FROM contacts) AS "contacts",
       (SELECT count(*)::text FROM projects) AS "projects",
       (SELECT count(*)::text FROM activity_events) AS "activityEvents",
       (SELECT count(*)::text FROM idempotency_requests) AS "idempotencyRequests",
       (SELECT count(*)::text FROM outbox_events) AS "outboxEvents"`,
  );
  const row = queryRow(result, "Core rehearsal target preflight");
  const total =
    databaseCount(row.clients, "clients count") +
    databaseCount(row.contacts, "contacts count") +
    databaseCount(row.projects, "projects count") +
    databaseCount(row.activityEvents, "activity events count") +
    databaseCount(row.idempotencyRequests, "idempotency requests count") +
    databaseCount(row.outboxEvents, "outbox events count");
  if (total !== 0) fail("nonempty_target", "Core rehearsal target tables must all be empty");
}

async function assertExactTargetMigrationHistory(client: CoreRehearsalClient): Promise<void> {
  const result = await client.query<ProductionMigrationHistoryRow>(
    `SELECT version, name, checksum
     FROM production_schema_migrations
     ORDER BY version`,
  );
  if (!productionSchemaHistoryMatches(result.rows, EXPECTED_PRODUCTION_SCHEMA_HISTORY)) {
    fail(
      "schema_history_mismatch",
      "Core rehearsal target migration history does not exactly match the reviewed source registry",
    );
  }
}

async function assertDeliveryControlsStayedEmpty(client: CoreRehearsalClient): Promise<void> {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::text FROM idempotency_requests) AS "idempotencyRequests",
       (SELECT count(*)::text FROM outbox_events) AS "outboxEvents"`,
  );
  const row = queryRow(result, "Core rehearsal delivery-control reconciliation");
  const total =
    databaseCount(row.idempotencyRequests, "idempotency requests count") +
    databaseCount(row.outboxEvents, "outbox events count");
  if (total !== 0) {
    fail("delivery_control_mismatch", "Core rehearsal delivery-control tables did not remain empty");
  }
}

async function readDestinationRows(client: CoreRehearsalClient): Promise<PreparedCoreRecordSnapshot> {
  const clients = await client.query(
    `SELECT id::text AS "id", client_code AS "clientCode", name,
            normalized_name_key AS "normalizedNameKey", status, industry,
            created_by AS "createdBy", updated_by AS "updatedBy",
            created_at AS "createdAt", updated_at AS "updatedAt", version::text AS "version"
     FROM clients ORDER BY id`,
  );
  const contacts = await client.query(
    `SELECT id::text AS "id", client_id::text AS "clientId", name, email, phone, role,
            is_primary AS "isPrimary", created_at AS "createdAt", updated_at AS "updatedAt",
            version::text AS "version"
     FROM contacts ORDER BY id`,
  );
  const projects = await client.query(
    `SELECT id::text AS "id", project_number AS "projectNumber", client_id::text AS "clientId",
            name, status, site, project_manager AS "projectManager",
            estimated_value::text AS "estimatedValue", created_by AS "createdBy",
            updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt",
            version::text AS "version"
     FROM projects ORDER BY id`,
  );
  const activityEvents = await client.query(
    `SELECT id::text AS "id",
            CASE WHEN client_id IS NOT NULL THEN 'client' ELSE 'project' END AS "recordType",
            COALESCE(client_id, project_id)::text AS "recordId", action, actor_id AS "actorId",
            correlation_id AS "correlationId", result, reason, detail,
            occurred_at AS "occurredAt"
     FROM activity_events ORDER BY id`,
  );

  const targetLikeSnapshot = {
    formatVersion: 1,
    dataClassification: "test",
    sourceSystem: CORE_REHEARSAL_SOURCE_SYSTEM,
    deferredSourceCounts: Object.fromEntries(
      DEFERRED_SOURCE_CATEGORIES.map((category) => [category, 0]),
    ),
    clients: clients.rows.map((row) => ({
      ...row,
      driveFolderId: null,
      driveUrl: null,
      createdAt: databaseTimestamp(row.createdAt, "destination client createdAt"),
      updatedAt: databaseTimestamp(row.updatedAt, "destination client updatedAt"),
    })),
    contacts: contacts.rows.map((row) => ({
      ...row,
      createdAt: databaseTimestamp(row.createdAt, "destination contact createdAt"),
      updatedAt: databaseTimestamp(row.updatedAt, "destination contact updatedAt"),
    })),
    projects: projects.rows.map((row) => ({
      ...row,
      driveFolderId: null,
      driveUrl: null,
      estimatedValue: databaseEstimatedValue(row.estimatedValue, "destination project estimatedValue"),
      createdAt: databaseTimestamp(row.createdAt, "destination project createdAt"),
      updatedAt: databaseTimestamp(row.updatedAt, "destination project updatedAt"),
    })),
    activityEvents: activityEvents.rows.map((row) => ({
      ...row,
      occurredAt: databaseTimestamp(row.occurredAt, "destination activity occurredAt"),
    })),
  };
  return prepareSnapshot(targetLikeSnapshot).rows;
}

function evidenceMatches(source: CoreRecordTableEvidence, destination: CoreRecordTableEvidence): boolean {
  return (
    source.count === destination.count &&
    source.contentSha256 === destination.contentSha256 &&
    source.identifiersSha256 === destination.identifiersSha256 &&
    SHA256_PATTERN.test(source.contentSha256) &&
    SHA256_PATTERN.test(source.identifiersSha256)
  );
}

function reconciledTable(
  table: string,
  source: CoreRecordTableEvidence,
  destination: CoreRecordTableEvidence,
): ReconciledTableEvidence {
  if (!evidenceMatches(source, destination)) {
    fail("reconciliation_mismatch", `Core rehearsal ${table} counts or SHA-256 evidence did not match`);
  }
  return {
    sourceCount: source.count,
    destinationCount: destination.count,
    sourceContentSha256: source.contentSha256,
    destinationContentSha256: destination.contentSha256,
    sourceIdentifiersSha256: source.identifiersSha256,
    destinationIdentifiersSha256: destination.identifiersSha256,
    matched: true,
  };
}

function safeDatabaseError(error: unknown): CoreRecordRehearsalError {
  if (error instanceof CoreRecordRehearsalError) return error;
  let suffix = "";
  if (isPlainObject(error)) {
    const code = typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
    const constraint =
      typeof error.constraint === "string" && POSTGRES_IDENTIFIER_PATTERN.test(error.constraint)
        ? error.constraint
        : null;
    if (code) suffix += ` (SQLSTATE ${code}`;
    if (constraint) suffix += `${code ? ", " : " ("}constraint ${constraint}`;
    if (code || constraint) suffix += ")";
  }
  return new CoreRecordRehearsalError(
    "database_operation_failed",
    `Core rehearsal database operation failed${suffix}`,
  );
}

export async function runCoreRecordRehearsal(
  pool: CoreRehearsalPool,
  snapshot: unknown,
  options: CoreRecordRehearsalOptions,
): Promise<CoreRecordRehearsalReport> {
  const guard = rehearsalGuard(options);
  const plan = createCoreRecordRehearsalPlan(snapshot, options);
  const client = await pool.connect().catch((error) => {
    throw safeDatabaseError(error);
  });
  let transactionStarted = false;
  let transactionStateUnknown = false;
  let discardError: Error | undefined;

  try {
    transactionStateUnknown = true;
    await client.query("BEGIN");
    transactionStateUnknown = false;
    transactionStarted = true;
    await client.query(`SET LOCAL ROLE ${CORE_REHEARSAL_IMPORTER_ROLE}`);
    const roleResult = await client.query<{ currentUser: unknown }>(
      `SELECT current_user AS "currentUser"`,
    );
    const roleRow = queryRow(roleResult, "Core rehearsal role check");
    if (roleRow.currentUser !== CORE_REHEARSAL_IMPORTER_ROLE) {
      fail("incorrect_database_role", "Core rehearsal did not assume the restricted importer role");
    }
    await client.query(`SET LOCAL lock_timeout = '${guard.lockTimeoutMs}ms'`);
    await client.query(`SET LOCAL statement_timeout = '${guard.statementTimeoutMs}ms'`);
    await client.query("SELECT pg_catalog.set_config('search_path', $1, true)", [
      `${guard.targetSchema}, pg_catalog, pg_temp`,
    ]);
    const schemaResult = await client.query<{ currentSchema: unknown }>(
      `SELECT pg_catalog.current_schema() AS "currentSchema"`,
    );
    const schemaRow = queryRow(schemaResult, "Core rehearsal schema check");
    if (schemaRow.currentSchema !== guard.targetSchema) {
      fail("unavailable_target_schema", "Core rehearsal target schema is unavailable to the importer role");
    }
    const lockResult = await client.query<{ acquired: unknown }>(
      "SELECT pg_catalog.pg_try_advisory_xact_lock($1::bigint) AS acquired",
      [CORE_REHEARSAL_ADVISORY_LOCK_ID],
    );
    const lockRow = queryRow(lockResult, "Core rehearsal lock check");
    if (lockRow.acquired !== true) {
      fail("rehearsal_already_running", "Another core rehearsal holds the database lock");
    }

    await assertExactTargetMigrationHistory(client);
    await assertEmptyTarget(client);
    await insertPreparedRows(client, plan.rows);
    const destinationRows = await readDestinationRows(client);
    const destinationEvidence = createEvidence(destinationRows);
    await assertDeliveryControlsStayedEmpty(client);
    const tables = {
      clients: reconciledTable("clients", plan.sourceEvidence.clients, destinationEvidence.clients),
      contacts: reconciledTable("contacts", plan.sourceEvidence.contacts, destinationEvidence.contacts),
      projects: reconciledTable("projects", plan.sourceEvidence.projects, destinationEvidence.projects),
      activityEvents: reconciledTable(
        "activity events",
        plan.sourceEvidence.activityEvents,
        destinationEvidence.activityEvents,
      ),
    };

    transactionStateUnknown = true;
    await client.query("COMMIT");
    transactionStateUnknown = false;
    transactionStarted = false;

    return {
      formatVersion: 1,
      dataClassification: "test",
      scope: "bounded-core-only",
      targetEnvironment: plan.targetEnvironment,
      targetSchema: plan.targetSchema,
      status: "reconciled",
      tables,
      sideEffects: {
        idempotencyRequestsInserted: 0,
        outboxEventsInserted: 0,
        providerCalls: 0,
      },
      deferredSourceCounts: plan.deferredSourceCounts,
      cutoverReady: false,
    };
  } catch (error) {
    const mustDiscard = transactionStateUnknown;
    if (transactionStarted || transactionStateUnknown) {
      try {
        await client.query("ROLLBACK");
        transactionStarted = false;
      } catch {
        discardError = new Error("Core rehearsal rollback failed");
      }
    }
    if (mustDiscard) discardError ??= new Error("Core rehearsal transaction state is unknown");
    throw safeDatabaseError(error);
  } finally {
    client.release(discardError);
  }
}
