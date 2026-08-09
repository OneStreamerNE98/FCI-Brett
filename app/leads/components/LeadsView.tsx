"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Columns3, ChevronRight, Clock3, List, Plus, Search, Users, Zap } from "lucide-react";
import {
  OperationsActionableList,
  OperationsActionableListItem,
} from "../../components/operations/OperationsActionableList";
import { useRecordListPreferences } from "../../components/operations/useRecordListPreferences";
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
import type { RecordListSortKey } from "../../lib/record-list-preferences";

const LEAD_ACTIONABLE_COLUMNS = [
  { key: "client", label: "Client / opportunity" },
  { key: "stage", label: "Stage" },
  { key: "value", label: "Est. value" },
  { key: "next", label: "Next action" },
] as const;
const recordCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function leadMatchesStageFilter(lead: Lead, filter: LeadStageFilter) {
  const normalizedStage = lead.stage.toLowerCase();
  if (filter === "other") return !leadStages.some((stage) => stage.toLowerCase() === normalizedStage);
  return normalizedStage === LEAD_STAGE_LABELS[filter].toLowerCase();
}

export function LeadsView({ leads, state, filter, onAdd, onAdvance, onLead }: { leads: Lead[]; state: LiveDataState; filter: LeadStageFilter | null; onAdd: () => void; onAdvance: (id: string) => void; onLead: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void }) {
  const [leadSearch, setLeadSearch] = useState("");
  const deferredLeadSearch = useDeferredValue(leadSearch);
  const { preference, update: updatePreference, loaded: preferencesLoaded, saving: savingPreference, error: preferenceError } = useRecordListPreferences("leads");
  const activeLeads = leads.filter((lead) => lead.status.toLowerCase() === "active");
  const stageFilteredLeads = filter ? activeLeads.filter((lead) => leadMatchesStageFilter(lead, filter)) : activeLeads;
  const normalizedSearch = deferredLeadSearch.trim().toLowerCase();
  const visibleActiveLeads = useMemo(() => {
    const matching = normalizedSearch ? stageFilteredLeads.filter((lead) => [lead.company, lead.number, lead.contact, lead.project, lead.source, lead.site, lead.stage].some((value) => value.toLowerCase().includes(normalizedSearch))) : stageFilteredLeads;
    const direction = preference.sortDirection === "ascending" ? 1 : -1;
    return [...matching].sort((left, right) => {
      if (preference.sortKey === "value") return direction * (left.estimatedValue - right.estimatedValue || recordCollator.compare(left.company, right.company));
      const leftValue = preference.sortKey === "stage" ? left.stage : preference.sortKey === "next" ? `${left.nextActionAt ?? ""} ${left.next}` : `${left.company} ${left.project} ${left.number}`;
      const rightValue = preference.sortKey === "stage" ? right.stage : preference.sortKey === "next" ? `${right.nextActionAt ?? ""} ${right.next}` : `${right.company} ${right.project} ${right.number}`;
      return direction * (recordCollator.compare(leftValue, rightValue) || recordCollator.compare(left.company, right.company));
    });
  }, [normalizedSearch, preference.sortDirection, preference.sortKey, stageFilteredLeads]);
  const knownStages = new Set(leadStages.map((stage) => stage.toLowerCase()));
  const standardLeads = visibleActiveLeads.filter((lead) => knownStages.has(lead.stage.toLowerCase()));
  const customStageLeads = visibleActiveLeads.filter((lead) => !knownStages.has(lead.stage.toLowerCase()));
  const inactiveLeads = leads.filter((lead) => lead.status.toLowerCase() !== "active" && (!normalizedSearch || [lead.company, lead.number, lead.contact, lead.project, lead.source, lead.site, lead.stage].some((value) => value.toLowerCase().includes(normalizedSearch))));
  const pipelineValue = visibleActiveLeads.reduce((total, lead) => total + lead.estimatedValue, 0);
  const filterLabel = filter ? LEAD_STAGE_LABELS[filter] : null;
  const summary = state === "ready"
    ? filterLabel
      ? `${visibleActiveLeads.length} active ${visibleActiveLeads.length === 1 ? "lead" : "leads"} in ${filterLabel} · ${money(pipelineValue)} estimated value`
      : `${activeLeads.length} open opportunities · ${money(pipelineValue)} estimated value`
    : "Loading current pipeline totals…";
  const stagesToRender = filter && filter !== "other" ? [LEAD_STAGE_LABELS[filter]] : leadStages;

  function chooseSort(sortKey: RecordListSortKey<"leads">) {
    const sortDirection = preference.sortKey === sortKey && preference.sortDirection === "ascending" ? "descending" : "ascending";
    void updatePreference({ ...preference, sortKey, sortDirection });
  }

  return <><PageTitle eyebrow="Sales pipeline" title="Leads & opportunities" text={summary} state="In development" action={<button className="primary-button" onClick={onAdd}><Plus size={17} /> Add lead</button>} />
    {filterLabel && <ActiveRouteFilter focusKey={`lead:${filter}`} headingId="lead-stage-filter-title" title={`Filtered to ${filterLabel}`} description="Showing active leads that match the selected pipeline row." clearHref={operationsHref("Leads")} />}
    <div className="record-list-toolbar leads-list-toolbar"><label><span>Find a lead</span><div><Search size={15} /><input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Client, opportunity, contact, or stage" /></div></label><div className="record-view-toggle" aria-label="Lead view"><button type="button" aria-pressed={preference.view === "board"} onClick={() => void updatePreference({ ...preference, view: "board" })} disabled={!preferencesLoaded || savingPreference}><Columns3 size={16} aria-hidden="true" /> Board</button><button type="button" aria-pressed={preference.view === "list"} onClick={() => void updatePreference({ ...preference, view: "list" })} disabled={!preferencesLoaded || savingPreference}><List size={16} aria-hidden="true" /> List</button></div><div className="record-list-mobile-sort"><label><span>Sort leads</span><select value={preference.sortKey} onChange={(event) => void updatePreference({ ...preference, sortKey: event.target.value as RecordListSortKey<"leads"> })} disabled={!preferencesLoaded || savingPreference}><option value="client">Client / opportunity</option><option value="stage">Stage</option><option value="value">Estimated value</option><option value="next">Next action</option></select></label><button type="button" className="soft-button" onClick={() => void updatePreference({ ...preference, sortDirection: preference.sortDirection === "ascending" ? "descending" : "ascending" })} disabled={!preferencesLoaded || savingPreference} aria-label={`Sort ${preference.sortDirection === "ascending" ? "descending" : "ascending"}`}>{preference.sortDirection === "ascending" ? "A–Z ↑" : "Z–A ↓"}</button></div><small>{visibleActiveLeads.length} of {stageFilteredLeads.length} active leads</small>{preferenceError ? <small className="record-list-preference-error" role="alert">{preferenceError}</small> : null}</div>
    {visibleActiveLeads.length === 0 && state === "ready" ? <OperationsEmptyState variant="page" action={normalizedSearch ? <button className="soft-button" onClick={() => setLeadSearch("")}>Clear search</button> : filterLabel ? <Link className="soft-button" href={operationsHref("Leads")}>Show all active leads</Link> : <button className="primary-button" onClick={onAdd}><Plus size={16} /> Add first lead</button>}><div><Zap size={25} /></div><h2>{normalizedSearch ? `No active leads match “${leadSearch.trim()}”` : filterLabel ? `No active leads in ${filterLabel}` : "No active leads"}</h2><p>{normalizedSearch ? "Try a different client, opportunity, contact, or stage." : filterLabel ? "The report filter is valid, but no current records match it." : "Add your first lead. Inactive records remain listed below."}</p></OperationsEmptyState> : preference.view === "list" ? <LeadStatusPanel title="Active leads" subtitle="Sort every visible column or open a lead for the full record." leads={visibleActiveLeads} onLead={onLead} actionable sortKey={preference.sortKey} sortDirection={preference.sortDirection} sortDisabled={!preferencesLoaded || savingPreference} onSort={chooseSort} /> : standardLeads.length > 0 ? <div className={`board${filter ? " filtered-board" : ""}`}>{stagesToRender.map((stage) => { const stageLeads = standardLeads.filter((lead) => lead.stage.toLowerCase() === stage.toLowerCase()); return <section className="board-column" key={stage}><header><h2>{stage}</h2><b>{stageLeads.length}</b></header>{stageLeads.map((lead) => <article className="lead-card" key={lead.id}><div className="lead-card-head"><Avatar initials={lead.initials} color={lead.color} /><span>{lead.number}</span></div><h3>{lead.company}</h3><p>{lead.project}</p><div className="lead-value">{lead.value}</div><div className="lead-contact"><Users size={14} />{lead.contact}</div><button type="button" className="lead-detail-button" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button><footer><span>{lead.source}</span><button onClick={() => onAdvance(lead.id)} aria-label={`Advance ${lead.company} from ${lead.stage}`}>Advance <ChevronRight size={15} /></button></footer></article>)}{stageLeads.length === 0 && <OperationsEmptyState variant="board">No leads in this stage.</OperationsEmptyState>}</section>; })}</div> : null}
    {preference.view === "board" && customStageLeads.length > 0 && <LeadStatusPanel title="Custom pipeline stages" subtitle="These leads use stages outside the current pipeline. Review their stage before advancing them." leads={customStageLeads} onLead={onLead} />}
    {!filter && inactiveLeads.length > 0 && <LeadStatusPanel title="Inactive leads" subtitle="Converted, lost, closed, and archived leads are excluded from active totals." leads={inactiveLeads} showRecordStatus onLead={onLead} />}
  </>;
}

function LeadStatusRow({ lead, showRecordStatus, detailAction }: { lead: Lead; showRecordStatus: boolean; detailAction?: ReactNode }) {
  return <><div className="client-cell"><Avatar initials={lead.initials} color={lead.color} /><div className="client-cell-copy"><strong>{lead.company}</strong><span>{lead.project}</span></div></div><div><Status text={showRecordStatus ? displayStatus(lead.status, "Inactive") : lead.stage} /></div><strong className="value-cell">{lead.value}</strong><div className="next-cell lead-status-next"><span><Clock3 size={14} />{lead.next}</span>{detailAction}</div></>;
}

function LeadStatusPanel({ title, subtitle, leads, showRecordStatus = false, onLead, actionable = false, sortKey, sortDirection, sortDisabled = false, onSort }: { title: string; subtitle: string; leads: Lead[]; showRecordStatus?: boolean; onLead?: (lead: Lead, returnFocusTarget?: HTMLElement | null) => void; actionable?: boolean; sortKey?: RecordListSortKey<"leads">; sortDirection?: "ascending" | "descending"; sortDisabled?: boolean; onSort?: (key: RecordListSortKey<"leads">) => void }) {
  if (actionable) return <section className="panel pipeline-panel"><PanelHeader title={title} subtitle={subtitle} /><OperationsActionableList ariaLabel={title} columns={LEAD_ACTIONABLE_COLUMNS} headerClassName="pipeline-head" sortKey={sortKey} sortDirection={sortDirection} sortDisabled={sortDisabled} onSort={(key) => onSort?.(key as RecordListSortKey<"leads">)}>{leads.map((lead) => <OperationsActionableListItem key={lead.id} className="pipeline-row" accessibleName={`Open lead ${lead.company}: ${lead.project}`} accessibleDescription={`Stage ${lead.stage}. Estimated value ${lead.value}. Next action ${lead.next}.`} onActivate={(trigger) => onLead?.(lead, trigger)}><LeadStatusRow lead={lead} showRecordStatus={showRecordStatus} /></OperationsActionableListItem>)}</OperationsActionableList></section>;
  return <section className="panel pipeline-panel"><PanelHeader title={title} subtitle={subtitle} /><div className="pipeline-head"><span>Client / opportunity</span><span>{showRecordStatus ? "Status" : "Stage"}</span><span>Est. value</span><span>Next action</span></div>{leads.map((lead) => <div className="pipeline-row" key={lead.id}><LeadStatusRow lead={lead} showRecordStatus={showRecordStatus} detailAction={onLead && <button type="button" className="lead-status-detail" aria-label={`View details for ${lead.company}`} onClick={(event) => onLead(lead, event.currentTarget)}>View details <ChevronRight size={14} /></button>} /></div>)}</section>;
}
