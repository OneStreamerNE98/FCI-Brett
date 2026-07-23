"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ExternalLink, LockKeyhole } from "lucide-react";

import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import styles from "./WorkspaceDriveResourceActions.module.css";
import { WorkspaceInfoHint } from "./workspace-setup-shell/WorkspaceInfoHint";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;

export type WorkspaceResourceSource = "app" | "env" | "none";
export type WorkspaceResourceState = "Found" | "Created" | "Adopted" | "Not configured" | "Simulated";
export type WorkspaceDriveRestrictions = {
  adminManagedRestrictions: boolean | null;
  copyRequiresWriterPermission: boolean | null;
  domainUsersOnly: boolean | null;
  driveMembersOnly: boolean | null;
  sharingFoldersRequiresOrganizerPermission: boolean | null;
};
export type WorkspaceSetupResource = {
  key: string;
  resourceType?: "drive.shared-drive" | "drive.folder" | "drive.file" | "sheets.spreadsheet" | "calendar.calendar";
  label: string;
  name?: string;
  blueprintName: string;
  management?: "owner" | "system";
  role?: "system-mirror" | "import" | "reference";
  parentKey?: string | null;
  externalId?: string;
  source: WorkspaceResourceSource;
  origin?: "created" | "adopted" | "env-adopted";
  url?: string;
  updatedAt?: number;
  restrictions?: WorkspaceDriveRestrictions;
  state: WorkspaceResourceState;
};

export type WorkspaceSetupResourcesPayload = {
  resources: WorkspaceSetupResource[];
  connectReady: boolean;
  simulation: boolean;
  identity: {
    connectionAccount: string | null;
    intakeMailboxMatches: boolean | null;
    allowedDomains: string[];
    mode: "simulation" | "workspace";
  };
};

type SharedDriveCandidate = {
  id: string;
  name: string;
  url: string;
  restrictions: WorkspaceDriveRestrictions;
};

type WorkspaceDriveChange = Readonly<{
  driveVerified?: boolean;
  blueprintChanged?: boolean;
}>;

export type WorkspaceCreationProgress = Readonly<{
  sharedDriveComplete: boolean;
  foldersComplete: boolean;
  spreadsheetsComplete: boolean;
  templatesComplete: boolean;
  completedCount: number;
}>;

type CreationRowProps = Readonly<{
  order: number;
  rowKey: string;
  label: string;
  info: string;
  state: "FOUND — ADOPT" | "VERIFY" | "DONE" | "AFTER DRIVE" | "CREATE" | "AFTER FOLDERS" | "VERIFY ONLY";
  complete?: boolean;
  lockedCaption?: string;
  children: ReactNode;
}>;

const SHARED_DRIVE_INFO = "The one company drive where every project folder lives. The app never creates a second drive — it adopts the one your admin set up.";
const FOLDER_TREE_INFO = "Creates the top-level folders exactly as your blueprint defines them. Rename them from this screen later — never directly in Drive.";
const SPREADSHEETS_INFO = "The Client Directory and Project Register the app keeps in sync, plus any extra sheets you defined. The app is the source of truth — the sheets are mirrors.";
const TEMPLATES_INFO = "Starter documents — estimate, work order, change order, checklist, budget — placed in your Templates folder. Edit their content in Google; the app only creates them.";
const CALENDARS_INFO = "Checks that the appointments calendar your admin shared is reachable. The app doesn't create calendars yet — that arrives with a later update.";

function isSharedDrive(resource: WorkspaceSetupResource) {
  return resource.resourceType === "drive.shared-drive" || (!resource.resourceType && resource.key === "primary");
}

export function workspaceResourceComplete(resource: WorkspaceSetupResource, simulation: boolean) {
  if (simulation) return resource.source === "app" && Boolean(resource.externalId);
  return resource.state === "Created" || resource.state === "Adopted";
}

function resourceGroupComplete(resources: readonly WorkspaceSetupResource[], simulation: boolean) {
  return resources.length > 0
    && resources.every((resource) => workspaceResourceComplete(resource, simulation));
}

export function deriveWorkspaceCreationProgress(
  resources: readonly WorkspaceSetupResource[],
  simulation: boolean,
  resourcesReady: boolean,
): WorkspaceCreationProgress {
  const sharedDrives = resources.filter(isSharedDrive);
  const folders = resources.filter((resource) => resource.resourceType === "drive.folder");
  const spreadsheets = resources.filter((resource) => resource.resourceType === "sheets.spreadsheet");
  const templates = resources.filter((resource) => resource.resourceType === "drive.file");
  const sharedDriveComplete = resourcesReady
    && resourceGroupComplete(sharedDrives, simulation);
  const foldersComplete = resourcesReady && resourceGroupComplete(folders, simulation);
  const spreadsheetsComplete = resourcesReady && resourceGroupComplete(spreadsheets, simulation);
  const templatesComplete = resourcesReady && resourceGroupComplete(templates, simulation);
  return {
    sharedDriveComplete,
    foldersComplete,
    spreadsheetsComplete,
    templatesComplete,
    completedCount: [
      sharedDriveComplete,
      foldersComplete,
      spreadsheetsComplete,
      templatesComplete,
    ].filter(Boolean).length,
  };
}

async function postJson<T>(url: string, body: Record<string, unknown> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string; candidates?: SharedDriveCandidate[] };
  return { response, data };
}

function restrictionLabel(restrictions: WorkspaceDriveRestrictions | undefined) {
  if (restrictions?.domainUsersOnly === true) return "External sharing restricted to the Workspace domain";
  if (restrictions?.domainUsersOnly === false) return "Drive permits external sharing — review required";
  return "External sharing restrictions not verified";
}

function resourceSourceLabel(source: WorkspaceSetupResource["source"]) {
  if (source === "app") return "App-managed";
  if (source === "env") return "Environment value";
  return "Not configured";
}

function resourceStateTone(resource: WorkspaceSetupResource) {
  if (resource.state === "Created" || resource.state === "Adopted") return styles.resourceStateDone;
  if (resource.state === "Found") return styles.resourceStateFound;
  if (resource.state === "Simulated") return styles.resourceStateSimulated;
  return styles.resourceStateNeutral;
}

function SharedDriveActions({
  resource,
  adoptEnabled,
  verifyEnabled,
  simulation,
  driveReady,
  driveVerified,
  verifyWorking,
  notify,
  onVerify,
  onChanged,
}: {
  resource?: WorkspaceSetupResource;
  adoptEnabled: boolean;
  verifyEnabled: boolean;
  simulation: boolean;
  driveReady: boolean;
  driveVerified: boolean;
  verifyWorking: boolean;
  notify: Notify;
  onVerify: () => Promise<void> | void;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<SharedDriveCandidate[]>([]);
  const [candidateId, setCandidateId] = useState("");

  async function adopt(selectedId?: string) {
    if (!resource) return;
    setBusy(true);
    try {
      const { response, data } = await postJson<{ adopted?: boolean; verified?: boolean }>(
        "/api/v1/integrations/google/drive/shared-drive/adopt",
        selectedId ? { driveId: selectedId } : {},
      );
      if (response.status === 409 && data.candidates?.length) {
        setCandidates(data.candidates);
        setCandidateId(data.candidates[0]?.id ?? "");
        notify("More than one Shared Drive matched the blueprint name. Choose the exact drive to adopt.", "warning");
        return;
      }
      if (!response.ok || !data.adopted || !data.verified) throw new Error(data.error ?? "The Shared Drive could not be adopted.");
      setCandidates([]);
      setCandidateId("");
      notify("The Shared Drive was verified and saved as the app-managed Drive authority.", "success");
      await onChanged({ driveVerified: true });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Shared Drive could not be adopted.", "error");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.rowActions}>
    {resource && <span className={`${styles.restrictionsChip} ${resource.restrictions?.domainUsersOnly === true ? styles.restrictionsVerified : resource.restrictions?.domainUsersOnly === false ? styles.restrictionsWarning : ""}`}>{restrictionLabel(resource.restrictions)}</span>}
    <div className={styles.actionButtons}>
      {resource && <AdministratorActionButton className="primary-button" isAdmin onClick={() => void adopt()} disabled={!adoptEnabled || busy || verifyWorking}>{busy ? "Checking…" : resource.externalId ? "Verify and adopt" : "Find and adopt"}</AdministratorActionButton>}
      <AdministratorActionButton className="soft-button" isAdmin onClick={() => void onVerify()} disabled={!verifyEnabled || busy || verifyWorking || (!simulation && !driveReady)}>{verifyWorking ? "Verifying…" : driveVerified ? "Verify Shared Drive again" : "Verify Shared Drive"}</AdministratorActionButton>
      {resource?.url && <a className="soft-button" href={resource.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
    </div>
    {!resource && <span className={styles.actionNote}>Adoption controls become available when the resource registry returns the Shared Drive row.</span>}
    {!simulation && !driveReady && verifyEnabled && <span className={styles.actionNote}>Direct verification becomes available when Drive is connected.</span>}
    {candidates.length > 0 && <div className={styles.driveCandidates} role="group" aria-label="Choose the exact Shared Drive">
      <label>Matching Shared Drive<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.id}</option>)}</select></label>
      <AdministratorActionButton className="primary-button" isAdmin onClick={() => void adopt(candidateId)} disabled={!adoptEnabled || !candidateId || busy || verifyWorking}>Adopt selected drive</AdministratorActionButton>
    </div>}
  </div>;
}

function EnsureFoldersAction({
  enabled,
  notify,
  onChanged,
}: {
  enabled: boolean;
  notify: Notify;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function ensureRoots() {
    setBusy(true);
    try {
      const { response, data } = await postJson<{
        ensured?: boolean;
        counts?: { found: number; created: number; adopted: number };
      }>("/api/v1/integrations/google/drive/folders/ensure-roots");
      if (!response.ok || !data.ensured) throw new Error(data.error ?? "The Shared Drive root folders could not be ensured.");
      const counts = data.counts ?? { found: 0, created: 0, adopted: 0 };
      notify(`Drive roots checked: ${counts.created} created, ${counts.adopted} adopted, ${counts.found} found.`, "success");
      await onChanged({});
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Shared Drive root folders could not be ensured.", "error");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.actionButtons}>
    <AdministratorActionButton className="primary-button" isAdmin onClick={() => void ensureRoots()} disabled={!enabled || busy}>{busy ? "Ensuring…" : "Ensure root folders"}</AdministratorActionButton>
  </div>;
}

function FolderRenameAction({
  resource,
  enabled,
  notify,
  onChanged,
}: {
  resource: WorkspaceSetupResource;
  enabled: boolean;
  notify: Notify;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(resource.name ?? resource.blueprintName.split(" / ").at(-1) ?? "");
  const [busy, setBusy] = useState(false);

  if (resource.management === "system") {
    return <span className={styles.resourceLocked}><LockKeyhole size={13} /> Locked by the filing contract</span>;
  }
  if (!resource.externalId) return <span className={styles.actionNote}>Ensure roots first</span>;
  if (!editing) {
    return <div className={styles.actionButtons}>
      <button className="soft-button" type="button" onClick={() => setEditing(true)} disabled={!enabled}>Rename</button>
      {resource.url && <a className="soft-button" href={resource.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
    </div>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const { response, data } = await postJson<{ renamed?: boolean }>(
        "/api/v1/integrations/google/drive/folders/rename",
        { key: resource.key, name },
      );
      if (!response.ok || !data.renamed) throw new Error(data.error ?? "The Drive folder could not be renamed.");
      setEditing(false);
      notify(`${resource.name ?? resource.key} was renamed in Drive and the Workspace blueprint.`, "success");
      await onChanged({ blueprintChanged: true });
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Drive folder could not be renamed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return <form className={styles.renameForm} onSubmit={(event) => void submit(event)}>
    <label><span className="sr-only">New name for {resource.name ?? resource.key}</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={!enabled || busy} /></label>
    <button className="primary-button" type="submit" disabled={!enabled || busy || !name.trim()}>{busy ? "Renaming…" : "Save name"}</button>
    <button className="soft-button" type="button" onClick={() => { setEditing(false); setName(resource.name ?? resource.blueprintName.split(" / ").at(-1) ?? ""); }} disabled={busy}>Cancel</button>
  </form>;
}

function EnsureSpreadsheetsAction({
  enabled,
  notify,
  onChanged,
}: {
  enabled: boolean;
  notify: Notify;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function ensureSpreadsheets() {
    setBusy(true);
    try {
      const { response, data } = await postJson<{
        ensured?: boolean;
        counts?: { found: number; created: number; adopted: number };
      }>("/api/v1/integrations/google/sheets/ensure");
      if (!response.ok || !data.ensured) throw new Error(data.error ?? "The Workspace spreadsheets could not be ensured.");
      const counts = data.counts ?? { found: 0, created: 0, adopted: 0 };
      notify(`Spreadsheets checked: ${counts.created} created, ${counts.adopted} adopted, ${counts.found} found.`, "success");
      await onChanged({});
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Workspace spreadsheets could not be ensured.", "error");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.actionButtons}>
    <AdministratorActionButton className="primary-button" isAdmin onClick={() => void ensureSpreadsheets()} disabled={!enabled || busy}>{busy ? "Ensuring…" : "Ensure spreadsheets"}</AdministratorActionButton>
  </div>;
}

function EnsureTemplatesAction({
  enabled,
  notify,
  onChanged,
}: {
  enabled: boolean;
  notify: Notify;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function ensureTemplates() {
    setBusy(true);
    try {
      const { response, data } = await postJson<{
        ensured?: boolean;
        counts?: { found: number; created: number; adopted: number };
      }>("/api/v1/integrations/google/drive/templates/ensure");
      if (!response.ok || !data.ensured) throw new Error(data.error ?? "The Workspace templates could not be ensured.");
      const counts = data.counts ?? { found: 0, created: 0, adopted: 0 };
      notify(`Templates checked: ${counts.created} created, ${counts.adopted} adopted, ${counts.found} found.`, "success");
      await onChanged({});
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Workspace templates could not be ensured.", "error");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.actionButtons}>
    <AdministratorActionButton className="primary-button" isAdmin onClick={() => void ensureTemplates()} disabled={!enabled || busy}>{busy ? "Ensuring…" : "Ensure templates"}</AdministratorActionButton>
  </div>;
}

function OpenResourceAction({ resource }: { resource: WorkspaceSetupResource }) {
  return resource.url
    ? <a className="soft-button" href={resource.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>
    : <span className={styles.actionNote}>No Google link is available yet</span>;
}

function ResourceDetails({
  label,
  resources,
  available,
  renderAction,
}: {
  label: string;
  resources: readonly WorkspaceSetupResource[];
  available: boolean;
  renderAction: (resource: WorkspaceSetupResource) => ReactNode;
}) {
  if (!available) return <p className={styles.emptyDetails}>Resource details are unavailable until the registry refresh succeeds.</p>;
  if (resources.length === 0) return <p className={styles.emptyDetails}>No {label.toLowerCase()} are defined in this blueprint.</p>;
  return <details className={styles.resourceDetails}>
    <summary><span>Review {label}</span><span>{resources.length}</span><ChevronDown size={15} aria-hidden="true" /></summary>
    <ul>
      {resources.map((resource) => <li key={`${resource.resourceType ?? "legacy"}:${resource.key}`}>
        <div className={styles.resourceCopy}>
          <strong>{resource.label}</strong>
          <small>{resource.blueprintName}</small>
          <span className={styles.resourceMeta}>
            <span className={`${styles.resourceState} ${resourceStateTone(resource)}`}>{resource.state}</span>
            <span>{resourceSourceLabel(resource.source)}</span>
          </span>
        </div>
        <div className={styles.resourceItemActions}>{renderAction(resource)}</div>
      </li>)}
    </ul>
  </details>;
}

function CreationRow({
  order,
  rowKey,
  label,
  info,
  state,
  complete = false,
  lockedCaption,
  children,
}: CreationRowProps) {
  return <li
    className={`${styles.creationRow}${complete ? ` ${styles.creationRowComplete}` : ""}${lockedCaption ? ` ${styles.creationRowLocked}` : ""}`}
    data-workspace-creation-row={rowKey}
    data-workspace-creation-state={state}
  >
    <span className={styles.rowNumber} aria-hidden="true">{order}</span>
    <div className={styles.rowBody}>
      <header>
        <div className={styles.rowHeading}>
          <h4>{label}</h4>
          <WorkspaceInfoHint label={`About ${label}`} text={info} />
        </div>
        <span className={`${styles.stateChip}${complete ? ` ${styles.stateChipDone}` : ""}`}>{state}</span>
      </header>
      {lockedCaption && <p className={styles.unlockCaption}>{lockedCaption}</p>}
      {children}
    </div>
  </li>;
}

export function WorkspaceDriveResourceActions({
  resources,
  simulation,
  resourcesReady,
  resourcesLoading,
  resourcesError,
  stageReady,
  driveReady,
  driveVerificationReady,
  driveVerified,
  driveWorking,
  calendarReady,
  calendarWorking,
  notify,
  onRetryResources,
  onVerifyDrive,
  onVerifyCalendar,
  onChanged,
}: {
  resources: readonly WorkspaceSetupResource[];
  simulation: boolean;
  resourcesReady: boolean;
  resourcesLoading: boolean;
  resourcesError: string | null;
  stageReady: boolean;
  driveReady: boolean;
  driveVerificationReady: boolean;
  driveVerified: boolean;
  driveWorking: boolean;
  calendarReady: boolean;
  calendarWorking: boolean;
  notify: Notify;
  onRetryResources: () => Promise<void> | void;
  onVerifyDrive: () => Promise<void> | void;
  onVerifyCalendar: () => Promise<void> | void;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const sharedDrives = resources.filter(isSharedDrive);
  const folders = resources.filter((resource) => resource.resourceType === "drive.folder");
  const spreadsheets = resources.filter((resource) => resource.resourceType === "sheets.spreadsheet");
  const templates = resources.filter((resource) => resource.resourceType === "drive.file");
  const calendars = resources.filter((resource) => resource.resourceType === "calendar.calendar");
  const sharedDrive = sharedDrives[0];
  const progress = deriveWorkspaceCreationProgress(resources, simulation, resourcesReady);
  const sharedDriveAdoptEnabled = stageReady && resourcesReady;
  const foldersEnabled = sharedDriveAdoptEnabled && progress.sharedDriveComplete;
  const spreadsheetsEnabled = foldersEnabled && progress.foldersComplete;
  const templatesEnabled = foldersEnabled && progress.foldersComplete;
  const calendarsEnabled = templatesEnabled && progress.templatesComplete;
  const sharedDriveState = progress.sharedDriveComplete
    ? "DONE"
    : sharedDrive?.source === "env" || sharedDrive?.state === "Found"
      ? "FOUND — ADOPT"
      : "VERIFY";

  return <section className={`${styles.creationCard} workspace-setup-card`} aria-labelledby="workspace-creation-heading">
    <header className={styles.cardHeader}>
      <div>
        <p className="eyebrow">Create in order</p>
        <h3 id="workspace-creation-heading">Workspace creation</h3>
      </div>
      <span className={styles.progressChip}>{resourcesLoading && !resourcesReady
        ? "Loading"
        : resourcesError && !resourcesReady
          ? "Unavailable"
          : `${progress.completedCount} of 4 ready`}</span>
    </header>
    <p className={styles.cardIntro}>Use the saved blueprint first, then complete each creation row in order. Every action is repeat-safe and never deletes Google content.</p>
    {resourcesLoading && !resourcesReady && <p className={styles.resourceMessage} role="status">Loading the Workspace resource registry…</p>}
    {resourcesError && <div className={styles.resourcesError} role="alert"><span>{resourcesError}</span><button className="soft-button" type="button" onClick={() => void onRetryResources()}>Retry resources</button></div>}
    <ol className={styles.creationList} aria-label="Workspace resources in creation order">
      <CreationRow
        order={1}
        rowKey="shared-drive"
        label="Shared Drive"
        info={SHARED_DRIVE_INFO}
        state={sharedDriveState}
        complete={progress.sharedDriveComplete}
        lockedCaption={!stageReady && !driveVerificationReady ? "Unlocks after Connect." : undefined}
      >
        <SharedDriveActions
          resource={sharedDrive}
          adoptEnabled={sharedDriveAdoptEnabled}
          verifyEnabled={driveVerificationReady}
          simulation={simulation}
          driveReady={driveReady}
          driveVerified={driveVerified}
          verifyWorking={driveWorking}
          notify={notify}
          onVerify={onVerifyDrive}
          onChanged={onChanged}
        />
      </CreationRow>
      <CreationRow
        order={2}
        rowKey="folder-tree"
        label="Folder tree (from your blueprint)"
        info={FOLDER_TREE_INFO}
        state={progress.foldersComplete ? "DONE" : foldersEnabled ? "CREATE" : "AFTER DRIVE"}
        complete={progress.foldersComplete}
        lockedCaption={!foldersEnabled ? "Unlocks after Shared Drive." : undefined}
      >
        <EnsureFoldersAction enabled={foldersEnabled} notify={notify} onChanged={onChanged} />
        <ResourceDetails label="folders" resources={folders} available={resourcesReady} renderAction={(resource) => <FolderRenameAction resource={resource} enabled={foldersEnabled} notify={notify} onChanged={onChanged} />} />
      </CreationRow>
      <CreationRow
        order={3}
        rowKey="spreadsheets"
        label="Spreadsheets"
        info={SPREADSHEETS_INFO}
        state={progress.spreadsheetsComplete ? "DONE" : spreadsheetsEnabled ? "CREATE" : "AFTER FOLDERS"}
        complete={progress.spreadsheetsComplete}
        lockedCaption={!spreadsheetsEnabled ? "Unlocks after Folder tree (from your blueprint)." : undefined}
      >
        <EnsureSpreadsheetsAction enabled={spreadsheetsEnabled} notify={notify} onChanged={onChanged} />
        <ResourceDetails label="spreadsheets" resources={spreadsheets} available={resourcesReady} renderAction={(resource) => <OpenResourceAction resource={resource} />} />
      </CreationRow>
      <CreationRow
        order={4}
        rowKey="templates"
        label="Templates"
        info={TEMPLATES_INFO}
        state={progress.templatesComplete ? "DONE" : templatesEnabled ? "CREATE" : "AFTER FOLDERS"}
        complete={progress.templatesComplete}
        lockedCaption={!templatesEnabled ? "Unlocks after Folder tree (from your blueprint)." : undefined}
      >
        <EnsureTemplatesAction enabled={templatesEnabled} notify={notify} onChanged={onChanged} />
        <ResourceDetails label="templates" resources={templates} available={resourcesReady} renderAction={(resource) => <OpenResourceAction resource={resource} />} />
      </CreationRow>
      <CreationRow
        order={5}
        rowKey="calendars"
        label="Calendars"
        info={CALENDARS_INFO}
        state="VERIFY ONLY"
        lockedCaption={!calendarsEnabled ? "Unlocks after Templates." : undefined}
      >
        <div className={styles.actionButtons}>
          <AdministratorActionButton className="soft-button" isAdmin onClick={() => void onVerifyCalendar()} disabled={!calendarsEnabled || calendarWorking || (!simulation && !calendarReady)}>{calendarWorking ? "Verifying…" : "Verify calendar access"}</AdministratorActionButton>
        </div>
        {!simulation && !calendarReady && calendarsEnabled && <span className={styles.actionNote}>Calendar verification becomes available when the configured service is connected.</span>}
        <ResourceDetails label="calendars" resources={calendars} available={resourcesReady} renderAction={(resource) => <OpenResourceAction resource={resource} />} />
      </CreationRow>
    </ol>
  </section>;
}
