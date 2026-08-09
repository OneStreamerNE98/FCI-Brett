import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1ProjectRepository } from "../../../adapters/d1/project-repository";
import { createDirectoryMirror } from "../../../adapters/google/directory-mirror";
import { creationAuthorizationFor, CREATION_CAPABILITIES } from "../../../application/creation-authorization";
import { assignProjectManager, createProject } from "../../../application/create-project";
import { recordProjectOperation } from "../../../application/record-project-operation";
import { normalizeProjectManagerId } from "../../../domain/project-creation";
import { resolveProjectSegment } from "../../../domain/project-segment";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { officeIdentityForEmail, requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { projectCreationHttpResult } from "../../../lib/creation-http-result";
import { getConnectionScope, getEffectiveGoogleRuntimeSetup } from "../../../lib/google-oauth-sites";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets-sites";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { encodeCursor, decodeCursor, parsePaginationParams } from "../../../lib/list-cursor";
import type { TimestampKeyset } from "../../../lib/list-cursor";
import {
  releaseFailedAddressMutation,
  resolveAddressMutation,
} from "../../../lib/address-mutation-sites";

const MAX_PROJECT_BODY_BYTES = 64_000;

function authorizedProjectManagerId(candidate: unknown, authenticatedActorId: string) {
  const normalized = normalizeProjectManagerId(candidate);
  if (!normalized.ok) return null;
  if (normalized.value === authenticatedActorId) return normalized.value;
  return officeIdentityForEmail(normalized.value)?.email ?? null;
}

function mapProjectRow(row: Record<string, unknown>, isAdmin: boolean) {
  const projectManagerId = authorizedProjectManagerId(row.project_manager, "");
  const { client_industry: clientIndustry, ...publicRecord } = row;
  return {
    ...publicRecord,
    project_manager: projectManagerId,
    project_manager_id: projectManagerId,
    contract_value: isAdmin ? row.contract_value : null,
    segment: resolveProjectSegment(row.segment, clientIndustry),
  };
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getConnectionScope();
  const clientId = request.nextUrl.searchParams.get("clientId");

  const params = parsePaginationParams(request.nextUrl.searchParams);
  if (!params.ok) return NextResponse.json({ error: params.error }, { status: 400 });

  let cursorTs: number | null = null;
  let cursorId: string | null = null;
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (!decoded.ok || !("updatedAt" in decoded.keyset)) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    const keyset = decoded.keyset as TimestampKeyset;
    cursorTs = keyset.updatedAt;
    cursorId = keyset.id;
  }

  const queryLimit = params.limit + 1; // fetch one extra row to detect has-more

  // Resolve links only from the active provider. Simulation and the company
  // Shared Drive keep independent mappings for the same project.
  const baseQuery =
    "SELECT p.id, p.project_number, p.client_id, p.name, p.status, p.site, p.latitude, p.longitude, p.address_validation_verdict, p.project_manager, p.estimated_value, p.flooring_category, p.square_feet, p.contract_value, p.segment, p.installation_started_at, p.installation_completed_at, p.had_callback, p.callback_note, p.created_by, p.created_at, p.updated_at, CAST(p.version AS TEXT) AS version, c.name AS client_name, c.client_code, c.industry AS client_industry, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN drive_folder_mappings m ON m.connection_key = ?1 AND m.entity_type = 'project' AND m.entity_id = p.id AND m.folder_key = 'project-root'";

  let query: string;
  let result: { results: unknown[] };
  if (clientId) {
    query = `${baseQuery} WHERE p.client_id = ?2 AND (?3 IS NULL OR p.updated_at < ?3 OR (p.updated_at = ?3 AND p.id < ?4)) ORDER BY p.updated_at DESC, p.id DESC LIMIT ?5`;
    result = await env.DB.prepare(query).bind(config.connectionKey, clientId, cursorTs, cursorId, queryLimit).all();
  } else {
    query = `${baseQuery} WHERE ?2 IS NULL OR p.updated_at < ?2 OR (p.updated_at = ?2 AND p.id < ?3) ORDER BY p.updated_at DESC, p.id DESC LIMIT ?4`;
    result = await env.DB.prepare(query).bind(config.connectionKey, cursorTs, cursorId, queryLimit).all();
  }

  const rows = result.results as Record<string, unknown>[];
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const projects = page.map((row) => mapProjectRow(row, auth.user.isAdmin));
  const nextCursor = hasMore
    ? encodeCursor({ updatedAt: page[page.length - 1].updated_at as number, id: page[page.length - 1].id as string })
    : null;

  return NextResponse.json({ projects, nextCursor }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_PROJECT_BODY_BYTES,
    invalidMessage: "Project details must be valid JSON.",
    tooLargeMessage: "Project details are too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!auth.user.isAdmin && parsed.body.contractValue !== undefined && parsed.body.contractValue !== null) {
    return NextResponse.json({ error: "An FCI administrator must record contract value." }, { status: 403 });
  }
  const { addressReview, ...projectBody } = parsed.body;
  const database = env.DB as unknown as D1Database;
  const address = await resolveAddressMutation(database, {
    actorId: auth.user.email,
    entityKind: "project",
    targetId: "new",
    rawAddress: projectBody.site,
    rawReview: addressReview,
  });
  if (!address.ok) return NextResponse.json({ error: address.message }, { status: 400 });
  projectBody.site = address.value.address;

  const result = await createProject(
    projectBody,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [CREATION_CAPABILITIES.createProject],
    }),
    {
      repository: createD1ProjectRepository(database),
      directoryMirror: createDirectoryMirror(async (actor) => (
        trySyncGoogleDirectory((await getEffectiveGoogleRuntimeSetup()).config, actor)
      )),
      resolveProjectManagerId: (candidateId) => authorizedProjectManagerId(candidateId, auth.user.email),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
    address.value,
  );
  if (!result.ok) await releaseFailedAddressMutation(database, address);
  const httpResult = projectCreationHttpResult(result);
  return NextResponse.json(httpResult.body, { status: httpResult.status });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_PROJECT_BODY_BYTES,
    invalidMessage: "Project action must be valid JSON.",
    tooLargeMessage: "Project action is too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const repository = createD1ProjectRepository(env.DB as unknown as D1Database);
  if ("action" in parsed.body) {
    const result = await recordProjectOperation(
      parsed.body,
      { actorId: auth.user.email, canManageProjects: true },
      {
        repository,
        newId: () => crypto.randomUUID(),
        now: () => Date.now(),
      },
    );
    if (!result.ok) {
      const status = result.kind === "project-not-found"
        ? 404
        : result.kind === "forbidden"
          ? 403
          : result.kind === "conflict"
            ? 409
            : 400;
      return NextResponse.json(
        result.kind === "conflict"
          ? { error: result.message, currentVersion: result.currentVersion }
          : { error: result.message },
        { status },
      );
    }
    return NextResponse.json(result.value);
  }

  const result = await assignProjectManager(
    parsed.body,
    { actorId: auth.user.email, canManageProjects: true },
    {
      repository,
      resolveProjectManagerId: (candidateId) => authorizedProjectManagerId(candidateId, auth.user.email),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  if (!result.ok) {
    const status = result.kind === "project-not-found"
      ? 404
      : result.kind === "forbidden"
        ? 403
        : result.kind === "conflict"
          ? 409
          : 400;
    return NextResponse.json(
      result.kind === "conflict"
        ? { error: result.message, currentVersion: result.currentVersion }
        : { error: result.message },
      { status },
    );
  }
  return NextResponse.json(result.value);
}
