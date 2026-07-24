"use client";

import { useState } from "react";
import {
  BriefcaseBusiness,
  CircleAlert,
  FolderOpen,
  FolderTree,
  RefreshCw,
} from "lucide-react";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { sheetMirrorStatusLabel, type SheetMirrorStatus } from "../../lib/sheet-mirror-status";

const SHEET_STATUS_PATH = "/api/v1/integrations/google/sheets/status";
const CLIENT_DIRECTORY_SHEET_KEY = "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMirrorEntityStatus(value: unknown) {
  return isRecord(value)
    && typeof value.status === "string"
    && (typeof value.lastSyncedAt === "number" || value.lastSyncedAt === null)
    && (typeof value.lastError === "string" || value.lastError === null);
}

function isSheetMirrorStatus(value: unknown): value is SheetMirrorStatus {
  return isRecord(value)
    && typeof value.configured === "boolean"
    && typeof value.enabled === "boolean"
    && typeof value.connected === "boolean"
    && (typeof value.spreadsheetUrl === "string" || value.spreadsheetUrl === null)
    && (typeof value.spreadsheetName === "string" || value.spreadsheetName === null)
    && isMirrorEntityStatus(value.clients)
    && isMirrorEntityStatus(value.projects)
    && (typeof value.lastSyncedAt === "number" || value.lastSyncedAt === null)
    && (typeof value.reason === "string" || value.reason === null)
    && ["app", "env", "none"].includes(String(value.source));
}

function syncTime(value: number | null | undefined) {
  return value === null || value === undefined ? "Not yet synced" : String(value);
}

function DirectoryMirrorSummary({
  icon: Icon,
  label,
  entity,
  mirror,
  description,
}: {
  icon: typeof FolderTree;
  label: string;
  entity: "clients" | "projects";
  mirror: SheetMirrorStatus | null;
  description: string;
}) {
  const entityStatus = mirror?.[entity];
  return <article>
    <div><Icon size={17} /></div>
    <span>{label}</span>
    <strong>{sheetMirrorStatusLabel(mirror, entity)}</strong>
    <small>Last synced: {syncTime(entityStatus?.lastSyncedAt)}</small>
    {entityStatus?.lastError && <small role="alert">Last error: {entityStatus.lastError}</small>}
    <p>{description}</p>
  </article>;
}

export function DirectorySyncPanel({
  mirror,
  syncing,
  onSync,
  isAdmin,
}: {
  mirror: SheetMirrorStatus | null;
  syncing: boolean;
  onSync: () => Promise<void>;
  onConfigure: () => void;
  isAdmin: boolean;
}) {
  const [refreshSnapshot, setRefreshSnapshot] = useState<{
    base: SheetMirrorStatus | null;
    mirror: SheetMirrorStatus;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const currentMirror = refreshSnapshot?.base === mirror ? refreshSnapshot.mirror : mirror;

  async function refreshStatus() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const response = await fetch(SHEET_STATUS_PATH, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok || !isRecord(body) || !isSheetMirrorStatus(body.mirror)) {
        throw new Error("sheet_status_unavailable");
      }
      setRefreshSnapshot({ base: mirror, mirror: body.mirror });
    } catch {
      setRefreshError("Mirror status could not be refreshed. Try again without leaving this page.");
    } finally {
      setRefreshing(false);
    }
  }

  const ready = Boolean(currentMirror?.configured && currentMirror.enabled && currentMirror.connected);
  const unconfigured = currentMirror !== null && !currentMirror.configured;

  return <section className="panel client-directory-settings" aria-labelledby="client-directory-settings-heading">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Google Sheets mirror</p>
        <h2 id="client-directory-settings-heading">Client Directory &amp; Project Register</h2>
        <p>FCI Operations stores the working metadata and relationships. Google Sheets provides a one-way mirror that updates after app changes and when you run a manual sync.</p>
      </div>
      <div className="workspace-actions">
        {currentMirror?.spreadsheetUrl && <a className="soft-button" href={currentMirror.spreadsheetUrl} target="_blank" rel="noreferrer"><FolderOpen size={15} /> Open spreadsheet</a>}
        <button className="soft-button" type="button" onClick={() => void refreshStatus()} disabled={refreshing}>
          <RefreshCw size={15} aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
        <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void onSync()} disabled={syncing || !ready}>
          {syncing ? "Syncing…" : "Sync now"}
        </AdministratorActionButton>
      </div>
    </div>

    {!ready && <div className="workspace-missing">
      <CircleAlert size={16} />
      <span>
        {unconfigured
          ? <>The mirror is not configured. Set up the Client Directory spreadsheet in Workspace Stage 3; <code>{CLIENT_DIRECTORY_SHEET_KEY}</code> remains the fallback configuration name.</>
          : currentMirror?.reason ?? "Checking Google Sheets configuration…"}
      </span>
      <a className="soft-button" href="/settings?section=google-workspace#workspace-stage-3">Open Google Workspace setup</a>
    </div>}

    {refreshError && <div className="workspace-missing" role="alert"><CircleAlert size={16} /><span>{refreshError}</span></div>}

    <div className="directory-sync-summary">
      <DirectoryMirrorSummary
        icon={FolderTree}
        label="Client Directory"
        entity="clients"
        mirror={currentMirror}
        description="Updates client code, contacts, project count, folder link, status, and last update. Your Account Notes column remains yours."
      />
      <DirectoryMirrorSummary
        icon={BriefcaseBusiness}
        label="Project Register"
        entity="projects"
        mirror={currentMirror}
        description="Generated from independent project records, including the client, status, site, value, manager, and Drive workspace link."
      />
    </div>

    <div className="directory-layout">
      <div>
        <h3>What lives in the app</h3>
        <ul>
          <li>Client-to-project relationships and project numbers</li>
          <li>Contacts, statuses, dates, values, and Drive mappings</li>
          <li>Future tasks, notes, meetings, communications, schedules, and activity history</li>
        </ul>
      </div>
      <div>
        <h3>How to use the spreadsheet</h3>
        <p>Use it to view, filter, export, and add account notes. Do not edit the generated Project Register; the next sync rebuilds it from FCI Operations. Spreadsheet edits do not write back to the app yet.</p>
      </div>
    </div>
  </section>;
}
