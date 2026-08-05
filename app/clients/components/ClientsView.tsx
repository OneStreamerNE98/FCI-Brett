"use client";

import { useState } from "react";
import {
  BriefcaseBusiness,
  ChevronRight,
  CircleCheckBig,
  Clock3,
  FolderTree,
  Plus,
  Search,
} from "lucide-react";
import {
  Avatar,
  OperationsEmptyState,
  PageTitle,
} from "../../components/operations/OperationsPrimitives";
import {
  OperationsActionableList,
  OperationsActionableListItem,
} from "../../components/operations/OperationsActionableList";
import type { Client, LiveDataState } from "../../lib/record-types";
import {
  sheetMirrorStatusLabel,
  type SheetMirrorStatus,
} from "../../lib/sheet-mirror-status";

const CLIENT_ACTIONABLE_COLUMNS = ["Client", "Primary contact", "Projects", ""] as const;

export function ClientsView({ clients, state, projectCounts, onAdd, onClient, onNewProject, sheetMirror, onSyncGoogleSheet, syncingSheet }: { clients: Client[]; state: LiveDataState; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client, returnFocusTarget?: HTMLElement | null) => void; onNewProject: () => void; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const [clientFilter, setClientFilter] = useState("");
  const syncLabel = sheetMirrorStatusLabel(sheetMirror);
  const synced = syncLabel === "Synced";
  const needsAttention = syncLabel === "Needs attention";
  const syncStateClass = synced ? "synced" : needsAttention ? "needs-attention" : syncLabel === "Checking sync" || syncLabel === "Syncing" ? "checking" : "not-synced";
  const normalizedFilter = clientFilter.trim().toLowerCase();
  const visibleClients = normalizedFilter ? clients.filter((client) => [client.name, client.code, client.contact, client.email].some((value) => value.toLowerCase().includes(normalizedFilter))) : clients;
  return <><PageTitle eyebrow="Client directory" title="Clients" text="Keep each client’s contacts, account documents, and projects together." state="In development" action={<><button className="soft-button" onClick={onNewProject} disabled={clients.length === 0}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></>} />
    <section className="client-directory-banner"><div className="directory-badge"><FolderTree size={20} /></div><div><strong>Client records are managed here and mirrored to Google Sheets</strong><span>{sheetMirror?.reason ?? "The Client Directory preserves account notes, while the Project Register is generated from the app."}</span></div><div className="directory-sync-actions"><span className={`directory-status ${syncStateClass}`}>{synced ? <CircleCheckBig size={14} /> : <Clock3 size={14} />}{syncLabel}</span><button className="soft-button" onClick={() => void onSyncGoogleSheet()} disabled={syncingSheet}>{syncingSheet ? "Syncing…" : "Sync directory"}</button></div></section>
    <div className="client-directory panel"><div className="client-directory-toolbar"><label><span>Find a client</span><div><Search size={15} /><input value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} placeholder="Name, code, or email" /></div></label><small>{visibleClients.length} of {clients.length} clients</small></div><OperationsActionableList ariaLabel="Client directory" columns={CLIENT_ACTIONABLE_COLUMNS} headerClassName="client-table-head">
      {visibleClients.map((client) => { const projectCount = projectCounts.get(client.id) ?? 0; return <OperationsActionableListItem
        key={client.id}
        className="client-table-row"
        accessibleName={`Open client ${client.name}, ${client.code}`}
        accessibleDescription={`Industry ${client.industry}. Primary contact ${client.contact}, ${client.email || "email to add"}. ${projectCount} ${projectCount === 1 ? "project" : "projects"}.`}
        onActivate={(trigger) => onClient(client, trigger)}
      >
        <span className="client-identity"><Avatar initials={client.initials} color={client.color} /><span className="client-identity-copy"><strong>{client.name}</strong><small>{client.code} · {client.industry}</small></span></span>
        <span className="client-primary-contact"><strong>{client.contact}</strong><small>{client.email || "Email to add"}</small></span>
        <span className="client-project-count"><b>{projectCount}</b><small>{projectCount === 1 ? "project" : "projects"}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </OperationsActionableListItem>})}
    </OperationsActionableList>{clients.length === 0 && state === "ready" ? <OperationsEmptyState variant="table">No clients yet. Add the first client to create the live directory.</OperationsEmptyState> : visibleClients.length === 0 && state === "ready" ? <OperationsEmptyState variant="table">No clients match “{clientFilter.trim()}”.</OperationsEmptyState> : null}</div>
  </>;
}
