import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import { createD1ClientRepository } from "../../../adapters/d1/client-repository";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createDirectoryMirror } from "../../../adapters/google/directory-mirror";
import { createClient } from "../../../application/create-client";
import { creationAuthorizationFor, CREATION_CAPABILITIES } from "../../../application/creation-authorization";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { clientCreationHttpResult } from "../../../lib/creation-http-result";
import { getConnectionScope, getEffectiveGoogleRuntimeSetup } from "../../../lib/google-oauth-sites";
import { trySyncGoogleDirectory } from "../../../lib/google-sheets-sites";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import {
  releaseFailedAddressMutation,
  resolveAddressMutation,
} from "../../../lib/address-mutation-sites";
import { noStoreJson as noStore } from "../../../lib/no-store-json";

const MAX_CLIENT_BODY_BYTES = 64_000;

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const config = getConnectionScope();
  // Folder links are connection-scoped so simulation and the live Shared Drive
  // can never expose each other's mappings.
  const result = await env.DB.prepare("SELECT c.id, c.client_code, c.name, c.status, c.industry, c.site_address, c.latitude, c.longitude, c.address_validation_verdict, c.created_by, c.created_at, c.updated_at, CAST(c.version AS TEXT) AS version, m.drive_file_id AS drive_folder_id, m.drive_url AS drive_url, COUNT(p.id) AS project_count, (SELECT id FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_id, (SELECT name FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_name, (SELECT email FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_email, (SELECT phone FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_phone, (SELECT role FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_role, (SELECT CAST(version AS TEXT) FROM contacts WHERE client_id = c.id ORDER BY is_primary DESC, created_at ASC LIMIT 1) AS primary_contact_version FROM clients c LEFT JOIN projects p ON p.client_id = c.id LEFT JOIN drive_folder_mappings m ON m.connection_key = ? AND m.entity_type = 'client' AND m.entity_id = c.id AND m.folder_key = 'client-root' GROUP BY c.id ORDER BY c.name ASC").bind(config.connectionKey).all();
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
  const { addressReview, ...clientBody } = parsed.body;
  const database = env.DB as unknown as D1Database;
  const address = await resolveAddressMutation(database, {
    actorId: auth.user.email,
    entityKind: "client",
    targetId: "new",
    rawAddress: clientBody.siteAddress,
    rawReview: addressReview,
  });
  if (!address.ok) return noStore({ error: address.message }, { status: 400 });
  clientBody.siteAddress = address.value.address;

  const result = await createClient(
    clientBody,
    creationAuthorizationFor({
      actorId: auth.user.email,
      capabilities: [CREATION_CAPABILITIES.createClient],
    }),
    {
      repository: createD1ClientRepository(database),
      directoryMirror: createDirectoryMirror(async (actor) => (
        trySyncGoogleDirectory((await getEffectiveGoogleRuntimeSetup()).config, actor)
      )),
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    },
    address.value,
  );
  if (!result.ok) await releaseFailedAddressMutation(database, address);
  const httpResult = clientCreationHttpResult(result);
  return noStore(httpResult.body, { status: httpResult.status });
}
