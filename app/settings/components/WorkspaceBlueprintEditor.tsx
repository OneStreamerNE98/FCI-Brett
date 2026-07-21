"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { LockKeyhole, Plus, RotateCcw, Save, Trash2 } from "lucide-react";

import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { FeatureStateBadge } from "../../components/FeatureStateBadge";
import {
  flattenWorkspaceBlueprintFolders,
  WORKSPACE_BLUEPRINT_LIMITS,
  WORKSPACE_BLUEPRINT_NAMING_TOKENS,
  WORKSPACE_BLUEPRINT_WEEKDAYS,
  type WorkspaceBlueprint,
  type WorkspaceBlueprintCalendar,
  type WorkspaceBlueprintFolder,
} from "../../lib/workspace-blueprint";

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
type BlueprintDraft = Mutable<WorkspaceBlueprint>;
type FolderDraft = Mutable<WorkspaceBlueprintFolder>;
type CalendarDraft = Mutable<WorkspaceBlueprintCalendar>;
type FolderCollectionKey = "roots" | "clientFolders" | "projectFolders";
type NotificationKind = "success" | "info" | "warning" | "error";
type ErrorAction = "load" | "save";
type Notify = (message: string, kind?: NotificationKind) => void;
type BlueprintResponse = {
  blueprint?: WorkspaceBlueprint;
  version?: number;
  seeded?: boolean;
  error?: string;
  code?: string;
  currentVersion?: number;
};

const FOLDER_COLLECTIONS: readonly { key: FolderCollectionKey; label: string; description: string }[] = [
  { key: "roots", label: "Shared Drive roots", description: "Top-level folders inside the company Shared Drive." },
  { key: "clientFolders", label: "Every client", description: "Folders created for each client account." },
  { key: "projectFolders", label: "Every independent project", description: "Folders created for each project workspace." },
];

const SYSTEM_FOLDER_REASON = "Used by email filing or safe intake. Renaming or removing it would break the filing contract.";
const SYSTEM_SHEET_REASON = "The Client Directory tabs and headers are maintained by the application.";
const SYSTEM_LABEL_REASON = "Review-first Gmail filing depends on this exact FCI label.";
const SYSTEM_CALENDAR_REASON = "The runtime uses this stable calendar key. Its display defaults remain editable.";

function cloneBlueprint(value: WorkspaceBlueprint | BlueprintDraft): BlueprintDraft {
  return structuredClone(value) as BlueprintDraft;
}

function visitFolder(folders: FolderDraft[], key: string, operation: (folder: FolderDraft) => void): boolean {
  for (const folder of folders) {
    if (folder.key === key) {
      operation(folder);
      return true;
    }
    if (visitFolder(folder.children, key, operation)) return true;
  }
  return false;
}

function removeFolder(folders: FolderDraft[], key: string): boolean {
  const index = folders.findIndex((folder) => folder.key === key);
  if (index >= 0) {
    folders.splice(index, 1);
    return true;
  }
  return folders.some((folder) => removeFolder(folder.children, key));
}

function allFolderKeys(blueprint: BlueprintDraft) {
  return new Set(flattenWorkspaceBlueprintFolders(blueprint).map((folder) => folder.key));
}

function unusedKey(base: string, existing: Set<string>) {
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function LockBadge({ label, reason }: { label: string; reason: string }) {
  const descriptionId = useId();
  return <span className="workspace-blueprint-lock-wrap">
    <button type="button" className="workspace-blueprint-lock" aria-label={`${label} is locked`} aria-describedby={descriptionId} title={reason}><LockKeyhole size={13} aria-hidden="true" /> System</button>
    <span id={descriptionId} className="workspace-blueprint-lock-note" role="tooltip">{reason}</span>
  </span>;
}

function FolderEditor({
  folder,
  collection,
  depth,
  onChange,
  onAddChild,
  onRemove,
}: {
  folder: FolderDraft;
  collection: FolderCollectionKey;
  depth: number;
  onChange: (collection: FolderCollectionKey, key: string, name: string) => void;
  onAddChild: (collection: FolderCollectionKey, key: string) => void;
  onRemove: (collection: FolderCollectionKey, key: string) => void;
}) {
  const locked = folder.management === "system";
  return <li className={`workspace-blueprint-folder ${locked ? "locked" : "owner"}`}>
    <div className="workspace-blueprint-folder-row">
      <label><span>Folder name</span><input aria-label={`${folder.name} folder name`} value={folder.name} disabled={locked} onChange={(event) => onChange(collection, folder.key, event.target.value)} /></label>
      <code>{folder.key}</code>
      {locked ? <LockBadge label={folder.name} reason={SYSTEM_FOLDER_REASON} /> : <div className="workspace-blueprint-row-actions">
        {depth < WORKSPACE_BLUEPRINT_LIMITS.folderDepth && <button type="button" className="soft-button" onClick={() => onAddChild(collection, folder.key)}><Plus size={13} /> Subfolder</button>}
        <button type="button" className="icon-button workspace-blueprint-remove" aria-label={`Remove ${folder.name} folder`} title={`Remove ${folder.name}`} onClick={() => onRemove(collection, folder.key)}><Trash2 size={14} /></button>
      </div>}
    </div>
    {folder.children.length > 0 && <ul>{folder.children.map((child) => <FolderEditor key={child.key} folder={child} collection={collection} depth={depth + 1} onChange={onChange} onAddChild={onAddChild} onRemove={onRemove} />)}</ul>}
  </li>;
}

export function WorkspaceBlueprintEditor({ notify, refreshKey = 0 }: { notify: Notify; refreshKey?: number }) {
  const [draft, setDraft] = useState<BlueprintDraft | null>(null);
  const [savedBlueprint, setSavedBlueprint] = useState<BlueprintDraft | null>(null);
  const [version, setVersion] = useState(0);
  const [seeded, setSeeded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<ErrorAction | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);

  const loadBlueprint = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorAction(null);
    try {
      const response = await fetch("/api/v1/integrations/google/setup/blueprint", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as BlueprintResponse;
      if (!response.ok || !payload.blueprint || !Number.isSafeInteger(payload.version)) {
        throw new Error(payload.error ?? "The Workspace blueprint could not be loaded.");
      }
      const next = cloneBlueprint(payload.blueprint);
      setDraft(next);
      setSavedBlueprint(cloneBlueprint(next));
      setVersion(payload.version ?? 0);
      setSeeded(payload.seeded === true);
      setConflictVersion(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Workspace blueprint could not be loaded.");
      setErrorAction("load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadBlueprint);
  }, [loadBlueprint, refreshKey]);

  const updateDraft = useCallback((operation: (next: BlueprintDraft) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneBlueprint(current);
      operation(next);
      return next;
    });
  }, []);

  const folderOptions = useMemo(() => draft ? flattenWorkspaceBlueprintFolders(draft) : [], [draft]);
  const dirty = Boolean(draft && savedBlueprint && JSON.stringify(draft) !== JSON.stringify(savedBlueprint));

  const renameFolder = useCallback((collection: FolderCollectionKey, folderKey: string, name: string) => {
    updateDraft((next) => { visitFolder(next.drive[collection], folderKey, (folder) => { folder.name = name; }); });
  }, [updateDraft]);

  const addFolder = useCallback((collection: FolderCollectionKey, parentKey?: string) => {
    updateDraft((next) => {
      if (flattenWorkspaceBlueprintFolders(next).length >= WORKSPACE_BLUEPRINT_LIMITS.folders) return;
      const key = unusedKey("new-folder", allFolderKeys(next));
      const folder: FolderDraft = { key, name: "New folder", management: "owner", children: [] };
      if (parentKey) visitFolder(next.drive[collection], parentKey, (parent) => { parent.children.push(folder); });
      else next.drive[collection].push(folder);
    });
  }, [updateDraft]);

  const deleteFolder = useCallback((collection: FolderCollectionKey, folderKey: string) => {
    updateDraft((next) => { removeFolder(next.drive[collection], folderKey); });
  }, [updateDraft]);

  const addTemplate = useCallback(() => {
    updateDraft((next) => {
      const existing = new Set(next.templates.map((template) => template.key));
      next.templates.push({
        key: unusedKey("new-template", existing),
        name: "New template",
        kind: "doc",
        targetFolderKey: flattenWorkspaceBlueprintFolders(next)[0]?.key ?? "company-admin",
        management: "owner",
      });
    });
  }, [updateDraft]);

  const addSpreadsheet = useCallback(() => {
    updateDraft((next) => {
      const existing = new Set(next.spreadsheets.map((spreadsheet) => spreadsheet.key));
      next.spreadsheets.push({
        key: unusedKey("new-spreadsheet", existing),
        name: "New spreadsheet",
        targetFolderKey: flattenWorkspaceBlueprintFolders(next)[0]?.key ?? "company-admin",
        management: "owner",
      });
    });
  }, [updateDraft]);

  async function saveBlueprint() {
    if (!draft || !dirty || conflictVersion !== null) return;
    setSaving(true);
    setError(null);
    setErrorAction(null);
    try {
      const response = await fetch("/api/v1/integrations/google/setup/blueprint", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blueprint: draft, expectedVersion: version }),
      });
      const payload = await response.json().catch(() => ({})) as BlueprintResponse;
      if (response.status === 409) {
        setConflictVersion(Number.isSafeInteger(payload.currentVersion) ? payload.currentVersion ?? null : null);
        setError(payload.error ?? "This blueprint changed in another editor. Load the latest version before saving.");
        setErrorAction("load");
        return;
      }
      if (!response.ok || !payload.blueprint || !Number.isSafeInteger(payload.version)) {
        throw new Error(payload.error ?? "The Workspace blueprint could not be saved.");
      }
      const saved = cloneBlueprint(payload.blueprint);
      setDraft(saved);
      setSavedBlueprint(cloneBlueprint(saved));
      setVersion(payload.version ?? version + 1);
      setSeeded(false);
      setConflictVersion(null);
      notify(`Workspace blueprint version ${payload.version} saved.`, "success");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Workspace blueprint could not be saved.");
      setErrorAction("save");
    } finally {
      setSaving(false);
    }
  }

  return <section className="workspace-setup-card workspace-blueprint-card" aria-labelledby="workspace-blueprint-heading">
    <header>
      <div><p className="eyebrow">Workspace setup</p><h3 id="workspace-blueprint-heading">Blueprint</h3></div>
      <span className="workspace-blueprint-version">{seeded ? "Seed defaults · version 0" : `Saved version ${version}`}</span>
    </header>
    <p>Define the names and structure FCI will use when later setup steps create Workspace resources. Nothing is created in Google from this editor.</p>
    {loading && !draft && <p className="workspace-blueprint-message" role="status">Loading the Workspace blueprint…</p>}
    {error && <div className={`workspace-blueprint-error${conflictVersion !== null ? " conflict" : ""}`} role="alert"><span>{error}</span><button type="button" className="soft-button" onClick={() => void (conflictVersion !== null || errorAction !== "save" ? loadBlueprint() : saveBlueprint())}>{conflictVersion !== null ? `Load latest${conflictVersion ? ` (v${conflictVersion})` : ""}` : errorAction === "save" ? "Retry save" : "Retry"}</button></div>}
    {draft && <div className="workspace-blueprint-editor">
      <fieldset className="workspace-blueprint-fields">
        <legend>Business and naming</legend>
        <div className="workspace-blueprint-field-grid">
          <label>Business display name<input value={draft.business.displayName} onChange={(event) => updateDraft((next) => { next.business.displayName = event.target.value; })} /></label>
          <label>Shared Drive name<input value={draft.drive.sharedDriveName} onChange={(event) => updateDraft((next) => { next.drive.sharedDriveName = event.target.value; })} /></label>
          <label>Client folder pattern<input value={draft.naming.clientFolderPattern} onChange={(event) => updateDraft((next) => { next.naming.clientFolderPattern = event.target.value; })} /></label>
          <label>Project folder pattern<input value={draft.naming.projectFolderPattern} onChange={(event) => updateDraft((next) => { next.naming.projectFolderPattern = event.target.value; })} /></label>
        </div>
        <p className="workspace-blueprint-token-legend">
          <strong>Allowed naming tokens</strong>
          <span>Client requires</span>{WORKSPACE_BLUEPRINT_NAMING_TOKENS.filter((token) => token === "{code}" || token === "{name}").map((token) => <code key={`client-${token}`}>{token}</code>)}
          <span>Project requires</span>{WORKSPACE_BLUEPRINT_NAMING_TOKENS.filter((token) => token === "{number}" || token === "{name}").map((token) => <code key={`project-${token}`}>{token}</code>)}
          <span>and may include</span><code>{"{year}"}</code>
        </p>
      </fieldset>

      <div className="workspace-blueprint-section">
        <div><h4>Folder tree</h4><p>Keys stay stable so future setup can reconcile renamed folders safely.</p></div>
        {FOLDER_COLLECTIONS.map((collection) => <fieldset className="workspace-blueprint-folder-group" key={collection.key}>
          <legend>{collection.label}</legend><p>{collection.description}</p>
          <ul>{draft.drive[collection.key].map((folder) => <FolderEditor key={folder.key} folder={folder} collection={collection.key} depth={1} onChange={renameFolder} onAddChild={addFolder} onRemove={deleteFolder} />)}</ul>
          <button type="button" className="soft-button workspace-blueprint-add" onClick={() => addFolder(collection.key)} disabled={flattenWorkspaceBlueprintFolders(draft).length >= WORKSPACE_BLUEPRINT_LIMITS.folders}><Plus size={14} /> Add folder</button>
        </fieldset>)}
      </div>

      <fieldset className="workspace-blueprint-list">
        <legend>Templates</legend><p>Define starter Docs or Sheets and the folder that will receive each one.</p>
        {draft.templates.map((template, index) => <div className="workspace-blueprint-list-row" key={template.key}>
          <label>Template name<input aria-label={`${template.key} template name`} value={template.name} onChange={(event) => updateDraft((next) => { next.templates[index].name = event.target.value; })} /></label>
          <label>Kind<select aria-label={`${template.key} template kind`} value={template.kind} onChange={(event) => updateDraft((next) => { next.templates[index].kind = event.target.value as "doc" | "sheet"; })}><option value="doc">Google Doc</option><option value="sheet">Google Sheet</option></select></label>
          <label>Target folder<select aria-label={`${template.key} template target folder`} value={template.targetFolderKey} onChange={(event) => updateDraft((next) => { next.templates[index].targetFolderKey = event.target.value; })}>{folderOptions.map((folder) => <option value={folder.key} key={folder.key}>{folder.path}</option>)}</select></label>
          <code>{template.key}</code><button type="button" className="icon-button workspace-blueprint-remove" aria-label={`Remove ${template.name} template`} onClick={() => updateDraft((next) => { next.templates.splice(index, 1); })}><Trash2 size={14} /></button>
        </div>)}
        <button type="button" className="soft-button workspace-blueprint-add" onClick={addTemplate} disabled={draft.templates.length >= WORKSPACE_BLUEPRINT_LIMITS.templates}><Plus size={14} /> Add template</button>
      </fieldset>

      <fieldset className="workspace-blueprint-list">
        <legend>Spreadsheets</legend><p>The Client Directory is locked; owner-defined extras can target any blueprint folder.</p>
        {draft.spreadsheets.map((spreadsheet, index) => {
          const locked = spreadsheet.management === "system";
          return <div className={`workspace-blueprint-list-row ${locked ? "locked" : ""}`} key={spreadsheet.key}>
            <label>Spreadsheet name<input aria-label={`${spreadsheet.key} spreadsheet name`} value={spreadsheet.name} disabled={locked} onChange={(event) => updateDraft((next) => { next.spreadsheets[index].name = event.target.value; })} /></label>
            <label>Target folder<select aria-label={`${spreadsheet.key} spreadsheet target folder`} value={spreadsheet.targetFolderKey} disabled={locked} onChange={(event) => updateDraft((next) => { next.spreadsheets[index].targetFolderKey = event.target.value; })}>{folderOptions.map((folder) => <option value={folder.key} key={folder.key}>{folder.path}</option>)}</select></label>
            <code>{spreadsheet.key}</code>{locked ? <LockBadge label={spreadsheet.name} reason={SYSTEM_SHEET_REASON} /> : <button type="button" className="icon-button workspace-blueprint-remove" aria-label={`Remove ${spreadsheet.name} spreadsheet`} onClick={() => updateDraft((next) => { next.spreadsheets.splice(index, 1); })}><Trash2 size={14} /></button>}
          </div>;
        })}
        <button type="button" className="soft-button workspace-blueprint-add" onClick={addSpreadsheet} disabled={draft.spreadsheets.length >= WORKSPACE_BLUEPRINT_LIMITS.spreadsheets}><Plus size={14} /> Add spreadsheet</button>
      </fieldset>

      <fieldset className="workspace-blueprint-list workspace-blueprint-calendars">
        <legend>Calendar defaults</legend><p>Stable keys stay locked while display names, duration, and working hours remain owner-defined.</p>
        {draft.calendars.map((calendar, index) => <div className="workspace-blueprint-calendar" key={calendar.key}>
          <div className="workspace-blueprint-calendar-heading"><strong>{calendar.key}</strong><LockBadge label={calendar.name} reason={SYSTEM_CALENDAR_REASON} /></div>
          <div className="workspace-blueprint-field-grid calendar">
            <label>Calendar display name<input aria-label={`${calendar.key} calendar display name`} value={calendar.name} onChange={(event) => updateDraft((next) => { next.calendars[index].name = event.target.value; })} /></label>
            <label>Default event minutes<input aria-label={`${calendar.key} default event minutes`} type="number" min="5" max="1440" value={calendar.defaultEventMinutes} onChange={(event) => updateDraft((next) => { next.calendars[index].defaultEventMinutes = Number(event.target.value); })} /></label>
            <label>Working day starts<input aria-label={`${calendar.key} working day start`} type="time" value={calendar.workingHours.start} onChange={(event) => updateDraft((next) => { next.calendars[index].workingHours.start = event.target.value; })} /></label>
            <label>Working day ends<input aria-label={`${calendar.key} working day end`} type="time" value={calendar.workingHours.end} onChange={(event) => updateDraft((next) => { next.calendars[index].workingHours.end = event.target.value; })} /></label>
          </div>
          <div className="workspace-blueprint-weekdays" aria-label={`${calendar.key} working days`}>{WORKSPACE_BLUEPRINT_WEEKDAYS.map((day) => {
            const checked = calendar.workingHours.days.includes(day);
            return <label key={day}><input type="checkbox" checked={checked} onChange={(event) => updateDraft((next) => {
              const target = next.calendars[index] as CalendarDraft;
              if (event.target.checked) target.workingHours.days.push(day);
              else if (target.workingHours.days.length > 1) target.workingHours.days = target.workingHours.days.filter((value) => value !== day);
            })} />{day.slice(0, 3)}</label>;
          })}</div>
        </div>)}
      </fieldset>

      <fieldset className="workspace-blueprint-list workspace-blueprint-locked-list">
        <legend>Gmail filing labels</legend><p>These exact labels remain visible and locked because review-first filing depends on them.</p>
        {draft.gmail.labels.map((label) => <div className="workspace-blueprint-locked-row" key={label.key}><span><strong>{label.name}</strong><code>{label.key}</code></span><LockBadge label={label.name} reason={SYSTEM_LABEL_REASON} /></div>)}
      </fieldset>

      <section className="workspace-blueprint-planned" aria-labelledby="workspace-blueprint-planned-heading">
        <div><h4 id="workspace-blueprint-planned-heading">Setup attributes planned for later</h4><p>These are informational and are not editable until a real consumer is approved.</p></div>
        {["Business address and phone", "Business-month convention", "Correspondence retention and archive policy"].map((item) => <div key={item}><span>{item}</span><FeatureStateBadge state="Planned" /></div>)}
      </section>

      <footer className="workspace-blueprint-footer">
        <span aria-live="polite">{dirty ? "Unsaved blueprint changes" : "All blueprint changes saved"}</span>
        <button type="button" className="soft-button" disabled={!dirty || saving} onClick={() => {
          if (savedBlueprint) setDraft(cloneBlueprint(savedBlueprint));
          if (conflictVersion === null) {
            setError(null);
            setErrorAction(null);
          }
        }}><RotateCcw size={14} /> Discard changes</button>
        <AdministratorActionButton type="button" className="primary-button" isAdmin disabled={!dirty || saving || conflictVersion !== null} onClick={() => void saveBlueprint()}>{saving ? "Saving…" : <><Save size={14} /> Save blueprint</>}</AdministratorActionButton>
      </footer>
    </div>}
  </section>;
}
