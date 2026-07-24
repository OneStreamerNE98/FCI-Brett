export type WorkspaceSettingsDocument = Readonly<Record<string, unknown>>;

export type WorkspaceSettingsRecord = Readonly<{
  id: string;
  sharedDriveId: string | null;
  clientDirectorySheetId: string | null;
  intakeMailbox: string | null;
  settings: WorkspaceSettingsDocument;
  updatedBy: string;
  updatedAt: number;
}>;

export type WorkspaceSettingsMerge = Readonly<{
  id: string;
  /**
   * Only these top-level keys are replaced. Every stored sibling key remains
   * untouched so independently owned settings surfaces cannot overwrite one
   * another from stale read-modify-write snapshots.
   */
  settings: WorkspaceSettingsDocument;
  updatedBy: string;
  updatedAt: number;
}>;

export interface WorkspaceSettingsRepository {
  findById(id: string): Promise<WorkspaceSettingsRecord | null>;
  /**
   * Atomically merges the supplied top-level settings keys and audit metadata
   * in one database statement. Existing sibling keys and scalar Workspace
   * resource IDs are deliberately preserved.
   */
  mergeSettings(input: WorkspaceSettingsMerge): Promise<void>;
}
