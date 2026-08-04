import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import { resetD1GoogleWorkspaceTenant } from "../../../../../../adapters/d1/google-tenant-reset";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import { getGoogleRuntimeConfig } from "../../../../../../lib/google-oauth-sites";
import { noStoreJson as noStore, noStoreResponse } from "../../../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

const TENANT_RESET_BODY_LIMIT = 512;

type StoredTenant = Readonly<{
  id: string;
  google_email: string;
  status: string;
}>;

async function storedTenant(connectionKey: string) {
  return env.DB.prepare("SELECT id, google_email, status FROM google_connections WHERE connection_key = ?")
    .bind(connectionKey)
    .first<StoredTenant>();
}

function workspaceOnly() {
  const config = getGoogleRuntimeConfig();
  if (config.simulation) {
    return {
      config,
      response: noStore(
        { error: "Tenant reset is available only in Google Workspace mode. Simulation reset remains a separate action." },
        { status: 409 },
      ),
    };
  }
  return { config, response: null };
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  const mode = workspaceOnly();
  if (mode.response) return mode.response;
  const tenant = await storedTenant(mode.config.connectionKey);
  return noStore({
    available: tenant?.status === "revoked",
    connectionStatus: tenant?.status ?? "not-connected",
    discardedTenant: tenant?.google_email ?? null,
  });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  await ensureWorkspaceSchema();
  const mode = workspaceOnly();
  if (mode.response) return mode.response;
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: TENANT_RESET_BODY_LIMIT,
    invalidMessage: "Provide the stored Google Workspace account as the tenant reset confirmation.",
    tooLargeMessage: "The tenant reset confirmation is too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  if (
    Object.keys(parsed.body).length !== 1
    || typeof parsed.body.confirmation !== "string"
    || !parsed.body.confirmation.trim()
  ) {
    return noStore({ error: "Provide only a non-empty confirmation field." }, { status: 400 });
  }

  const tenant = await storedTenant(mode.config.connectionKey);
  if (!tenant) {
    return noStore({ error: "There is no saved Google Workspace tenant to reset." }, { status: 409 });
  }
  if (tenant.status !== "revoked") {
    return noStore({ error: "Disconnect the saved Google Workspace connection before starting fresh on a new tenant." }, { status: 409 });
  }
  if (parsed.body.confirmation.trim() !== tenant.google_email) {
    return noStore({ error: `Type ${tenant.google_email} exactly to confirm which tenant will be discarded.` }, { status: 409 });
  }

  const now = Date.now();
  const outcome = await resetD1GoogleWorkspaceTenant(env.DB, {
    connection: {
      id: tenant.id,
      key: mode.config.connectionKey,
      googleEmail: tenant.google_email,
    },
    actor: auth.user.email,
    auditId: crypto.randomUUID(),
    now,
  });
  if (outcome === "stale") {
    return noStore({ error: "The saved connection changed while the reset was being confirmed. Check readiness and try again." }, { status: 409 });
  }

  return noStore({ reset: true, discardedTenant: tenant.google_email });
}
