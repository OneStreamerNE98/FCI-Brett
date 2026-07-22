import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { createD1ClientRepository } from "../../../adapters/d1/client-repository";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createDirectoryMirror } from "../../../adapters/google/directory-mirror";
import { createClient } from "../../../application/create-client";
import { creationAuthorizationFor, CREATION_CAPABILITIES } from "../../../application/creation-authorization";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { clientCreationHttpResult } from "../../../lib/creation-http-result";
import { getEffectiveGoogleRuntimeSetup, getGoogleRuntimeConfig } from "../../../lib/google-oauth-sites";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets-sites";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";

const MAX_CLIENT_BODY_BYTES = 64_000;

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  // Folder links are connection-scoped so simulation and the live Shared Drive
  // can never expose each other's mappings.
  const result = await env.DB.prepare("SELECT c.id, c.client_code, c.name, c.status, c.industry, c.created_by, c.created_at, c.updated_at, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url, COUNT(p.id) AS project_count, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_name, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_email FROM clients c LEFT JOIN projects p ON p.client_id = c.id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'client' AND m.entity_id = c.id AND m.folder_key = 'client-root' GROUP BY c.id ORDER BY c.name ASC").bind(config.connectionKey).all();
  return noStore({ clients: result.results });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_CLIENT_BODY_BYTES,
    invalidMessage: "Client details must be valid JSON.",
    tooLargeMessage: "Client details are too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });

  const result = await createClient(
    parsed.body,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [CREATION_CAPABILITIES.createClient],
    }),
    {
      repository: createD1ClientRepository(env.DB as unknown as D1Database),
      directoryMirror: createDirectoryMirror(async (actor) => (
        trySyncGoogleDirectory((await getEffectiveGoogleRuntimeSetup()).config, actor)
      )),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
  );
  const httpResult = clientCreationHttpResult(result);
  return noStore(httpResult.body, { status: httpResult.status });
}
