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
  /** When present, atomically writes (or clears) the saved Sheet-id tier. */
  clientDirectorySheetId?: string | null;
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
   * resource IDs are preserved unless the corresponding optional scalar is
   * explicitly present on the merge input.
   */
  mergeSettings(input: WorkspaceSettingsMerge): Promise<void>;
}
