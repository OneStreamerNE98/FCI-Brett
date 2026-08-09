"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ChevronRight, MapPin, Plus, Search } from "lucide-react";
import {
  Avatar,
  OperationsEmptyState,
  PageTitle,
  Status,
} from "../../components/operations/OperationsPrimitives";
import {
  OperationsActionableList,
  OperationsActionableListItem,
} from "../../components/operations/OperationsActionableList";
import { useRecordListPreferences } from "../../components/operations/useRecordListPreferences";
import { ActiveRouteFilter } from "../../features/reports/ActiveRouteFilter";
import {
  displayStatus,
  isActiveProject,
  recordInitials,
  terminalProjectStatuses,
} from "../../lib/record-display";
import {
  operationsHref,
  PROJECT_STATUS_FILTERS,
  type ProjectLifecycleFilter,
  type ProjectStatusFilter,
} from "../../lib/operations-routes";
import type { RecordListSortKey } from "../../lib/record-list-preferences";
import type { LiveDataState, Project } from "../../lib/record-types";

const PROJECT_ACTIONABLE_COLUMNS = [
  { key: "project", label: "Project" },
  { key: "status", label: "Status" },
  { key: "schedule", label: "Schedule & site" },
  { key: "value", label: "Value" },
  "",
] as const;
const PROJECT_INITIAL_ROW_CAP = 40;
const PROJECT_ROW_INCREMENT = 40;
const recordCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function ProjectsView({ projects, state, filter, lifecycle, onFilter, onProject, onNewProject }: { projects: Project[]; state: LiveDataState; filter: ProjectStatusFilter; lifecycle: ProjectLifecycleFilter | null; onFilter: (filter: ProjectStatusFilter) => void; onProject: (project: Project, returnFocusTarget?: HTMLElement | null) => void; onNewProject: () => void }) {
  const [projectSearch, setProjectSearch] = useState("");
  const deferredProjectSearch = useDeferredValue(projectSearch);
  const [reveal, setReveal] = useState({ key: "", cap: PROJECT_INITIAL_ROW_CAP });
  const { preference, update: updatePreference, loaded: preferencesLoaded, saving: savingPreference, error: preferenceError } = useRecordListPreferences("projects");
  const routeProjects = projects.filter((project) => {
    const status = project.status.toLowerCase();
    if (lifecycle) return status === lifecycle;
    return filter === "Active" ? !terminalProjectStatuses.has(status) : status === filter.toLowerCase();
  });
  const normalizedSearch = deferredProjectSearch.trim().toLowerCase();
  const filteredProjects = useMemo(() => {
    const matching = normalizedSearch ? routeProjects.filter((project) => [project.name, project.number, project.client, project.status, project.date, project.site].some((value) => value.toLowerCase().includes(normalizedSearch))) : routeProjects;
    const direction = preference.sortDirection === "ascending" ? 1 : -1;
    return [...matching].sort((left, right) => {
      if (preference.sortKey === "value") return direction * ((left.estimatedValue ?? 0) - (right.estimatedValue ?? 0) || recordCollator.compare(left.name, right.name));
      const leftValue = preference.sortKey === "status" ? left.status : preference.sortKey === "schedule" ? `${left.date} ${left.site}` : `${left.name} ${left.number} ${left.client}`;
      const rightValue = preference.sortKey === "status" ? right.status : preference.sortKey === "schedule" ? `${right.date} ${right.site}` : `${right.name} ${right.number} ${right.client}`;
      return direction * (recordCollator.compare(leftValue, rightValue) || recordCollator.compare(left.name, right.name));
    });
  }, [normalizedSearch, preference.sortDirection, preference.sortKey, routeProjects]);
  const revealKey = `${filter}\u0000${lifecycle ?? ""}\u0000${normalizedSearch}\u0000${preference.sortKey}\u0000${preference.sortDirection}`;
  const rowCap = reveal.key === revealKey ? reveal.cap : PROJECT_INITIAL_ROW_CAP;
  const renderedProjects = filteredProjects.slice(0, rowCap);
  const filterCount = (stage: string) => stage === "Active" ? projects.filter(isActiveProject).length : projects.filter((project) => project.status.toLowerCase() === stage.toLowerCase()).length;
  const lifecycleLabel = lifecycle ? displayStatus(lifecycle, "Unknown") : null;

  function chooseSort(sortKey: RecordListSortKey<"projects">) {
    const sortDirection = preference.sortKey === sortKey && preference.sortDirection === "ascending" ? "descending" : "ascending";
    void updatePreference({ sortKey, sortDirection });
  }

  return <><PageTitle eyebrow="Project delivery" title="Projects" text="Track every project separately, including repeat work for the same client." state="In development" action={<button className="primary-button" onClick={onNewProject}><Plus size={17} /> New project</button>} />
    <div className="filterbar"><div className="tabs" aria-label="Project status filter">{PROJECT_STATUS_FILTERS.map((stage) => <button className={filter === stage ? "active" : ""} aria-pressed={filter === stage} key={stage} onClick={() => onFilter(stage)}>{stage}<b>{filterCount(stage)}</b></button>)}</div></div>
    {lifecycleLabel && <ActiveRouteFilter focusKey={`project:${lifecycle}`} headingId="project-lifecycle-filter-title" title={`Filtered to ${lifecycleLabel}`} description="Showing projects with this exact lifecycle status." clearHref={operationsHref("Projects")} />}
    <div className="projects-table panel"><div className="client-directory-toolbar record-list-toolbar"><label><span>Find a project</span><div><Search size={15} /><input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Project, client, status, or site" /></div></label><div className="record-list-mobile-sort"><label><span>Sort projects</span><select value={preference.sortKey} onChange={(event) => void updatePreference({ ...preference, sortKey: event.target.value as RecordListSortKey<"projects"> })} disabled={!preferencesLoaded || savingPreference}><option value="project">Project</option><option value="status">Status</option><option value="schedule">Schedule &amp; site</option><option value="value">Value</option></select></label><button type="button" className="soft-button" onClick={() => void updatePreference({ ...preference, sortDirection: preference.sortDirection === "ascending" ? "descending" : "ascending" })} disabled={!preferencesLoaded || savingPreference} aria-label={`Sort ${preference.sortDirection === "ascending" ? "descending" : "ascending"}`}>{preference.sortDirection === "ascending" ? "A–Z ↑" : "Z–A ↓"}</button></div><small>{filteredProjects.length} of {routeProjects.length} projects</small>{preferenceError ? <small className="record-list-preference-error" role="alert">{preferenceError}</small> : null}</div><OperationsActionableList ariaLabel="Projects" columns={PROJECT_ACTIONABLE_COLUMNS} headerClassName="projects-table-head" sortKey={preference.sortKey} sortDirection={preference.sortDirection} sortDisabled={!preferencesLoaded || savingPreference} onSort={(key) => chooseSort(key as RecordListSortKey<"projects">)}>
      {renderedProjects.map((project) => <OperationsActionableListItem
        key={project.id}
        className="projects-table-row"
        accessibleName={`Open project ${project.number}: ${project.name}`}
        accessibleDescription={`Client ${project.client}. Status ${project.status}. Schedule ${project.date}. Site ${project.site}. Estimated value ${project.value}.`}
        onActivate={(trigger) => onProject(project, trigger)}
      >
        <span className="project-row-identity"><Avatar initials={recordInitials(project.client)} color={project.accent} /><span><strong>{project.name}</strong><small>{project.number} · {project.client}</small></span></span>
        <span className="project-row-status"><Status text={project.status} /></span>
        <span className="project-row-details"><span className={project.date.toLowerCase() === "not scheduled" ? "is-unscheduled" : ""}>{project.date}</span><small><MapPin size={12} aria-hidden="true" />{project.site}</small></span>
        <strong className="project-row-value"><span>Estimated value</span>{project.value}</strong>
        <ChevronRight size={17} aria-hidden="true" />
      </OperationsActionableListItem>)}
    </OperationsActionableList>{renderedProjects.length < filteredProjects.length ? <div className="record-list-reveal"><button type="button" className="soft-button" onClick={() => setReveal({ key: revealKey, cap: rowCap + PROJECT_ROW_INCREMENT })}>Show {Math.min(PROJECT_ROW_INCREMENT, filteredProjects.length - renderedProjects.length)} more projects</button><span>{renderedProjects.length} shown</span></div> : null}{!filteredProjects.length && <OperationsEmptyState variant="table" action={state !== "ready" ? undefined : normalizedSearch && routeProjects.length > 0 ? <button type="button" className="soft-button" onClick={() => setProjectSearch("")}>Clear search</button> : projects.length === 0 || (!lifecycle && filter === "Active") ? <button type="button" className="primary-button" onClick={onNewProject}><Plus size={16} /> New project</button> : <button type="button" className="soft-button" onClick={() => onFilter("Active")}>Show active projects</button>}>{state === "ready" ? normalizedSearch && routeProjects.length > 0 ? `No projects match “${projectSearch.trim()}”.` : lifecycleLabel ? `There are no projects in ${lifecycleLabel}.` : filter === "Active" ? "No active projects yet." : `There are no ${filter.toLowerCase()} projects.` : "Loading projects…"}</OperationsEmptyState>}</div>
  </>;
}
