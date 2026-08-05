import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import { getConnectionScope } from "../../../../../lib/google-oauth-sites";
import { noStoreJson, noStoreResponse } from "../../../../../lib/no-store-json";
import { requireOfficeUser } from "../../../../../lib/workspace-auth";

const RESULT_LIMIT = 50;
const QUERY_LIMIT = RESULT_LIMIT + 1;
const VALID_CATEGORIES = new Set(["drive", "archive", "events"]);

function encodeCursor(parts: Record<string, [number, string]>): string | null {
  const entries = Object.entries(parts).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  return btoa(JSON.stringify(Object.fromEntries(entries)));
}

function decodeCursor(cursor: string | null):
  | { ok: true; data: Record<string, [number, string]> }
  | { ok: false } {
  if (!cursor) return { ok: true, data: {} };
  try {
    const parsed = JSON.parse(atob(cursor));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false };
    }
    const result: Record<string, [number, string]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        Array.isArray(value)
        && value.length === 2
        && typeof value[0] === "number"
        && typeof value[1] === "string"
      ) {
        result[key] = [value[0], value[1]];
      }
    }
    return { ok: true, data: result };
  } catch {
    return { ok: false };
  }
}

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

function cursorClause(
  timestampColumn: string,
  idColumn: string,
  cursor: [number, string] | undefined,
) {
  if (!cursor) return { sql: "", values: [] as (number | string)[] };
  return {
    sql: ` AND (${timestampColumn} < ? OR (${timestampColumn} = ? AND ${idColumn} < ?))`,
    values: [cursor[0], cursor[0], cursor[1]],
  };
}

function nextCursorFor(
  rows: readonly { updated_at?: number; created_at?: number; id: string }[],
  hasMore: boolean,
  key: "d" | "a" | "e",
): string | undefined {
  if (!hasMore || rows.length === 0) return undefined;
  const lastRow = rows[Math.min(rows.length, RESULT_LIMIT) - 1];
  const timestamp = "created_at" in lastRow && lastRow.created_at !== undefined
    ? lastRow.created_at
    : (lastRow.updated_at ?? 0);
  return encodeCursor({ [key]: [timestamp, lastRow.id] }) ?? undefined;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  const { searchParams } = request.nextUrl;
  const cursorParam = searchParams.get("cursor");
  const categoryParam = searchParams.get("category");

  const decoded = decodeCursor(cursorParam);
  if (!decoded.ok) {
    return noStoreJson({ error: "Invalid cursor." }, 400);
  }
  const cursor = decoded.data;

  const rawCategories = categoryParam
    ? categoryParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  if (rawCategories !== null) {
    const invalid = rawCategories.filter((c) => !VALID_CATEGORIES.has(c));
    if (invalid.length > 0 || rawCategories.length === 0) {
      return noStoreJson(
        { error: `Invalid category: ${invalid[0] ?? ""}. Allowed: drive, archive, events.` },
        400,
      );
    }
  }
  const categories = rawCategories ?? ["drive", "archive", "events"];
  const includeDrive = categories.includes("drive");
  const includeArchive = categories.includes("archive");
  const includeEvents = categories.includes("events");

  const config = getConnectionScope();
  const checkedAt = Date.now();

  const driveCursor = cursor.d;
  const driveWhere = cursorClause("updated_at", "id", driveCursor);
  const archiveCursor = cursor.a;
  const archiveWhere = cursorClause("updated_at", "id", archiveCursor);
  const eventCursor = cursor.e;
  const eventWhere = cursorClause("created_at", "id", eventCursor);

  const [driveResult, archiveResult, eventResult] = await Promise.all([
    includeDrive
      ? env.DB.prepare(
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
             )${driveWhere.sql}
           ORDER BY updated_at DESC, id DESC
           LIMIT ${QUERY_LIMIT}`,
        ).bind(config.connectionKey, checkedAt, ...driveWhere.values).all<DriveOperationRow>()
      : Promise.resolve({ results: [] as DriveOperationRow[] }),
    includeArchive
      ? env.DB.prepare(
          `SELECT id, gmail_message_id, project_id, status, last_error_code, updated_at
           FROM gmail_file_archives
           WHERE connection_key = ? AND status = 'failed'${archiveWhere.sql}
           ORDER BY updated_at DESC, id DESC
           LIMIT ${QUERY_LIMIT}`,
        ).bind(config.connectionKey, ...archiveWhere.values).all<FailedArchiveRow>()
      : Promise.resolve({ results: [] as FailedArchiveRow[] }),
    includeEvents
      ? env.DB.prepare(
          `SELECT id, event_type, actor, entity_type, entity_id, detail, created_at
           FROM google_integration_events
           WHERE connection_key = ?${eventWhere.sql}
           ORDER BY created_at DESC, id DESC
           LIMIT ${QUERY_LIMIT}`,
        ).bind(config.connectionKey, ...eventWhere.values).all<IntegrationEventRow>()
      : Promise.resolve({ results: [] as IntegrationEventRow[] }),
  ]);

  const driveBounded = boundedRows(driveResult.results);
  const driveOperations = driveBounded.rows.map((row) => ({
    id: boundedText(row.id, 200),
    operationKey: boundedText(row.operation_key, 300),
    projectId: boundedText(row.project_id, 200),
    condition: row.status === "failed" ? "failed" as const : "stuck" as const,
    status: boundedText(row.status, 80),
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: boundedText(row.last_error_code, 200),
    updatedAt: row.updated_at,
  }));
  const archiveBounded = boundedRows(archiveResult.results);
  const failedArchives = archiveBounded.rows.map((row) => ({
    id: boundedText(row.id, 200),
    gmailMessageId: boundedText(row.gmail_message_id, 300),
    projectId: boundedText(row.project_id, 200),
    status: boundedText(row.status, 80),
    lastErrorCode: boundedText(row.last_error_code, 200),
    updatedAt: row.updated_at,
  }));
  const eventBounded = boundedRows(eventResult.results);
  const events = eventBounded.rows.map((row) => ({
    id: boundedText(row.id, 200),
    eventType: boundedText(row.event_type, 200),
    actor: boundedText(row.actor, 254),
    entityType: boundedText(row.entity_type, 100),
    entityId: boundedText(row.entity_id, 200),
    detail: boundedText(row.detail, 1_000),
    createdAt: row.created_at,
  }));

  return noStoreJson({
    runtimeMode: config.simulation ? "simulation" : "workspace",
    simulation: config.simulation,
    checkedAt,
    limits: { perCategory: RESULT_LIMIT },
    driveOperations: {
      items: driveOperations,
      hasMore: driveResult.results.length > RESULT_LIMIT,
      nextCursor: nextCursorFor(driveResult.results, driveResult.results.length > RESULT_LIMIT, "d"),
    },
    failedArchives: {
      items: failedArchives,
      hasMore: archiveResult.results.length > RESULT_LIMIT,
      nextCursor: nextCursorFor(archiveResult.results, archiveResult.results.length > RESULT_LIMIT, "a"),
    },
    events: {
      items: events,
      hasMore: eventResult.results.length > RESULT_LIMIT,
      nextCursor: nextCursorFor(eventResult.results, eventResult.results.length > RESULT_LIMIT, "e"),
    },
  });
}
