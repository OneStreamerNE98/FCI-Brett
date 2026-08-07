"use client";

import Link from "next/link";
import { ChevronRight, Clock3, Plus, Users, Zap } from "lucide-react";
import {
  Avatar,
  OperationsEmptyState,
  PageTitle,
  PanelHeader,
  Status,
} from "../../components/operations/OperationsPrimitives";
import { ActiveRouteFilter } from "../../features/reports/ActiveRouteFilter";
import { displayStatus, leadStages, money } from "../../lib/record-display";
import {
  LEAD_STAGE_LABELS,
  operationsHref,
  type LeadStageFilter,
} from "../../lib/operations-routes";
import type { Lead, LiveDataState } from "../../lib/record-types";

function leadMatchesStageFilter(lead: Lead, filter: LeadStageFilter) {
  const normalizedStage = lead.stage.toLowerCase();
  if (filter === "other") return !leadStages.some((stage) => stage.toLowerCase() === normalizedStage);
  return normalizedStage === LEAD_STAGE_LABELS[filter].toLowerCase();
}

export function LeadsView({ leads, state, filter, onAdd, onAdvance, onLead }: { leads: Lead[]; state: LiveDataState; filter: LeadStageFilter | null; onAdd: () => void; onAdvance: (id: string) => void; onLead: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
  const activeLeads = leads.filter((lead) => lead.status.toLowerCase() === "active");
  const visibleActiveLeads = filter ? activeLeads.filter((lead) => leadMatchesStageFilter(lead, filter)) : activeLeads;
  const knownStages = new Set(leadStages.map((stage) => stage.toLowerCase()));
  const standardLeads = visibleActiveLeads.filter((lead) => knownStages.has(lead.stage.toLowerCase()));
  const customStageLeads = visibleActiveLeads.filter((lead) => !knownStages.has(lead.stage.toLowerCase()));
  const inactiveLeads = leads.filter((lead) => lead.status.toLowerCase() !== "active");
  const pipelineValue = visibleActiveLeads.reduce((total, lead) => total + lead.estimatedValue, 0);
  const filterLabel = filter ? LEAD_STAGE_LABELS[filter] : null;
  const summary = state === "ready"
    ? filterLabel
      ? `${visibleActiveLeads.length} active ${visibleActiveLeads.length === 1 ? "lead" : "leads"} in ${filterLabel} · ${money(pipelineValue)} estimated value`
      : `${activeLeads.length} open opportunities · ${money(pipelineValue)} estimated value`
    : "Loading current pipeline totals…";
  const stagesToRender = filter && filter !== "other" ? [LEAD_STAGE_LABELS[filter]] : leadStages;

  return <><PageTitle eyebrow="Sales pipeline" title="Leads & opportunities" text={summary} state="In development" action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Add lead</button>} />
    {filterLabel && <ActiveRouteFilter focusKey={`lead:${filter}`} headingId="lead-stage-filter-title" title={`Filtered to ${filterLabel}`} description="Showing active leads that match the selected pipeline row." clearHref={operationsHref("Leads")} />}
    {visibleActiveLeads.length === 0 && state === "ready" ? <OperationsEmptyState variant="page" action={filterLabel ? <Link className="soft-button" href={operationsHref("Leads")}>Show all active leads</Link> : <button className="primary-button" onClick={onAdd}><Plus size={16} /> Add first lead</button>}><div><Zap size={25} /></div><h2>{filterLabel ? `No active leads in ${filterLabel}` : "No active leads"}</h2><p>{filterLabel ? "The report filter is valid, but no current records match it." : "Add your first lead. Inactive records remain listed below."}</p></OperationsEmptyState> : standardLeads.length > 0 ? <div className={`board${filter ? " filtered-board" : ""}`}>{stagesToRender.map((stage) => { const stageLeads = standardLeads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase()); return <section className="board-column" key={stage}><header><h2>{stage}</h2><b>{stageLeads.length}</b></header>{stageLeads.map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.number}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><button type="button" className="lead-detail-button" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button><footer><span>{lead.source}</span><button onClick={() => onAdvance(lead.id)} aria-label={`Advance ${lead.company} from ${lead.stage}`}>Advance <ChevronRight size={15} /></button></footer></article>)}{stageLeads.length === 0 && <OperationsEmptyState variant="board">No leads in this stage.</OperationsEmptyState>}</section>; })}</div> : null}
    {customStageLeads.length > 0 && <LeadStatusPanel title="Custom pipeline stages" subtitle="These leads use stages outside the current pipeline. Review their stage before advancing them." leads={customStageLeads} onLead={onLead} />}
    {!filter && inactiveLeads.length > 0 && <LeadStatusPanel title="Inactive leads" subtitle="Converted, lost, closed, and archived leads are excluded from active totals." leads={inactiveLeads} showRecordStatus onLead={onLead} />}
  </>;
}

function LeadStatusPanel({ title, subtitle, leads, showRecordStatus = false, onLead }: { title: string; subtitle: string; leads: Lead[]; showRecordStatus?: boolean; onLead?: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
  return <section className="panel pipeline-panel"><PanelHeader title={title} subtitle={subtitle} /><div className="pipeline-head"><span>Client / opportunity</span><span>{showRecordStatus ? "Status" : "Stage"}</span><span>Est. value</span><span>Next action</span></div>{leads.map((lead) => <div className="pipeline-row" key={lead.id}><div className="client-cell"><Avatar initials={lead.initials} color={lead.color} /><div className="client-cell-copy"><strong>{lead.company}</strong><span>{lead.project}</span></div></div><div><Status text={showRecordStatus ? displayStatus(lead.status, "Inactive") : lead.stage} /></div><strong className="value-cell">{lead.value}</strong><div className="next-cell lead-status-next"><span><Clock3 size={14} />{lead.next}</span>{onLead && <button type="button" className="lead-status-detail" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button>}</div></div>)}</section>;
}
