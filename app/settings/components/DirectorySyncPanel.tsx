"use client";

import { BriefcaseBusiness, CircleAlert, FolderOpen, FolderTree } from "lucide-react";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";

type SheetMirrorStatus = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  clients: { status: string; lastSyncedAt: number | null; lastError: string | null };
  projects: { status: string; lastSyncedAt: number | null; lastError: string | null };
  lastSyncedAt: number | null;
  reason: string | null;
};

function formatSyncTime(value: number | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet synced";
}

export function DirectorySyncPanel({ mirror, syncing, onSync, onConfigure, isAdmin }: { mirror: SheetMirrorStatus | null; syncing: boolean; onSync: () => Promise<void>; onConfigure: () => void; isAdmin: boolean }) {
  const ready = Boolean(mirror?.configured && mirror.enabled && mirror.connected);
  const clientsStatus = mirror?.clients.status ?? "checking";
  const projectsStatus = mirror?.projects.status ?? "checking";
  return <section className="panel client-directory-settings"><div className="settings-heading"><div><p className="eyebrow">Google Sheets mirror</p><h2>Client Directory & Project Register</h2><p>FCI Operations stores the working metadata and relationships. Google Sheets provides a one-way mirror that updates after app changes and when you run a manual sync.</p></div><div className="workspace-actions">{mirror?.spreadsheetUrl && <a className="soft-button" href={mirror.spreadsheetUrl} target="_blank" rel="noreferrer"><FolderOpen size={15} /> Open spreadsheet</a>}<AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void onSync()} disabled={syncing || !ready}>{syncing ? "Syncing…" : "Sync now"}</AdministratorActionButton></div></div>
    {!ready && <div className="workspace-missing"><CircleAlert size={16} /><span>{mirror?.reason ?? "Checking Google Sheets configuration…"}</span><button className="soft-button" onClick={onConfigure}>Google setup</button></div>}
    <div className="directory-sync-summary"><article><div><FolderTree size={17} /></div><span>Client Directory</span><strong>{clientsStatus === "synced" ? "Synced" : clientsStatus === "failed" ? "Needs attention" : clientsStatus}</strong><small>{formatSyncTime(mirror?.clients.lastSyncedAt ?? null)}</small><p>Updates client code, contacts, project count, folder link, status, and last update. Your Account Notes column remains yours.</p></article><article><div><BriefcaseBusiness size={17} /></div><span>Project Register</span><strong>{projectsStatus === "synced" ? "Synced" : projectsStatus === "failed" ? "Needs attention" : projectsStatus}</strong><small>{formatSyncTime(mirror?.projects.lastSyncedAt ?? null)}</small><p>Generated from independent project records, including the client, status, site, value, manager, and Drive workspace link.</p></article></div>
    {(mirror?.clients.lastError || mirror?.projects.lastError) && <div className="workspace-missing"><CircleAlert size={16} /><span>{mirror.clients.lastError ?? mirror.projects.lastError}</span></div>}
    <div className="directory-layout"><div><h3>What lives in the app</h3><ul><li>Client-to-project relationships and project numbers</li><li>Contacts, statuses, dates, values, and Drive mappings</li><li>Future tasks, notes, meetings, communications, schedules, and activity history</li></ul></div><div><h3>How to use the spreadsheet</h3><p>Use it to view, filter, export, and add account notes. Do not edit the generated Project Register; the next sync rebuilds it from FCI Operations. Spreadsheet edits do not write back to the app yet.</p></div></div></section>;
}

