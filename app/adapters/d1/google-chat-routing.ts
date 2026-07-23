import {
  normalizeStoredGoogleChatRouting,
  type GoogleChatRoutingSettings,
} from "../../lib/google-chat-notifier";
import { createD1WorkspaceSettingsRepository } from "./workspace-settings-repository";
import type { D1Database } from "./d1-database";

export const GOOGLE_CHAT_ROUTING_SETTINGS_ID = "google-chat-routing";

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
  const repository = createD1WorkspaceSettingsRepository(
    database as unknown as D1Database,
  );
  const record = await repository.findById(GOOGLE_CHAT_ROUTING_SETTINGS_ID);
  return Object.freeze({
    routing: normalizeStoredGoogleChatRouting(record?.settings),
    updatedAt: record?.updatedAt ?? null,
  });
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
  const repository = createD1WorkspaceSettingsRepository(
    database as unknown as D1Database,
  );
  await repository.upsert({
    id: GOOGLE_CHAT_ROUTING_SETTINGS_ID,
    settings: stored,
    updatedBy: actor,
    updatedAt: now,
  });
  return Object.freeze({ routing, updatedAt: now });
}
