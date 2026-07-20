import type { LeadRow } from "../../domain/lead";
import type {
  LeadCreationIntent,
  LeadRepository,
  LeadUpdateIntent,
} from "../../ports/lead-repository";
import type { D1Database, D1PreparedStatement } from "./d1-database";

export function createD1LeadRepository(database: D1Database): LeadRepository {
  return {
    async list() {
      const result = await database
        .prepare("SELECT * FROM leads ORDER BY updated_at DESC, created_at DESC LIMIT 500")
        .all<LeadRow>();
      return result.results;
    },

    findById(leadId) {
      return database.prepare("SELECT * FROM leads WHERE id = ?").bind(leadId).first<LeadRow>();
    },

    async create(intent: LeadCreationIntent) {
      const { lead, activity } = intent;
      await database.batch([
        database.prepare("INSERT INTO leads (id, lead_number, company, contact_name, contact_email, contact_phone, project_name, source, stage, site, estimated_value, next_action, next_action_at, owner_email, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(lead.id, lead.lead_number, lead.company, lead.contact_name, lead.contact_email, lead.contact_phone, lead.project_name, lead.source, lead.stage, lead.site, lead.estimated_value, lead.next_action, lead.next_action_at, lead.owner_email, lead.status, lead.created_by, lead.created_at, lead.updated_at),
        database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt),
      ]);
      const created = await database
        .prepare("SELECT * FROM leads WHERE id = ?")
        .bind(lead.id)
        .first<LeadRow>();
      if (!created) throw new Error("D1 lead creation did not return the inserted lead");
      return { outcome: "created", value: created };
    },

    async update(intent: LeadUpdateIntent) {
      const { values } = intent;
      const statements: D1PreparedStatement[] = [
        database.prepare("UPDATE leads SET company = ?, contact_name = ?, contact_email = ?, contact_phone = ?, project_name = ?, source = ?, stage = ?, site = ?, estimated_value = ?, next_action = ?, next_action_at = ?, owner_email = ?, status = ?, updated_at = ? WHERE id = ?")
          .bind(values.company, values.contactName, values.contactEmail, values.contactPhone, values.projectName, values.source, values.stage, values.site, values.estimatedValue, values.nextAction, values.nextActionAt, values.ownerEmail, values.status, intent.updatedAt, intent.leadId),
      ];
      for (const activity of intent.activities) {
        statements.push(
          database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(activity.id, activity.recordId, activity.action, activity.actor, activity.detail, activity.createdAt),
        );
      }
      const results = await database.batch(statements);
      if (results[0]?.meta.changes !== 1) return { outcome: "lead-not-found" };
      const updated = await database
        .prepare("SELECT * FROM leads WHERE id = ?")
        .bind(intent.leadId)
        .first<LeadRow>();
      if (!updated) throw new Error("D1 lead update did not return the updated lead");
      return { outcome: "updated", value: updated };
    },
  };
}
