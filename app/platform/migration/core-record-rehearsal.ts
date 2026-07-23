import { createHash } from "node:crypto";

import { normalizeClientNameKey } from "../../domain/client-name-key.ts";
import {
  EXPECTED_PRODUCTION_SCHEMA_HISTORY,
  productionSchemaHistoryMatches,
  type ProductionMigrationHistoryRow,
} from "../google-cloud/database-readiness.ts";
import { CORE_REHEARSAL_ADVISORY_LOCK_ID } from "../postgres/advisory-locks.ts";

export const CORE_REHEARSAL_ACKNOWLEDGMENT =
  "FCI TEST — DO NOT USE — I ACKNOWLEDGE THIS NON-PRODUCTION CORE REHEARSAL";
export const CORE_REHEARSAL_SCHEMA_PREFIX = "fci_rehearsal_";
export const CORE_REHEARSAL_SCHEMA_PATTERN = /^fci_rehearsal_[a-z0-9_]{1,49}$/;
export const CORE_REHEARSAL_IMPORTER_ROLE = "fci_rehearsal_importer";
export const CORE_REHEARSAL_TEST_MARKER = "FCI TEST — DO NOT USE";
export const CORE_REHEARSAL_SOURCE_SYSTEM = "d1-development-test-export";
export const CORE_REHEARSAL_MAX_ROWS = 5_000;

export const CORE_REHEARSAL_SOURCE_INVENTORY = [
  {
    sourceCategory: "records",
    disposition: "excluded",
    reason: "Legacy generic records were retired by BE-03 and have no production migration.",
  },
  {
    sourceCategory: "activity_events",
    disposition: "transformed",
    reason: "Classified activity is transformed to explicit client, project, or lead relationships.",
  },
  {
    sourceCategory: "webhook_receipts",
    disposition: "excluded",
    reason: "Development webhook delivery receipts are transient replay-control data.",
  },
  {
    sourceCategory: "clients",
    disposition: "transformed",
    reason: "Test clients are normalized to the production client schema without legacy Drive fields.",
  },
  {
    sourceCategory: "contacts",
    disposition: "transformed",
    reason: "Test contacts are normalized to the production contact schema.",
  },
  {
    sourceCategory: "leads",
    disposition: "migrated",
    reason: "Marked test leads map to the immutable PostgreSQL v6 leads table.",
  },
  {
    sourceCategory: "projects",
    disposition: "transformed",
    reason: "Test projects are normalized to the production project schema without legacy Drive fields.",
  },
  {
    sourceCategory: "project_meetings",
    disposition: "migrated",
    reason: "Marked test project meetings map to the immutable PostgreSQL v6 project_meetings table.",
  },
  {
    sourceCategory: "tasks",
    disposition: "blocking",
    reason: "Task rows require a reviewed rehearsal-format expansion before production migration.",
  },
  {
    sourceCategory: "filing_rules",
    disposition: "blocking",
    reason: "Production filing-rule ownership and migration semantics are not implemented.",
  },
  {
    sourceCategory: "workspace_settings",
    disposition: "blocking",
    reason: "Development Workspace settings cannot be admitted to production automatically.",
  },
  {
    sourceCategory: "user_preferences",
    disposition: "blocking",
    reason: "Production user mapping and preference migration are not implemented.",
  },
  {
    sourceCategory: "mail_items",
    disposition: "blocking",
    reason: "Production mail-item migration and authorization semantics are not implemented.",
  },
  {
    sourceCategory: "gmail_file_archives",
    disposition: "blocking",
    reason: "Gmail archive metadata requires a separately reviewed production mapping.",
  },
  {
    sourceCategory: "gmail_file_archive_artifacts",
    disposition: "blocking",
    reason: "Gmail archive artifacts require a separately reviewed storage migration.",
  },
  {
    sourceCategory: "google_oauth_attempts",
    disposition: "excluded",
    reason: "OAuth attempts are transient and must never be migrated.",
  },
  {
    sourceCategory: "google_connections",
    disposition: "transformed",
    reason: "Production connections require separately approved reauthorization; no credential ciphertext is carried.",
  },
  {
    sourceCategory: "workspace_resources",
    disposition: "transformed",
    reason: "App-managed resource IDs require approved production reauthorization and reconciliation into integration_resources; no raw development rows are carried.",
  },
  {
    sourceCategory: "workspace_blueprints",
    disposition: "transformed",
    reason: "Development setup definitions require separately approved production authorization and configuration reconciliation; no raw blueprint rows are carried.",
  },
  {
    sourceCategory: "drive_folder_mappings",
    disposition: "blocking",
    reason: "Drive mappings require production connector identity and ownership reconciliation.",
  },
  {
    sourceCategory: "google_drive_operations",
    disposition: "excluded",
    reason: "Development provider-operation history is not production source data.",
  },
  {
    sourceCategory: "google_sheet_sync_state",
    disposition: "excluded",
    reason: "Development sync cursors and leases must be recreated in production.",
  },
  {
    sourceCategory: "google_integration_events",
    disposition: "blocking",
    reason: "Integration-event migration and production audit meaning are not implemented.",
  },
  {
    sourceCategory: "workspace_simulation_state",
    disposition: "excluded",
    reason: "Workspace simulation state is development-only test infrastructure.",
  },
  {
    sourceCategory: "r2_objects",
    disposition: "blocking",
    reason: "R2 objects require an approved, hash-verified object-storage migration.",
  },
] as const;

export const DEFERRED_SOURCE_CATEGORIES = [
  "records",
  "webhook_receipts",
  "tasks",
  "filing_rules",
  "workspace_settings",
  "user_preferences",
  "mail_items",
  "gmail_file_archives",
  "gmail_file_archive_artifacts",
  "google_oauth_attempts",
  "google_connections",
  "workspace_resources",
  "workspace_blueprints",
  "drive_folder_mappings",
  "google_drive_operations",
  "google_sheet_sync_state",
  "google_integration_events",
  "workspace_simulation_state",
  "unclassified_activity_events",
  "r2_objects",
] as const;

type DeferredSourceCategory = (typeof DEFERRED_SOURCE_CATEGORIES)[number];
type SourceInventoryDefinition = (typeof CORE_REHEARSAL_SOURCE_INVENTORY)[number];
type SourceCategory = SourceInventoryDefinition["sourceCategory"];
type SourceDisposition = SourceInventoryDefinition["disposition"];
type RehearsalEnvironment = "development" | "staging";
type ActivityResult = "succeeded" | "failed" | "denied";
type ActivityRecordType = "client" | "project" | "lead";

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
  flooringCategory: null;
  squareFeet: null;
  contractValue: null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: "1";
};

type PreparedLead = {
  id: string;
  leadNumber: string;
  company: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  projectName: string;
  source: string;
  stage: string;
  site: string;
  estimatedValue: number;
  nextAction: string;
  nextActionAt: string | null;
  ownerEmail: string;
  status: "active" | "converted" | "lost" | "archived";
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: "1";
};

type PreparedProjectMeeting = {
  id: string;
  projectId: string;
  title: string;
  meetingAt: string;
  meetingType:
    | "client"
    | "site-walk"
    | "internal"
    | "pre-install"
    | "closeout"
    | "other";
  sourceProvider: "manual" | "otter" | "link";
  sourceUrl: string | null;
  attendees: string[];
  notes: string | null;
  transcript: string | null;
  summary: string | null;
  decisions: string | null;
  actionItems: string[];
  createdBy: string;
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
  leads: PreparedLead[];
  projects: PreparedProject[];
  projectMeetings: PreparedProjectMeeting[];
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
  leads: CoreRecordTableEvidence;
  projects: CoreRecordTableEvidence;
  projectMeetings: CoreRecordTableEvidence;
  activityEvents: CoreRecordTableEvidence;
};

export type CoreRecordSourceInventoryEntry = {
  sourceCategory: SourceCategory;
  disposition: SourceDisposition;
  reason: string;
  sourceCount: number;
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
  sourceInventory: CoreRecordSourceInventoryEntry[];
};

export type CoreRecordRehearsalReport = {
  formatVersion: 2;
  dataClassification: "test";
  scope: "bounded-core-only";
  targetEnvironment: RehearsalEnvironment;
  targetSchema: string;
  status: "reconciled";
  tables: {
    clients: ReconciledTableEvidence;
    contacts: ReconciledTableEvidence;
    leads: ReconciledTableEvidence;
    projects: ReconciledTableEvidence;
    projectMeetings: ReconciledTableEvidence;
    activityEvents: ReconciledTableEvidence;
  };
  sideEffects: {
    idempotencyRequestsInserted: 0;
    outboxEventsInserted: 0;
    providerCalls: 0;
  };
  deferredSourceCounts: Record<DeferredSourceCategory, 0>;
  sourceInventory: CoreRecordSourceInventoryEntry[];
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
const LEAD_STATUSES = new Set(["active", "converted", "lost", "archived"]);
// This PostgreSQL-facing rehearsal set matches the registered v8 constraint.
const PROJECT_MEETING_TYPES = new Set([
  "client",
  "site-walk",
  "internal",
  "pre-install",
  "closeout",
  "phone-call",
  "other",
]);
const PROJECT_MEETING_SOURCE_PROVIDERS = new Set(["manual", "otter", "link"]);
const ACTIVITY_RESULTS = new Set(["succeeded", "failed", "denied"]);
const POSTGRES_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_CODE_PATTERN = /^CL-[A-Z0-9]{8}$/;
const PROJECT_NUMBER_PATTERN = /^CF-[0-9]{4}-[A-Z0-9]{8}$/;
const LEAD_NUMBER_PATTERN = /^L-[0-9]{4}-[A-Z0-9]{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  "leads",
  "projects",
  "projectMeetings",
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
  "flooringCategory",
  "squareFeet",
  "contractValue",
  "driveFolderId",
  "driveUrl",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "version",
] as const;
const LEAD_KEYS = [
  "id",
  "leadNumber",
  "company",
  "contactName",
  "contactEmail",
  "contactPhone",
  "projectName",
  "source",
  "stage",
  "site",
  "estimatedValue",
  "nextAction",
  "nextActionAt",
  "ownerEmail",
  "status",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "version",
] as const;
const PROJECT_MEETING_KEYS = [
  "id",
  "projectId",
  "title",
  "meetingAt",
  "meetingType",
  "sourceProvider",
  "sourceUrl",
  "attendees",
  "notes",
  "transcript",
  "summary",
  "decisions",
  "actionItems",
  "createdBy",
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

function productionText(value: unknown, label: string, maxLength: number): string {
  const text = requiredText(value, label, maxLength);
  if (/\p{Cc}/u.test(text)) {
    fail("invalid_snapshot_value", `${label} contains a control character`);
  }
  return text;
}

function nullableProductionText(
  value: unknown,
  label: string,
  maxLength: number,
  allowLineBreaks = false,
): string | null {
  if (value === null) return null;
  const text = requiredText(value, label, maxLength);
  const checked = allowLineBreaks ? text.replace(/[\t\n\r]/g, "") : text;
  if (/\p{Cc}/u.test(checked)) {
    fail("invalid_snapshot_value", `${label} contains an unsupported control character`);
  }
  return text;
}

function normalizedEmail(value: unknown, label: string, required: true): string;
function normalizedEmail(value: unknown, label: string, required?: false): string | null;
function normalizedEmail(value: unknown, label: string, required = false): string | null {
  if (value === null && !required) return null;
  const email = productionText(value, label, 254);
  if (email !== email.toLowerCase() || !EMAIL_PATTERN.test(email)) {
    fail("invalid_snapshot_value", `${label} must be a normalized email address`);
  }
  return email;
}

function nullableCanonicalTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  return canonicalTimestamp(value, label);
}

function postgresInteger(value: unknown, label: string): number {
  const integer = nonnegativeSafeInteger(value, label);
  if (integer > 2_147_483_647) {
    fail("invalid_snapshot_value", `${label} must fit a PostgreSQL integer`);
  }
  return integer;
}

function boundedStringList(
  value: unknown,
  label: string,
  maximumItems: number,
): string[] {
  const entries = arrayValue(value, label);
  if (entries.length > maximumItems) {
    fail("invalid_snapshot_value", `${label} exceeds the item limit`);
  }
  const result = entries.map((entry, index) =>
    nullableProductionText(entry, `${label}[${index}]`, 160, true),
  );
  if (result.some((entry) => entry === null) || new Set(result).size !== result.length) {
    fail("invalid_snapshot_value", `${label} must contain unique nonempty strings`);
  }
  return result as string[];
}

function projectMeetingSourceUrl(
  value: unknown,
  provider: PreparedProjectMeeting["sourceProvider"],
  label: string,
): string | null {
  if (provider === "manual") {
    if (value !== null) fail("invalid_snapshot_value", `${label} must be null for a manual meeting`);
    return null;
  }
  const sourceUrl = productionText(value, label, 900);
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    fail("invalid_snapshot_value", `${label} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    fail("invalid_snapshot_value", `${label} must be a credential-free HTTPS URL`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const isOtter = hostname === "otter.ai" || hostname.endsWith(".otter.ai");
  if ((provider === "otter") !== isOtter) {
    fail("invalid_snapshot_value", `${label} does not match the declared source provider`);
  }
  return sourceUrl;
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
    contentSha256: sha256Evidence(`${table}:content:v2`, ordered),
    identifiersSha256: sha256Evidence(
      `${table}:identifiers:v2`,
      ordered.map((row) => row.id),
    ),
  };
}

function createEvidence(rows: PreparedCoreRecordSnapshot): CoreRecordEvidence {
  return {
    clients: tableEvidence("clients", rows.clients),
    contacts: tableEvidence("contacts", rows.contacts),
    leads: tableEvidence("leads", rows.leads),
    projects: tableEvidence("projects", rows.projects),
    projectMeetings: tableEvidence("project_meetings", rows.projectMeetings),
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
        `The bounded core rehearsal refuses inventory-only source category ${category}`,
      );
    }
    result[category] = 0;
  }
  return result;
}

function sourceInventory(
  rows: PreparedCoreRecordSnapshot,
  deferredSourceCounts: Record<DeferredSourceCategory, 0>,
): CoreRecordSourceInventoryEntry[] {
  const payloadCounts: Partial<Record<SourceCategory, number>> = {
    activity_events: rows.activityEvents.length,
    clients: rows.clients.length,
    contacts: rows.contacts.length,
    leads: rows.leads.length,
    projects: rows.projects.length,
    project_meetings: rows.projectMeetings.length,
  };
  return CORE_REHEARSAL_SOURCE_INVENTORY.map((entry) => {
    const sourceCount =
      payloadCounts[entry.sourceCategory] ??
      deferredSourceCounts[entry.sourceCategory as DeferredSourceCategory];
    if (sourceCount === undefined) {
      fail(
        "unclassified_source_category",
        `Source category ${entry.sourceCategory} has no bounded inventory count`,
      );
    }
    return { ...entry, sourceCount };
  });
}

function prepareSnapshot(value: unknown): {
  rows: PreparedCoreRecordSnapshot;
  deferredSourceCounts: Record<DeferredSourceCategory, 0>;
} {
  const source = exactObject(value, TOP_LEVEL_KEYS, "snapshot");
  if (source.formatVersion !== 2) fail("unsupported_snapshot_version", "snapshot.formatVersion must be 2");
  if (source.dataClassification !== "test") {
    fail("unsafe_data_classification", "snapshot.dataClassification must be test");
  }
  if (source.sourceSystem !== CORE_REHEARSAL_SOURCE_SYSTEM) {
    fail("unsupported_source", `snapshot.sourceSystem must be ${CORE_REHEARSAL_SOURCE_SYSTEM}`);
  }
  const deferredSourceCounts = deferredCounts(source.deferredSourceCounts);
  const clientEntries = arrayValue(source.clients, "snapshot.clients");
  const contactEntries = arrayValue(source.contacts, "snapshot.contacts");
  const leadEntries = arrayValue(source.leads, "snapshot.leads");
  const projectEntries = arrayValue(source.projects, "snapshot.projects");
  const projectMeetingEntries = arrayValue(source.projectMeetings, "snapshot.projectMeetings");
  const activityEntries = arrayValue(source.activityEvents, "snapshot.activityEvents");
  const totalRows =
    clientEntries.length +
    contactEntries.length +
    leadEntries.length +
    projectEntries.length +
    projectMeetingEntries.length +
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

  const leads = leadEntries.map((entry, index) => {
    const row = exactObject(entry, LEAD_KEYS, `leads[${index}]`);
    const id = canonicalUuid(row.id, `leads[${index}].id`);
    const leadNumber = productionText(row.leadNumber, `leads[${index}].leadNumber`, 15);
    if (!LEAD_NUMBER_PATTERN.test(leadNumber)) {
      fail("invalid_identifier", `leads[${index}].leadNumber is not production-compatible`);
    }
    const company = productionText(row.company, `leads[${index}].company`, 180);
    const contactName = productionText(row.contactName, `leads[${index}].contactName`, 160);
    const projectName = productionText(row.projectName, `leads[${index}].projectName`, 180);
    const site = productionText(row.site, `leads[${index}].site`, 300);
    if (
      !markedTestRecordName(company) ||
      !markedTestRecordName(contactName) ||
      !markedTestRecordName(projectName) ||
      !markedTestRecordName(site)
    ) {
      fail(
        "unsafe_test_record",
        `leads[${index}] company, contact, project, and site must include the test-data marker`,
      );
    }
    const status = productionText(row.status, `leads[${index}].status`, 20) as PreparedLead["status"];
    if (!LEAD_STATUSES.has(status)) fail("invalid_status", `leads[${index}].status is unsupported`);
    const nextActionAt = nullableCanonicalTimestamp(
      row.nextActionAt,
      `leads[${index}].nextActionAt`,
    );
    if (nextActionAt !== null && new Date(nextActionAt).getTime() < 0) {
      fail("invalid_timestamp", `leads[${index}].nextActionAt must be at or after the Unix epoch`);
    }
    const createdAt = canonicalTimestamp(row.createdAt, `leads[${index}].createdAt`);
    const updatedAt = canonicalTimestamp(row.updatedAt, `leads[${index}].updatedAt`);
    if (updatedAt < createdAt) fail("invalid_timestamp_order", `leads[${index}] timestamps are out of order`);
    return {
      id,
      leadNumber,
      company,
      contactName,
      contactEmail: normalizedEmail(row.contactEmail, `leads[${index}].contactEmail`),
      contactPhone: nullableProductionText(row.contactPhone, `leads[${index}].contactPhone`, 40),
      projectName,
      source: productionText(row.source, `leads[${index}].source`, 80),
      stage: productionText(row.stage, `leads[${index}].stage`, 80),
      site,
      estimatedValue: postgresInteger(row.estimatedValue, `leads[${index}].estimatedValue`),
      nextAction: productionText(row.nextAction, `leads[${index}].nextAction`, 500),
      nextActionAt,
      ownerEmail: normalizedEmail(row.ownerEmail, `leads[${index}].ownerEmail`, true),
      status,
      createdBy: requiredText(row.createdBy, `leads[${index}].createdBy`),
      updatedBy: requiredText(row.updatedBy, `leads[${index}].updatedBy`),
      createdAt,
      updatedAt,
      version: versionOne(row.version, `leads[${index}].version`),
    } satisfies PreparedLead;
  });

  assertUnique(leads.map((row) => row.id), "Lead IDs");
  assertUnique(leads.map((row) => row.leadNumber), "Lead numbers");
  const leadIds = new Set(leads.map((row) => row.id));

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
    if (
      row.flooringCategory !== null ||
      row.squareFeet !== null ||
      row.contractValue !== null
    ) {
      fail(
        "kpi04_fields_deferred",
        `projects[${index}] flooringCategory, squareFeet, and contractValue are deferred to KPI-04 and must be null in snapshot format 2`,
      );
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
      flooringCategory: null,
      squareFeet: null,
      contractValue: null,
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

  const projectMeetings = projectMeetingEntries.map((entry, index) => {
    const row = exactObject(entry, PROJECT_MEETING_KEYS, `projectMeetings[${index}]`);
    const id = canonicalUuid(row.id, `projectMeetings[${index}].id`);
    const projectId = canonicalUuid(row.projectId, `projectMeetings[${index}].projectId`);
    if (!projectIds.has(projectId)) {
      fail("orphan_source_record", `projectMeetings[${index}] has no source project`);
    }
    const title = nullableProductionText(row.title, `projectMeetings[${index}].title`, 160, true);
    if (title === null || !markedTestRecordName(title)) {
      fail("unsafe_test_record", `projectMeetings[${index}].title must include the test-data marker`);
    }
    const meetingType = requiredText(
      row.meetingType,
      `projectMeetings[${index}].meetingType`,
      20,
    ) as PreparedProjectMeeting["meetingType"];
    if (!PROJECT_MEETING_TYPES.has(meetingType)) {
      fail("invalid_snapshot_value", `projectMeetings[${index}].meetingType is unsupported`);
    }
    const sourceProvider = requiredText(
      row.sourceProvider,
      `projectMeetings[${index}].sourceProvider`,
      10,
    ) as PreparedProjectMeeting["sourceProvider"];
    if (!PROJECT_MEETING_SOURCE_PROVIDERS.has(sourceProvider)) {
      fail("invalid_snapshot_value", `projectMeetings[${index}].sourceProvider is unsupported`);
    }
    const sourceUrl = projectMeetingSourceUrl(
      row.sourceUrl,
      sourceProvider,
      `projectMeetings[${index}].sourceUrl`,
    );
    const attendees = boundedStringList(
      row.attendees,
      `projectMeetings[${index}].attendees`,
      40,
    );
    const actionItems = boundedStringList(
      row.actionItems,
      `projectMeetings[${index}].actionItems`,
      50,
    );
    const notes = nullableProductionText(row.notes, `projectMeetings[${index}].notes`, 25_000, true);
    const transcript = nullableProductionText(
      row.transcript,
      `projectMeetings[${index}].transcript`,
      100_000,
      true,
    );
    const summary = nullableProductionText(
      row.summary,
      `projectMeetings[${index}].summary`,
      12_000,
      true,
    );
    const decisions = nullableProductionText(
      row.decisions,
      `projectMeetings[${index}].decisions`,
      12_000,
      true,
    );
    if (
      sourceUrl === null &&
      notes === null &&
      transcript === null &&
      summary === null &&
      decisions === null &&
      actionItems.length === 0
    ) {
      fail("invalid_snapshot_value", `projectMeetings[${index}] has no meeting evidence`);
    }
    const createdAt = canonicalTimestamp(row.createdAt, `projectMeetings[${index}].createdAt`);
    const updatedAt = canonicalTimestamp(row.updatedAt, `projectMeetings[${index}].updatedAt`);
    if (updatedAt < createdAt) {
      fail("invalid_timestamp_order", `projectMeetings[${index}] timestamps are out of order`);
    }
    return {
      id,
      projectId,
      title,
      meetingAt: canonicalTimestamp(row.meetingAt, `projectMeetings[${index}].meetingAt`),
      meetingType,
      sourceProvider,
      sourceUrl,
      attendees,
      notes,
      transcript,
      summary,
      decisions,
      actionItems,
      createdBy: requiredText(row.createdBy, `projectMeetings[${index}].createdBy`),
      createdAt,
      updatedAt,
      version: versionOne(row.version, `projectMeetings[${index}].version`),
    } satisfies PreparedProjectMeeting;
  });

  assertUnique(projectMeetings.map((row) => row.id), "Project-meeting IDs");

  const activityEvents = activityEntries.map(
    (entry, index) => {
      const row = exactObject(entry, ACTIVITY_KEYS, `activityEvents[${index}]`);
      const id = canonicalUuid(row.id, `activityEvents[${index}].id`);
      if (row.recordType !== "client" && row.recordType !== "project" && row.recordType !== "lead") {
        fail("unclassified_activity", `activityEvents[${index}].recordType must be explicit`);
      }
      const recordType = row.recordType;
      const recordId = canonicalUuid(row.recordId, `activityEvents[${index}].recordId`);
      const knownRecord =
        recordType === "client"
          ? clientIds.has(recordId)
          : recordType === "project"
            ? projectIds.has(recordId)
            : leadIds.has(recordId);
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

  return {
    rows: { clients, contacts, leads, projects, projectMeetings, activityEvents },
    deferredSourceCounts,
  };
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
    sourceInventory: sourceInventory(prepared.rows, prepared.deferredSourceCounts),
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
    "leads",
    [
      "id",
      "lead_number",
      "company",
      "contact_name",
      "contact_email",
      "contact_phone",
      "project_name",
      "source",
      "stage",
      "site",
      "estimated_value",
      "next_action",
      "next_action_at",
      "owner_email",
      "status",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
      "version",
    ],
    insertValues(rows.leads, (row) => [
      row.id,
      row.leadNumber,
      row.company,
      row.contactName,
      row.contactEmail,
      row.contactPhone,
      row.projectName,
      row.source,
      row.stage,
      row.site,
      row.estimatedValue,
      row.nextAction,
      row.nextActionAt,
      row.ownerEmail,
      row.status,
      row.createdBy,
      row.updatedBy,
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
    "project_meetings",
    [
      "id",
      "project_id",
      "title",
      "meeting_at",
      "meeting_type",
      "source_provider",
      "source_url",
      "attendees",
      "notes",
      "transcript",
      "summary",
      "decisions",
      "action_items",
      "created_by",
      "created_at",
      "updated_at",
      "version",
    ],
    insertValues(rows.projectMeetings, (row) => [
      row.id,
      row.projectId,
      row.title,
      row.meetingAt,
      row.meetingType,
      row.sourceProvider,
      row.sourceUrl,
      JSON.stringify(row.attendees),
      row.notes,
      row.transcript,
      row.summary,
      row.decisions,
      JSON.stringify(row.actionItems),
      row.createdBy,
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
      "lead_id",
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
      row.recordType === "lead" ? row.recordId : null,
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
       (SELECT count(*)::text FROM leads) AS "leads",
       (SELECT count(*)::text FROM projects) AS "projects",
       (SELECT count(*)::text FROM project_meetings) AS "projectMeetings",
       (SELECT count(*)::text FROM activity_events) AS "activityEvents",
       (SELECT count(*)::text FROM idempotency_requests) AS "idempotencyRequests",
       (SELECT count(*)::text FROM outbox_events) AS "outboxEvents"`,
  );
  const row = queryRow(result, "Core rehearsal target preflight");
  const total =
    databaseCount(row.clients, "clients count") +
    databaseCount(row.contacts, "contacts count") +
    databaseCount(row.leads, "leads count") +
    databaseCount(row.projects, "projects count") +
    databaseCount(row.projectMeetings, "project meetings count") +
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
  const leads = await client.query(
    `SELECT id::text AS "id", lead_number AS "leadNumber", company,
            contact_name AS "contactName", contact_email AS "contactEmail",
            contact_phone AS "contactPhone", project_name AS "projectName", source, stage,
            site, estimated_value AS "estimatedValue", next_action AS "nextAction",
            next_action_at AS "nextActionAt", owner_email AS "ownerEmail", status,
            created_by AS "createdBy", updated_by AS "updatedBy", created_at AS "createdAt",
            updated_at AS "updatedAt", version::text AS "version"
     FROM leads ORDER BY id`,
  );
  const projects = await client.query(
    `SELECT id::text AS "id", project_number AS "projectNumber", client_id::text AS "clientId",
            name, status, site, project_manager AS "projectManager",
            estimated_value::text AS "estimatedValue", created_by AS "createdBy",
            updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt",
            version::text AS "version"
     FROM projects ORDER BY id`,
  );
  const projectMeetings = await client.query(
    `SELECT id::text AS "id", project_id::text AS "projectId", title,
            meeting_at AS "meetingAt", meeting_type AS "meetingType",
            source_provider AS "sourceProvider", source_url AS "sourceUrl", attendees,
            notes, transcript, summary, decisions, action_items AS "actionItems",
            created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt",
            version::text AS "version"
     FROM project_meetings ORDER BY id`,
  );
  const activityEvents = await client.query(
    `SELECT id::text AS "id",
            CASE WHEN client_id IS NOT NULL THEN 'client'
                 WHEN project_id IS NOT NULL THEN 'project'
                 ELSE 'lead' END AS "recordType",
            COALESCE(client_id, project_id, lead_id)::text AS "recordId", action, actor_id AS "actorId",
            correlation_id AS "correlationId", result, reason, detail,
            occurred_at AS "occurredAt"
     FROM activity_events ORDER BY id`,
  );

  const targetLikeSnapshot = {
    formatVersion: 2,
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
    leads: leads.rows.map((row) => ({
      ...row,
      nextActionAt:
        row.nextActionAt === null
          ? null
          : databaseTimestamp(row.nextActionAt, "destination lead nextActionAt"),
      estimatedValue: databaseEstimatedValue(
        row.estimatedValue,
        "destination lead estimatedValue",
      ),
      createdAt: databaseTimestamp(row.createdAt, "destination lead createdAt"),
      updatedAt: databaseTimestamp(row.updatedAt, "destination lead updatedAt"),
    })),
    projects: projects.rows.map((row) => ({
      ...row,
      driveFolderId: null,
      driveUrl: null,
      estimatedValue: databaseEstimatedValue(row.estimatedValue, "destination project estimatedValue"),
      flooringCategory: null,
      squareFeet: null,
      contractValue: null,
      createdAt: databaseTimestamp(row.createdAt, "destination project createdAt"),
      updatedAt: databaseTimestamp(row.updatedAt, "destination project updatedAt"),
    })),
    projectMeetings: projectMeetings.rows.map((row) => ({
      ...row,
      meetingAt: databaseTimestamp(row.meetingAt, "destination project meeting meetingAt"),
      createdAt: databaseTimestamp(row.createdAt, "destination project meeting createdAt"),
      updatedAt: databaseTimestamp(row.updatedAt, "destination project meeting updatedAt"),
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
      leads: reconciledTable("leads", plan.sourceEvidence.leads, destinationEvidence.leads),
      projects: reconciledTable("projects", plan.sourceEvidence.projects, destinationEvidence.projects),
      projectMeetings: reconciledTable(
        "project meetings",
        plan.sourceEvidence.projectMeetings,
        destinationEvidence.projectMeetings,
      ),
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
      formatVersion: 2,
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
      sourceInventory: plan.sourceInventory,
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
