"use client";

import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, FilePlus2, FolderTree, X } from "lucide-react";

import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { ClientDataNotice } from "../../components/ClientDataNotice";
import {
  cachedGetJson,
  invalidateCachedGet,
  isTerminalCachedGetError,
} from "../../lib/client-get-cache";
import { useCachedGetSubscription } from "../../lib/client-get-hooks";
import styles from "./ProjectFilesPanel.module.css";

type ProjectFileKind = "doc" | "sheet" | "slides";

type ProjectFileTemplate = Readonly<{
  key: string;
  name: string;
  kind: ProjectFileKind;
}>;

type ProjectFileFolder = Readonly<{
  key: string;
  name: string;
  path: string;
}>;

type ProjectFileCatalog = Readonly<{
  provisioned: boolean;
  templates: ProjectFileTemplate[];
  folders: ProjectFileFolder[];
}>;

type CreatedProjectFile = Readonly<{
  id: string;
  name: string;
  url: string;
  kind: ProjectFileKind;
  simulated: boolean;
  environment?: string;
}>;

type ProjectFileCatalogState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; catalog: ProjectFileCatalog }>;

export type ProjectFilesController = Readonly<{
  catalogState: ProjectFileCatalogState;
  createdFiles: CreatedProjectFile[];
  modalOpen: boolean;
  closeModal: () => void;
  openModal: () => void;
  recordCreatedFile: (file: CreatedProjectFile) => void;
  retryCatalog: () => void;
}>;

const PROJECT_FILE_KINDS = [
  { value: "doc" as const, label: "Google Doc", blankLabel: "Blank Google Doc" },
  { value: "sheet" as const, label: "Google Sheet", blankLabel: "Blank Google Sheet" },
  { value: "slides" as const, label: "Google Slides", blankLabel: "Blank Google Slides" },
];

function isProjectFileKind(value: unknown): value is ProjectFileKind {
  return value === "doc" || value === "sheet" || value === "slides";
}

function normalizeCatalog(value: unknown): ProjectFileCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project file choices could not be loaded.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.provisioned !== "boolean" || !Array.isArray(record.templates) || !Array.isArray(record.folders)) {
    throw new Error("Project file choices could not be loaded.");
  }

  const templates = record.templates.map((template) => {
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      throw new Error("Project file choices could not be loaded.");
    }
    const item = template as Record<string, unknown>;
    if (typeof item.key !== "string" || typeof item.name !== "string" || !isProjectFileKind(item.kind)) {
      throw new Error("Project file choices could not be loaded.");
    }
    return { key: item.key, name: item.name, kind: item.kind };
  });

  const folders = record.folders.map((folder) => {
    if (!folder || typeof folder !== "object" || Array.isArray(folder)) {
      throw new Error("Project file choices could not be loaded.");
    }
    const item = folder as Record<string, unknown>;
    if (typeof item.key !== "string" || typeof item.name !== "string" || typeof item.path !== "string") {
      throw new Error("Project file choices could not be loaded.");
    }
    return { key: item.key, name: item.name, path: item.path };
  });

  return { provisioned: record.provisioned, templates, folders };
}

function normalizeCreatedFile(value: unknown, simulated: unknown, environment: unknown): CreatedProjectFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The project file was created, but its link was not returned.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || typeof record.name !== "string"
    || typeof record.url !== "string"
    || !isProjectFileKind(record.kind)
  ) {
    throw new Error("The project file was created, but its link was not returned.");
  }
  let url: URL;
  try {
    url = new URL(record.url);
  } catch {
    throw new Error("The project file was created, but its link was not returned.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The project file was created, but its link was not returned.");
  }
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    kind: record.kind,
    simulated: simulated === true,
    ...(typeof environment === "string" && environment.trim() ? { environment } : {}),
  };
}

async function responseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof data?.error === "string" && data.error.trim() ? data.error : fallback;
}

export function useProjectFilesController(projectId: string, driveFolderId?: string): ProjectFilesController {
  const [catalogResult, setCatalogResult] = useState<Readonly<{
    requestKey: string;
    state: ProjectFileCatalogState;
  }> | null>(null);
  const [createdSession, setCreatedSession] = useState<Readonly<{
    projectId: string;
    files: CreatedProjectFile[];
  }>>({ projectId, files: [] });
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const catalogUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/drive/files`;
  const requestKey = `${projectId}:${driveFolderId ?? "unprovisioned"}:${catalogRevision}`;
  const catalogState = catalogResult?.requestKey === requestKey
    ? catalogResult.state
    : { status: "loading" as const };
  const createdFiles = createdSession.projectId === projectId ? createdSession.files : [];

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const catalog = normalizeCatalog(await cachedGetJson<unknown>(catalogUrl));
        if (active) {
          setCatalogResult({ requestKey, state: { status: "ready", catalog } });
        }
      } catch (error) {
        if (!active) return;
        if (isTerminalCachedGetError(error)) {
          setCreatedSession({ projectId, files: [] });
          setModalProjectId(null);
        }
        setCatalogResult({
          requestKey,
          state: {
            status: "error",
            message: error instanceof Error ? error.message : "Project file choices could not be loaded.",
          },
        });
      }
    })();

    return () => { active = false; };
  }, [catalogUrl, projectId, requestKey]);

  useCachedGetSubscription([catalogUrl], () => {
    setCatalogRevision((current) => current + 1);
  });

  return {
    catalogState,
    createdFiles,
    modalOpen: modalProjectId === projectId,
    closeModal: () => setModalProjectId(null),
    openModal: () => setModalProjectId(projectId),
    recordCreatedFile: (file) => setCreatedSession((current) => ({
      projectId,
      files: current.projectId === projectId ? [...current.files, file] : [file],
    })),
    retryCatalog: () => {
      invalidateCachedGet(catalogUrl);
      setCatalogRevision((current) => current + 1);
    },
  };
}

export function ProjectFilesPanel({
  controller,
  newDocumentTriggerRef,
}: {
  controller: ProjectFilesController;
  newDocumentTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const headingId = useId();
  const ready = controller.catalogState.status === "ready" && controller.catalogState.catalog.provisioned;

  return <section className={styles.panel} aria-labelledby={headingId}>
    <header className={styles.heading}>
      <div>
        <p className={styles.kicker}>Google Drive</p>
        <h3 id={headingId}>Project files</h3>
        <p>Create a Google Doc, Sheet, or Slides file without leaving the project.</p>
      </div>
      <button
        ref={newDocumentTriggerRef}
        type="button"
        className={`soft-button ${styles.newDocumentButton}`}
        onClick={controller.openModal}
        disabled={!ready}
      >
        <FilePlus2 size={16} aria-hidden="true" /> New document
      </button>
    </header>

    {controller.catalogState.status === "loading" && <div className={styles.state} role="status" aria-live="polite">
      <strong>Loading project files…</strong>
      <span>Checking the project folder and available starter templates.</span>
    </div>}

    {controller.catalogState.status === "error" && <ClientDataNotice
      state="error"
      error={controller.catalogState.message}
      errorTitle="Project files are unavailable"
      retryLabel="Try again"
      onRetry={controller.retryCatalog}
    />}

    {controller.catalogState.status === "ready" && !controller.catalogState.catalog.provisioned && <div className={`${styles.state} ${styles.unprovisioned}`} role="status">
      <FolderTree size={19} aria-hidden="true" />
      <strong>Drive folder required</strong>
      <span>Use Create Drive folder below before adding project files.</span>
    </div>}

    {ready && <div className={styles.sessionFiles}>
      <div>
        <h4>Created in this session</h4>
        <p>These links stay here while this project drawer is open. Use Open Drive folder below for the complete file list.</p>
      </div>
      {controller.createdFiles.length === 0
        ? <p className={styles.empty}>No files have been created in this session.</p>
        : <ul>{controller.createdFiles.map((file) => <li key={file.id}>
          <a href={file.url} target="_blank" rel="noopener noreferrer">
            <span>{file.name}</span>
            <small>{file.simulated
              ? `Simulated ${PROJECT_FILE_KINDS.find((option) => option.value === file.kind)?.label ?? "Google file"} — no Google file created`
              : PROJECT_FILE_KINDS.find((option) => option.value === file.kind)?.label ?? "Google file"}</small>
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </li>)}</ul>}
    </div>}
  </section>;
}

export function ProjectFileCreationModal({
  catalog,
  controller,
  projectId,
  projectNumber,
  returnFocusRef,
}: {
  catalog: ProjectFileCatalog;
  controller: ProjectFilesController;
  projectId: string;
  projectNumber: string;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [kind, setKind] = useState<ProjectFileKind>("doc");
  const [templateKey, setTemplateKey] = useState("");
  const [folderKey, setFolderKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedProjectFile | null>(null);
  const successLinkRef = useRef<HTMLAnchorElement>(null);
  const kindTemplates = catalog.templates.filter((template) => template.kind === kind);
  const kindOption = PROJECT_FILE_KINDS.find((option) => option.value === kind) ?? PROJECT_FILE_KINDS[0];

  useEffect(() => {
    if (!created) return;
    const focusFrame = window.requestAnimationFrame(() => successLinkRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [created]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setError("Enter a document name.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/drive/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name,
          ...(templateKey ? { templateKey } : {}),
          ...(folderKey ? { folderKey } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "The project file could not be created."));
      }
      const data = await response.json() as { file?: unknown; simulated?: unknown; environment?: unknown };
      invalidateCachedGet(`/api/v1/projects/${encodeURIComponent(projectId)}/drive/files`, { notify: false });
      const file = normalizeCreatedFile(data.file, data.simulated, data.environment);
      controller.recordCreatedFile(file);
      setCreated(file);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The project file could not be created.");
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay
    ariaLabel={`Create a project file in ${projectNumber}`}
    contentClassName={`modal ${styles.modal}`}
    onClose={controller.closeModal}
    busy={saving}
    returnFocusRef={returnFocusRef}
  >
    <header>
      <div>
        <p className="eyebrow">{projectNumber}</p>
        <h2>New document</h2>
      </div>
      <button type="button" onClick={controller.closeModal} aria-label="Close" disabled={saving}><X size={20} /></button>
    </header>
    {created
      ? <div className={styles.success}>
        <div role="status" aria-live="polite">
          <CheckCircle2 size={21} aria-hidden="true" />
          <div>
            <h3>{created.name} is ready</h3>
            <p>{created.simulated
              ? "Simulation only — no Google file was created."
              : "The file was created in the selected project folder."}</p>
          </div>
        </div>
        <a ref={successLinkRef} className="primary-button" href={created.url} target="_blank" rel="noopener noreferrer">
          {created.simulated ? "View simulation" : "Open file"} <ExternalLink size={16} aria-hidden="true" />
        </a>
        <button type="button" className="soft-button" onClick={controller.closeModal}>Done</button>
      </div>
      : <form onSubmit={submit}>
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <label>Document type
          <select
            data-overlay-initial-focus
            aria-label="Document type"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ProjectFileKind);
              setTemplateKey("");
            }}
            disabled={saving}
          >
            {PROJECT_FILE_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>Start from
          {/* aria-label matches the visible label text exactly: WCAG 2.5.3 (Label in
              Name) holds, and the accessible name stays deterministic — the wrapping
              label's computed text would otherwise include the option text. */}
          <select aria-label="Start from" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} disabled={saving}>
            <option value="">{kindOption.blankLabel}</option>
            {kindTemplates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
          </select>
        </label>
        <label>Destination folder
          <select aria-label="Destination folder" value={folderKey} onChange={(event) => setFolderKey(event.target.value)} disabled={saving}>
            <option value="">Project root</option>
            {catalog.folders.map((folder) => <option key={folder.key} value={folder.key}>{folder.path || folder.name}</option>)}
          </select>
        </label>
        <label>Document name
          <input name="name" required maxLength={180} placeholder="Document name" disabled={saving} />
        </label>
        <p className="form-help"><FolderTree size={14} aria-hidden="true" /> Only this project&apos;s configured Drive folders are available.</p>
        <footer>
          <button type="button" className="soft-button" onClick={controller.closeModal} disabled={saving}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create document"}</button>
        </footer>
      </form>}
  </AccessibleOverlay>;
}
