import type {
  UserPreferencesRecord,
  UserPreferencesRepository,
} from "../../ports/user-preferences-repository";
import type { D1Database } from "./d1-database";

type UserPreferencesRow = Readonly<{
  user_email?: unknown;
  display_timezone: string;
  reply_signature: string;
  notification_preferences_json: string;
  page_layouts_json: string;
  updated_at: number;
}>;

function recordFromD1(row: UserPreferencesRow, requestedEmail: string): UserPreferencesRecord {
  return Object.freeze({
    userEmail: typeof row.user_email === "string" ? row.user_email : requestedEmail,
    displayTimezone: row.display_timezone,
    replySignature: row.reply_signature,
    notificationPreferencesJson: row.notification_preferences_json,
    pageLayoutsJson: row.page_layouts_json,
    updatedAt: row.updated_at,
  });
}

export function createD1UserPreferencesRepository(
  database: D1Database,
): UserPreferencesRepository {
  return {
    async findByEmail(email) {
      const row = await database
        .prepare(
          "SELECT user_email, display_timezone, reply_signature, notification_preferences_json, page_layouts_json, updated_at FROM user_preferences WHERE user_email = ?",
        )
        .bind(email)
        .first<UserPreferencesRow>();
      return row ? recordFromD1(row, email) : null;
    },

    async upsert(record) {
      await database
        .prepare(
          "INSERT INTO user_preferences (user_email, display_timezone, reply_signature, notification_preferences_json, page_layouts_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_email) DO UPDATE SET display_timezone = excluded.display_timezone, reply_signature = excluded.reply_signature, notification_preferences_json = excluded.notification_preferences_json, page_layouts_json = excluded.page_layouts_json, updated_at = excluded.updated_at",
        )
        .bind(
          record.userEmail,
          record.displayTimezone,
          record.replySignature,
          record.notificationPreferencesJson,
          record.pageLayoutsJson,
          record.updatedAt,
        )
        .run();
    },
  };
}
