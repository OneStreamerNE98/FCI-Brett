import {
  normalizeStoredFilingRule,
  validateFilingRuleCreate,
  validateFilingRulePatch,
  type FilingRulePatchValues,
  type FilingRuleRecord,
  type FilingRuleValues,
} from "../../domain/filing-rule";
import type {
  FilingRuleRepository,
  FilingRuleUpdate,
} from "../../ports/filing-rule-repository";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import {
  assertPersistenceText,
  persistenceDate,
} from "./persistence-repository-values";
import {
  parsePostgresTimestamp,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresFilingRuleOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

type FilingRuleDatabaseRow = Record<string, unknown> & {
  id: unknown;
  name: unknown;
  enabled: unknown;
  priority: unknown;
  match_summary: unknown;
  action: unknown;
  target_category: unknown;
  approval_required: unknown;
  created_by: unknown;
  created_at: unknown;
  updated_at: unknown;
};

function validRuleId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  return value;
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function requiredInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer`);
  }
  return value;
}

function filingRuleRecord(row: FilingRuleDatabaseRow): FilingRuleRecord {
  if (!validRuleId(row.id)) throw new TypeError("PostgreSQL filing rule ID is invalid");
  const createdAt = parsePostgresTimestamp(
    row.created_at,
    "PostgreSQL filing rule created_at",
  );
  const updatedAt = parsePostgresTimestamp(
    row.updated_at,
    "PostgreSQL filing rule updated_at",
  );
  if (updatedAt < createdAt) {
    throw new TypeError("PostgreSQL filing rule timestamps are inconsistent");
  }
  return normalizeStoredFilingRule({
    id: row.id,
    name: requiredText(row.name, "PostgreSQL filing rule name"),
    enabled: requiredBoolean(row.enabled, "PostgreSQL filing rule enabled"),
    priority: requiredInteger(row.priority, "PostgreSQL filing rule priority"),
    match_summary: requiredText(
      row.match_summary,
      "PostgreSQL filing rule matching criteria",
    ),
    action: requiredText(row.action, "PostgreSQL filing rule action"),
    target_category: requiredText(
      row.target_category,
      "PostgreSQL filing rule target category",
    ),
    approval_required: requiredBoolean(
      row.approval_required,
      "PostgreSQL filing rule approval requirement",
    ),
    created_by: requiredText(row.created_by, "PostgreSQL filing rule creator"),
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

function sameValues(left: FilingRuleValues, right: FilingRuleValues) {
  return left.name === right.name
    && left.enabled === right.enabled
    && left.priority === right.priority
    && left.matchSummary === right.matchSummary
    && left.action === right.action
    && left.targetCategory === right.targetCategory
    && left.approvalRequired === right.approvalRequired;
}

function validatedCreationValues(values: FilingRuleValues) {
  const validation = validateFilingRuleCreate({ ...values });
  if (!validation.ok || !sameValues(values, validation.values)) {
    throw new TypeError("PostgreSQL filing rule values must be normalized");
  }
  return validation.values;
}

function validatedPatchValues(values: FilingRulePatchValues) {
  const validation = validateFilingRulePatch({ ...values });
  if (!validation.ok) {
    throw new TypeError("PostgreSQL filing rule update values must be normalized");
  }
  for (const key of Object.keys(values) as Array<keyof FilingRulePatchValues>) {
    if (validation.values[key] !== values[key]) {
      throw new TypeError("PostgreSQL filing rule update values must be normalized");
    }
  }
  return validation.values;
}

function updateAssignments(input: FilingRuleUpdate) {
  const values = validatedPatchValues(input.values);
  const sets: string[] = [];
  const parameters: unknown[] = [];
  const bind = (column: string, value: unknown) => {
    parameters.push(value);
    sets.push(`${column} = $${parameters.length}`);
  };
  if (values.enabled !== undefined) bind("enabled", values.enabled);
  if (values.priority !== undefined) bind("priority", values.priority);
  if (values.name !== undefined) bind("name", values.name);
  if (values.matchSummary !== undefined) bind("match_summary", values.matchSummary);
  if (values.targetCategory !== undefined) bind("target_category", values.targetCategory);
  if (values.action !== undefined) bind("action", values.action);
  return { sets, parameters };
}

export function createPostgresFilingRuleRepository(
  pool: PostgresPool,
  options: PostgresFilingRuleOptions = {},
): FilingRuleRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  return {
    async list() {
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<FilingRuleDatabaseRow>(
            `SELECT id, name, enabled, priority, match_summary, action,
                    target_category, approval_required, created_by,
                    created_at, updated_at
             FROM filing_rules
             ORDER BY priority ASC, created_at ASC, id`,
          );
          return result.rows.map(filingRuleRecord);
        },
      );
    },

    async create(input) {
      if (!validRuleId(input.id)) {
        throw new TypeError("PostgreSQL filing rule ID is invalid");
      }
      const values = validatedCreationValues(input.values);
      assertPersistenceText(input.createdBy, "PostgreSQL filing rule creator", 320);
      const createdAt = persistenceDate(input.createdAt, "PostgreSQL filing rule created_at");
      await withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `INSERT INTO filing_rules (
             id, name, enabled, priority, match_summary, action,
             target_category, approval_required, created_by,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            input.id,
            values.name,
            values.enabled,
            values.priority,
            values.matchSummary,
            values.action,
            values.targetCategory,
            values.approvalRequired,
            input.createdBy,
            createdAt,
          ],
        );
        if (result.rowCount !== 1) {
          throw new Error("PostgreSQL filing rule was not inserted exactly once");
        }
      });
    },

    async update(input) {
      if (!validRuleId(input.id)) return false;
      const { sets, parameters } = updateAssignments(input);
      if (sets.length === 0) return false;
      parameters.push(persistenceDate(input.updatedAt, "PostgreSQL filing rule updated_at"));
      sets.push(`updated_at = $${parameters.length}`);
      parameters.push(input.id);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `UPDATE filing_rules
           SET ${sets.join(", ")}
           WHERE id = $${parameters.length}`,
          parameters,
        );
        if (result.rowCount === 0) return false;
        if (result.rowCount !== 1) {
          throw new Error("PostgreSQL filing rule update returned an invalid result");
        }
        return true;
      });
    },

    async delete(id) {
      if (!validRuleId(id)) return false;
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          "DELETE FROM filing_rules WHERE id = $1",
          [id],
        );
        if (result.rowCount === 0) return false;
        if (result.rowCount !== 1) {
          throw new Error("PostgreSQL filing rule deletion returned an invalid result");
        }
        return true;
      });
    },
  };
}
