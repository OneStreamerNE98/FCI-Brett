import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import { getGoogleRuntimeConfig } from "../../../../../lib/google-oauth-sites";
import { noStoreJson, noStoreResponse } from "../../../../../lib/no-store-json";
import { requireOfficeUser } from "../../../../../lib/workspace-auth";

const RESULT_LIMIT = 50;
const QUERY_LIMIT = RESULT_LIMIT + 1;

type DriveOperationRow = Readonly<{
  id: string;
  operation_key: string;
  project_id: string;
  status: string;
  lease_expires_at: number | null;
  last_error_code: string | null;
  updated_at: number;
}>;

type FailedArchiveRow = Readonly<{
  id: string;
  gmail_message_id: string;
  project_id: string;
  status: string;
  last_error_code: string | null;
  updated_at: number;
}>;

type IntegrationEventRow = Readonly<{
  id: string;
  event_type: string;
  actor: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: string | null;
  created_at: number;
}>;

function boundedText(value: string | null, maximumLength: number) {
  if (value === null) return null;
  return value.slice(0, maximumLength);
}

function boundedRows<T>(rows: readonly T[]) {
  return {
    rows: rows.slice(0, RESULT_LIMIT),
    hasMore: rows.length > RESULT_LIMIT,
  };
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  const config = getGoogleRuntimeConfig();
  const checkedAt = Date.now();
  const [driveResult, archiveResult, eventResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, operation_key, project_id, status, lease_expires_at, last_error_code, updated_at
       FROM google_drive_operations
       WHERE connection_key = ?
         AND (
           status = 'failed'
           OR (
             status IN ('in-progress', 'committing')
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?
           )
         )
       ORDER BY updated_at DESC, id DESC
       LIMIT ${QUERY_LIMIT}`,
    ).bind(config.connectionKey, checkedAt).all<DriveOperationRow>(),
    env.DB.prepare(
      `SELECT id, gmail_message_id, project_id, status, last_error_code, updated_at
       FROM gmail_file_archives
       WHERE connection_key = ? AND status = 'failed'
       ORDER BY updated_at DESC, id DESC
       LIMIT ${QUERY_LIMIT}`,
    ).bind(config.connectionKey).all<FailedArchiveRow>(),
    env.DB.prepare(
      `SELECT id, event_type, actor, entity_type, entity_id, detail, created_at
       FROM google_integration_events
       WHERE connection_key = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ${QUERY_LIMIT}`,
    ).bind(config.connectionKey).all<IntegrationEventRow>(),
  ]);

  const driveOperations = boundedRows(driveResult.results).rows.map((row) => ({
    id: boundedText(row.id, 200),
    operationKey: boundedText(row.operation_key, 300),
    projectId: boundedText(row.project_id, 200),
    condition: row.status === "failed" ? "failed" as const : "stuck" as const,
    status: boundedText(row.status, 80),
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: boundedText(row.last_error_code, 200),
    updatedAt: row.updated_at,
  }));
  const failedArchives = boundedRows(archiveResult.results).rows.map((row) => ({
    id: boundedText(row.id, 200),
    gmailMessageId: boundedText(row.gmail_message_id, 300),
    projectId: boundedText(row.project_id, 200),
    status: boundedText(row.status, 80),
    lastErrorCode: boundedText(row.last_error_code, 200),
    updatedAt: row.updated_at,
  }));
  const events = boundedRows(eventResult.results).rows.map((row) => ({
    id: boundedText(row.id, 200),
    eventType: boundedText(row.event_type, 200),
    actor: boundedText(row.actor, 254),
    entityType: boundedText(row.entity_type, 100),
    entityId: boundedText(row.entity_id, 200),
    detail: boundedText(row.detail, 1_000),
    createdAt: row.created_at,
  }));

  return noStoreJson({
    runtimeMode: config.environment,
    simulation: config.simulation,
    checkedAt,
    limits: { perCategory: RESULT_LIMIT },
    driveOperations: {
      items: driveOperations,
      hasMore: driveResult.results.length > RESULT_LIMIT,
    },
    failedArchives: {
      items: failedArchives,
      hasMore: archiveResult.results.length > RESULT_LIMIT,
    },
    events: {
      items: events,
      hasMore: eventResult.results.length > RESULT_LIMIT,
    },
  });
}
