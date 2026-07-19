import { LEAD_STATUSES, type LeadRow, validateLeadValues } from "../../domain/lead";
import type {
  AcceptedLeadCreation,
  LeadCreationIntent,
  LeadRepository,
  LeadUpdateIntent,
} from "../../ports/lead-repository";
import {
  bindPostgresCreationRequest,
  calculatePostgresRequestFingerprint,
  claimPostgresCreation,
  completePostgresCreation,
  POSTGRES_CREATION_OPERATIONS,
  type PostgresCreationRequestMetadata,
} from "./creation-idempotency";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  isPostgresUuid,
  parsePostgresJsonObject,
  parsePostgresNumericSafeInteger,
  parsePostgresPositiveBigint,
  parsePostgresTimestamp,
} from "./postgres-values";

type PostgresLeadRepositoryOptions = {
  schema?: string;
  request?: PostgresCreationRequestMetadata;
};

type LeadDatabaseRow = Record<string, unknown> & {
  id: unknown;
  lead_number: unknown;
  company: unknown;
  contact_name: unknown;
  contact_email: unknown;
  contact_phone: unknown;
  project_name: unknown;
  source: unknown;
  stage: unknown;
  site: unknown;
  estimated_value: unknown;
  next_action: unknown;
  next_action_at: unknown;
  owner_email: unknown;
  status: unknown;
  created_by: unknown;
  created_at: unknown;
  updated_at: unknown;
  version?: unknown;
};

const LEAD_SELECT = `SELECT id::text AS id, lead_number, company, contact_name,
       contact_email, contact_phone, project_name, source, stage, site,
       estimated_value::text AS estimated_value, next_action, next_action_at,
       owner_email, status, created_by, created_at, updated_at,
       version::text AS version
FROM leads`;

const LEAD_IDENTIFIER_CONSTRAINTS = [
  "leads_pkey",
  "leads_lead_number_key",
  "activity_events_pkey",
  "outbox_events_pkey",
  "outbox_events_event_key_key",
  "idempotency_requests_pkey",
] as const;

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function nullableText(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function nullableTimestamp(value: unknown, label: string) {
  return value === null ? null : parsePostgresTimestamp(value, label);
}

function leadRowFromPostgres(row: LeadDatabaseRow): LeadRow {
  if (!isPostgresUuid(row.id)) throw new Error("PostgreSQL lead ID is invalid");
  const status = requiredText(row.status, "PostgreSQL lead status");
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    throw new Error("PostgreSQL lead status is unsupported");
  }
  return {
    id: row.id,
    lead_number: requiredText(row.lead_number, "PostgreSQL lead number"),
    company: requiredText(row.company, "PostgreSQL lead company"),
    contact_name: requiredText(row.contact_name, "PostgreSQL lead contact name"),
    contact_email: nullableText(row.contact_email, "PostgreSQL lead contact email"),
    contact_phone: nullableText(row.contact_phone, "PostgreSQL lead contact phone"),
    project_name: requiredText(row.project_name, "PostgreSQL lead project name"),
    source: requiredText(row.source, "PostgreSQL lead source"),
    stage: requiredText(row.stage, "PostgreSQL lead stage"),
    site: requiredText(row.site, "PostgreSQL lead site"),
    estimated_value: parsePostgresNumericSafeInteger(
      row.estimated_value,
      "PostgreSQL lead estimated value",
    ),
    next_action: requiredText(row.next_action, "PostgreSQL lead next action"),
    next_action_at: nullableTimestamp(row.next_action_at, "PostgreSQL lead next action time"),
    owner_email: requiredText(row.owner_email, "PostgreSQL lead owner email"),
    status,
    created_by: requiredText(row.created_by, "PostgreSQL lead creator"),
    created_at: parsePostgresTimestamp(row.created_at, "PostgreSQL lead created_at"),
    updated_at: parsePostgresTimestamp(row.updated_at, "PostgreSQL lead updated_at"),
  };
}

function acceptedLead(value: unknown): AcceptedLeadCreation {
  const record = parsePostgresJsonObject(value, "PostgreSQL stored lead response");
  const row = parsePostgresJsonObject(record.row, "PostgreSQL stored lead row") as LeadDatabaseRow;
  return {
    row: leadRowFromPostgres({
      ...row,
      created_at: new Date(requiredEpoch(row.created_at, "PostgreSQL stored lead created_at")),
      updated_at: new Date(requiredEpoch(row.updated_at, "PostgreSQL stored lead updated_at")),
      next_action_at: row.next_action_at === null
        ? null
        : new Date(requiredEpoch(row.next_action_at, "PostgreSQL stored lead next action time")),
    }),
    version: parsePostgresPositiveBigint(record.version, "PostgreSQL stored lead version"),
  };
}

function requiredEpoch(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} is invalid`);
  return value;
}

function acceptedLeadFromRow(row: LeadDatabaseRow): AcceptedLeadCreation {
  return {
    row: leadRowFromPostgres(row),
    version: parsePostgresPositiveBigint(row.version, "PostgreSQL lead version"),
  };
}

function normalizedLeadFields(lead: LeadRow) {
  const values = validateLeadValues({
    company: lead.company,
    contactName: lead.contact_name,
    contactEmail: lead.contact_email,
    contactPhone: lead.contact_phone,
    projectName: lead.project_name,
    source: lead.source,
    stage: lead.stage,
    site: lead.site,
    estimatedValue: lead.estimated_value,
    nextAction: lead.next_action,
    nextActionAt: lead.next_action_at,
    ownerEmail: lead.owner_email,
    status: lead.status,
  });
  if (!values) throw new TypeError("PostgreSQL lead values must satisfy lead validation");
  return values;
}

function leadCreationFingerprintInput(intent: LeadCreationIntent) {
  const values = normalizedLeadFields(intent.lead);
  return { version: 1, ...values };
}

export function calculatePostgresLeadCreationFingerprint(intent: LeadCreationIntent) {
  return calculatePostgresRequestFingerprint(leadCreationFingerprintInput(intent));
}

function assertUuid(value: string, label: string) {
  if (!isPostgresUuid(value)) throw new TypeError(`${label} must be a UUID`);
}

function assertLeadCreationIntent(intent: LeadCreationIntent) {
  assertUuid(intent.lead.id, "PostgreSQL lead ID");
  assertUuid(intent.activity.id, "PostgreSQL lead activity ID");
  normalizedLeadFields(intent.lead);
  if (!/^L-[0-9]{4}-[A-Z0-9]{8}$/.test(intent.lead.lead_number)) {
    throw new TypeError("PostgreSQL lead number is invalid");
  }
  if (intent.activity.recordId !== intent.lead.id) {
    throw new TypeError("PostgreSQL lead creation evidence must reference the new lead");
  }
  if (intent.activity.actor !== intent.lead.created_by || !intent.lead.created_by.trim()) {
    throw new TypeError("PostgreSQL lead creation actor must match its activity evidence");
  }
  for (const timestamp of [intent.lead.created_at, intent.lead.updated_at, intent.activity.createdAt]) {
    if (!Number.isSafeInteger(timestamp)) {
      throw new TypeError("PostgreSQL lead timestamps must be safe epoch milliseconds");
    }
  }
}

function assertLeadUpdateIntent(intent: LeadUpdateIntent) {
  assertUuid(intent.leadId, "PostgreSQL lead ID");
  const values = validateLeadValues(intent.values as unknown as Record<string, unknown>);
  if (!values) throw new TypeError("PostgreSQL lead update must satisfy lead validation");
  if (!intent.updatedBy.trim() || !Number.isSafeInteger(intent.updatedAt)) {
    throw new TypeError("PostgreSQL lead update actor and timestamp are required");
  }
  for (const activity of intent.activities) {
    assertUuid(activity.id, "PostgreSQL lead activity ID");
    if (
      activity.recordId !== intent.leadId
      || activity.actor !== intent.updatedBy
      || !Number.isSafeInteger(activity.createdAt)
    ) {
      throw new TypeError("PostgreSQL lead update evidence must match the updated lead and actor");
    }
  }
}

function postgresConstraint(error: unknown, code: string, constraints: readonly string[]) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === code && typeof record.constraint === "string"
    && constraints.includes(record.constraint);
}

export function createPostgresLeadRepository(
  pool: PostgresPool,
  options: PostgresLeadRepositoryOptions = {},
): LeadRepository {
  return {
    async list() {
      return withPostgresTransaction(pool, { schema: options.schema, readOnly: true }, async (client) => {
        const result = await client.query<LeadDatabaseRow>(
          `${LEAD_SELECT}\nORDER BY updated_at DESC, created_at DESC, id\nLIMIT 500`,
        );
        return result.rows.map(leadRowFromPostgres);
      });
    },

    async findById(leadId) {
      if (!isPostgresUuid(leadId)) return null;
      return withPostgresTransaction(pool, { schema: options.schema, readOnly: true }, async (client) => {
        const result = await client.query<LeadDatabaseRow>(`${LEAD_SELECT}\nWHERE id = $1`, [leadId]);
        if (result.rowCount === 0) return null;
        if (result.rowCount !== 1 || !result.rows[0]) {
          throw new Error("PostgreSQL lead lookup returned an invalid result");
        }
        return leadRowFromPostgres(result.rows[0]);
      });
    },

    async create(intent) {
      assertLeadCreationIntent(intent);
      if (!options.request) {
        throw new TypeError("PostgreSQL lead creation requires an idempotency request context");
      }
      const request = bindPostgresCreationRequest(options.request, leadCreationFingerprintInput(intent));
      try {
        return await withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
          const claim = await claimPostgresCreation(
            client,
            POSTGRES_CREATION_OPERATIONS.lead,
            intent.lead.created_by,
            intent.lead.created_at,
            request,
            acceptedLead,
          );
          if (claim.outcome === "idempotency-conflict" || claim.outcome === "in-progress") return claim;
          if (claim.outcome === "failed-replay") {
            throw new Error("Stored PostgreSQL lead failure response is invalid");
          }
          if (claim.outcome === "replayed") {
            return { outcome: "accepted" as const, value: claim.value, replayed: true };
          }

          const lead = intent.lead;
          const inserted = await client.query<LeadDatabaseRow>(
            `INSERT INTO leads (
               id, lead_number, company, contact_name, contact_email, contact_phone,
               project_name, source, stage, site, estimated_value, next_action,
               next_action_at, owner_email, status, created_by, updated_by,
               created_at, updated_at, version
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $16, $17, $18, 1
             )
             RETURNING id::text AS id, lead_number, company, contact_name,
               contact_email, contact_phone, project_name, source, stage, site,
               estimated_value::text AS estimated_value, next_action, next_action_at,
               owner_email, status, created_by, created_at, updated_at,
               version::text AS version`,
            [
              lead.id, lead.lead_number, lead.company, lead.contact_name,
              lead.contact_email, lead.contact_phone, lead.project_name, lead.source,
              lead.stage, lead.site, lead.estimated_value, lead.next_action,
              lead.next_action_at === null ? null : new Date(lead.next_action_at),
              lead.owner_email, lead.status, lead.created_by,
              new Date(lead.created_at), new Date(lead.updated_at),
            ],
          );
          if (inserted.rowCount !== 1 || !inserted.rows[0]) {
            throw new Error("PostgreSQL lead was not inserted exactly once");
          }
          const value = acceptedLeadFromRow(inserted.rows[0]);
          await client.query(
            `INSERT INTO activity_events (
               id, lead_id, action, actor_id, correlation_id, result, detail, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7)`,
            [
              intent.activity.id, lead.id, intent.activity.action, intent.activity.actor,
              request.correlationId, JSON.stringify({ message: intent.activity.detail }),
              new Date(intent.activity.createdAt),
            ],
          );
          await client.query(
            `INSERT INTO outbox_events (
               id, event_key, event_type, lead_id, actor_id, correlation_id,
               payload, status, available_at, created_at, updated_at, version
             ) VALUES ($1, $2, 'lead.created', $3, $4, $5, $6::jsonb,
               'pending', $7, $7, $7, 1)`,
            [
              request.outboxEventId, `lead.created:${lead.id}`, lead.id, lead.created_by,
              request.correlationId,
              JSON.stringify({ cause: "lead-created", recordId: lead.id }),
              new Date(lead.created_at),
            ],
          );
          await completePostgresCreation(
            client,
            POSTGRES_CREATION_OPERATIONS.lead,
            lead.created_by,
            lead.updated_at,
            request,
            value,
          );
          return { outcome: "accepted" as const, value, replayed: false };
        });
      } catch (error) {
        if (postgresConstraint(error, "23505", LEAD_IDENTIFIER_CONSTRAINTS)) {
          return { outcome: "identifier-collision" };
        }
        throw error;
      }
    },

    async update(intent) {
      if (!isPostgresUuid(intent.leadId)) return { outcome: "lead-not-found" };
      assertLeadUpdateIntent(intent);
      return withPostgresTransaction(pool, { schema: options.schema }, async (client) => {
        const values = intent.values;
        const updated = await client.query<LeadDatabaseRow>(
          `UPDATE leads SET
             company = $1, contact_name = $2, contact_email = $3, contact_phone = $4,
             project_name = $5, source = $6, stage = $7, site = $8,
             estimated_value = $9, next_action = $10, next_action_at = $11,
             owner_email = $12, status = $13, updated_by = $14, updated_at = $15,
             version = version + 1
           WHERE id = $16
           RETURNING id::text AS id, lead_number, company, contact_name,
             contact_email, contact_phone, project_name, source, stage, site,
             estimated_value::text AS estimated_value, next_action, next_action_at,
             owner_email, status, created_by, created_at, updated_at,
             version::text AS version`,
          [
            values.company, values.contactName, values.contactEmail, values.contactPhone,
            values.projectName, values.source, values.stage, values.site,
            values.estimatedValue, values.nextAction,
            values.nextActionAt === null ? null : new Date(values.nextActionAt),
            values.ownerEmail, values.status, intent.updatedBy, new Date(intent.updatedAt),
            intent.leadId,
          ],
        );
        if (updated.rowCount === 0) return { outcome: "lead-not-found" as const };
        if (updated.rowCount !== 1 || !updated.rows[0]) {
          throw new Error("PostgreSQL lead update returned an invalid result");
        }
        for (const activity of intent.activities) {
          await client.query(
            `INSERT INTO activity_events (
               id, lead_id, action, actor_id, correlation_id, result, detail, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6::jsonb, $7)`,
            [
              activity.id, intent.leadId, activity.action, activity.actor,
              `lead-update:${activity.id}`, JSON.stringify({ message: activity.detail }),
              new Date(activity.createdAt),
            ],
          );
        }
        return { outcome: "updated" as const, value: leadRowFromPostgres(updated.rows[0]) };
      });
    },
  };
}
