export type DirectoryMirrorRequest = {
  actorId: string;
  cause: "client-created" | "project-created";
  recordId: string;
};

export type DirectoryMirrorSyncSummary = {
  clients: {
    inserted: number;
    updated: number;
    total: number;
  };
  projects: {
    total: number;
  };
  spreadsheetUrl: string | null;
  completedAt: number;
};

export type DirectoryMirrorPublicError = {
  code: string;
  message: string;
};

export type DirectoryMirrorResult =
  | {
      status: "synced";
      message: string;
      result: DirectoryMirrorSyncSummary;
    }
  | {
      status: "not-configured";
      message: string;
    }
  | {
      status: "pending";
      message: string;
      error: DirectoryMirrorPublicError;
    };

export interface DirectoryMirror {
  requestSync(request: DirectoryMirrorRequest): Promise<DirectoryMirrorResult>;
}
