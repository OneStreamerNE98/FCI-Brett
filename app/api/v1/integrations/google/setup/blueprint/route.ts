import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import {
  getWorkspaceBlueprint,
  saveWorkspaceBlueprint,
} from "../../../../../../adapters/d1/workspace-blueprints";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import { getGoogleRuntimeConfig } from "../../../../../../lib/google-oauth-sites";
import {
  sanitizeWorkspaceBlueprint,
  seedWorkspaceBlueprint,
  summarizeWorkspaceBlueprintChanges,
  WorkspaceBlueprintValidationError,
} from "../../../../../../lib/workspace-blueprint";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

const MAXIMUM_BLUEPRINT_BODY_BYTES = 64 * 1024;
const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

function invalidBody(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: RESPONSE_HEADERS });
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const config = getGoogleRuntimeConfig();
  const persisted = await getWorkspaceBlueprint(env.DB, config.connectionKey);
  return NextResponse.json({
    blueprint: persisted?.blueprint ?? seedWorkspaceBlueprint(),
    version: persisted?.version ?? 0,
    seeded: persisted === null,
  }, { headers: RESPONSE_HEADERS });
}

export async function PUT(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAXIMUM_BLUEPRINT_BODY_BYTES,
    invalidMessage: "Provide a valid Workspace blueprint and expectedVersion.",
    tooLargeMessage: "The Workspace blueprint request is too large.",
  });
  if (!parsed.ok) return invalidBody(parsed.error, parsed.status);

  const keys = Object.keys(parsed.body);
  if (keys.length !== 2 || !keys.includes("blueprint") || !keys.includes("expectedVersion")) {
    return invalidBody("Provide only blueprint and expectedVersion.");
  }
  const expectedVersion = parsed.body.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) {
    return invalidBody("expectedVersion must be a non-negative whole number.");
  }

  let blueprint;
  try {
    blueprint = sanitizeWorkspaceBlueprint(parsed.body.blueprint);
  } catch (error) {
    if (error instanceof WorkspaceBlueprintValidationError) {
      return NextResponse.json({ error: error.message, path: error.path }, { status: 400, headers: RESPONSE_HEADERS });
    }
    throw error;
  }

  const config = getGoogleRuntimeConfig();
  const previous = await getWorkspaceBlueprint(env.DB, config.connectionKey);
  const changeSummary = summarizeWorkspaceBlueprintChanges(previous?.blueprint ?? seedWorkspaceBlueprint(), blueprint);
  const result = await saveWorkspaceBlueprint(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    expectedVersion: expectedVersion as number,
    blueprint,
    actor: auth.user.email,
    now: Date.now(),
    auditEvent: {
      id: crypto.randomUUID(),
      eventType: "setup.blueprint_updated",
      entityType: "workspace-blueprint",
      entityId: config.connectionKey,
      detail: `version=${(expectedVersion as number) + 1};${changeSummary}`,
    },
  });
  if (!result.saved) {
    return NextResponse.json({
      error: "The Workspace blueprint changed after this editor loaded. Load the latest version before saving again.",
      code: "workspace_blueprint_version_conflict",
      currentVersion: result.currentVersion,
    }, { status: 409, headers: RESPONSE_HEADERS });
  }
  return NextResponse.json({
    blueprint: result.record.blueprint,
    version: result.record.version,
    seeded: false,
  }, { headers: RESPONSE_HEADERS });
}
