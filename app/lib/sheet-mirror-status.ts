export type SheetMirrorStatus = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  clients: { status: string; lastSyncedAt: number | null; lastError: string | null };
  projects: { status: string; lastSyncedAt: number | null; lastError: string | null };
  lastSyncedAt: number | null;
  reason: string | null;
  source: "app" | "env" | "none";
};

const SHEET_MIRROR_STATUS_LABELS = {
  checking: "Checking sync",
  syncing: "Syncing",
  attention: "Needs attention",
  synced: "Synced",
  notSynced: "Not synced",
} as const;

export function sheetMirrorStatusLabel(
  mirror: SheetMirrorStatus | null,
  entity?: "clients" | "projects",
) {
  if (!mirror) return SHEET_MIRROR_STATUS_LABELS.checking;

  const statuses = entity
    ? [mirror[entity].status]
    : [mirror.clients.status, mirror.projects.status];

  if (statuses.includes("syncing")) return SHEET_MIRROR_STATUS_LABELS.syncing;
  if (mirror.reason || statuses.includes("failed")) return SHEET_MIRROR_STATUS_LABELS.attention;
  if (statuses.every((status) => status === "synced")) return SHEET_MIRROR_STATUS_LABELS.synced;
  return SHEET_MIRROR_STATUS_LABELS.notSynced;
}
