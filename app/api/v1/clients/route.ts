import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { createD1ClientRepository } from "../../../adapters/d1/client-repository";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createDirectoryMirror } from "../../../adapters/google/directory-mirror";
import { createClient } from "../../../application/create-client";
import { creationAuthorizationFor, CREATION_CAPABILITIES } from "../../../application/creation-authorization";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  // Folder links are connection-scoped so simulation and the live Shared Drive
  // can never expose each other's mappings.
  const result = await env.DB.prepare("SELECT c.id, c.client_code, c.name, c.status, c.industry, c.created_by, c.created_at, c.updated_at, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url, COUNT(p.id) AS project_count, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_name, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_email FROM clients c LEFT JOIN projects p ON p.client_id = c.id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'client' AND m.entity_id = c.id AND m.folder_key = 'client-root' GROUP BY c.id ORDER BY c.name ASC").bind(config.connectionKey).all();
  return NextResponse.json({ clients: result.results });
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
    return NextResponse.json({ error: "Client details must be valid JSON." }, { status: 400 });
  }

  const result = await createClient(
    body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [CREATION_CAPABILITIES.createClient],
    }),
    {
      repository: createD1ClientRepository(env.DB as unknown as D1Database),
      directoryMirror: createDirectoryMirror((actor) => trySyncGoogleDirectory(getGoogleRuntimeConfig(), actor)),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  if (!result.ok) {
    const status = result.kind === "identifier-collision"
      ? 503
      : result.kind === "duplicate" || result.kind === "idempotency-conflict" || result.kind === "in-progress"
      ? 409
      : result.kind === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json(result.value, { status: 201 });
}
