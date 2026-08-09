"use client";

import { useDeferredValue, useMemo, useState } from "react";
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
import { useRecordListPreferences } from "../../components/operations/useRecordListPreferences";
import type { RecordListSortKey } from "../../lib/record-list-preferences";
import type { Client, LiveDataState } from "../../lib/record-types";
import {
  sheetMirrorStatusLabel,
  type SheetMirrorStatus,
} from "../../lib/sheet-mirror-status";

const CLIENT_ACTIONABLE_COLUMNS = [
  { key: "client", label: "Client" },
  { key: "contact", label: "Primary contact" },
  { key: "projects", label: "Projects" },
  "",
] as const;
const CLIENT_INITIAL_ROW_CAP = 40;
const CLIENT_ROW_INCREMENT = 40;
const recordCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function ClientsView({ clients, state, projectCounts, onAdd, onClient, onNewProject, sheetMirror, onSyncGoogleSheet, syncingSheet }: { clients: Client[]; state: LiveDataState; projectCounts: Map<string, number>; onAdd: () => void; onClient: (client: Client, returnFocusTarget?: HTMLElement | null) => void; onNewProject: () => void; sheetMirror: SheetMirrorStatus | null; onSyncGoogleSheet: () => Promise<void>; syncingSheet: boolean }) {
  const [clientFilter, setClientFilter] = useState("");
  const deferredClientFilter = useDeferredValue(clientFilter);
  const [reveal, setReveal] = useState({ key: "", cap: CLIENT_INITIAL_ROW_CAP });
  const { preference, update: updatePreference, loaded: preferencesLoaded, saving: savingPreference, error: preferenceError } = useRecordListPreferences("clients");
  const syncLabel = sheetMirrorStatusLabel(sheetMirror);
  const synced = syncLabel === "Synced";
  const needsAttention = syncLabel === "Needs attention";
  const syncStateClass = synced ? "synced" : needsAttention ? "needs-attention" : syncLabel === "Checking sync" || syncLabel === "Syncing" ? "checking" : "not-synced";
  const normalizedFilter = deferredClientFilter.trim().toLowerCase();
  const visibleClients = useMemo(() => {
    const matching = normalizedFilter ? clients.filter((client) => [client.name, client.code, client.contact, client.email].some((value) => value.toLowerCase().includes(normalizedFilter))) : clients;
    const direction = preference.sortDirection === "ascending" ? 1 : -1;
    return [...matching].sort((left, right) => {
      if (preference.sortKey === "projects") return direction * ((projectCounts.get(left.id) ?? 0) - (projectCounts.get(right.id) ?? 0) || recordCollator.compare(left.name, right.name));
      const leftValue = preference.sortKey === "contact" ? `${left.contact} ${left.email}` : `${left.name} ${left.code}`;
      const rightValue = preference.sortKey === "contact" ? `${right.contact} ${right.email}` : `${right.name} ${right.code}`;
      return direction * (recordCollator.compare(leftValue, rightValue) || recordCollator.compare(left.name, right.name));
    });
  }, [clients, normalizedFilter, preference.sortDirection, preference.sortKey, projectCounts]);
  const revealKey = `${normalizedFilter}\u0000${preference.sortKey}\u0000${preference.sortDirection}`;
  const rowCap = reveal.key === revealKey ? reveal.cap : CLIENT_INITIAL_ROW_CAP;
  const renderedClients = visibleClients.slice(0, rowCap);

  function chooseSort(sortKey: RecordListSortKey<"clients">) {
    const sortDirection = preference.sortKey === sortKey && preference.sortDirection === "ascending" ? "descending" : "ascending";
    void updatePreference({ sortKey, sortDirection });
  }
  return <><PageTitle eyebrow="Client directory" title="Clients" text="Keep each client’s contacts, account documents, and projects together." state="In development" action={<><button className="soft-button" onClick={onNewProject} disabled={clients.length === 0}><BriefcaseBusiness size={16} /> New project</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add client</button></>} />
    <section className="client-directory-banner"><div className="directory-badge"><FolderTree size={20} /></div><div><strong>Client records are managed here and mirrored to Google Sheets</strong><span>{sheetMirror?.reason ?? "The Client Directory preserves account notes, while the Project Register is generated from the app."}</span></div><div className="directory-sync-actions"><span className={`directory-status ${syncStateClass}`}>{synced ? <CircleCheckBig size={14} /> : <Clock3 size={14} />}{syncLabel}</span><button className="soft-button" onClick={() => void onSyncGoogleSheet()} disabled={syncingSheet}>{syncingSheet ? "Syncing…" : "Sync directory"}</button></div></section>
    <div className="client-directory panel"><div className="client-directory-toolbar"><label><span>Find a client</span><div><Search size={15} /><input value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} placeholder="Name, code, or email" /></div></label><div className="record-list-mobile-sort"><label><span>Sort clients</span><select value={preference.sortKey} onChange={(event) => void updatePreference({ ...preference, sortKey: event.target.value as RecordListSortKey<"clients"> })} disabled={!preferencesLoaded || savingPreference}><option value="client">Client</option><option value="contact">Primary contact</option><option value="projects">Projects</option></select></label><button type="button" className="soft-button" onClick={() => void updatePreference({ ...preference, sortDirection: preference.sortDirection === "ascending" ? "descending" : "ascending" })} disabled={!preferencesLoaded || savingPreference} aria-label={`Sort ${preference.sortDirection === "ascending" ? "descending" : "ascending"}`}>{preference.sortDirection === "ascending" ? "A–Z ↑" : "Z–A ↓"}</button></div><small>{visibleClients.length} of {clients.length} clients</small>{preferenceError ? <small className="record-list-preference-error" role="alert">{preferenceError}</small> : null}</div><OperationsActionableList ariaLabel="Client directory" columns={CLIENT_ACTIONABLE_COLUMNS} headerClassName="client-table-head" sortKey={preference.sortKey} sortDirection={preference.sortDirection} sortDisabled={!preferencesLoaded || savingPreference} onSort={(key) => chooseSort(key as RecordListSortKey<"clients">)}>
      {renderedClients.map((client) => { const projectCount = projectCounts.get(client.id) ?? 0; return <OperationsActionableListItem
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
    </OperationsActionableList>{renderedClients.length < visibleClients.length ? <div className="record-list-reveal"><button type="button" className="soft-button" onClick={() => setReveal({ key: revealKey, cap: rowCap + CLIENT_ROW_INCREMENT })}>Show {Math.min(CLIENT_ROW_INCREMENT, visibleClients.length - renderedClients.length)} more clients</button><span>{renderedClients.length} shown</span></div> : null}{clients.length === 0 && state === "ready" ? <OperationsEmptyState variant="table" action={<button className="primary-button" type="button" onClick={onAdd}><Plus size={16} /> Add client</button>}>No clients yet. Add the first client to create the live directory.</OperationsEmptyState> : visibleClients.length === 0 && state === "ready" ? <OperationsEmptyState variant="table" action={<button className="soft-button" type="button" onClick={() => setClientFilter("")}>Clear search</button>}>No clients match “{clientFilter.trim()}”.</OperationsEmptyState> : null}</div>
  </>;
}
