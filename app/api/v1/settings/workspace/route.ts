import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1WorkspaceSettingsRepository } from "../../../../adapters/d1/workspace-settings-repository";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeWorkspacePreferences,
  WORKSPACE_SETTINGS_ID,
} from "../../../../domain/workspace-settings";
import type { WorkspaceSettingsRepository } from "../../../../ports/workspace-settings-repository";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";

const MAX_WORKSPACE_SETTINGS_BODY_BYTES = 8_000;

async function readSettings(repository: WorkspaceSettingsRepository) {
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  if (!record) return { settings: DEFAULT_WORKSPACE_PREFERENCES, updatedAt: null };
  return {
    settings: normalizeWorkspacePreferences(record.settings),
    updatedAt: record.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const repository = createD1WorkspaceSettingsRepository(
    env.DB as unknown as D1Database,
  );
  return NextResponse.json(await readSettings(repository), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_WORKSPACE_SETTINGS_BODY_BYTES,
    invalidMessage: "Send a valid settings object.",
    tooLargeMessage: "Settings update is too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const settings = normalizeWorkspacePreferences(parsed.body);
  const now = Date.now();
  const repository = createD1WorkspaceSettingsRepository(
    env.DB as unknown as D1Database,
  );
  await repository.upsert({
    id: WORKSPACE_SETTINGS_ID,
    settings,
    updatedBy: auth.user.email,
    updatedAt: now,
  });
  return NextResponse.json({ settings, updatedAt: now }, { headers: { "Cache-Control": "no-store" } });
}
