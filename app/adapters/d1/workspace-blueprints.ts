import {
  sanitizeWorkspaceBlueprint,
  type WorkspaceBlueprint,
} from "../../lib/workspace-blueprint";

type D1RunResultLike = Readonly<{ meta?: Readonly<{ changes?: number }> }>;

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  run(): Promise<D1RunResultLike>;
};

export type D1WorkspaceBlueprintsDatabase = Readonly<{
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1RunResultLike[]>;
}>;

type WorkspaceBlueprintRow = Readonly<{
  id: string;
  connection_key: string;
  version: number;
  blueprint_json: string;
  created_by: string;
  created_at: number;
  updated_by: string;
  updated_at: number;
}>;

export type PersistedWorkspaceBlueprint = Readonly<{
  id: string;
  connectionKey: string;
  version: number;
  blueprint: WorkspaceBlueprint;
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
}>;

export type SaveWorkspaceBlueprintInput = Readonly<{
  id: string;
  connectionKey: string;
  expectedVersion: number;
  blueprint: WorkspaceBlueprint;
  actor: string;
  now: number;
  auditEvent: Readonly<{
    id: string;
    eventType: string;
    entityType: string;
    entityId: string;
    detail: string;
  }>;
}>;

export type SaveWorkspaceBlueprintResult =
  | Readonly<{ saved: true; record: PersistedWorkspaceBlueprint }>
  | Readonly<{ saved: false; currentVersion: number }>;

const SELECT_BLUEPRINT = "SELECT id, connection_key, version, blueprint_json, created_by, created_at, updated_by, updated_at FROM workspace_blueprints WHERE connection_key = ?";

function persisted(row: WorkspaceBlueprintRow): PersistedWorkspaceBlueprint {
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new TypeError("Stored Workspace blueprint version is invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.blueprint_json);
  } catch {
    throw new TypeError("Stored Workspace blueprint JSON is invalid.");
  }
  return Object.freeze({
    id: row.id,
    connectionKey: row.connection_key,
    version: row.version,
    blueprint: sanitizeWorkspaceBlueprint(parsed),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
}

export async function getWorkspaceBlueprint(
  database: D1WorkspaceBlueprintsDatabase,
  connectionKey: string,
): Promise<PersistedWorkspaceBlueprint | null> {
  const row = await database.prepare(SELECT_BLUEPRINT).bind(connectionKey).first<WorkspaceBlueprintRow>();
  return row ? persisted(row) : null;
}

/**
 * Atomically inserts version 1 or updates only the exact expected version.
 * A zero-change result is an optimistic-concurrency conflict, never a retry.
 */
export async function saveWorkspaceBlueprint(
  database: D1WorkspaceBlueprintsDatabase,
  input: SaveWorkspaceBlueprintInput,
): Promise<SaveWorkspaceBlueprintResult> {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new TypeError("expectedVersion must be a non-negative safe integer.");
  }
  const nextVersion = input.expectedVersion + 1;
  const blueprintJson = JSON.stringify(input.blueprint);
  // Read fallible identity metadata before the transactional commit. Once the
  // batch succeeds, callers must be able to treat the blueprint as committed
  // without a second D1 read that could fail and trigger unsafe compensation.
  const previous = await getWorkspaceBlueprint(database, input.connectionKey);
  const saveStatement = database.prepare(
    "INSERT INTO workspace_blueprints (id, connection_key, version, blueprint_json, created_by, created_at, updated_by, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM workspace_blueprints WHERE connection_key = ? AND version = ?) ON CONFLICT(connection_key) DO UPDATE SET version = excluded.version, blueprint_json = excluded.blueprint_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at WHERE workspace_blueprints.version = ?",
  ).bind(
    input.id,
    input.connectionKey,
    nextVersion,
    blueprintJson,
    input.actor,
    input.now,
    input.actor,
    input.now,
    input.expectedVersion,
    input.connectionKey,
    input.expectedVersion,
    input.expectedVersion,
  );
  const auditStatement = database.prepare(
    "INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND EXISTS (SELECT 1 FROM workspace_blueprints WHERE connection_key = ? AND version = ? AND updated_by = ? AND updated_at = ? AND blueprint_json = ?)",
  ).bind(
    input.auditEvent.id,
    input.connectionKey,
    input.auditEvent.eventType,
    input.actor,
    input.auditEvent.entityType,
    input.auditEvent.entityId,
    input.auditEvent.detail,
    input.now,
    input.connectionKey,
    nextVersion,
    input.actor,
    input.now,
    blueprintJson,
  );
  // D1 executes a batch transactionally. A failed event insert therefore rolls
  // back the blueprint CAS instead of leaving an unaudited saved version.
  const [result, auditResult] = await database.batch([saveStatement, auditStatement]);

  if (result.meta?.changes === 0) {
    const current = await getWorkspaceBlueprint(database, input.connectionKey);
    return Object.freeze({ saved: false, currentVersion: current?.version ?? 0 });
  }
  if (auditResult.meta?.changes !== 1) {
    throw new TypeError("Workspace blueprint save did not create its audit event.");
  }

  const record = Object.freeze({
    id: previous?.id ?? input.id,
    connectionKey: input.connectionKey,
    version: nextVersion,
    blueprint: input.blueprint,
    createdBy: previous?.createdBy ?? input.actor,
    createdAt: previous?.createdAt ?? input.now,
    updatedBy: input.actor,
    updatedAt: input.now,
  });
  return Object.freeze({ saved: true, record });
}
