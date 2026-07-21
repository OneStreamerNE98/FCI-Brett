import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import { GoogleDriveClient, type DriveSharedDrive } from "../../../../../../../lib/google-drive";
import { mapGoogleIntegrationError } from "../../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
} from "../../../../../../../lib/google-oauth-sites";
import { GoogleIntegrationError } from "../../../../../../../lib/google-oauth";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../../_workspace-data";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const mapped = mapGoogleIntegrationError(error, "The Shared Drive could not be adopted or verified. Try again.");
  return response(mapped.body, mapped.status);
}

function driveId(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{10,200}$/u.test(normalized) ? normalized : null;
}

function simulationDrive(): DriveSharedDrive {
  return Object.freeze({
    id: "workspace-simulation-shared-drive",
    name: "FCI Operations",
    url: "/settings?section=google-workspace&workspace-simulation=shared-drive",
    restrictions: Object.freeze({
      adminManagedRestrictions: true,
      copyRequiresWriterPermission: true,
      domainUsersOnly: true,
      driveMembersOnly: true,
      sharingFoldersRequiresOrganizerPermission: true,
    }),
  });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: 8_000,
    invalidMessage: "Provide an optional Shared Drive ID as valid JSON.",
    tooLargeMessage: "The Shared Drive adoption request is too large.",
  });
  if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
  if (Object.keys(parsed.body).some((key) => key !== "driveId")) {
    return response({ error: "Provide only driveId when selecting a Shared Drive." }, 400);
  }
  const requestedDriveId = driveId(parsed.body.driveId);
  if (requestedDriveId === null) return response({ error: "Choose a valid Shared Drive ID." }, 400);

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, resources } = setup;
  if (!config.connectReady) {
    return response({ error: "Complete the Google connection prerequisites before adopting a Shared Drive.", missing: config.missing }, 409);
  }
  const existing = resources.find((resource) => resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary");
  const now = Date.now();
  const lease = await acquireWorkspaceSetupLease(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    action: "shared-drive-adopt",
    scopeKey: "primary",
    actor: auth.user.email,
    now,
  });
  if (!lease) return response({ error: "A Shared Drive setup request is already in progress. Try again shortly.", code: "workspace_setup_lease_conflict" }, 409);

  try {
    let adopted: DriveSharedDrive;
    let origin: "adopted" | "env-adopted";
    if (config.simulation) {
      adopted = { ...simulationDrive(), name: blueprint.drive.sharedDriveName };
      origin = "adopted";
    } else {
      const client = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
      const effectiveDriveId = requestedDriveId ?? config.drive.rootFolderId;
      if (effectiveDriveId) {
        adopted = await client.getSharedDrive(effectiveDriveId);
        origin = !requestedDriveId && (
          existing?.origin === "env-adopted"
          || (!existing && config.drive.rootFolderId === effectiveDriveId)
        )
          ? "env-adopted"
          : "adopted";
      } else {
        const matches = await client.findSharedDriveByName(blueprint.drive.sharedDriveName);
        if (matches.length === 0) {
          await completeWorkspaceSetupLease(env.DB, lease, Date.now());
          return response({
            error: `No Shared Drive named ${blueprint.drive.sharedDriveName} was found. Create it manually using the Workspace resources checklist, then try again.`,
            code: "shared_drive_not_found",
          }, 404);
        }
        if (matches.length > 1) {
          await completeWorkspaceSetupLease(env.DB, lease, Date.now());
          return response({
            error: "More than one Shared Drive has the blueprint name. Choose the exact drive before adopting it.",
            code: "shared_drive_ambiguous",
            candidates: matches.map((candidate) => ({ id: candidate.id, name: candidate.name, url: candidate.url, restrictions: candidate.restrictions })),
          }, 409);
        }
        adopted = matches[0];
        origin = "adopted";
      }
    }

    const completedAt = Date.now();
    await upsertWorkspaceResource(env.DB, {
      id: existing?.id ?? crypto.randomUUID(),
      connectionKey: config.connectionKey,
      resourceType: "drive.shared-drive",
      resourceKey: "primary",
      externalId: adopted.id,
      externalUrl: adopted.url,
      origin,
      metadata: { name: adopted.name, restrictions: adopted.restrictions },
      createdBy: existing?.createdBy ?? auth.user.email,
      createdAt: existing?.createdAt ?? completedAt,
      updatedAt: completedAt,
    });
    await writeGoogleIntegrationEvent(
      config,
      "setup.shared_drive_adopted",
      auth.user.email,
      "drive.shared-drive",
      adopted.id,
      `origin=${origin};domainUsersOnly=${String(adopted.restrictions.domainUsersOnly)}`,
    );
    await completeWorkspaceSetupLease(env.DB, lease, completedAt);
    return response({ adopted: true, verified: true, simulated: config.simulation, origin, drive: adopted });
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "shared_drive_adopt_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return errorResponse(error);
  }
}
