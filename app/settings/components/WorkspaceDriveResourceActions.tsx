"use client";

import { useState, type FormEvent } from "react";
import { ExternalLink, LockKeyhole } from "lucide-react";

import { AdministratorActionButton } from "../../components/AdministratorActionButton";

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

function SharedDriveActions({
  resource,
  notify,
  onChanged,
}: {
  resource: WorkspaceSetupResource;
  notify: Notify;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<"adopt" | "ensure" | null>(null);
  const [candidates, setCandidates] = useState<SharedDriveCandidate[]>([]);
  const [candidateId, setCandidateId] = useState("");

  async function adopt(selectedId?: string) {
    setBusy("adopt");
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
      setBusy(null);
    }
  }

  async function ensureRoots() {
    setBusy("ensure");
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
      setBusy(null);
    }
  }

  return <div className="workspace-resource-actions">
    <span className={`workspace-restrictions-chip ${resource.restrictions?.domainUsersOnly === true ? "verified" : resource.restrictions?.domainUsersOnly === false ? "warning" : "unknown"}`}>{restrictionLabel(resource.restrictions)}</span>
    <div className="workspace-resource-action-buttons">
      <AdministratorActionButton className="soft-button" isAdmin onClick={() => void adopt()} disabled={busy !== null}>{busy === "adopt" ? "Checking…" : resource.externalId ? "Verify and adopt" : "Find and adopt"}</AdministratorActionButton>
      <AdministratorActionButton className="primary-button" isAdmin onClick={() => void ensureRoots()} disabled={busy !== null || resource.source !== "app"}>{busy === "ensure" ? "Ensuring…" : resource.source === "app" ? "Ensure root folders" : "Adopt first"}</AdministratorActionButton>
      {resource.url && <a className="soft-button" href={resource.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
    </div>
    {candidates.length > 0 && <div className="workspace-drive-candidates" role="group" aria-label="Choose the exact Shared Drive">
      <label>Matching Shared Drive<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.id}</option>)}</select></label>
      <AdministratorActionButton className="primary-button" isAdmin onClick={() => void adopt(candidateId)} disabled={!candidateId || busy !== null}>Adopt selected drive</AdministratorActionButton>
    </div>}
  </div>;
}

function FolderRenameAction({
  resource,
  notify,
  onChanged,
}: {
  resource: WorkspaceSetupResource;
  notify: Notify;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(resource.name ?? resource.blueprintName.split(" / ").at(-1) ?? "");
  const [busy, setBusy] = useState(false);

  if (resource.management === "system") {
    return <span className="workspace-resource-locked"><LockKeyhole size={13} /> Locked by the filing contract</span>;
  }
  if (!resource.externalId) return <span className="workspace-resource-action-note">Ensure roots first</span>;
  if (!editing) {
    return <div className="workspace-resource-action-buttons">
      <button className="soft-button" type="button" onClick={() => setEditing(true)}>Rename</button>
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

  return <form className="workspace-resource-rename" onSubmit={(event) => void submit(event)}>
    <label><span className="sr-only">New name for {resource.name ?? resource.key}</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
    <button className="primary-button" type="submit" disabled={busy || !name.trim()}>{busy ? "Renaming…" : "Save name"}</button>
    <button className="soft-button" type="button" onClick={() => { setEditing(false); setName(resource.name ?? resource.blueprintName.split(" / ").at(-1) ?? ""); }} disabled={busy}>Cancel</button>
  </form>;
}

function SpreadsheetActions({
  resource,
  notify,
  onChanged,
}: {
  resource: WorkspaceSetupResource;
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

  return <div className="workspace-resource-action-buttons">
    <AdministratorActionButton className="primary-button" isAdmin onClick={() => void ensureSpreadsheets()} disabled={busy}>{busy ? "Ensuring…" : "Ensure spreadsheets"}</AdministratorActionButton>
    {resource.url && <a className="soft-button" href={resource.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
  </div>;
}

export function WorkspaceDriveResourceActions({
  resource,
  notify,
  onChanged,
}: {
  resource: WorkspaceSetupResource;
  notify: Notify;
  onChanged: (change: WorkspaceDriveChange) => Promise<void> | void;
}) {
  if (resource.resourceType === "drive.shared-drive" || (!resource.resourceType && resource.key === "primary")) {
    return <SharedDriveActions resource={resource} notify={notify} onChanged={onChanged} />;
  }
  if (resource.resourceType === "drive.folder") {
    return <FolderRenameAction resource={resource} notify={notify} onChanged={onChanged} />;
  }
  if (resource.resourceType === "sheets.spreadsheet") {
    return <SpreadsheetActions resource={resource} notify={notify} onChanged={onChanged} />;
  }
  return <div className="workspace-resource-action-buttons">{resource.url ? <a className="soft-button" href={resource.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a> : <span className="workspace-resource-action-note">Later setup packet</span>}</div>;
}
