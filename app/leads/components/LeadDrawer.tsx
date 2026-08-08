"use client";

import { type RefObject, useState } from "react";
import {
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  MapPin,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { Status } from "../../components/operations/OperationsPrimitives";
import type { JobSiteMapsRuntimeConfig } from "../../features/maps/job-site-map";
import { leadStages } from "../../lib/record-display";
import type { Lead, LeadEditPatch } from "../../lib/record-types";
import { LeadModal } from "./LeadModal";

export function LeadDrawer({ lead, isAdmin, mapsRuntime, onClose, onAdvance, onSaveLead, returnFocusRef, fallbackFocusRef }: { lead: Lead; isAdmin: boolean; mapsRuntime: JobSiteMapsRuntimeConfig; onClose: () => void; onAdvance: (id: string) => Promise<void>; onSaveLead: (lead: Lead, patch: LeadEditPatch, version: string) => Promise<void>; returnFocusRef?: RefObject<HTMLElement | null>; fallbackFocusRef?: RefObject<HTMLElement | null> }) {
  const [advancing, setAdvancing] = useState(false);
  const [editing, setEditing] = useState(false);
  const currentIndex = leadStages.findIndex((stage) => stage.toLowerCase() === lead.stage.toLowerCase());
  const canAdvance = lead.status.toLowerCase() === "active" && currentIndex >= 0 && currentIndex < leadStages.length - 1;

  async function handleAdvance() {
    setAdvancing(true);
    try {
      await onAdvance(lead.id);
    } finally {
      setAdvancing(false);
    }
  }

  return <><AccessibleOverlay variant="drawer" ariaLabel={`${lead.number} ${lead.company}`} contentClassName="project-drawer lead-drawer" onClose={onClose} busy={advancing} returnFocusRef={returnFocusRef} fallbackFocusRef={fallbackFocusRef}>
    <header><button data-overlay-initial-focus onClick={onClose} aria-label="Close lead details" disabled={advancing}><X size={20} /></button><Status text={lead.stage} /><span>{lead.number}</span></header>
    <div className="drawer-title"><p>Lead opportunity</p><h2>{lead.company}</h2><div><span><BriefcaseBusiness size={14} />{lead.project}</span><span><MapPin size={14} />{lead.site}</span></div></div>
    <div className="drawer-body">
      <div className="drawer-stats"><div><span>Estimated value</span><strong>{lead.value}</strong></div><div><span>Stage</span><strong>{lead.stage}</strong></div><div><span>Primary contact</span><strong>{lead.contact}</strong></div><div><span>Lead source</span><strong>{lead.source}</strong></div></div>
      <section className="lead-next-action"><h3>Next action</h3><p><Clock3 size={15} />{lead.next}</p></section>
      <section className="lead-record-note"><ShieldCheck size={16} /><p>Edit saved lead details here. Advance stage remains a separate deliberate action and can be undone from the confirmation message.</p></section>
    </div>
    <footer><button type="button" className="soft-button" onClick={() => setEditing(true)} disabled={advancing}><Settings size={16} /> Edit lead</button><button type="button" className="soft-button" onClick={onClose} disabled={advancing}>Close</button>{canAdvance && <button type="button" className="primary-button" onClick={() => void handleAdvance()} disabled={advancing}>{advancing ? "Advancing…" : <><span>Advance stage</span><ChevronRight size={16} /></>}</button>}</footer>
  </AccessibleOverlay>
    {editing && <LeadModal mode="edit" initialValues={lead} isAdmin={isAdmin} mapsRuntime={mapsRuntime} onClose={() => setEditing(false)} onSave={(patch, version) => onSaveLead(lead, patch, version)} />}
  </>;
}
