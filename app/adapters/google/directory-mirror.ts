import type { DirectoryMirror, DirectoryMirrorResult } from "../../ports/directory-mirror";

export type DirectorySync = (actorId: string) => Promise<unknown>;

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Directory mirror returned invalid ${label}`);
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Directory mirror returned invalid ${label}`);
  return value;
}

function publicSyncResult(value: unknown) {
  const result = record(value, "sync details");
  const clients = record(result.clients, "client sync details");
  const projects = record(result.projects, "project sync details");
  if (result.spreadsheetUrl !== null && typeof result.spreadsheetUrl !== "string") throw new Error("Directory mirror returned an invalid spreadsheet URL");
  return {
    clients: {
      inserted: finiteNumber(clients.inserted, "inserted client count"),
      updated: finiteNumber(clients.updated, "updated client count"),
      total: finiteNumber(clients.total, "total client count"),
    },
    projects: {
      total: finiteNumber(projects.total, "total project count"),
    },
    spreadsheetUrl: result.spreadsheetUrl,
    completedAt: finiteNumber(result.completedAt, "completion time"),
  };
}

function publicError(value: unknown) {
  const error = record(value, "error details");
  if (typeof error.code !== "string" || typeof error.message !== "string") throw new Error("Directory mirror returned invalid error details");
  return { code: error.code, message: error.message };
}

function mapDirectorySyncResult(value: unknown): DirectoryMirrorResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Directory mirror returned an invalid result");
  const result = value as Record<string, unknown>;
  if (typeof result.message !== "string") throw new Error("Directory mirror returned an invalid message");
  if (result.status === "not-configured") return { status: "not-configured", message: result.message };
  if (result.status === "synced") {
    return { status: "synced", message: result.message, result: publicSyncResult(result.result) };
  }
  if (result.status === "pending") {
    return { status: "pending", message: result.message, error: publicError(result.error) };
  }
  throw new Error("Directory mirror returned an unsupported status");
}

export function createDirectoryMirror(syncDirectory: DirectorySync): DirectoryMirror {
  return {
    async requestSync(request) {
      return mapDirectorySyncResult(await syncDirectory(request.actorId));
    },
  };
}
