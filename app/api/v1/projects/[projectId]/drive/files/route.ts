import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../../../adapters/d1/d1-database";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../adapters/d1/workspace-setup-leases";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import {
  GoogleDriveClient,
  PROJECT_FILE_KIND_MIME_TYPES,
  projectFolderCatalog,
  projectFolderPathForKey,
  resolveSimulatedManagedProjectFolderByKey,
  sanitizeDriveFileName,
  type ProjectFileKind,
} from "../../../../../../lib/google-drive";
import {
  GoogleIntegrationError,
  googleIntegrationErrorResponse,
} from "../../../../../../lib/google-integration-error";
import { getEffectiveGoogleRuntimeSetup, getGoogleAccessToken } from "../../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { WORKSPACE_BLUEPRINT_KEY_PATTERN } from "../../../../../../lib/workspace-blueprint";
import { workspaceTemplateTokenValues } from "../../../../../../lib/workspace-templates";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { noStoreJson, noStoreResponse } from "../../../../../../lib/no-store-json";

type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  client_name: string;
  site: string | null;
  estimated_value: number | null;
};

type MappingRow = { drive_file_id: string; drive_url: string };
type RouteContext = { params: Promise<{ projectId: string }> };
type EffectiveSetup = Awaited<ReturnType<typeof getEffectiveGoogleRuntimeSetup>>;

const PROJECT_FILE_KINDS = new Set<ProjectFileKind>(["doc", "sheet", "slides"]);
const MAX_FILE_NAME_LENGTH = 180;
const MAX_BODY_BYTES = 2_000;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function validatedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_FILE_NAME_LENGTH || hasControlCharacter(normalized)) return null;
  const sanitized = sanitizeDriveFileName(normalized, "");
  return sanitized && /[\p{L}\p{N}\p{S}]/u.test(sanitized) ? sanitized : null;
}

function optionalKey(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || !WORKSPACE_BLUEPRINT_KEY_PATTERN.test(value)) return { ok: false };
  return { ok: true, value };
}

function registeredTemplates(setup: EffectiveSetup) {
  return setup.blueprint.templates.flatMap((template) => {
    // Template token merging currently supports Google Docs only. Do not offer
    // Sheets or Slides templates until their native merge path is implemented;
    // copying the seeded budget Sheet would otherwise preserve literal tokens.
    if (template.kind !== "doc") return [];
    const resource = setup.resources.find((candidate) => (
      candidate.resourceType === "drive.file"
      && candidate.resourceKey === template.key
    ));
    const expectedMimeType = PROJECT_FILE_KIND_MIME_TYPES[template.kind];
    if (
      !resource
      || !resource.externalId.trim()
      || resource.metadata.kind !== template.kind
      || resource.metadata.metadataMimeType !== expectedMimeType
    ) {
      return [];
    }
    return [Object.freeze({
      key: template.key,
      name: template.name,
      kind: template.kind,
      fileId: resource.externalId,
    })];
  });
}

async function projectAndMapping(connectionKey: string, projectId: string) {
  const project = await env.DB.prepare(
    "SELECT p.id, p.project_number, p.name, p.site, p.estimated_value, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?",
  )
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) return { project: null, mapping: null } as const;
  const mapping = await env.DB.prepare(
    "SELECT drive_file_id, drive_url FROM drive_folder_mappings WHERE connection_key = ? AND entity_type = 'project' AND entity_id = ? AND folder_key = 'project-root'",
  )
    .bind(connectionKey, project.id)
    .first<MappingRow>();
  return { project, mapping } as const;
}

/**
 * Returns an office-safe creation catalog. It exposes only current blueprint
 * template identities with an exact registered Google type and leaf project
 * destinations; no admin blueprint payload or provider identifiers are returned.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);

  await ensureWorkspaceSchema();
  const setup = await getEffectiveGoogleRuntimeSetup();
  const { projectId } = await context.params;
  const { project, mapping } = await projectAndMapping(setup.config.connectionKey, projectId);
  if (!project) return noStoreJson({ error: "Project not found." }, { status: 404 });

  return noStoreJson({
    provisioned: Boolean(
      setup.config.connectReady
      && setup.config.drive.rootFolderId
      && mapping?.drive_file_id,
    ),
    templates: registeredTemplates(setup).map(({ key, name, kind }) => ({ key, name, kind })),
    folders: projectFolderCatalog(setup.blueprint),
  });
}

/**
 * Creates one Google-native file (Doc, Sheet, or Slides) inside a project's
 * already-provisioned Drive folder — blank via files.create or from a registered
 * blueprint template via files.copy. This is routine project work, so it is
 * office-gated rather than admin-gated, and it never provisions folders itself:
 * an unprovisioned project is turned away with provision-first guidance.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_BODY_BYTES,
    invalidMessage: "Provide a valid new-document request.",
    tooLargeMessage: "The new-document request is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);

  const body = parsed.body;
  const unexpectedKey = Object.keys(body).find((key) => !["kind", "name", "templateKey", "folderKey"].includes(key));
  if (unexpectedKey) return noStoreJson({ error: `Unexpected field: ${unexpectedKey}.` }, { status: 400 });

  const kind = body.kind;
  if (typeof kind !== "string" || !PROJECT_FILE_KINDS.has(kind as ProjectFileKind)) {
    return noStoreJson({ error: "Choose a document, spreadsheet, or slides file." }, { status: 400 });
  }
  const name = validatedName(body.name);
  if (!name) return noStoreJson({ error: "Enter a document name of 180 characters or fewer." }, { status: 400 });
  const template = optionalKey(body.templateKey);
  if (!template.ok) return noStoreJson({ error: "Choose a valid template." }, { status: 400 });
  const folder = optionalKey(body.folderKey);
  if (!folder.ok) return noStoreJson({ error: "Choose a valid project folder." }, { status: 400 });
  const templateKey = template.value;
  const folderKey = folder.value;

  await ensureWorkspaceSchema();
  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint } = setup;
  if (!config.connectReady || !config.drive.rootFolderId) {
    return noStoreJson({ error: "Google Drive setup is incomplete.", missing: config.missing }, { status: 409 });
  }

  const { projectId } = await context.params;
  const { project, mapping } = await projectAndMapping(config.connectionKey, projectId);
  if (!project) return noStoreJson({ error: "Project not found." }, { status: 404 });
  if (!mapping) {
    return noStoreJson({
      error: "This project does not have a Google Drive folder yet. Provision the project folder first.",
      code: "project_drive_workspace_required",
    }, { status: 409 });
  }

  // Validate the destination folder key against the blueprint before any provider
  // work so a document can never target a folder the blueprint does not define.
  let folderPath: readonly string[] | null = null;
  if (folderKey) {
    folderPath = projectFolderPathForKey(blueprint, folderKey);
    if (!folderPath) return noStoreJson({ error: "Choose a valid project folder." }, { status: 400 });
  }

  // A template create can only copy a template already registered in Drive by the
  // SET-17 registry; an unknown or type-mismatched template fails closed.
  let templateFileId: string | null = null;
  if (templateKey) {
    const defined = blueprint.templates.find((candidate) => candidate.key === templateKey);
    if (!defined) {
      return noStoreJson({ error: "Choose a valid template.", code: "template_not_defined" }, { status: 400 });
    }
    if (defined.kind !== kind) {
      return noStoreJson({ error: "The selected template does not match the chosen file type." }, { status: 400 });
    }
    const registered = registeredTemplates(setup).find((candidate) => candidate.key === templateKey);
    if (!registered) {
      return noStoreJson({ error: "Choose a valid template.", code: "template_not_registered" }, { status: 400 });
    }
    templateFileId = registered.fileId;
  }

  let providerFileCreated = false;
  const database = env.DB as unknown as D1Database;
  let lease: WorkspaceSetupLease | null = null;
  try {
    if (!config.simulation) {
      lease = await acquireWorkspaceSetupLease(database, {
        id: crypto.randomUUID(),
        connectionKey: config.workspaceConnectionKey,
        action: `project-file-create:${project.id}`,
        scopeKey: `project-file:${project.id}`,
        actor: auth.user.email,
        now: Date.now(),
        connectionFence: googleConnectionLeaseFence(config),
      });
      if (!lease) {
        return noStoreJson({
          error: "The Google connection changed or another project file is already being created. Try again.",
          code: "project_file_create_in_progress",
        }, { status: 409 });
      }
    }
    let file: { id: string; name: string; url: string };

    if (config.simulation) {
      // Simulation never contacts Google: the destination folder is validated
      // against the blueprint and fixture identifiers are returned in its place.
      if (mapping.drive_file_id !== `sim-project-${project.id}`) {
        throw new GoogleIntegrationError(
          "invalid_project_drive_folder",
          "The project does not have a managed Google Drive workspace.",
          409,
        );
      }
      if (folderKey) resolveSimulatedManagedProjectFolderByKey(mapping.drive_file_id, blueprint, folderKey);
      const fileId = `sim-project-file-${encodeURIComponent(project.id)}-${templateKey ? `copy-${encodeURIComponent(templateKey)}` : kind}-${crypto.randomUUID()}`;
      file = {
        id: fileId,
        name,
        url: `${request.nextUrl.origin}/?workspace-simulation=project-file&project=${encodeURIComponent(project.id)}&file=${encodeURIComponent(fileId)}`,
      };
    } else {
      const drive = new GoogleDriveClient(await getGoogleAccessToken(config, "drive"), config);
      const parentId = folderPath
        ? (await drive.resolveManagedProjectFolderPath(mapping.drive_file_id, folderPath, project.id)).id
        : (await drive.resolveManagedProjectRoot(mapping.drive_file_id, project.id)).id;
      if (templateFileId && templateKey) {
        file = await drive.copyTemplateFile({
          templateFileId,
          templateKey,
          parentId,
          name,
          kind: kind as ProjectFileKind,
        });
        providerFileCreated = true;
        if (kind === "doc") {
          await drive.replaceDocumentTemplateTokens(
            file.id,
            workspaceTemplateTokenValues({
              clientName: project.client_name,
              siteAddress: project.site,
              estimatedValue: project.estimated_value,
            }),
          );
        }
      } else {
        file = await drive.createProjectFile({
          parentId,
          name,
          kind: kind as ProjectFileKind,
        });
        providerFileCreated = true;
      }
    }

    const createdAt = Date.now();
    const detail = `kind=${kind};source=${templateKey ? `template:${templateKey}` : "blank"}${folderKey ? `;folder=${folderKey}` : ""}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(
          crypto.randomUUID(),
          project.id,
          config.simulation ? "workspace_simulation.project_file_created" : "google_drive.project_file_created",
          auth.user.email,
          config.simulation
            ? `Simulated ${kind} created in the project folder; no Google data changed`
            : `${kind} created in the Google Drive project folder`,
          createdAt,
        ),
      env.DB.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          crypto.randomUUID(),
          config.connectionKey,
          "drive.file_created",
          auth.user.email,
          "project",
          project.id,
          `mode=${config.simulation ? "simulation" : "workspace"};${detail}`,
          createdAt,
        ),
    ]);

    if (lease) {
      await completeWorkspaceSetupLease(database, lease, Date.now());
      lease = null;
    }

    return noStoreJson({
      created: true,
      ...(config.simulation ? { simulated: true } : {}),
      file: { id: file.id, name: file.name, url: file.url, kind },
      environment: config.environment,
    }, { status: 201 });
  } catch (error) {
    let responseError = error;
    if (providerFileCreated) {
      const code = error instanceof GoogleIntegrationError ? error.code : "project_file_create_failed";
      try {
        await env.DB.prepare("INSERT INTO google_integration_events (id, connection_key, event_type, actor, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(
            crypto.randomUUID(),
            config.connectionKey,
            "drive.file_create_failed",
            auth.user.email,
            "project",
            project.id,
            `mode=workspace;kind=${kind};source=${templateKey ? `template:${templateKey}` : "blank"};code=${code};provider_file_preserved=true`,
            Date.now(),
          )
          .run();
      } catch (auditError) {
        responseError = auditError;
      }
    }
    if (lease) {
      await failWorkspaceSetupLease(database, lease, "project_file_create_failed", Date.now());
      lease = null;
    }
    return noStoreResponse(googleIntegrationErrorResponse(responseError, "The document could not be created in the project folder. Try again."));
  }
}
