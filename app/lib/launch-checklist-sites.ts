import { createD1WorkspaceSettingsRepository } from "../adapters/d1/workspace-settings-repository";
import type { D1Database } from "../adapters/d1/d1-database";
import {
  mergeLaunchChecklistIntoSettings,
  normalizeLaunchChecklist,
  type LaunchChecklistItemId,
} from "../domain/launch-checklist";
import { WORKSPACE_SETTINGS_ID } from "../domain/workspace-settings";

export async function readSitesLaunchChecklist(
  database: D1Database,
  canAttest: boolean,
) {
  const repository = createD1WorkspaceSettingsRepository(database);
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  return Object.freeze({
    launchChecklist: normalizeLaunchChecklist(record?.settings.launchChecklist),
    canAttest,
    updatedAt: record?.updatedAt ?? null,
  });
}

export async function saveSitesLaunchChecklist(
  database: D1Database,
  update: Readonly<{ itemId: LaunchChecklistItemId; checked: boolean }>,
  actorEmail: string,
  now: number,
) {
  const repository = createD1WorkspaceSettingsRepository(database);
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  const settings = mergeLaunchChecklistIntoSettings(
    record?.settings ?? {},
    update,
    actorEmail,
    now,
  );
  await repository.mergeSettings({
    id: WORKSPACE_SETTINGS_ID,
    settings: { launchChecklist: settings.launchChecklist },
    updatedBy: actorEmail,
    updatedAt: now,
  });
  return Object.freeze({
    launchChecklist: normalizeLaunchChecklist(settings.launchChecklist),
    canAttest: true,
    updatedAt: now,
  });
}
