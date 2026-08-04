import {
  isSystemAssistantLabelSlug,
  MAX_ASSISTANT_LABEL_ROWS,
  MAX_ASSISTANT_LABELS,
  normalizeAssistantLabelDescription,
  normalizeAssistantLabelSlug,
  normalizeAssistantLabelTimestamp,
  normalizeStoredAssistantLabelDefinition,
  type AssistantLabelDefinition,
} from "../../domain/assistant-label-definition";
import type {
  AssistantLabelInsertOutcome,
  AssistantLabelRemovalOutcome,
  AssistantLabelRepository,
} from "../../ports/assistant-label-repository";
import type { D1Database } from "./d1-database";

type AssistantLabelRow = Readonly<Record<string, unknown>>;

function changes(result: Readonly<{ meta: { changes?: number } }>) {
  return result.meta.changes ?? 0;
}

export function createD1AssistantLabelRepository(
  database: D1Database,
): AssistantLabelRepository {
  return {
    async list() {
      const result = await database.prepare(
        "SELECT slug, description, retired, created_at, updated_at FROM assistant_label_definitions ORDER BY created_at ASC, slug ASC",
      ).all<AssistantLabelRow>();
      return result.results.map((row) => normalizeStoredAssistantLabelDefinition(row));
    },

    async insert(label: AssistantLabelDefinition): Promise<AssistantLabelInsertOutcome> {
      const normalized = normalizeStoredAssistantLabelDefinition(label);
      // Both bounds live in the INSERT ... SELECT ... WHERE predicate so D1's
      // per-statement serialization decides them; a separate COUNT would let a
      // concurrent insert slip past between the read and the write.
      const result = await database.prepare(
        `INSERT INTO assistant_label_definitions (
           slug, description, retired, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM assistant_label_definitions WHERE retired = 0) < ?
            AND (SELECT COUNT(*) FROM assistant_label_definitions) < ?
         ON CONFLICT(slug) DO NOTHING`,
      ).bind(
        normalized.slug,
        normalized.description,
        normalized.retired ? 1 : 0,
        normalized.createdAt,
        normalized.updatedAt,
        MAX_ASSISTANT_LABELS,
        MAX_ASSISTANT_LABEL_ROWS,
      ).run();
      if (changes(result) === 1) return "inserted";
      // The write lost: report which bound rejected it so the caller can tell a
      // recoverable cap from an exhausted store.
      const counts = await database.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN retired = 0 THEN 1 ELSE 0 END) AS active
           FROM assistant_label_definitions`,
      ).first<{ total: unknown; active: unknown }>();
      const total = Number(counts?.total ?? 0);
      const active = Number(counts?.active ?? 0);
      if (total >= MAX_ASSISTANT_LABEL_ROWS) return "storage-exhausted";
      if (active >= MAX_ASSISTANT_LABELS) return "active-cap-reached";
      return "not-inserted";
    },

    async updateDescription(slug, description, updatedAt) {
      const normalizedSlug = normalizeAssistantLabelSlug(slug);
      const normalizedDescription = normalizeAssistantLabelDescription(description);
      const normalizedUpdatedAt = normalizeAssistantLabelTimestamp(updatedAt, "AI label updated_at");
      const result = await database.prepare(
        "UPDATE assistant_label_definitions SET description = ?, updated_at = ? WHERE slug = ?",
      ).bind(normalizedDescription, normalizedUpdatedAt, normalizedSlug).run();
      return changes(result) === 1;
    },

    async removeOrRetire(slug, updatedAt): Promise<AssistantLabelRemovalOutcome> {
      const normalizedSlug = normalizeAssistantLabelSlug(slug);
      const normalizedUpdatedAt = normalizeAssistantLabelTimestamp(updatedAt, "AI label updated_at");
      // Enforced here as well as at the route: the adapter is the last gate
      // before the statement runs, and a system slug lost this way is
      // unrecoverable (delete is permanent, retirement has no un-retire path).
      if (isSystemAssistantLabelSlug(normalizedSlug)) return "protected";
      const safeAnalysisPayload = `CASE
        WHEN json_valid(mail_items.analysis_payload)
          THEN mail_items.analysis_payload
        ELSE '{}'
      END`;
      const usedPredicate = `EXISTS (
        SELECT 1
          FROM mail_items,
               json_each(${safeAnalysisPayload}, '$.intents') AS stored_intent
         WHERE stored_intent.value = ?
      )`;
      const retired = await database.prepare(
        `UPDATE assistant_label_definitions
            SET retired = 1, updated_at = ?
          WHERE slug = ? AND ${usedPredicate}`,
      ).bind(normalizedUpdatedAt, normalizedSlug, normalizedSlug).run();
      if (changes(retired) === 1) return "retired";

      const deleted = await database.prepare(
        `DELETE FROM assistant_label_definitions
          WHERE slug = ?
            AND retired = 0
            AND NOT ${usedPredicate}`,
      ).bind(normalizedSlug, normalizedSlug).run();
      if (changes(deleted) === 1) return "deleted";

      // D1 serializes individual statements, but another request can save a
      // guarded analysis between this method's first usage check and delete.
      // Re-run the retirement after the guarded delete loses that race so the
      // API never reports retirement while leaving a newly used label active.
      const racedRetirement = await database.prepare(
        `UPDATE assistant_label_definitions
            SET retired = 1, updated_at = ?
          WHERE slug = ? AND ${usedPredicate}`,
      ).bind(normalizedUpdatedAt, normalizedSlug, normalizedSlug).run();
      if (changes(racedRetirement) === 1) return "retired";

      const existing = await database.prepare(
        "SELECT retired FROM assistant_label_definitions WHERE slug = ?",
      ).bind(normalizedSlug).first<{ retired: unknown }>();
      return existing ? "retired" : "not-found";
    },
  };
}
