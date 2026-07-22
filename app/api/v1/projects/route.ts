import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1ProjectRepository } from "../../../adapters/d1/project-repository";
import { createDirectoryMirror } from "../../../adapters/google/directory-mirror";
import { creationAuthorizationFor, CREATION_CAPABILITIES } from "../../../application/creation-authorization";
import { assignProjectManager, createProject } from "../../../application/create-project";
import { recordProjectOperation } from "../../../application/record-project-operation";
import { normalizeProjectManagerId } from "../../../domain/project-creation";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { officeIdentityForEmail, requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { projectCreationHttpResult } from "../../../lib/creation-http-result";
import { getEffectiveGoogleRuntimeSetup, getGoogleRuntimeConfig } from "../../../lib/google-oauth-sites";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets-sites";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";

const MAX_PROJECT_BODY_BYTES = 64_000;

function authorizedProjectManagerId(candidate: unknown, authenticatedActorId: string) {
  const normalized = normalizeProjectManagerId(candidate);
  if (!normalized.ok) return null;
  if (normalized.value === authenticatedActorId) return normalized.value;
  return officeIdentityForEmail(normalized.value)?.email ?? null;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  const clientId = request.nextUrl.searchParams.get("clientId");
  // Resolve links only from the active provider. Simulation and the company
  // Shared Drive keep independent mappings for the same project.
  const query = "SELECT p.id, p.project_number, p.client_id, p.name, p.status, p.site, p.project_manager, p.estimated_value, p.flooring_category, p.square_feet, p.contract_value, p.installation_started_at, p.installation_completed_at, p.had_callback, p.callback_note, p.created_by, p.created_at, p.updated_at, c.name AS client_name, c.client_code, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'project' AND m.entity_id = p.id AND m.folder_key = 'project-root'" + (clientId ? " WHERE p.client_id = ?" : "") + " ORDER BY p.updated_at DESC";
  const statement = env.DB.prepare(query);
  const result = clientId ? await statement.bind(config.connectionKey, clientId).all() : await statement.bind(config.connectionKey).all();
  const projects = result.results.map((row: unknown) => {
    const record = row as Record<string, unknown>;
    const projectManagerId = authorizedProjectManagerId(record.project_manager, auth.user.email);
    return {
      ...record,
      project_manager: projectManagerId,
      project_manager_id: projectManagerId,
      contract_value: auth.user.isAdmin ? record.contract_value : null,
    };
  });
  return NextResponse.json({ projects }, { headers: { "Cache-Control": "no-store" } });
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

  const result = await createProject(
    parsed.body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [CREATION_CAPABILITIES.createProject],
    }),
    {
      repository: createD1ProjectRepository(env.DB as unknown as D1Database),
      directoryMirror: createDirectoryMirror(async (actor) => (
        trySyncGoogleDirectory((await getEffectiveGoogleRuntimeSetup()).config, actor)
      )),
      resolveProjectManagerId: (candidateId) => authorizedProjectManagerId(candidateId, auth.user.email),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
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
      const status = result.kind === "project-not-found" ? 404 : result.kind === "forbidden" ? 403 : 400;
      return NextResponse.json({ error: result.message }, { status });
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
    const status = result.kind === "project-not-found" ? 404 : result.kind === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json(result.value);
}
