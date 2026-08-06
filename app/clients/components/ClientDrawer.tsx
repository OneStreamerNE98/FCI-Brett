"use client";

import { type RefObject, useState } from "react";
import { ChevronRight, ContactRound, FolderTree, Mail, Plus, Settings, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { OperationsEmptyState, Status } from "../../components/operations/OperationsPrimitives";
import { JobSiteMapCard } from "../../features/maps/JobSiteMapCard";
import type { JobSiteMapsRuntimeConfig } from "../../features/maps/job-site-map";
import type { Client, ClientEditPatch, ContactEditPatch, Project } from "../../lib/record-types";
import { ClientEditModal, ContactEditModal } from "./ClientModals";

export function ClientDrawer({ client, projects, jobSiteMaps, onClose, onSaveClient, onSaveContact, onNewProject, onProject, returnFocusRef }: { client: Client; projects: Project[]; jobSiteMaps: JobSiteMapsRuntimeConfig; onClose: () => void; onSaveClient: (client: Client, patch: ClientEditPatch, version: string) => Promise<void>; onSaveContact: (client: Client, patch: ContactEditPatch, version: string) => Promise<void>; onNewProject: () => void; onProject: (project: Project) => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [editingClientSnapshot, setEditingClientSnapshot] = useState<Client | null>(null);
  const [editingContactSnapshot, setEditingContactSnapshot] = useState<Client | null>(null);
  const contactEditable = Boolean(client.contactId && client.contactVersion);
  return <><AccessibleOverlay variant="drawer" ariaLabel={`${client.name} client account`} contentClassName="project-drawer client-drawer" onClose={onClose} returnFocusRef={returnFocusRef}>
    <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close client"><X size={20} /></button><Status text={client.status} /><span>{client.code}</span></header>
    <div className="drawer-title"><p>Client account</p><h2>{client.name}</h2><div><span><ContactRound size={14} />{client.contact}</span><span><Mail size={14} />{client.email || "Contact email pending"}</span></div></div>
    <div className="client-drawer-body">
      <section className="client-account-card"><div className="directory-badge"><FolderTree size={19} /></div><div><strong>Client account folder</strong><span>{client.driveUrl ? "Google Drive folder ready" : "Google Drive folder not created yet"}</span></div></section>
      {/* The drawer reads industryRaw, not the display default. This is an editing
          surface, so showing a fabricated "Commercial" for a client whose industry is
          genuinely unset would misrepresent what is stored — and it is what the user is
          about to edit. The list row chip keeps the shipped "Commercial" default
          (DES-08a1), which is why these two surfaces cannot share one field. Both are
          pinned: tests/e2e/des08a1-industry-surfacing.spec.ts:263 for the chip,
          tests/e2e/edit06-client-contact-editing.spec.ts:145 for this value. */}
      <div className="client-summary-grid"><div><span>Industry</span><strong>{client.industryRaw ?? "Unspecified"}</strong></div><div><span>Contact role</span><strong>{client.contactRole}</strong></div><div><span>Contact phone</span><strong>{client.contactPhone ?? "Not yet captured"}</strong></div><div><span>Independent projects</span><strong>{projects.length}</strong></div></div>
      <JobSiteMapCard location={client.jobSite} runtime={jobSiteMaps} contextLabel={`${client.code} ${client.name}`} />
      <section className="client-project-section"><header><h3>Projects for this client</h3><button onClick={onNewProject}><Plus size={14} /> New project</button></header>{projects.map((project) => <button type="button" className="client-project-link" key={project.id} onClick={() => onProject(project)}><div><Status text={project.status} /><strong>{project.name}</strong><span>{project.number} · {project.site}</span></div><ChevronRight size={16} /></button>)}{!projects.length ? <OperationsEmptyState variant="client-projects">No projects yet. Create the first independent project for this client.</OperationsEmptyState> : null}</section>
      <section className="client-account-notes"><h3>Account-level documents</h3><p>Store reusable client documents here. Project-specific documents stay inside their own project folders.</p></section>
    </div>
    <footer><button type="button" className="soft-button" onClick={() => setEditingClientSnapshot(client)}><Settings size={16} /> Edit client</button><button type="button" className="soft-button" onClick={() => setEditingContactSnapshot(client)} disabled={!contactEditable} title={contactEditable ? "Edit the saved primary contact" : "Wait for the automatic update after adding a primary contact"}><ContactRound size={16} /> Edit primary contact</button></footer>
  </AccessibleOverlay>
    {editingClientSnapshot && <ClientEditModal client={editingClientSnapshot} mapsRuntime={jobSiteMaps} onClose={() => setEditingClientSnapshot(null)} onSave={(patch, version) => onSaveClient(editingClientSnapshot, patch, version)} />}
    {editingContactSnapshot && <ContactEditModal client={editingContactSnapshot} onClose={() => setEditingContactSnapshot(null)} onSave={(patch, version) => onSaveContact(editingContactSnapshot, patch, version)} />}
  </>;
}
