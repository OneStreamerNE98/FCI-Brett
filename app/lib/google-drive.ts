import { DRIVE_BLUEPRINT } from "./google-workspace";
import { GoogleIntegrationError, type GoogleFetch, type GoogleRuntimeConfig } from "./google-oauth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DEFAULT_GOOGLE_FETCH: GoogleFetch = (input, init) => globalThis.fetch(input, init);
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const MAX_MANAGED_FILE_BYTES = 20 * 1024 * 1024;
const MAX_MANAGED_APP_PROPERTIES = 12;

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
  appProperties?: Record<string, string>;
  md5Checksum?: string;
  size?: string;
};

type SharedDriveRecord = {
  id: string;
  name: string;
  restrictions?: {
    adminManagedRestrictions?: boolean;
    copyRequiresWriterPermission?: boolean;
    domainUsersOnly?: boolean;
    driveMembersOnly?: boolean;
    sharingFoldersRequiresOrganizerPermission?: boolean;
  };
};

type FolderIdentity = { key: string; value: string };

export type DriveFolder = Pick<DriveFile, "id" | "name" | "parents" | "webViewLink">;

export type DriveSharedDriveRestrictions = Readonly<{
  adminManagedRestrictions: boolean | null;
  copyRequiresWriterPermission: boolean | null;
  domainUsersOnly: boolean | null;
  driveMembersOnly: boolean | null;
  sharingFoldersRequiresOrganizerPermission: boolean | null;
}>;

export type DriveSharedDrive = Readonly<{
  id: string;
  name: string;
  url: string;
  restrictions: DriveSharedDriveRestrictions;
}>;

export type DriveFolderEnsureResult = Readonly<{
  outcome: "found" | "created" | "adopted";
  folder: Readonly<{
    id: string;
    name: string;
    url: string;
    parents: readonly string[];
  }>;
}>;

export type DriveManagedFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  url: string;
  appProperties: Record<string, string>;
  checksum: string | null;
  size: number | null;
};

export type DriveManagedFileLookup = {
  parentId: string;
  appProperties: Record<string, string>;
};

export type DriveManagedFileUpload = DriveManagedFileLookup & {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type DriveManagedFileUploadResult = {
  created: boolean;
  file: DriveManagedFile;
};

function driveQueryString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function folderUrl(file: DriveFile) {
  return file.webViewLink ?? `https://drive.google.com/drive/folders/${file.id}`;
}

function sharedDrive(record: SharedDriveRecord): DriveSharedDrive {
  const restrictions = record.restrictions ?? {};
  const flag = (value: boolean | undefined) => typeof value === "boolean" ? value : null;
  return Object.freeze({
    id: record.id,
    name: record.name,
    url: `https://drive.google.com/drive/folders/${encodeURIComponent(record.id)}`,
    restrictions: Object.freeze({
      adminManagedRestrictions: flag(restrictions.adminManagedRestrictions),
      copyRequiresWriterPermission: flag(restrictions.copyRequiresWriterPermission),
      domainUsersOnly: flag(restrictions.domainUsersOnly),
      driveMembersOnly: flag(restrictions.driveMembersOnly),
      sharingFoldersRequiresOrganizerPermission: flag(restrictions.sharingFoldersRequiresOrganizerPermission),
    }),
  });
}

function fileUrl(file: DriveFile) {
  return file.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
}

function asManagedFile(file: DriveFile): DriveManagedFile {
  const parsedSize = typeof file.size === "string" && /^\d+$/.test(file.size) ? Number(file.size) : null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents ?? [],
    url: fileUrl(file),
    appProperties: file.appProperties ?? {},
    checksum: file.md5Checksum ?? null,
    size: Number.isSafeInteger(parsedSize) ? parsedSize : null,
  };
}

function ensureNonEmptyString(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new GoogleIntegrationError("invalid_drive_upload", `${label} is invalid.`, 400);
  }
  return normalized;
}

function normalizedProjectFolderPath(path: string | readonly string[]) {
  const source = typeof path === "string" ? path.split("/") : [...path];
  const segments = source.map((segment) => typeof segment === "string" ? segment.trim() : "");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(segment))) {
    throw new GoogleIntegrationError("invalid_project_folder_path", "Choose a valid managed project folder path.", 400);
  }
  return segments;
}

function normalizedAppProperties(properties: Record<string, string>) {
  const entries = Object.entries(properties);
  if (!entries.length || entries.length > MAX_MANAGED_APP_PROPERTIES) {
    throw new GoogleIntegrationError("invalid_drive_app_properties", "A managed Drive file needs a small, non-empty set of source properties.", 400);
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(key) || typeof value !== "string") {
      throw new GoogleIntegrationError("invalid_drive_app_properties", "Managed Drive file properties are invalid.", 400);
    }
    normalized[key] = ensureNonEmptyString(value, "A managed Drive file property", 124);
  }
  return normalized;
}

/** Applies a conservative display-name policy before bytes are sent to Google Drive. */
export function sanitizeDriveFileName(value: string, fallback = "file") {
  const clean = (candidate: string) => candidate
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 180)
    .replace(/[.\s]+$/g, "");
  return clean(value) || clean(fallback) || "file";
}

function normalizedMimeType(value: string) {
  const mimeType = value.trim().toLowerCase();
  if (mimeType.length > 128 || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mimeType)) {
    throw new GoogleIntegrationError("invalid_drive_upload", "The Drive upload MIME type is invalid.", 400);
  }
  return mimeType;
}

function multipartUploadBody(metadata: Record<string, unknown>, bytes: Uint8Array, mimeType: string, boundary: string) {
  const encoder = new TextEncoder();
  const prefix = encoder.encode([
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "Content-Transfer-Encoding: binary",
    "",
  ].join("\r\n"));
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const result = new Uint8Array(prefix.byteLength + bytes.byteLength + suffix.byteLength);
  result.set(prefix, 0);
  result.set(bytes, prefix.byteLength);
  result.set(suffix, prefix.byteLength + bytes.byteLength);
  return result;
}

export class GoogleDriveClient {
  constructor(
    private readonly accessToken: string,
    private readonly config: GoogleRuntimeConfig,
    private readonly fetcher: GoogleFetch = DEFAULT_GOOGLE_FETCH,
  ) {}

  /**
   * files.list accepts Shared Drive search selectors in addition to the general
   * supportsAllDrives flag. Do not reuse these selectors for files.get or
   * files.create: Google defines a different query-parameter contract for each
   * method and rejects list-only parameters on those endpoints.
   */
  private addListOptions(parameters: URLSearchParams) {
    if (this.config.drive.mode === "shared-drive") {
      parameters.set("supportsAllDrives", "true");
      parameters.set("includeItemsFromAllDrives", "true");
      parameters.set("corpora", "drive");
      parameters.set("driveId", this.rootId());
    }
    return parameters;
  }

  /** files.get and metadata-only files.create support only this Shared Drive flag. */
  private addFileOptions(parameters: URLSearchParams) {
    if (this.config.drive.mode === "shared-drive") parameters.set("supportsAllDrives", "true");
    return parameters;
  }

  private addUploadOptions(parameters: URLSearchParams) {
    if (this.config.drive.mode === "shared-drive") parameters.set("supportsAllDrives", "true");
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
      response = await this.fetcher(`${DRIVE_API}/${path}`, {
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

  private async uploadRequest<T>(path: string, body: Uint8Array, contentType: string) {
    let response: Response;
    try {
      const uploadBody = Uint8Array.from(body).buffer;
      response = await this.fetcher(`${DRIVE_UPLOAD_API}/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          "Content-Type": contentType,
        },
        body: new Blob([uploadBody], { type: contentType }),
      });
    } catch {
      throw new GoogleIntegrationError("drive_unavailable", "Google Drive is temporarily unavailable. Try again.", 503);
    }
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && data) return data as T;
    if (response.status === 401) throw new GoogleIntegrationError("drive_reauthorization_required", "Google authorization needs to be reconnected.", 409);
    if (response.status === 403) throw new GoogleIntegrationError("drive_permission_denied", "The approved Google account cannot write to the configured workspace folder.", 403);
    if (response.status === 404) throw new GoogleIntegrationError("drive_not_found", "The configured workspace folder could not be found.", 404);
    if (response.status === 429) throw new GoogleIntegrationError("drive_rate_limited", "Google Drive is temporarily rate-limited. Try again shortly.", 429);
    if (response.status >= 400 && response.status < 500) throw new GoogleIntegrationError("drive_upload_rejected", "Google Drive rejected that file upload.", 400);
    throw new GoogleIntegrationError("drive_request_failed", "Google Drive could not complete that operation. Try again.", 503);
  }

  private async getFolder(fileId: string) {
    const parameters = this.addFileOptions(new URLSearchParams({ fields: "id,name,mimeType,parents,trashed,webViewLink,appProperties" }));
    return this.request<DriveFile>(`files/${encodeURIComponent(fileId)}?${parameters.toString()}`);
  }

  /** Reads one Shared Drive and its safe, read-only sharing restriction flags. */
  async getSharedDrive(driveId: string): Promise<DriveSharedDrive> {
    const normalized = ensureNonEmptyString(driveId, "The Shared Drive ID", 200);
    const parameters = new URLSearchParams({
      fields: "id,name,restrictions(adminManagedRestrictions,copyRequiresWriterPermission,domainUsersOnly,driveMembersOnly,sharingFoldersRequiresOrganizerPermission)",
    });
    const result = await this.request<SharedDriveRecord>(`drives/${encodeURIComponent(normalized)}?${parameters.toString()}`);
    if (result.id !== normalized || !result.name) {
      throw new GoogleIntegrationError("invalid_shared_drive", "Google returned an invalid Shared Drive record.", 503);
    }
    return sharedDrive(result);
  }

  /** Returns every exact-name Shared Drive match so callers can reject ambiguity. */
  async findSharedDriveByName(name: string): Promise<DriveSharedDrive[]> {
    const normalized = ensureNonEmptyString(name, "The Shared Drive name", 120);
    const matches: DriveSharedDrive[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const parameters = new URLSearchParams({
        q: `name = '${driveQueryString(normalized)}'`,
        pageSize: "100",
        fields: "nextPageToken,drives(id,name,restrictions(adminManagedRestrictions,copyRequiresWriterPermission,domainUsersOnly,driveMembersOnly,sharingFoldersRequiresOrganizerPermission))",
      });
      if (pageToken) parameters.set("pageToken", pageToken);
      const result = await this.request<{ drives?: SharedDriveRecord[]; nextPageToken?: string }>(`drives?${parameters.toString()}`);
      matches.push(...(result.drives ?? [])
        .filter((record) => record.id && record.name === normalized)
        .map(sharedDrive));
      // The caller only distinguishes zero, one, and ambiguous. Stop once the
      // ambiguity is proven instead of enumerating unnecessary Drive metadata.
      if (matches.length > 1 || !result.nextPageToken) return matches;
      pageToken = result.nextPageToken;
    }
    throw new GoogleIntegrationError("drive_list_incomplete", "Google Drive returned too many Shared Drive pages to verify safely.", 503);
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
    const parameters = this.addListOptions(new URLSearchParams({
      q,
      fields: "files(id,name,mimeType,parents,trashed,webViewLink,appProperties)",
      pageSize: "10",
    }));
    const response = await this.request<{ files?: DriveFile[] }>(`files?${parameters.toString()}`);
    return response.files ?? [];
  }

  private async childFoldersByIdentity(parentId: string, identity: FolderIdentity) {
    const q = `'${driveQueryString(parentId)}' in parents and trashed = false and mimeType = '${FOLDER_MIME_TYPE}' and appProperties has { key='${driveQueryString(identity.key)}' and value='${driveQueryString(identity.value)}' }`;
    const parameters = this.addListOptions(new URLSearchParams({
      q,
      fields: "files(id,name,mimeType,parents,trashed,webViewLink,appProperties)",
      pageSize: "10",
    }));
    const response = await this.request<{ files?: DriveFile[] }>(`files?${parameters.toString()}`);
    return response.files ?? [];
  }

  private async createFolder(parentId: string, name: string, appProperties: Record<string, string> = {}) {
    await this.assertContained(parentId);
    const parameters = this.addFileOptions(new URLSearchParams({ fields: "id,name,mimeType,parents,trashed,webViewLink,appProperties" }));
    const folder = await this.request<DriveFile>(`files?${parameters.toString()}`, {
      method: "POST",
      body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId], appProperties }),
    });
    await this.assertContained(folder.id);
    return folder;
  }

  private async stampFolder(file: DriveFile, properties: Record<string, string>) {
    const parameters = this.addFileOptions(new URLSearchParams({ fields: "id,name,mimeType,parents,trashed,webViewLink,appProperties" }));
    const updated = await this.request<DriveFile>(`files/${encodeURIComponent(file.id)}?${parameters.toString()}`, {
      method: "PATCH",
      body: JSON.stringify({ appProperties: { ...(file.appProperties ?? {}), ...properties } }),
    });
    if (updated.mimeType !== FOLDER_MIME_TYPE || updated.trashed) {
      throw new GoogleIntegrationError("invalid_drive_folder", "Google returned an invalid folder after applying its setup identity.", 503);
    }
    await this.assertContained(updated.id);
    return updated;
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

  /**
   * Ensures one blueprint folder beneath an exact managed parent. A same-name
   * manual folder is adopted only when unambiguous, then stamped with the stable
   * blueprint key so later setup runs are rename-safe and idempotent.
   */
  async ensureBlueprintFolder(input: {
    parentId: string;
    key: string;
    name: string;
    reuseByName?: boolean;
  }): Promise<DriveFolderEnsureResult> {
    const key = ensureNonEmptyString(input.key, "The blueprint folder key", 64);
    const name = ensureNonEmptyString(input.name, "The blueprint folder name", 120);
    if (name.includes("/") || name.includes("\\")) {
      throw new GoogleIntegrationError("invalid_drive_folder_name", "A blueprint folder name cannot contain a path separator.", 400);
    }
    const identity = { key: "fciRootKey", value: key } satisfies FolderIdentity;
    const properties = { fciRootKey: key };
    await this.assertContained(input.parentId);
    const managed = await this.childFoldersByIdentity(input.parentId, identity);
    if (managed.length > 1) {
      throw new GoogleIntegrationError("duplicate_drive_folder", `More than one managed Google Drive folder matched ${name}.`, 409);
    }
    if (managed.length === 1) {
      const folder = managed[0];
      return Object.freeze({
        outcome: "found",
        folder: Object.freeze({ id: folder.id, name: folder.name, url: folderUrl(folder), parents: Object.freeze([...(folder.parents ?? [])]) }),
      });
    }

    if (input.reuseByName !== false) {
      const named = await this.childFolders(input.parentId, name);
      if (named.length > 1) {
        throw new GoogleIntegrationError("ambiguous_drive_folder", `More than one Google Drive folder is named ${name}.`, 409);
      }
      if (named.length === 1) {
        const existingKey = named[0].appProperties?.fciRootKey?.trim();
        if (existingKey && existingKey !== key) {
          throw new GoogleIntegrationError(
            "drive_folder_identity_conflict",
            `The Google Drive folder named ${name} is already managed by another blueprint key. Resolve the duplicate name before retrying.`,
            409,
          );
        }
        if (existingKey === key) {
          const folder = named[0];
          return Object.freeze({
            outcome: "found",
            folder: Object.freeze({ id: folder.id, name: folder.name, url: folderUrl(folder), parents: Object.freeze([...(folder.parents ?? [])]) }),
          });
        }
        const folder = await this.stampFolder(named[0], properties);
        return Object.freeze({
          outcome: "adopted",
          folder: Object.freeze({ id: folder.id, name: folder.name, url: folderUrl(folder), parents: Object.freeze([...(folder.parents ?? [])]) }),
        });
      }
    }

    const folder = await this.createFolder(input.parentId, name, properties);
    return Object.freeze({
      outcome: "created",
      folder: Object.freeze({ id: folder.id, name: folder.name, url: folderUrl(folder), parents: Object.freeze([...(folder.parents ?? [])]) }),
    });
  }

  /** Renames one contained active folder and returns both names for compensation/audit. */
  async renameFolder(folderId: string, name: string) {
    const normalized = ensureNonEmptyString(name, "The blueprint folder name", 120);
    if (normalized.includes("/") || normalized.includes("\\")) {
      throw new GoogleIntegrationError("invalid_drive_folder_name", "A blueprint folder name cannot contain a path separator.", 400);
    }
    await this.assertContained(folderId);
    const current = await this.getFolder(folderId);
    if (current.mimeType !== FOLDER_MIME_TYPE || current.trashed) {
      throw new GoogleIntegrationError("invalid_drive_folder", "Only an active managed folder can be renamed.", 409);
    }
    const parameters = this.addFileOptions(new URLSearchParams({ fields: "id,name,mimeType,parents,trashed,webViewLink,appProperties" }));
    const renamed = await this.request<DriveFile>(`files/${encodeURIComponent(folderId)}?${parameters.toString()}`, {
      method: "PATCH",
      body: JSON.stringify({ name: normalized }),
    });
    if (renamed.id !== folderId || renamed.name !== normalized || renamed.mimeType !== FOLDER_MIME_TYPE || renamed.trashed) {
      throw new GoogleIntegrationError("drive_rename_invalid_response", "Google Drive did not confirm the requested folder name.", 503);
    }
    await this.assertContained(renamed.id);
    return Object.freeze({
      previousName: current.name,
      folder: Object.freeze({ id: renamed.id, name: renamed.name, url: folderUrl(renamed), parents: Object.freeze([...(renamed.parents ?? [])]) }),
    });
  }

  /**
   * Resolves an already-provisioned path beneath a managed project root. This is
   * deliberately read-only: email filing cannot create a project folder by typo.
   */
  async resolveManagedProjectFolderPath(projectFolderId: string, path: string | readonly string[]): Promise<DriveFolder> {
    const segments = normalizedProjectFolderPath(path);
    await this.assertContained(projectFolderId);
    const projectRoot = await this.getFolder(projectFolderId);
    const projectId = projectRoot.appProperties?.fciProjectId;
    if (projectRoot.mimeType !== FOLDER_MIME_TYPE || projectRoot.trashed || projectRoot.appProperties?.fciFolderKind !== "project" || !projectId) {
      throw new GoogleIntegrationError("invalid_project_drive_folder", "The project does not have a managed Google Drive workspace.", 409);
    }

    let current = projectRoot;
    for (const segment of segments) {
      const matches = await this.childFolders(current.id, segment);
      if (matches.length === 0) {
        throw new GoogleIntegrationError("project_drive_folder_missing", `The managed project folder ${segment} is missing. Re-provision the project workspace before filing email.`, 409);
      }
      if (matches.length > 1) {
        throw new GoogleIntegrationError("duplicate_drive_folder", `More than one managed Google Drive folder matched ${segment}.`, 409);
      }
      const child = matches[0];
      if (child.appProperties?.fciProjectId !== projectId || child.appProperties?.fciFolderKind !== "project-child") {
        throw new GoogleIntegrationError("invalid_project_drive_folder", `The selected project folder ${segment} is not managed by this project.`, 409);
      }
      current = child;
    }
    return { id: current.id, name: current.name, parents: current.parents, webViewLink: current.webViewLink };
  }

  /** Finds one source-tagged file beneath the exact managed folder, or returns null. */
  async findManagedFile(input: DriveManagedFileLookup): Promise<DriveManagedFile | null> {
    const properties = normalizedAppProperties(input.appProperties);
    await this.assertContained(input.parentId);
    const propertyFilters = Object.entries(properties)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ` and appProperties has { key='${driveQueryString(key)}' and value='${driveQueryString(value)}' }`)
      .join("");
    const q = `'${driveQueryString(input.parentId)}' in parents and trashed = false${propertyFilters}`;
    const parameters = this.addListOptions(new URLSearchParams({
      q,
      fields: "files(id,name,mimeType,parents,trashed,webViewLink,appProperties,md5Checksum,size)",
      pageSize: "3",
    }));
    const response = await this.request<{ files?: DriveFile[] }>(`files?${parameters.toString()}`);
    const matches = response.files ?? [];
    if (matches.length > 1) {
      throw new GoogleIntegrationError("duplicate_drive_file", "More than one managed Google Drive file has the same source identity.", 409);
    }
    return matches.length === 1 ? asManagedFile(matches[0]) : null;
  }

  /**
   * Creates a binary Drive file only when its appProperties source identity is not
   * already present. Callers should preserve those properties on retry.
   */
  async findOrUploadManagedFile(input: DriveManagedFileUpload): Promise<DriveManagedFileUploadResult> {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
      throw new GoogleIntegrationError("invalid_drive_upload", "Choose a non-empty file to upload to Google Drive.", 400);
    }
    if (input.bytes.byteLength > MAX_MANAGED_FILE_BYTES) {
      throw new GoogleIntegrationError("drive_upload_too_large", `Files larger than ${MAX_MANAGED_FILE_BYTES / (1024 * 1024)} MB must be uploaded through the large-file workflow.`, 413);
    }
    const name = sanitizeDriveFileName(ensureNonEmptyString(input.name, "The Drive file name", 300));
    const mimeType = normalizedMimeType(input.mimeType);
    const appProperties = normalizedAppProperties(input.appProperties);
    const existing = await this.findManagedFile({ parentId: input.parentId, appProperties });
    if (existing) return { created: false, file: existing };

    // Find-or-upload is retry-safe because a retry starts by looking up the stable
    // source identity above. The coordinator still serializes a filing operation so
    // two simultaneous first attempts cannot race Drive's create endpoint.
    await this.assertContained(input.parentId);
    const boundary = `fci-${crypto.randomUUID()}`;
    const multipart = multipartUploadBody({ name, mimeType, parents: [input.parentId], appProperties }, input.bytes, mimeType, boundary);
    const parameters = this.addUploadOptions(new URLSearchParams({
      uploadType: "multipart",
      fields: "id,name,mimeType,parents,trashed,webViewLink,appProperties,md5Checksum,size",
    }));
    const uploaded = await this.uploadRequest<DriveFile>(`files?${parameters.toString()}`, multipart, `multipart/related; boundary=${boundary}`);
    if (!uploaded.id || !uploaded.name || !uploaded.mimeType || uploaded.trashed || !uploaded.parents?.includes(input.parentId)) {
      throw new GoogleIntegrationError("drive_upload_invalid_response", "Google Drive uploaded the file without the expected managed-folder details. Check Drive before retrying.", 503);
    }
    return { created: true, file: asManagedFile(uploaded) };
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
