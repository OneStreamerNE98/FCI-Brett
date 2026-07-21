type D1RunResultLike = Readonly<{ meta?: Readonly<{ changes?: number }> }>;

type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResultLike>;
};

export type D1WorkspaceSetupLeaseDatabase = Readonly<{
  prepare(sql: string): D1PreparedStatementLike;
}>;

export type WorkspaceSetupLease = Readonly<{
  operationKey: string;
  leaseExpiresAt: number;
}>;

const LEASE_DURATION_MS = 5 * 60 * 1_000;

/** Uses the established Drive-operation row as a five-minute setup lease. */
export async function acquireWorkspaceSetupLease(
  database: D1WorkspaceSetupLeaseDatabase,
  input: Readonly<{
    id: string;
    connectionKey: string;
    action: string;
    scopeKey: string;
    actor: string;
    now: number;
  }>,
): Promise<WorkspaceSetupLease | null> {
  const operationKey = `${input.connectionKey}:setup:${input.action}`;
  const leaseExpiresAt = input.now + LEASE_DURATION_MS;
  const result = await database.prepare(
    "INSERT INTO google_drive_operations (id, connection_key, operation_key, project_id, status, lease_expires_at, last_error_code, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'in-progress', ?, NULL, ?, ?, ?) ON CONFLICT(operation_key) DO UPDATE SET status = 'in-progress', lease_expires_at = excluded.lease_expires_at, last_error_code = NULL, created_by = excluded.created_by, updated_at = excluded.updated_at WHERE google_drive_operations.status != 'in-progress' OR google_drive_operations.lease_expires_at < ?",
  ).bind(
    input.id,
    input.connectionKey,
    operationKey,
    `workspace-setup:${input.scopeKey}`,
    leaseExpiresAt,
    input.actor,
    input.now,
    input.now,
    input.now,
  ).run();
  if (result.meta?.changes !== 1) return null;
  return Object.freeze({ operationKey, leaseExpiresAt });
}

export async function completeWorkspaceSetupLease(
  database: D1WorkspaceSetupLeaseDatabase,
  lease: WorkspaceSetupLease,
  now: number,
) {
  await database.prepare(
    "UPDATE google_drive_operations SET status = 'completed', lease_expires_at = NULL, last_error_code = NULL, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?",
  ).bind(now, lease.operationKey, lease.leaseExpiresAt).run();
}

export async function failWorkspaceSetupLease(
  database: D1WorkspaceSetupLeaseDatabase,
  lease: WorkspaceSetupLease,
  errorCode: string,
  now: number,
) {
  await database.prepare(
    "UPDATE google_drive_operations SET status = 'failed', lease_expires_at = NULL, last_error_code = ?, updated_at = ? WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?",
  ).bind(errorCode, now, lease.operationKey, lease.leaseExpiresAt).run();
}
