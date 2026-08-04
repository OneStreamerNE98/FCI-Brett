import {
  MAX_ASSISTANT_LABELS,
  normalizeAssistantLabelDescription,
  normalizeAssistantLabelSlug,
  normalizeAssistantLabelTimestamp,
  normalizeStoredAssistantLabelDefinition,
  type AssistantLabelDefinition,
} from "../../domain/assistant-label-definition";
import type {
  AssistantLabelRemovalOutcome,
  AssistantLabelRepository,
} from "../../ports/assistant-label-repository";
import {
  withPostgresTransaction,
  type PostgresPool,
  type PostgresTransactionOptions,
} from "./postgres-database";
import { persistenceDate } from "./persistence-repository-values";
import { parsePostgresTimestamp, postgresSchemaName } from "./postgres-values";

export type PostgresAssistantLabelRepositoryOptions = Readonly<{
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}>;

type AssistantLabelRow = Readonly<Record<string, unknown>>;

export function createPostgresAssistantLabelRepository(
  pool: PostgresPool,
  options: PostgresAssistantLabelRepositoryOptions = {},
): AssistantLabelRepository {
  const transactionOptions: PostgresTransactionOptions = {
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
          const result = await client.query<AssistantLabelRow>(
            `SELECT slug, description, retired, created_at, updated_at
               FROM assistant_label_definitions
              ORDER BY created_at ASC, slug ASC`,
          );
          if (result.rowCount !== result.rows.length) {
            throw new Error("PostgreSQL AI label catalog returned an invalid result");
          }
          return result.rows.map((row) => normalizeStoredAssistantLabelDefinition({
            ...row,
            created_at: parsePostgresTimestamp(row.created_at, "AI label created_at"),
            updated_at: parsePostgresTimestamp(row.updated_at, "AI label updated_at"),
          }));
        },
      );
    },

    async insert(label: AssistantLabelDefinition) {
      const normalized = normalizeStoredAssistantLabelDefinition(label);
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        await client.query(
          "LOCK TABLE assistant_label_definitions IN SHARE ROW EXCLUSIVE MODE",
        );
        const result = await client.query(
          `INSERT INTO assistant_label_definitions (
             slug, description, retired, created_at, updated_at
           )
           SELECT $1, $2, $3, $4, $5
            WHERE (SELECT pg_catalog.count(*) FROM assistant_label_definitions) < $6
           ON CONFLICT (slug) DO NOTHING`,
          [
            normalized.slug,
            normalized.description,
            normalized.retired,
            persistenceDate(normalized.createdAt, "AI label created_at"),
            persistenceDate(normalized.updatedAt, "AI label updated_at"),
            MAX_ASSISTANT_LABELS,
          ],
        );
        return result.rowCount === 1;
      });
    },

    async updateDescription(slug, description, updatedAt) {
      const normalizedSlug = normalizeAssistantLabelSlug(slug);
      const normalizedDescription = normalizeAssistantLabelDescription(description);
      const normalizedUpdatedAt = normalizeAssistantLabelTimestamp(updatedAt, "AI label updated_at");
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `UPDATE assistant_label_definitions
              SET description = $1, updated_at = $2
            WHERE slug = $3`,
          [
            normalizedDescription,
            persistenceDate(normalizedUpdatedAt, "AI label updated_at"),
            normalizedSlug,
          ],
        );
        return result.rowCount === 1;
      });
    },

    async removeOrRetire(slug, updatedAt): Promise<AssistantLabelRemovalOutcome> {
      const normalizedSlug = normalizeAssistantLabelSlug(slug);
      const normalizedUpdatedAt = normalizeAssistantLabelTimestamp(updatedAt, "AI label updated_at");
      return withPostgresTransaction(pool, transactionOptions, async (client) => {
        // Serialize the catalog decision with guarded analysis writers. A
        // writer holds FOR SHARE on every label until its mail_items write
        // commits; taking FOR UPDATE here first means each subsequent READ
        // COMMITTED statement sees that committed usage. In the inverse
        // ordering, the writer waits here and then rejects the retired or
        // deleted label rather than persisting a stale classification.
        const locked = await client.query<{ retired: boolean }>(
          `SELECT retired
             FROM assistant_label_definitions
            WHERE slug = $1
            FOR UPDATE`,
          [normalizedSlug],
        );
        if (locked.rowCount === 0) return "not-found";
        if (locked.rows[0]?.retired === true) return "retired";

        const retired = await client.query(
          `UPDATE assistant_label_definitions
              SET retired = true, updated_at = $2
            WHERE slug = $1
              AND EXISTS (
                SELECT 1
                  FROM mail_items
                  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
                    CASE
                      WHEN pg_catalog.jsonb_typeof(mail_items.analysis_payload -> 'intents') = 'array'
                        THEN mail_items.analysis_payload -> 'intents'
                      ELSE '[]'::jsonb
                    END
                  ) AS stored_intent(value)
                 WHERE stored_intent.value = $1
              )`,
          [normalizedSlug, persistenceDate(normalizedUpdatedAt, "AI label updated_at")],
        );
        if (retired.rowCount === 1) return "retired";

        const deleted = await client.query(
          `DELETE FROM assistant_label_definitions
            WHERE slug = $1
              AND retired = false
              AND NOT EXISTS (
                SELECT 1
                  FROM mail_items
                  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
                    CASE
                      WHEN pg_catalog.jsonb_typeof(mail_items.analysis_payload -> 'intents') = 'array'
                        THEN mail_items.analysis_payload -> 'intents'
                      ELSE '[]'::jsonb
                    END
                  ) AS stored_intent(value)
                 WHERE stored_intent.value = $1
              )`,
          [normalizedSlug],
        );
        if (deleted.rowCount === 1) return "deleted";

        const existing = await client.query(
          "SELECT retired FROM assistant_label_definitions WHERE slug = $1",
          [normalizedSlug],
        );
        return existing.rowCount === 1 ? "retired" : "not-found";
      });
    },
  };
}
