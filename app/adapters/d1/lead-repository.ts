import type { LeadRow } from "../../domain/lead";
import type {
  LeadCreationIntent,
  LeadRepository,
  LeadUpdateIntent,
} from "../../ports/lead-repository";
import type { D1Database, D1PreparedStatement } from "./d1-database";
import { d1RecordVersion, nextD1RecordVersion } from "./record-version.ts";

type D1LeadRow = Omit<LeadRow, "version"> & { version: unknown };

function leadRow(row: D1LeadRow): LeadRow {
  return { ...row, version: d1RecordVersion(row.version, "D1 lead version") };
}

async function currentLeadVersion(database: D1Database, leadId: string) {
  const row = await database
    .prepare("SELECT version FROM leads WHERE id = ?")
    .bind(leadId)
    .first<{ version: unknown }>();
  return row ? d1RecordVersion(row.version, "D1 lead version") : null;
}

function assertFormLeadReviewIntent(intent: LeadCreationIntent) {
  const review = intent.formLeadReview;
  if (!review) return;
  if (
    !/^[A-Za-z0-9_-]{1,256}$/u.test(review.id)
    || !/^[a-z][a-z0-9_-]{0,127}$/u.test(review.connectionKey)
    || review.acceptedAt !== intent.lead.created_at
    || intent.lead.source !== "Google Form"
    || intent.activity.actor !== intent.lead.created_by
  ) {
    throw new TypeError("D1 Google Form lead acceptance evidence is invalid");
  }
}

export function createD1LeadRepository(database: D1Database): LeadRepository {
  return {
    async list() {
      const result = await database
        .prepare("SELECT * FROM leads ORDER BY updated_at DESC, created_at DESC LIMIT 500")
        .all<D1LeadRow>();
      return result.results.map(leadRow);
    },

    findById(leadId) {
      return database.prepare("SELECT * FROM leads WHERE id = ?").bind(leadId).first<D1LeadRow>()
        .then((row) => row ? leadRow(row) : null);
    },

    async create(intent: LeadCreationIntent) {
      assertFormLeadReviewIntent(intent);
      const { lead, activity } = intent;
      const statements: D1PreparedStatement[] = [];
      if (intent.formLeadReview) {
        statements.push(
          database.prepare(
            `UPDATE google_form_lead_reviews
             SET status = 'accepted', reviewed_by = ?, reviewed_at = ?,
                 updated_at = ?, accepted_lead_id = ?
             WHERE id = ? AND connection_key = ? AND status = 'needs-review'`,
          ).bind(
            lead.created_by,
            intent.formLeadReview.acceptedAt,
            intent.formLeadReview.acceptedAt,
            lead.id,
            intent.formLeadReview.id,
            intent.formLeadReview.connectionKey,
          ),
        );
      }
      statements.push(
        database.prepare(intent.formLeadReview
          ? "INSERT INTO leads (id, lead_number, company, contact_name, contact_email, contact_phone, project_name, source, stage, site, estimated_value, next_action, next_action_at, owner_email, status, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1"
          : "INSERT INTO leads (id, lead_number, company, contact_name, contact_email, contact_phone, project_name, source, stage, site, estimated_value, next_action, next_action_at, owner_email, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(lead.id, lead.lead_number, lead.company, lead.contact_name, lead.contact_email, lead.contact_phone, lead.project_name, lead.source, lead.stage, lead.site, lead.estimated_value, lead.next_action, lead.next_action_at, lead.owner_email, lead.status, lead.created_by, lead.created_at, lead.updated_at),
      );
      statements.push(
        database.prepare(intent.formLeadReview
          ? "INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM leads WHERE id = ? AND created_by = ?)"
          : "INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(
            activity.id,
            activity.recordId,
            activity.action,
            activity.actor,
            activity.detail,
            activity.createdAt,
            ...(intent.formLeadReview ? [lead.id, lead.created_by] : []),
          ),
      );
      const results = await database.batch(statements);
      if (intent.formLeadReview && results[0]?.meta.changes !== 1) {
        return { outcome: "review-not-found" };
      }
      const leadInsertIndex = intent.formLeadReview ? 1 : 0;
      if (results[leadInsertIndex]?.meta.changes !== 1) {
        throw new Error("D1 lead was not inserted exactly once");
      }
      if (intent.formLeadReview && results[leadInsertIndex + 1]?.meta.changes !== 1) {
        throw new Error("D1 Google Form lead activity was not inserted exactly once");
      }
      const created = await database
        .prepare("SELECT * FROM leads WHERE id = ?")
        .bind(lead.id)
        .first<D1LeadRow>();
      if (!created) throw new Error("D1 lead creation did not return the inserted lead");
      const value = leadRow(created);
      return intent.formLeadReview
        ? {
            outcome: "review-accepted",
            value: { row: value, version: value.version },
            formLeadReview: { id: intent.formLeadReview.id, status: "accepted" },
            replayed: false,
          }
        : { outcome: "created", value };
    },

    async update(intent: LeadUpdateIntent) {
      const { values } = intent;
      const expectedVersion = d1RecordVersion(intent.expectedVersion, "Expected D1 lead version");
      const resultingVersion = nextD1RecordVersion(expectedVersion);
      const statements: D1PreparedStatement[] = [
        database.prepare("UPDATE leads SET company = ?, contact_name = ?, contact_email = ?, contact_phone = ?, project_name = ?, source = ?, stage = ?, site = ?, estimated_value = ?, next_action = ?, next_action_at = ?, owner_email = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
          .bind(values.company, values.contactName, values.contactEmail, values.contactPhone, values.projectName, values.source, values.stage, values.site, values.estimatedValue, values.nextAction, values.nextActionAt, values.ownerEmail, values.status, intent.updatedAt, intent.leadId, expectedVersion),
      ];
      for (const activity of intent.activities) {
        statements.push(
          database.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM leads WHERE id = ? AND version = ?)")
            .bind(
              activity.id,
              activity.recordId,
              activity.action,
              activity.actor,
              activity.detail,
              activity.createdAt,
              intent.leadId,
              resultingVersion,
            ),
        );
      }
      const results = await database.batch(statements);
      if (results[0]?.meta.changes !== 1) {
        const currentVersion = await currentLeadVersion(database, intent.leadId);
        return currentVersion
          ? { outcome: "conflict", currentVersion }
          : { outcome: "lead-not-found" };
      }
      const updated = await database
        .prepare("SELECT * FROM leads WHERE id = ?")
        .bind(intent.leadId)
        .first<D1LeadRow>();
      if (!updated) throw new Error("D1 lead update did not return the updated lead");
      return { outcome: "updated", value: leadRow(updated) };
    },
  };
}
