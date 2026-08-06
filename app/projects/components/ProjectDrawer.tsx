"use client";

import { type RefObject, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, FolderOpen, MapPin, MessageSquareText, Settings, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { FeatureStateBadge } from "../../components/FeatureStateBadge";
import { Status } from "../../components/operations/OperationsPrimitives";
import { JobSiteMapCard } from "../../features/maps/JobSiteMapCard";
import { FINANCIAL_RESTRICTION_LABEL, FLOORING_KPI_TIME_ZONE } from "../../features/reports/flooring-kpis";
import { displayStatus, money } from "../../lib/record-display";
import type { Client, Notify, Project, ProjectEditPatch } from "../../lib/record-types";
import type { JobSiteMapsRuntimeConfig } from "../../features/maps/job-site-map";
import { ProjectFileCreationModal, ProjectFilesPanel, useProjectFilesController } from "./ProjectFilesPanel";
import { FollowUpResultModal, InstallationDatesModal, ProjectEditModal } from "./ProjectModals";
import { ProjectMeetings } from "./ProjectMeetings";

const projectOperationDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: FLOORING_KPI_TIME_ZONE });

function formatProjectOperationDate(timestamp: number | null) {
  return timestamp === null ? "Not yet recorded" : projectOperationDateFormatter.format(new Date(timestamp));
}

export function ProjectDrawer({ project, clients, jobSiteMaps, onClose, notify, onSaveProject, onProvisionDrive, onAssignToMe, onRecordInstallationDates, onRecordFollowUpResult, onMeetingRecorded, isAdmin, currentUserEmail, returnFocusRef }: { project: Project; clients: Client[]; jobSiteMaps: JobSiteMapsRuntimeConfig; onClose: () => void; notify: Notify; onSaveProject: (project: Project, patch: ProjectEditPatch, version: string) => Promise<void>; onProvisionDrive: (project: Project) => Promise<void>; onAssignToMe: (project: Project) => Promise<void>; onRecordInstallationDates: (project: Project, installationStartedAt: number, installationCompletedAt: number) => Promise<void>; onRecordFollowUpResult: (project: Project, hadCallback: boolean, callbackNote: string | null) => Promise<void>; onMeetingRecorded: () => void; isAdmin: boolean; currentUserEmail: string; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [tab, setTab] = useState<"Overview" | "Files" | "Meetings">("Overview");
  const [editingSnapshot, setEditingSnapshot] = useState<Project | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [assigningManager, setAssigningManager] = useState(false);
  const [installationDatesOpen, setInstallationDatesOpen] = useState(false);
  const [followUpResultOpen, setFollowUpResultOpen] = useState(false);
  const projectFilesTriggerRef = useRef<HTMLButtonElement>(null);
  const projectFiles = useProjectFilesController(project.id, project.driveFolderId);
  const busy = provisioning || assigningManager;

  async function handleDrive() {
    if (project.driveUrl) {
      window.open(project.driveUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setProvisioning(true);
    await onProvisionDrive(project);
    setProvisioning(false);
  }

  async function handleAssignToMe() {
    setAssigningManager(true);
    try {
      await onAssignToMe(project);
    } finally {
      setAssigningManager(false);
    }
  }

  return <><AccessibleOverlay variant="drawer" ariaLabel={`${project.number} ${project.name}`} contentClassName="project-drawer" onClose={onClose} busy={busy} returnFocusRef={returnFocusRef}>
      <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close project" disabled={busy}><X size={20} /></button><Status text={project.status} /><span>{project.number}</span></header>
      <div className="drawer-title"><p>{project.client}</p><h2>{project.name}</h2><div><span><MapPin size={14} />{project.site}</span><span><CalendarDays size={14} />{project.date}</span></div></div>
      <nav aria-label="Available project views">{(["Overview", "Files", "Meetings"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <div className="drawer-body" tabIndex={0} aria-label="Project details">
        {tab === "Overview" ? <>
          <section className="project-health"><div><span>Delivery progress</span><strong>Not tracked yet</strong></div><p><CheckCircle2 size={15} /> This live project is managed independently from other client work</p></section>
          <JobSiteMapCard location={project.jobSite} runtime={jobSiteMaps} contextLabel={`${project.number} ${project.name}`} />
          <div className="drawer-stats"><div><span>Estimated value</span><strong>{project.value}</strong></div><div><span>Contract value</span><strong>{!isAdmin ? FINANCIAL_RESTRICTION_LABEL : project.contractValue === null ? "Not yet captured" : money(project.contractValue)}</strong></div><div><span>Segment</span><strong>{displayStatus(project.segment ?? "commercial", "Commercial")}</strong></div><div><span>Flooring category</span><strong>{project.flooringCategory === null ? "Not yet captured" : displayStatus(project.flooringCategory, project.flooringCategory)}</strong></div><div><span>Square feet</span><strong>{project.squareFeet === null ? "Not yet captured" : new Intl.NumberFormat("en-US").format(project.squareFeet)}</strong></div><div><span>Installation started</span><strong>{formatProjectOperationDate(project.installationStartedAt)}</strong></div><div><span>Installation completed</span><strong>{formatProjectOperationDate(project.installationCompletedAt)}</strong></div><div><span>Post-installation callback</span><strong>{project.hadCallback ? "Yes recorded" : "No recorded callback"}</strong>{project.callbackNote ? <small>{project.callbackNote}</small> : !project.hadCallback && <small>Default No can include an uncaptured legacy result.</small>}</div><div className="project-manager-stat"><span>Project manager</span><strong>{project.lead}</strong>{project.managerId === currentUserEmail ? <small>Assigned to your signed-in account</small> : isAdmin ? <button className="manager-assignment-button" onClick={() => void handleAssignToMe()} disabled={assigningManager}>{assigningManager ? "Assigning…" : "Assign to me"}</button> : project.managerId ? <small>Authorized office account</small> : <small>No authorized manager is assigned</small>}</div><div><span>Drive folder</span><strong>{project.driveFolderId ? "Ready" : "Setup required"}</strong></div></div>
          <section className="project-operation-actions"><header><h3>Installation &amp; follow-up</h3><p>{isAdmin ? "Record the dates and callback outcome used by flooring KPI reporting." : "Only an administrator can record installation dates and callback results."}</p></header>{isAdmin && <div><button type="button" className="soft-button" onClick={() => setInstallationDatesOpen(true)}><CalendarDays size={16} /> Record installation dates</button><button type="button" className="soft-button" onClick={() => setFollowUpResultOpen(true)}><MessageSquareText size={16} /> Record follow-up result</button></div>}</section>
          <section className="project-capability-plan"><header><div><h3>Planned project capabilities</h3><p>These items are informational and are not available as controls yet.</p></div><FeatureStateBadge state="Planned" /></header><ul><li>Durable tasks and scheduled reminders</li><li>Indexed project files beyond the working Drive folder link</li><li>Crews, shifts, and field schedule</li><li>Project activity feed and outbound updates</li></ul></section>
        </> : tab === "Files"
          ? <ProjectFilesPanel controller={projectFiles} newDocumentTriggerRef={projectFilesTriggerRef} />
          : <ProjectMeetings project={project} notify={notify} onMeetingRecorded={onMeetingRecorded} />}
      </div>
      <footer>
        <button className="soft-button" type="button" onClick={() => setEditingSnapshot(project)} disabled={busy}><Settings size={16} /> Edit project</button>
        <button className="soft-button" onClick={handleDrive} disabled={busy}><FolderOpen size={16} /> {provisioning ? "Creating folder…" : project.driveUrl ? "Open Drive folder" : "Create Drive folder"}</button>
      </footer>
  </AccessibleOverlay>
    {editingSnapshot && <ProjectEditModal project={editingSnapshot} clients={clients} isAdmin={isAdmin} mapsRuntime={jobSiteMaps} onClose={() => setEditingSnapshot(null)} onSave={(patch, version) => onSaveProject(editingSnapshot, patch, version)} />}
    {installationDatesOpen && <InstallationDatesModal project={project} onClose={() => setInstallationDatesOpen(false)} onSave={(installationStartedAt, installationCompletedAt) => onRecordInstallationDates(project, installationStartedAt, installationCompletedAt)} />}
    {followUpResultOpen && <FollowUpResultModal project={project} onClose={() => setFollowUpResultOpen(false)} onSave={(hadCallback, callbackNote) => onRecordFollowUpResult(project, hadCallback, callbackNote)} />}
    {projectFiles.modalOpen && projectFiles.catalogState.status === "ready" && projectFiles.catalogState.catalog.provisioned && <ProjectFileCreationModal catalog={projectFiles.catalogState.catalog} controller={projectFiles} projectId={project.id} projectNumber={project.number} returnFocusRef={projectFilesTriggerRef} />}
  </>;
}
