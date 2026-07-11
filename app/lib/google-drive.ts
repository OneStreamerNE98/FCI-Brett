import { DRIVE_BLUEPRINT } from "./google-workspace";
import { GoogleIntegrationError, type GoogleRuntimeConfig } from "./google-oauth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
  appProperties?: Record<string, string>;
};

type FolderIdentity = { key: string; value: string };

export type DriveFolder = Pick<DriveFile, "id" | "name" | "parents" | "webViewLink">;

function driveQueryString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function folderUrl(file: DriveFile) {
  return file.webViewLink ?? `https://drive.google.com/drive/folders/${file.id}`;
}

export class GoogleDriveClient {
  constructor(private readonly accessToken: string, private readonly config: GoogleRuntimeConfig) {}

  private addDriveOptions(parameters: URLSearchParams) {
    if (this.config.drive.mode === "shared-drive") {
      parameters.set("supportsAllDrives", "true");
      parameters.set("includeItemsFromAllDrives", "true");
      parameters.set("corpora", "drive");
      parameters.set("driveId", this.rootId());
    }
    return parameters;
  }

  private rootId() {
    const root = this.config.drive.rootFolderId;
    if (!root) throw new GoogleIntegrationError("drive_root_missing", "The Google Drive root folder is not configured.", 503);
    return root;
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetch(`${DRIVE_API}/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new GoogleIntegrationError("drive_unavailable", "Google Drive is temporarily unavailable. Try again.", 503);
    }
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !data) {
      if (response.status === 401) throw new GoogleIntegrationError("drive_reauthorization_required", "Google authorization needs to be reconnected.", 409);
      if (response.status === 403) throw new GoogleIntegrationError("drive_permission_denied", "The approved Google account cannot access the configured workspace folder.", 403);
      if (response.status === 404) throw new GoogleIntegrationError("drive_not_found", "The configured workspace folder could not be found.", 404);
      throw new GoogleIntegrationError("drive_request_failed", "Google Drive could not complete that operation. Try again.", 503);
    }
    return data as T;
  }

  private async getFolder(fileId: string) {
    const parameters = this.addDriveOptions(new URLSearchParams({ fields: "id,name,mimeType,parents,trashed,webViewLink,appProperties" }));
    return this.request<DriveFile>(`files/${encodeURIComponent(fileId)}?${parameters.toString()}`);
  }

  async verifyRootFolder() {
    const root = await this.getFolder(this.rootId());
    if (root.mimeType !== FOLDER_MIME_TYPE || root.trashed) {
      throw new GoogleIntegrationError("invalid_drive_root", "The configured workspace root must be an active Google Drive folder.", 409);
    }
    return { id: root.id, name: root.name, url: folderUrl(root) };
  }

  async assertContained(folderId: string) {
    const rootId = this.rootId();
    let currentId = folderId;
    for (let depth = 0; depth < 32; depth += 1) {
      if (currentId === rootId) return;
      const current = await this.getFolder(currentId);
      if (current.mimeType !== FOLDER_MIME_TYPE || current.trashed || !current.parents?.length) break;
      if (current.parents.length !== 1) break;
      currentId = current.parents[0];
    }
    throw new GoogleIntegrationError("drive_root_escape", "A project folder is not contained inside the configured Google workspace root.", 409);
  }

  private async childFolders(parentId: string, name: string, identity?: FolderIdentity) {
    const propertyFilter = identity
      ? ` and appProperties has { key='${driveQueryString(identity.key)}' and value='${driveQueryString(identity.value)}' }`
      : "";
    const q = `'${driveQueryString(parentId)}' in parents and trashed = false and mimeType = '${FOLDER_MIME_TYPE}' and name = '${driveQueryString(name)}'${propertyFilter}`;
    const parameters = this.addDriveOptions(new URLSearchParams({
      q,
      fields: "files(id,name,mimeType,parents,trashed,webViewLink,appProperties)",
      pageSize: "10",
    }));
    const response = await this.request<{ files?: DriveFile[] }>(`files?${parameters.toString()}`);
    return response.files ?? [];
  }

  private async createFolder(parentId: string, name: string, appProperties: Record<string, string> = {}) {
    await this.assertContained(parentId);
    const parameters = this.addDriveOptions(new URLSearchParams({ fields: "id,name,mimeType,parents,trashed,webViewLink,appProperties" }));
    const folder = await this.request<DriveFile>(`files?${parameters.toString()}`, {
      method: "POST",
      body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId], appProperties }),
    });
    await this.assertContained(folder.id);
    return folder;
  }

  private async getOrCreateFolder(parentId: string, name: string, options: { identity?: FolderIdentity; properties?: Record<string, string>; reuseByName?: boolean } = {}) {
    await this.assertContained(parentId);
    const matches = await this.childFolders(parentId, name, options.identity);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new GoogleIntegrationError("duplicate_drive_folder", `More than one managed Google Drive folder matched ${name}.`, 409);
    }
    if (!options.identity && options.reuseByName !== false) {
      const namedMatches = await this.childFolders(parentId, name);
      if (namedMatches.length === 1) return namedMatches[0];
      if (namedMatches.length > 1) {
        throw new GoogleIntegrationError("ambiguous_drive_folder", `More than one Google Drive folder is named ${name}.`, 409);
      }
    }
    return this.createFolder(parentId, name, options.properties);
  }

  async provisionProjectFolders(input: {
    client: { id: string; code: string; name: string };
    project: { id: string; number: string; name: string; year: string };
  }) {
    const root = await this.verifyRootFolder();
    const accountsRoot = await this.getOrCreateFolder(root.id, "01_Client Accounts", { properties: { fciWorkspaceFolder: "client-accounts" } });
    const clientFolder = await this.getOrCreateFolder(accountsRoot.id, `${input.client.code} — ${input.client.name}`, {
      identity: { key: "fciClientId", value: input.client.id },
      properties: { fciClientId: input.client.id, fciFolderKind: "client" },
      reuseByName: false,
    });
    await this.getOrCreateFolder(clientFolder.id, "00_Client Profile & Master Documents", { properties: { fciClientId: input.client.id, fciFolderKind: "client-profile" } });
    await this.getOrCreateFolder(clientFolder.id, "Projects (shortcuts only)", { properties: { fciClientId: input.client.id, fciFolderKind: "client-project-links" } });

    const projectsRoot = await this.getOrCreateFolder(root.id, "02_Projects", { properties: { fciWorkspaceFolder: "projects" } });
    const yearFolder = await this.getOrCreateFolder(projectsRoot.id, input.project.year, { properties: { fciWorkspaceFolder: `projects-${input.project.year}` } });
    const projectFolder = await this.getOrCreateFolder(yearFolder.id, `${input.project.number} — ${input.project.name}`, {
      identity: { key: "fciProjectId", value: input.project.id },
      properties: { fciProjectId: input.project.id, fciFolderKind: "project" },
      reuseByName: false,
    });

    for (const folderPath of DRIVE_BLUEPRINT.projectFolders) {
      let parent = projectFolder;
      const segments = folderPath.split("/").map((segment) => segment.trim()).filter(Boolean);
      for (const segment of segments) {
        parent = await this.getOrCreateFolder(parent.id, segment, {
          properties: { fciProjectId: input.project.id, fciFolderKind: "project-child" },
        });
      }
    }

    return {
      root,
      clientFolder: { id: clientFolder.id, name: clientFolder.name, url: folderUrl(clientFolder) },
      projectFolder: { id: projectFolder.id, name: projectFolder.name, url: folderUrl(projectFolder) },
    };
  }
}
