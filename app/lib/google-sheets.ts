import { env } from "cloudflare:workers";
import {
  GoogleIntegrationError,
  getGoogleAccessToken,
  type GoogleRuntimeConfig,
  writeGoogleIntegrationEvent,
} from "./google-oauth";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const CLIENT_DIRECTORY_TAB = "Client Directory";
const PROJECT_REGISTER_TAB = "Project Register";
const CLIENT_HEADERS = [
  "Client Code", "Client / Company", "Status", "Primary Contact", "Email", "Phone",
  "Client Folder Link", "Active Project Count", "Account Notes", "Last Updated", "FCI Client ID",
];
const PROJECT_HEADERS = [
  "FCI Project ID", "Project Number", "Project Name", "Client Code", "Client / Company", "Status",
  "Project Manager", "Site", "Estimated Value", "Project Folder Link", "Created", "Last Updated",
];

type SheetProperties = { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } };
type SpreadsheetMetadata = { sheets?: Array<{ properties?: SheetProperties }> };
type ValuesResponse = { values?: string[][] };

type ClientMirrorRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  industry: string | null;
  primaryContact: string | null;
  email: string | null;
  phone: string | null;
  driveUrl: string | null;
  projectCount: number;
  updatedAt: number;
};

type ProjectMirrorRow = {
  id: string;
  number: string;
  name: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  status: string;
  projectManager: string | null;
  site: string | null;
  estimatedValue: number | null;
  driveUrl: string | null;
  createdAt: number;
  updatedAt: number;
};

type MirrorStateRow = {
  entity_type: "clients" | "projects";
  status: string;
  last_synced_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_attempt_at: number | null;
};

export type GoogleSheetMirrorStatus = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  clients: { status: string; lastSyncedAt: number | null; lastError: string | null };
  projects: { status: string; lastSyncedAt: number | null; lastError: string | null };
  lastSyncedAt: number | null;
  reason: string | null;
};

export type GoogleSheetSyncResult = {
  clients: { inserted: number; updated: number; total: number };
  projects: { total: number };
  spreadsheetUrl: string;
  completedAt: number;
};

function sheetUrl(spreadsheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}

function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}

function statusLabel(value: string) {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function timestamp(value: number) {
  return new Date(value).toISOString();
}

function range(tab: string, cells: string) {
  return `'${tab.replace(/'/g, "''")}'!${cells}`;
}

function errorDetails(error: unknown) {
  if (error instanceof GoogleIntegrationError) return { code: error.code, message: error.message };
  return { code: "sheets_sync_failed", message: "Google Sheets could not complete the directory sync. Try again." };
}

export class GoogleSheetsClient {
  constructor(private readonly accessToken: string, private readonly spreadsheetId: string) {}

  private async request<T>(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetch(`${SHEETS_API}/${encodeURIComponent(this.spreadsheetId)}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new GoogleIntegrationError("sheets_unavailable", "Google Sheets is temporarily unavailable. Try again.", 503);
    }
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && data) return data as T;
    if (response.status === 401) throw new GoogleIntegrationError("sheets_reauthorization_required", "Google authorization needs to be reconnected before Sheets can sync.", 409);
    if (response.status === 403) throw new GoogleIntegrationError("sheets_permission_denied", "Enable the Google Sheets API for this Google Cloud project and confirm the approved account can edit the Client Directory spreadsheet.", 403);
    if (response.status === 404) throw new GoogleIntegrationError("sheets_not_found", "The configured Client Directory spreadsheet could not be found.", 404);
    if (response.status === 429) throw new GoogleIntegrationError("sheets_rate_limited", "Google Sheets is temporarily rate-limited. Try again shortly.", 429);
    throw new GoogleIntegrationError("sheets_request_failed", "Google Sheets could not complete that operation. Try again.", 503);
  }

  metadata() {
    return this.request<SpreadsheetMetadata>("?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))");
  }

  values(sheetRange: string) {
    return this.request<ValuesResponse>(`/values/${encodeURIComponent(sheetRange)}?majorDimension=ROWS`);
  }

  update(sheetRange: string, values: string[][]) {
    return this.request<Record<string, unknown>>(`/values/${encodeURIComponent(sheetRange)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ majorDimension: "ROWS", values }),
    });
  }

  append(sheetRange: string, values: string[][]) {
    return this.request<Record<string, unknown>>(`/values/${encodeURIComponent(sheetRange)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ majorDimension: "ROWS", values }),
    });
  }

  batchValues(data: Array<{ range: string; values: string[][] }>) {
    return this.request<Record<string, unknown>>("/values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
  }

  clear(sheetRange: string) {
    return this.request<Record<string, unknown>>(`/values/${encodeURIComponent(sheetRange)}:clear`, { method: "POST", body: "{}" });
  }

  batchUpdate(requests: Record<string, unknown>[]) {
    return this.request<Record<string, unknown>>(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  }
}

function sheetProperties(metadata: SpreadsheetMetadata, title: string) {
  return metadata.sheets?.map((sheet) => sheet.properties).find((properties): properties is SheetProperties => properties?.title === title) ?? null;
}

async function ensureSheetTabs(client: GoogleSheetsClient) {
  let metadata = await client.metadata();
  const clientDirectory = sheetProperties(metadata, CLIENT_DIRECTORY_TAB);
  const projectRegister = sheetProperties(metadata, PROJECT_REGISTER_TAB);
  if (!clientDirectory || !projectRegister) {
    const requests: Record<string, unknown>[] = [];
    if (!clientDirectory) requests.push({ addSheet: { properties: { title: CLIENT_DIRECTORY_TAB, gridProperties: { rowCount: 1000, columnCount: CLIENT_HEADERS.length } } } });
    if (!projectRegister) requests.push({ addSheet: { properties: { title: PROJECT_REGISTER_TAB, gridProperties: { rowCount: 1000, columnCount: PROJECT_HEADERS.length } } } });
    await client.batchUpdate(requests);
    metadata = await client.metadata();
  }
  const clientSheet = sheetProperties(metadata, CLIENT_DIRECTORY_TAB);
  const projectSheet = sheetProperties(metadata, PROJECT_REGISTER_TAB);
  if (!clientSheet || !projectSheet) throw new GoogleIntegrationError("sheets_tab_creation_failed", "Google Sheets did not create the directory tabs. Try again.", 503);
  return { clientSheet, projectSheet };
}

async function ensureHeaders(client: GoogleSheetsClient, clientSheet: SheetProperties, projectSheet: SheetProperties) {
  const [clientHeaderResponse, projectHeaderResponse] = await Promise.all([
    client.values(range(CLIENT_DIRECTORY_TAB, "A1:K1")),
    client.values(range(PROJECT_REGISTER_TAB, "A1:L1")),
  ]);
  const existingClientHeaders = clientHeaderResponse.values?.[0] ?? [];
  const existingProjectHeaders = projectHeaderResponse.values?.[0] ?? [];
  if (existingClientHeaders.some(Boolean) && (existingClientHeaders[0] !== CLIENT_HEADERS[0] || existingClientHeaders[1] !== CLIENT_HEADERS[1])) {
    throw new GoogleIntegrationError("client_directory_schema_mismatch", "The Client Directory tab has unexpected first columns. Restore Client Code and Client / Company before syncing.", 409);
  }
  const updates: Array<{ range: string; values: string[][] }> = [];
  if (!existingClientHeaders.some(Boolean) || existingClientHeaders[10] !== CLIENT_HEADERS[10]) {
    updates.push({ range: range(CLIENT_DIRECTORY_TAB, "A1:K1"), values: [CLIENT_HEADERS] });
  }
  if (!existingProjectHeaders.some(Boolean) || existingProjectHeaders.join("\u0000") !== PROJECT_HEADERS.join("\u0000")) {
    updates.push({ range: range(PROJECT_REGISTER_TAB, "A1:L1"), values: [PROJECT_HEADERS] });
  }
  if (updates.length) await client.batchValues(updates);

  await client.batchUpdate([
    { updateSheetProperties: { properties: { sheetId: clientSheet.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { updateSheetProperties: { properties: { sheetId: projectSheet.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { updateDimensionProperties: { range: { sheetId: clientSheet.sheetId, dimension: "COLUMNS", startIndex: 10, endIndex: 11 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
    { updateDimensionProperties: { range: { sheetId: projectSheet.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
  ]);
}

async function loadClientRows(connectionKey: string) {
  const result = await env.DB.prepare("SELECT c.id, c.client_code AS code, c.name, c.status, c.industry, c.updated_at AS updatedAt, m.drive_url AS driveUrl, COUNT(p.id) AS projectCount, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primaryContact, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS email, (SELECT phone FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS phone FROM clients c LEFT JOIN projects p ON p.client_id = c.id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'client' AND m.entity_id = c.id AND m.folder_key = 'client-root' GROUP BY c.id ORDER BY c.name ASC")
    .bind(connectionKey)
    .all<ClientMirrorRow>();
  return result.results ?? [];
}

async function loadProjectRows(connectionKey: string) {
  const result = await env.DB.prepare("SELECT p.id, p.project_number AS number, p.name, p.client_id AS clientId, p.status, p.site, p.project_manager AS projectManager, p.estimated_value AS estimatedValue, p.created_at AS createdAt, p.updated_at AS updatedAt, c.client_code AS clientCode, c.name AS clientName, m.drive_url AS driveUrl FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'project' AND m.entity_id = p.id AND m.folder_key = 'project-root' ORDER BY p.created_at ASC")
    .bind(connectionKey)
    .all<ProjectMirrorRow>();
  return result.results ?? [];
}

function clientCells(row: ClientMirrorRow) {
  return [
    cell(row.code), cell(row.name), statusLabel(row.status), cell(row.primaryContact), cell(row.email), cell(row.phone),
    cell(row.driveUrl), cell(row.projectCount), "", timestamp(row.updatedAt), cell(row.id),
  ];
}

function projectCells(row: ProjectMirrorRow) {
  return [
    cell(row.id), cell(row.number), cell(row.name), cell(row.clientCode), cell(row.clientName), statusLabel(row.status),
    cell(row.projectManager), cell(row.site), row.estimatedValue === null ? "" : cell(row.estimatedValue), cell(row.driveUrl),
    timestamp(row.createdAt), timestamp(row.updatedAt),
  ];
}

async function syncClientDirectory(client: GoogleSheetsClient, rows: ClientMirrorRow[]) {
  const existing = await client.values(range(CLIENT_DIRECTORY_TAB, "A1:K1000"));
  const sheetRows = existing.values ?? [];
  const byId = new Map<string, number>();
  const byCode = new Map<string, number>();
  for (let index = 1; index < sheetRows.length; index += 1) {
    const row = sheetRows[index] ?? [];
    const sheetRow = index + 1;
    const id = row[10]?.trim();
    const code = row[0]?.trim();
    if (id) {
      if (byId.has(id)) throw new GoogleIntegrationError("client_directory_duplicate_id", "The Client Directory contains duplicate FCI Client IDs. Remove the duplicate before syncing.", 409);
      byId.set(id, sheetRow);
    }
    if (code) {
      if (byCode.has(code)) throw new GoogleIntegrationError("client_directory_duplicate_code", "The Client Directory contains duplicate client codes. Remove the duplicate before syncing.", 409);
      byCode.set(code, sheetRow);
    }
  }
  const updates: Array<{ range: string; values: string[][] }> = [];
  const additions: string[][] = [];
  let updated = 0;
  for (const row of rows) {
    const existingRow = byId.get(row.id) ?? byCode.get(row.code);
    if (!existingRow) {
      additions.push(clientCells(row));
      continue;
    }
    const values = clientCells(row);
    // Account Notes is intentionally spreadsheet-owned. We never overwrite column I.
    updates.push({ range: range(CLIENT_DIRECTORY_TAB, `A${existingRow}:H${existingRow}`), values: [values.slice(0, 8)] });
    updates.push({ range: range(CLIENT_DIRECTORY_TAB, `J${existingRow}:K${existingRow}`), values: [[values[9], values[10]]] });
    updated += 1;
  }
  if (updates.length) await client.batchValues(updates);
  if (additions.length) await client.append(range(CLIENT_DIRECTORY_TAB, "A:K"), additions);
  return { inserted: additions.length, updated, total: rows.length };
}

async function syncProjectRegister(client: GoogleSheetsClient, rows: ProjectMirrorRow[]) {
  await client.clear(range(PROJECT_REGISTER_TAB, "A2:L"));
  if (rows.length) await client.update(range(PROJECT_REGISTER_TAB, `A2:L${rows.length + 1}`), rows.map(projectCells));
  return { total: rows.length };
}

async function updateSyncState(config: GoogleRuntimeConfig, entityType: "clients" | "projects", state: { status: string; syncedAt?: number | null; error?: { code: string; message: string } | null; actor: string }) {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO google_sheet_sync_state (connection_key, entity_type, status, last_synced_at, last_error_code, last_error_message, last_attempt_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_key, entity_type) DO UPDATE SET status = excluded.status, last_synced_at = excluded.last_synced_at, last_error_code = excluded.last_error_code, last_error_message = excluded.last_error_message, last_attempt_at = excluded.last_attempt_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(config.connectionKey, entityType, state.status, state.syncedAt ?? null, state.error?.code ?? null, state.error?.message ?? null, now, state.actor, now)
    .run();
}

function configuredMirrorError(config: GoogleRuntimeConfig) {
  if (config.clientDirectorySheetIdInvalid) return new GoogleIntegrationError("invalid_sheet_id", "The Client Directory spreadsheet ID is invalid. Check the Google test profile configuration.", 503);
  if (!config.clientDirectorySheetId) return new GoogleIntegrationError("sheet_not_configured", "Set the Client Directory spreadsheet ID before syncing clients and projects.", 409);
  if (!config.sheetsEnabled) return new GoogleIntegrationError("sheets_not_enabled", "Enable the Sheets service for this Google profile, then reconnect Google.", 409);
  return null;
}

export async function syncGoogleDirectory(config: GoogleRuntimeConfig, actor: string): Promise<GoogleSheetSyncResult> {
  const configurationError = configuredMirrorError(config);
  if (configurationError) throw configurationError;
  const spreadsheetId = config.clientDirectorySheetId!;
  await Promise.all([
    updateSyncState(config, "clients", { status: "syncing", actor }),
    updateSyncState(config, "projects", { status: "syncing", actor }),
  ]);
  try {
    const accessToken = await getGoogleAccessToken(config, "sheets");
    const client = new GoogleSheetsClient(accessToken, spreadsheetId);
    const { clientSheet, projectSheet } = await ensureSheetTabs(client);
    await ensureHeaders(client, clientSheet, projectSheet);
    const [clients, projects] = await Promise.all([loadClientRows(config.connectionKey), loadProjectRows(config.connectionKey)]);
    const clientResult = await syncClientDirectory(client, clients);
    const projectResult = await syncProjectRegister(client, projects);
    const completedAt = Date.now();
    await Promise.all([
      updateSyncState(config, "clients", { status: "synced", syncedAt: completedAt, actor }),
      updateSyncState(config, "projects", { status: "synced", syncedAt: completedAt, actor }),
    ]);
    await writeGoogleIntegrationEvent(config, "sheets.directory.synced", actor, "google-sheet", spreadsheetId, JSON.stringify({ clients: clientResult.total, projects: projectResult.total }));
    return { clients: clientResult, projects: projectResult, spreadsheetUrl: sheetUrl(spreadsheetId), completedAt };
  } catch (error) {
    const detail = errorDetails(error);
    await Promise.all([
      updateSyncState(config, "clients", { status: "failed", error: detail, actor }),
      updateSyncState(config, "projects", { status: "failed", error: detail, actor }),
    ]);
    await writeGoogleIntegrationEvent(config, "sheets.directory.failed", actor, "google-sheet", spreadsheetId, detail.code);
    throw error;
  }
}

export async function trySyncGoogleDirectory(config: GoogleRuntimeConfig, actor: string) {
  if (configuredMirrorError(config)) return { status: "not-configured" as const, message: "The Google Sheet mirror is not configured yet." };
  try {
    const result = await syncGoogleDirectory(config, actor);
    return { status: "synced" as const, message: "Saved and synced to Google Sheets.", result };
  } catch (error) {
    const detail = errorDetails(error);
    return { status: "pending" as const, message: `Saved in FCI Operations; Google Sheet sync needs attention: ${detail.message}`, error: detail };
  }
}

export async function getGoogleSheetMirrorStatus(config: GoogleRuntimeConfig, connection: { services: { sheets: boolean } }): Promise<GoogleSheetMirrorStatus> {
  const states = await env.DB.prepare("SELECT entity_type, status, last_synced_at, last_error_code, last_error_message, last_attempt_at FROM google_sheet_sync_state WHERE connection_key = ?")
    .bind(config.connectionKey)
    .all<MirrorStateRow>();
  const byType = new Map((states.results ?? []).map((state) => [state.entity_type, state]));
  const clients = byType.get("clients");
  const projects = byType.get("projects");
  const configured = Boolean(config.clientDirectorySheetId) && !config.clientDirectorySheetIdInvalid;
  const enabled = config.sheetsEnabled;
  const connected = connection.services.sheets;
  let reason: string | null = null;
  if (config.clientDirectorySheetIdInvalid) reason = "The configured spreadsheet ID is invalid.";
  else if (!configured) reason = "Add the Client Directory spreadsheet ID to the active Google profile.";
  else if (!enabled) reason = "Enable Google Sheets for the active profile, then reconnect Google.";
  else if (!connected) reason = "Reconnect Google and approve the Sheets permission.";
  const lastSyncedAt = Math.max(clients?.last_synced_at ?? 0, projects?.last_synced_at ?? 0) || null;
  return {
    configured,
    enabled,
    connected,
    spreadsheetUrl: configured ? sheetUrl(config.clientDirectorySheetId!) : null,
    spreadsheetName: configured ? "Client Directory" : null,
    clients: { status: clients?.status ?? "not-synced", lastSyncedAt: clients?.last_synced_at ?? null, lastError: clients?.last_error_message ?? null },
    projects: { status: projects?.status ?? "not-synced", lastSyncedAt: projects?.last_synced_at ?? null, lastError: projects?.last_error_message ?? null },
    lastSyncedAt,
    reason,
  };
}
