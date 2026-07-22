import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { upsertWorkspaceResource } from "../../../../../../../adapters/d1/workspace-resources";
import { parseBoundedJsonObject } from "../../../../../../../lib/api-json-body";
import { GoogleDriveClient } from "../../../../../../../lib/google-drive";
import { mapGoogleIntegrationError } from "../../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
} from "../../../../../../../lib/google-oauth-sites";
import { GoogleIntegrationError } from "../../../../../../../lib/google-oauth";
import { flattenWorkspaceRootFolders } from "../../../../../../../lib/workspace-blueprint";
import { renderWorkspaceTemplate } from "../../../../../../../lib/workspace-templates";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../../_workspace-data";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const mapped = mapGoogleIntegrationError(error, "The Workspace templates could not be ensured. Try again.");
  return response(mapped.body, mapped.status);
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  if (request.body) {
    const parsed = await parseBoundedJsonObject(request, {
      maximumBytes: 1_000,
      invalidMessage: "Provide an empty JSON object to ensure the Workspace templates.",
      tooLargeMessage: "The template ensure request is too large.",
    });
    if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
    if (Object.keys(parsed.body).length > 0) return response({ error: "Provide no fields when ensuring the Workspace templates." }, 400);
  }

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, resources } = setup;
  if (!config.connectReady || !config.drive.rootFolderId) {
    return response({ error: "Adopt and verify the Shared Drive before ensuring templates.", code: "shared_drive_not_adopted" }, 409);
  }
  const sharedDrive = resources.find((resource) => resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary");
  if (!sharedDrive) {
    return response({ error: "Adopt the Shared Drive into the app-managed registry before ensuring templates.", code: "shared_drive_not_adopted" }, 409);
  }

  const templateFolder = flattenWorkspaceRootFolders(blueprint).find((folder) => folder.key === "templates");
  if (!templateFolder) {
    return response({
      error: "The Workspace blueprint must define the central Templates folder before templates can be ensured.",
      code: "templates_folder_definition_missing",
    }, 409);
  }
  const existingFoldersByKey = new Map(
    resources
      .filter((resource) => resource.resourceType === "drive.folder")
      .map((resource) => [resource.resourceKey, resource]),
  );
  const parent = templateFolder.parentKey
    ? existingFoldersByKey.get(templateFolder.parentKey)
    : sharedDrive;
  if (!parent) {
    return response({
      error: `Ensure the Shared Drive root folders before templates. Missing parent folder: ${templateFolder.parentKey}.`,
      code: "templates_parent_folder_missing",
    }, 409);
  }

  const lease = await acquireWorkspaceSetupLease(env.DB, {
    id: crypto.randomUUID(),
    connectionKey: config.connectionKey,
    action: "templates",
    scopeKey: "templates",
    actor: auth.user.email,
    now: Date.now(),
  });
  if (!lease) return response({ error: "A template setup request is already in progress. Try again shortly.", code: "workspace_setup_lease_conflict" }, 409);

  try {
    const existingTemplateFolder = existingFoldersByKey.get("templates");
    const existingTemplatesByKey = new Map(
      resources
        .filter((resource) => resource.resourceType === "drive.file")
        .map((resource) => [resource.resourceKey, resource]),
    );
    const drive = config.simulation
      ? null
      : new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
    const ensuredFolder = drive
      ? await drive.ensureBlueprintFolder({
        parentId: parent.externalId,
        key: "templates",
        name: templateFolder.name,
        reuseByName: true,
        appProperties: { fciFolderKind: "templates" },
      })
      : {
        outcome: existingTemplateFolder ? "found" as const : "created" as const,
        folder: {
          id: existingTemplateFolder?.externalId ?? "workspace-simulation-folder-templates",
          name: templateFolder.name,
          url: existingTemplateFolder?.externalUrl ?? "/settings?section=google-workspace&workspace-simulation=folder-templates",
          parents: [parent.externalId],
        },
      };
    const folderCompletedAt = Date.now();
    await upsertWorkspaceResource(env.DB, {
      id: existingTemplateFolder?.id ?? crypto.randomUUID(),
      connectionKey: config.connectionKey,
      resourceType: "drive.folder",
      resourceKey: "templates",
      externalId: ensuredFolder.folder.id,
      parentExternalId: parent.externalId,
      externalUrl: ensuredFolder.folder.url,
      origin: ensuredFolder.outcome === "created"
        ? "created"
        : ensuredFolder.outcome === "adopted"
          ? "adopted"
          : existingTemplateFolder?.origin ?? "adopted",
      metadata: {
        name: ensuredFolder.folder.name,
        path: templateFolder.path,
        management: templateFolder.management,
        folderKind: "templates",
      },
      createdBy: existingTemplateFolder?.createdBy ?? auth.user.email,
      createdAt: existingTemplateFolder?.createdAt ?? folderCompletedAt,
      updatedAt: folderCompletedAt,
    });

    const results: Array<{
      key: string;
      name: string;
      kind: "doc" | "sheet";
      management: "owner";
      targetFolderKey: string;
      outcome: "found" | "created" | "adopted";
      id: string;
      url: string;
    }> = [];
    for (const template of blueprint.templates) {
      const rendered = renderWorkspaceTemplate(template, blueprint.business.displayName);
      const existing = existingTemplatesByKey.get(template.key);
      const ensured = drive
        ? await drive.findOrUploadManagedFile({
          parentId: ensuredFolder.folder.id,
          name: template.name,
          mimeType: rendered.metadataMimeType,
          mediaMimeType: rendered.mediaMimeType,
          bytes: rendered.bytes,
          appProperties: { fciTemplateKey: template.key },
        })
        : {
          created: !existing,
          file: {
            id: existing?.externalId ?? `workspace-simulation-template-${template.key}`,
            name: template.name,
            mimeType: rendered.metadataMimeType,
            parents: [ensuredFolder.folder.id],
            url: existing?.externalUrl ?? `/settings?section=google-workspace&workspace-simulation=template-${encodeURIComponent(template.key)}`,
            appProperties: { fciTemplateKey: template.key },
            checksum: null,
            size: rendered.bytes.byteLength,
          },
        };
      if (ensured.file.mimeType !== rendered.metadataMimeType) {
        throw new GoogleIntegrationError(
          "invalid_blueprint_template",
          `The blueprint identity ${template.key} belongs to a file with the wrong Google template type.`,
          409,
        );
      }
      const outcome = ensured.created
        ? "created" as const
        : existing?.externalId === ensured.file.id
          ? "found" as const
          : "adopted" as const;
      const completedAt = Date.now();
      await upsertWorkspaceResource(env.DB, {
        id: existing?.id ?? crypto.randomUUID(),
        connectionKey: config.connectionKey,
        resourceType: "drive.file",
        resourceKey: template.key,
        externalId: ensured.file.id,
        parentExternalId: ensuredFolder.folder.id,
        externalUrl: ensured.file.url,
        origin: outcome === "created" ? "created" : outcome === "adopted" ? "adopted" : existing?.origin ?? "adopted",
        metadata: {
          name: ensured.file.name,
          kind: template.kind,
          management: template.management,
          targetFolderKey: template.targetFolderKey,
          sourceFolderKey: "templates",
          metadataMimeType: rendered.metadataMimeType,
          mediaMimeType: rendered.mediaMimeType,
        },
        createdBy: existing?.createdBy ?? auth.user.email,
        createdAt: existing?.createdAt ?? completedAt,
        updatedAt: completedAt,
      });
      results.push({
        key: template.key,
        name: ensured.file.name,
        kind: template.kind,
        management: template.management,
        targetFolderKey: template.targetFolderKey,
        outcome,
        id: ensured.file.id,
        url: ensured.file.url,
      });
    }

    const counts = results.reduce((summary, item) => {
      summary[item.outcome] += 1;
      return summary;
    }, { found: 0, created: 0, adopted: 0 });
    await writeGoogleIntegrationEvent(
      config,
      "setup.templates_ensured",
      auth.user.email,
      "workspace",
      config.drive.rootFolderId,
      `folder=${ensuredFolder.outcome};found=${counts.found};created=${counts.created};adopted=${counts.adopted};outcomes=${results.map((item) => `${item.key}:${item.outcome}`).join(",")}`,
    );
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    const created = ensuredFolder.outcome === "created" || counts.created > 0;
    return response({
      ensured: true,
      simulated: config.simulation,
      folder: {
        key: "templates",
        name: ensuredFolder.folder.name,
        outcome: ensuredFolder.outcome,
        id: ensuredFolder.folder.id,
        url: ensuredFolder.folder.url,
      },
      counts,
      templates: results,
    }, created ? 201 : 200);
  } catch (error) {
    const code = error instanceof GoogleIntegrationError ? error.code : "templates_ensure_failed";
    await failWorkspaceSetupLease(env.DB, lease, code, Date.now());
    return errorResponse(error);
  }
}
