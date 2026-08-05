"use client";

import { ChevronRight, MapPin, Plus } from "lucide-react";
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
import type { LiveDataState, Project } from "../../lib/record-types";

const PROJECT_ACTIONABLE_COLUMNS = ["Project", "Status", "Schedule & site", "Value", ""] as const;

export function ProjectsView({ projects, state, filter, lifecycle, onFilter, onProject, onNewProject }: { projects: Project[]; state: LiveDataState; filter: ProjectStatusFilter; lifecycle: ProjectLifecycleFilter | null; onFilter: (filter: ProjectStatusFilter) => void; onProject: (project: Project, returnFocusTarget?: HTMLElement | null) => void; onNewProject: () => void }) {
  const filteredProjects = projects.filter((project) => {
    const status = project.status.toLowerCase();
    if (lifecycle) return status === lifecycle;
    return filter === "Active" ? !terminalProjectStatuses.has(status) : status === filter.toLowerCase();
  });
  const filterCount = (stage: string) => stage === "Active" ? projects.filter(isActiveProject).length : projects.filter((project) => project.status.toLowerCase() === stage.toLowerCase()).length;
  const lifecycleLabel = lifecycle ? displayStatus(lifecycle, "Unknown") : null;

  return <><PageTitle eyebrow="Project delivery" title="Projects" text="Track every project separately, including repeat work for the same client." state="In development" action={<button className="primary-button" onClick={onNewProject}><Plus size={17} /> New project</button>} />
    <div className="filterbar"><div className="tabs" aria-label="Project status filter">{PROJECT_STATUS_FILTERS.map((stage) => <button className={filter === stage ? "active" : ""} aria-pressed={filter === stage} key={stage} onClick={() => onFilter(stage)}>{stage}<b>{filterCount(stage)}</b></button>)}</div></div>
    {lifecycleLabel && <ActiveRouteFilter focusKey={`project:${lifecycle}`} headingId="project-lifecycle-filter-title" title={`Filtered to ${lifecycleLabel}`} description="Showing projects with this exact lifecycle status." clearHref={operationsHref("Projects")} />}
    <div className="projects-table panel"><OperationsActionableList ariaLabel="Projects" columns={PROJECT_ACTIONABLE_COLUMNS} headerClassName="projects-table-head">
      {filteredProjects.map((project) => <OperationsActionableListItem
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
    </OperationsActionableList>{!filteredProjects.length && <OperationsEmptyState variant="table">{state === "ready" ? lifecycleLabel ? `There are no projects in ${lifecycleLabel}.` : filter === "Active" ? "No active projects yet." : `There are no ${filter.toLowerCase()} projects.` : "Loading projects…"}</OperationsEmptyState>}</div>
  </>;
}
