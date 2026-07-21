import {
  normalizeStoredGoogleChatRouting,
  type GoogleChatRoutingSettings,
} from "../../lib/google-chat-notifier";

export const GOOGLE_CHAT_ROUTING_SETTINGS_ID = "google-chat-routing";

type GoogleChatRoutingRow = Readonly<{
  settings_json: string;
  updated_at: number;
}>;

type GoogleChatRoutingStatement = {
  bind(...values: unknown[]): GoogleChatRoutingStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
};

export type GoogleChatRoutingDatabase = {
  prepare(sql: string): GoogleChatRoutingStatement;
};

export async function readGoogleChatRouting(
  database: GoogleChatRoutingDatabase,
): Promise<Readonly<{
  routing: GoogleChatRoutingSettings;
  updatedAt: number | null;
}>> {
  const row = await database
    .prepare("SELECT settings_json, updated_at FROM workspace_settings WHERE id = ?")
    .bind(GOOGLE_CHAT_ROUTING_SETTINGS_ID)
    .first<GoogleChatRoutingRow>();
  if (!row) return Object.freeze({ routing: normalizeStoredGoogleChatRouting(null), updatedAt: null });
  try {
    return Object.freeze({
      routing: normalizeStoredGoogleChatRouting(JSON.parse(row.settings_json)),
      updatedAt: row.updated_at,
    });
  } catch {
    return Object.freeze({ routing: normalizeStoredGoogleChatRouting(null), updatedAt: row.updated_at });
  }
}

export async function saveGoogleChatRouting(
  database: GoogleChatRoutingDatabase,
  routing: GoogleChatRoutingSettings,
  actor: string,
  now: number,
) {
  const stored = {
    routes: routing.routes.map((route) => ({
      eventType: route.eventType,
      enabled: route.enabled,
      spaceKey: route.spaceKey,
    })),
  };
  await database
    .prepare("INSERT INTO workspace_settings (id, shared_drive_id, client_directory_sheet_id, intake_mailbox, settings_json, updated_by, updated_at) VALUES (?, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(GOOGLE_CHAT_ROUTING_SETTINGS_ID, JSON.stringify(stored), actor, now)
    .run();
  return Object.freeze({ routing, updatedAt: now });
}
