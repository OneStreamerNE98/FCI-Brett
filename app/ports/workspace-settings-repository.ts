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

export type WorkspaceSettingsUpsert = Readonly<{
  id: string;
  settings: WorkspaceSettingsDocument;
  updatedBy: string;
  updatedAt: number;
}>;

export interface WorkspaceSettingsRepository {
  findById(id: string): Promise<WorkspaceSettingsRecord | null>;
  /**
   * Updates only the settings document and audit metadata. Existing scalar
   * Workspace resource IDs are deliberately preserved.
   */
  upsert(input: WorkspaceSettingsUpsert): Promise<void>;
}
