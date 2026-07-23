import { normalizeStoredFilingRule } from "../../domain/filing-rule";
import type {
  FilingRuleRepository,
  FilingRuleUpdate,
} from "../../ports/filing-rule-repository";
import type { D1Database } from "./d1-database";

function updateAssignments(input: FilingRuleUpdate) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.values.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(input.values.enabled ? 1 : 0);
  }
  if (input.values.priority !== undefined) {
    sets.push("priority = ?");
    values.push(input.values.priority);
  }
  if (input.values.name !== undefined) {
    sets.push("name = ?");
    values.push(input.values.name);
  }
  if (input.values.matchSummary !== undefined) {
    sets.push("match_summary = ?");
    values.push(input.values.matchSummary);
  }
  if (input.values.targetCategory !== undefined) {
    sets.push("target_category = ?");
    values.push(input.values.targetCategory);
  }
  if (input.values.action !== undefined) {
    sets.push("action = ?");
    values.push(input.values.action);
  }
  return { sets, values };
}

export function createD1FilingRuleRepository(database: D1Database): FilingRuleRepository {
  return {
    async list() {
      const result = await database
        .prepare("SELECT * FROM filing_rules ORDER BY priority ASC, created_at ASC")
        .all<Record<string, unknown>>();
      return result.results.map(normalizeStoredFilingRule);
    },

    async create(input) {
      await database
        .prepare(
          "INSERT INTO filing_rules (id, name, enabled, priority, match_summary, action, target_category, approval_required, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.id,
          input.values.name,
          input.values.enabled ? 1 : 0,
          input.values.priority,
          input.values.matchSummary,
          input.values.action,
          input.values.targetCategory,
          input.values.approvalRequired ? 1 : 0,
          input.createdBy,
          input.createdAt,
          input.createdAt,
        )
        .run();
    },

    async update(input) {
      const { sets, values } = updateAssignments(input);
      if (sets.length === 0) return false;
      sets.push("updated_at = ?");
      values.push(input.updatedAt, input.id);
      const result = await database
        .prepare(`UPDATE filing_rules SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...values)
        .run();
      return result.meta.changes === 1;
    },

    async delete(id) {
      const result = await database
        .prepare("DELETE FROM filing_rules WHERE id = ?")
        .bind(id)
        .run();
      return result.meta.changes === 1;
    },
  };
}
