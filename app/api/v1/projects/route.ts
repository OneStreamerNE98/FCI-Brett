import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1ProjectRepository } from "../../../adapters/d1/project-repository";
import { createDirectoryMirror } from "../../../adapters/google/directory-mirror";
import { creationAuthorizationFor, CREATION_CAPABILITIES } from "../../../application/creation-authorization";
import { assignProjectManager, createProject } from "../../../application/create-project";
import { normalizeProjectManagerId } from "../../../domain/project-creation";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { officeIdentityForEmail, requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets";

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
  const query = "SELECT p.id, p.project_number, p.client_id, p.name, p.status, p.site, p.project_manager, p.estimated_value, p.created_by, p.created_at, p.updated_at, c.name AS client_name, c.client_code, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url FROM projects p JOIN clients c ON c.id = p.client_id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'project' AND m.entity_id = p.id AND m.folder_key = 'project-root'" + (clientId ? " WHERE p.client_id = ?" : "") + " ORDER BY p.updated_at DESC";
  const statement = env.DB.prepare(query);
  const result = clientId ? await statement.bind(config.connectionKey, clientId).all() : await statement.bind(config.connectionKey).all();
  const projects = result.results.map((row: unknown) => {
    const record = row as Record<string, unknown>;
    const projectManagerId = authorizedProjectManagerId(record.project_manager, auth.user.email);
    return { ...record, project_manager: projectManagerId, project_manager_id: projectManagerId };
  });
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Project details must be valid JSON." }, { status: 400 });
  }

  const result = await createProject(
    body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [CREATION_CAPABILITIES.createProject],
    }),
    {
      repository: createD1ProjectRepository(env.DB as unknown as D1Database),
      directoryMirror: createDirectoryMirror((actor) => trySyncGoogleDirectory(getGoogleRuntimeConfig(), actor)),
      resolveProjectManagerId: (candidateId) => authorizedProjectManagerId(candidateId, auth.user.email),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  if (!result.ok) {
    const status = result.kind === "client-not-found" ? 404 : result.kind === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json(result.value, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Project manager correction must be valid JSON." }, { status: 400 });
  }

  const result = await assignProjectManager(
    body,
    { actorId: auth.user.email, canManageProjects: true },
    {
      repository: createD1ProjectRepository(env.DB as unknown as D1Database),
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
