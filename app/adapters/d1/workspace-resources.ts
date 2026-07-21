import type {
  WorkspaceResource,
  WorkspaceResourceOrigin,
  WorkspaceResourceType,
} from "../../lib/workspace-effective-config";

type D1RunResultLike = Readonly<{ meta?: Readonly<{ changes?: number }> }>;

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<D1RunResultLike>;
};

export type D1WorkspaceResourcesDatabase = Readonly<{
  prepare(sql: string): D1PreparedStatementLike;
}>;

export type UpsertWorkspaceResourceInput = Readonly<{
  id: string;
  connectionKey: string;
  resourceType: WorkspaceResourceType;
  resourceKey: string;
  externalId: string;
  parentExternalId?: string | null;
  externalUrl?: string | null;
  origin: WorkspaceResourceOrigin;
  metadata?: Readonly<Record<string, unknown>>;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}>;

type WorkspaceResourceRow = Readonly<{
  id: string;
  connection_key: string;
  resource_type: WorkspaceResourceType;
  resource_key: string;
  external_id: string;
  parent_external_id: string | null;
  external_url: string | null;
  origin: WorkspaceResourceOrigin;
  metadata_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}>;

function metadata(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Stored Workspace resource metadata is invalid.");
  }
  return Object.freeze({ ...parsed }) as Readonly<Record<string, unknown>>;
}

function resource(row: WorkspaceResourceRow): WorkspaceResource {
  return Object.freeze({
    id: row.id,
    connectionKey: row.connection_key,
    resourceType: row.resource_type,
    resourceKey: row.resource_key,
    externalId: row.external_id,
    parentExternalId: row.parent_external_id,
    externalUrl: row.external_url,
    origin: row.origin,
    metadata: metadata(row.metadata_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export type { WorkspaceResource, WorkspaceResourceOrigin, WorkspaceResourceType };

/** Lists one connector profile's resource registry without provider calls. */
export async function listWorkspaceResources(
  database: D1WorkspaceResourcesDatabase,
  connectionKey: string,
): Promise<WorkspaceResource[]> {
  const result = await database.prepare(
    "SELECT id, connection_key, resource_type, resource_key, external_id, parent_external_id, external_url, origin, metadata_json, created_by, created_at, updated_at FROM workspace_resources WHERE connection_key = ? ORDER BY resource_type ASC, resource_key ASC",
  ).bind(connectionKey).all<WorkspaceResourceRow>();
  return result.results.map(resource);
}

/** Upserts by the unique connection + resource type + resource key identity. */
export async function upsertWorkspaceResource(
  database: D1WorkspaceResourcesDatabase,
  input: UpsertWorkspaceResourceInput,
): Promise<WorkspaceResource> {
  await database.prepare(
    "INSERT INTO workspace_resources (id, connection_key, resource_type, resource_key, external_id, parent_external_id, external_url, origin, metadata_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connection_key, resource_type, resource_key) DO UPDATE SET external_id = excluded.external_id, parent_external_id = excluded.parent_external_id, external_url = excluded.external_url, origin = excluded.origin, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at",
  ).bind(
    input.id,
    input.connectionKey,
    input.resourceType,
    input.resourceKey,
    input.externalId,
    input.parentExternalId ?? null,
    input.externalUrl ?? null,
    input.origin,
    JSON.stringify(input.metadata ?? {}),
    input.createdBy,
    input.createdAt,
    input.updatedAt,
  ).run();

  const row = await database.prepare(
    "SELECT id, connection_key, resource_type, resource_key, external_id, parent_external_id, external_url, origin, metadata_json, created_by, created_at, updated_at FROM workspace_resources WHERE connection_key = ? AND resource_type = ? AND resource_key = ?",
  ).bind(input.connectionKey, input.resourceType, input.resourceKey).first<WorkspaceResourceRow>();
  if (!row) throw new TypeError("Workspace resource upsert did not persist a row.");
  return resource(row);
}
