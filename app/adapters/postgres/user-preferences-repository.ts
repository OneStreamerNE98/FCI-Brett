import type {
  UserPreferencesRecord,
  UserPreferencesRepository,
} from "../../ports/user-preferences-repository";
import { withPostgresTransaction, type PostgresPool } from "./postgres-database";
import { persistenceDate } from "./persistence-repository-values";
import {
  parsePostgresTimestamp,
  postgresSchemaName,
} from "./postgres-values";

export type PostgresUserPreferencesOptions = {
  schema?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

type UserPreferencesDatabaseRow = Record<string, unknown> & {
  user_email: unknown;
  display_timezone: unknown;
  reply_signature: unknown;
  notification_preferences_json: unknown;
  page_layouts_json: unknown;
  updated_at: unknown;
};

function normalizedEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 254
    && value === value.trim().toLowerCase()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  return value;
}

function jsonObjectText(value: unknown, label: string) {
  if (typeof value !== "string") throw new TypeError(`${label} must be JSON text`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError(`${label} must encode a JSON object`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must encode a JSON object`);
  }
  return value;
}

function userPreferencesRecord(row: UserPreferencesDatabaseRow): UserPreferencesRecord {
  if (!normalizedEmail(row.user_email)) {
    throw new TypeError("PostgreSQL user preference email is invalid");
  }
  return Object.freeze({
    userEmail: row.user_email,
    displayTimezone: requiredText(
      row.display_timezone,
      "PostgreSQL user preference timezone",
    ),
    replySignature: requiredText(
      row.reply_signature,
      "PostgreSQL user preference reply signature",
    ),
    notificationPreferencesJson: jsonObjectText(
      row.notification_preferences_json,
      "PostgreSQL notification preferences",
    ),
    pageLayoutsJson: jsonObjectText(
      row.page_layouts_json,
      "PostgreSQL page layouts",
    ),
    updatedAt: parsePostgresTimestamp(
      row.updated_at,
      "PostgreSQL user preferences updated_at",
    ),
  });
}

function validateRecord(record: UserPreferencesRecord) {
  if (!normalizedEmail(record.userEmail)) {
    throw new TypeError("User preference email must be normalized");
  }
  if (
    typeof record.displayTimezone !== "string"
    || !record.displayTimezone.trim()
    || record.displayTimezone.length > 80
    || /[\u0000-\u001f\u007f]/.test(record.displayTimezone)
  ) {
    throw new TypeError("User preference timezone must be bounded nonblank text");
  }
  if (
    typeof record.replySignature !== "string"
    || record.replySignature.length > 2_000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(record.replySignature)
  ) {
    throw new TypeError("User preference reply signature is invalid");
  }
  return {
    notificationPreferencesJson: jsonObjectText(
      record.notificationPreferencesJson,
      "Notification preferences",
    ),
    pageLayoutsJson: jsonObjectText(record.pageLayoutsJson, "Page layouts"),
    updatedAt: persistenceDate(record.updatedAt, "User preferences updated_at"),
  };
}

export function createPostgresUserPreferencesRepository(
  pool: PostgresPool,
  options: PostgresUserPreferencesOptions = {},
): UserPreferencesRepository {
  const transactionOptions = {
    schema: postgresSchemaName(options.schema),
    lockTimeoutMs: options.lockTimeoutMs,
    statementTimeoutMs: options.statementTimeoutMs,
  };

  return {
    async findByEmail(email) {
      if (!normalizedEmail(email)) return null;
      return withPostgresTransaction(
        pool,
        { ...transactionOptions, readOnly: true },
        async (client) => {
          const result = await client.query<UserPreferencesDatabaseRow>(
            `SELECT user_email, display_timezone, reply_signature,
                    notification_preferences_json::text AS notification_preferences_json,
                    page_layouts_json::text AS page_layouts_json, updated_at
             FROM user_preferences
             WHERE user_email = $1`,
            [email],
          );
          if (result.rowCount === 0) return null;
          if (result.rowCount !== 1 || !result.rows[0]) {
            throw new Error("PostgreSQL user preference lookup returned an invalid result");
          }
          return userPreferencesRecord(result.rows[0]);
        },
      );
    },

    async upsert(record) {
      const validated = validateRecord(record);
      await withPostgresTransaction(pool, transactionOptions, async (client) => {
        const result = await client.query(
          `INSERT INTO user_preferences (
             user_email, display_timezone, reply_signature,
             notification_preferences_json, page_layouts_json, updated_at
           ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
           ON CONFLICT (user_email) DO UPDATE SET
             display_timezone = EXCLUDED.display_timezone,
             reply_signature = EXCLUDED.reply_signature,
             notification_preferences_json = EXCLUDED.notification_preferences_json,
             page_layouts_json = EXCLUDED.page_layouts_json,
             updated_at = EXCLUDED.updated_at`,
          [
            record.userEmail,
            record.displayTimezone,
            record.replySignature,
            validated.notificationPreferencesJson,
            validated.pageLayoutsJson,
            validated.updatedAt,
          ],
        );
        if (result.rowCount !== 1) {
          throw new Error("PostgreSQL user preferences were not upserted exactly once");
        }
      });
    },
  };
}
