"use client";

import { type FormEvent, useState } from "react";
import { FolderTree, ShieldCheck, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { WorkspaceInfoHint } from "../../components/WorkspaceInfoHint";
import type { AddressReviewReference } from "../../domain/address-validation";
import { FLOORING_CATEGORIES, PROJECT_STATUSES, type FlooringCategory } from "../../domain/project-creation";
import { CALLBACK_NOTE_MAX_LENGTH } from "../../domain/project-operations";
import { normalizeProjectSegment } from "../../domain/project-segment";
import { AddressValidationField } from "../../features/address-validation/AddressValidationField";
import { normalizeJobSiteLocation, type JobSiteMapsRuntimeConfig } from "../../features/maps/job-site-map";
import { ProjectSegmentSelector } from "../../features/projects/ProjectSegmentSelector";
import { FINANCIAL_RESTRICTION_LABEL, FLOORING_KPI_TIME_ZONE } from "../../features/reports/flooring-kpis";
import { displayStatus, money } from "../../lib/record-display";
import type {
  Client,
  Project,
  ProjectConflictValues,
  ProjectEditPatch,
} from "../../lib/record-types";

const projectOperationDateInputFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: FLOORING_KPI_TIME_ZONE });
const PROJECT_STATUS_HINT = "Planning is pre-work, Mobilizing is readying crews and materials, Installation is the active install, Closeout is punch list and wrap-up.";
const PROJECT_FLOORING_CATEGORY_HINT = "The main material for this job. Use Specialty for niche products and Mixed when no single category dominates.";
const PROJECT_ESTIMATED_VALUE_HINT = "Expected job value before booking. If a contract value is later recorded, reporting prefers that figure.";

export class ProjectEditConflictError extends Error {
  currentVersion: string;
  currentValues: ProjectConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: ProjectConflictValues,
  ) {
    super(message);
    this.name = "ProjectEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}

export function optionalFlooringCategory(value: unknown): FlooringCategory | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (FLOORING_CATEGORIES as readonly string[]).includes(normalized) ? normalized as FlooringCategory : null;
}

function projectOperationDateInputValue(timestamp: number | null) {
  if (timestamp === null) return "";
  const parts = projectOperationDateInputFormatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function projectOperationTimestampFromDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day, 12);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : null;
}

export function projectManagerLabel(managerId: string | null, currentUserEmail: string, currentUserName: string) {
  if (!managerId) return "Unassigned";
  if (managerId === currentUserEmail.trim().toLowerCase()) return currentUserName.trim() ? `${currentUserName} (you)` : `${managerId} (you)`;
  return managerId;
}

export function NewProjectModal({ clients, initialClientId, managerId, managerLabel, isAdmin, mapsRuntime, onClose, onSave }: { clients: Client[]; initialClientId: string | null; managerId: string; managerLabel: string; isAdmin: boolean; mapsRuntime: JobSiteMapsRuntimeConfig; onClose: () => void; onSave: (project: Project) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [site, setSite] = useState("");
  const [addressReview, setAddressReview] = useState<AddressReviewReference | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); const clientId = String(form.get("clientId")); const client = clients.find((item) => item.id === clientId); if (!client) { setSaving(false); return; } const name = String(form.get("name")); const estimatedValue = form.get("value") ? Number(form.get("value")) : null; const flooringCategory = optionalFlooringCategory(form.get("flooringCategory")); const squareFeet = form.get("squareFeet") ? Number(form.get("squareFeet")) : null; const contractValue = isAdmin && form.get("contractValue") ? Number(form.get("contractValue")) : null; const segment = normalizeProjectSegment(form.get("segment")); const jobSite = normalizeJobSiteLocation({ address: site }); try { await onSave({ id: "", clientId, number: "", client: client.name, name, status: String(form.get("status")), progress: 0, value: estimatedValue === null ? "TBD" : money(estimatedValue), estimatedValue, flooringCategory, squareFeet, contractValue, segment, installationStartedAt: null, installationCompletedAt: null, hadCallback: false, callbackNote: null, site: jobSite?.address ?? "Site pending", jobSite, ...(addressReview ? { addressReview } : {}), managerId, lead: projectManagerLabel(managerId, managerId, managerLabel), date: "Not scheduled", accent: client.color }); } finally { setSaving(false); } }
  const selectedClientId = initialClientId && clients.some((client) => client.id === initialClientId) ? initialClientId : clients[0]?.id ?? "";
  return <AccessibleOverlay ariaLabel="Create a project" contentClassName="modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">Independent project</p><h2>Create a project</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      <label>Client<select data-overlay-initial-focus name="clientId" required defaultValue={selectedClientId} disabled={clients.length === 0}>{clients.length === 0 && <option value="">Create a client first</option>}{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select></label>
      <label>Project name<input name="name" required placeholder="Project name" /></label>
      <div className="form-row"><div className="modal-address-field"><AddressValidationField id="new-project-site" name="site" label="Site" value={site} required entityKind="project" targetId="new" mapsRuntime={mapsRuntime} disabled={saving} onChange={setSite} onReviewChange={setAddressReview} /></div><div className="assigned-manager-field" aria-label={`Project manager: ${managerLabel}, signed-in account`}><span>Project manager</span><strong>{managerLabel}</strong><small>{managerId} · signed-in account</small></div></div>
      <div className="form-row">
        <div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-project-status">Status</label><WorkspaceInfoHint label="Project phase help" text={PROJECT_STATUS_HINT} anchor="auto" /></div><select id="new-project-status" name="status"><option>Planning</option><option>Mobilizing</option><option>Installation</option><option>Closeout</option></select></div>
        <div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-project-estimated-value">Estimated value <span className="optional-label">Optional</span></label><WorkspaceInfoHint label="Project value help" text={PROJECT_ESTIMATED_VALUE_HINT} anchor="right" /></div><input id="new-project-estimated-value" name="value" type="number" min="0" step="1" inputMode="numeric" placeholder="Estimated amount" /></div>
      </div>
      <ProjectSegmentSelector />
      <div className="form-row modal-hint-form-row">
        <div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-project-flooring-category">Flooring category <span className="optional-label">Optional</span></label><WorkspaceInfoHint label="Flooring selection help" text={PROJECT_FLOORING_CATEGORY_HINT} anchor="auto" /></div><select id="new-project-flooring-category" name="flooringCategory" defaultValue=""><option value="">Not yet captured</option>{FLOORING_CATEGORIES.map((category) => <option key={category} value={category}>{displayStatus(category, category)}</option>)}</select></div>
        <label>Square feet <span className="optional-label">Optional</span><input name="squareFeet" type="number" min="1" step="1" inputMode="numeric" placeholder="Project square footage" /></label>
      </div>
      <label>Contract value <span className="optional-label">Optional</span><input name="contractValue" type="number" min="0" step="1" inputMode="numeric" placeholder={isAdmin ? "Sold price at booking" : FINANCIAL_RESTRICTION_LABEL} disabled={!isAdmin} aria-describedby="contract-value-help" /></label>
      <p id="contract-value-help" className="form-help"><ShieldCheck size={14} /> {isAdmin ? "Contract value is a financial field visible to administrators." : "An administrator can record the sold price at booking."}</p>
      <p className="form-help"><ShieldCheck size={14} /> The project is assigned to your authorized signed-in account. An administrator can correct an unassigned legacy project from its project drawer.</p>
      <p className="form-help"><FolderTree size={14} /> This creates an independent project number and Project Register row. Create its Drive folder from the project after saving.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || clients.length === 0}>{saving ? "Creating…" : clients.length === 0 ? "Add a client first" : "Create project"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

export function ProjectEditModal({ project, clients, isAdmin, mapsRuntime, onClose, onSave }: { project: Project; clients: Client[]; isAdmin: boolean; mapsRuntime: JobSiteMapsRuntimeConfig; onClose: () => void; onSave: (patch: ProjectEditPatch, version: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<ProjectConflictValues>({});
  const storedSite = project.site === "Site pending" ? null : project.site;
  const [site, setSite] = useState(storedSite ?? "");
  const [addressReview, setAddressReview] = useState<AddressReviewReference | null>(null);

  function savedValue(key: keyof ProjectConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    let displayValue: string;
    if (key === "clientId") {
      const client = clients.find((item) => item.id === value);
      displayValue = client ? `${client.name} · ${client.code}` : String(value);
    } else if (key === "estimatedValue" || key === "contractValue") {
      displayValue = typeof value === "number" ? money(value) : "Not set";
    } else if (key === "squareFeet") {
      displayValue = typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : "Not set";
    } else if (key === "segment") {
      displayValue = value === null
        ? "Derived from client industry"
        : displayStatus(String(value), String(value));
    } else if (key === "flooringCategory") {
      displayValue = value === null
        ? "Not yet captured"
        : displayStatus(String(value), String(value));
    } else if (key === "status") {
      displayValue = displayStatus(String(value), String(value));
    } else {
      displayValue = value === null || value === "" ? "Not set" : String(value);
    }
    return <small className="project-edit-saved-value">Saved value: {displayValue}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const version = conflictVersion ?? project.version;
    if (!version) {
      setError("This project is no longer in the current live list. Close and reopen it after the automatic update.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const clientId = String(form.get("clientId") ?? "").trim();
    const nextSite = site.trim() || null;
    const flooringCategory = optionalFlooringCategory(form.get("flooringCategory"));
    const squareFeetText = String(form.get("squareFeet") ?? "").trim();
    const squareFeet = squareFeetText ? Number(squareFeetText) : null;
    const segment = normalizeProjectSegment(form.get("segment"));
    const patch: ProjectEditPatch = {};

    if (name !== project.name) patch.name = name;
    if (clientId !== project.clientId) patch.clientId = clientId;
    if (nextSite !== storedSite || addressReview) {
      patch.site = nextSite;
      if (addressReview) patch.addressReview = addressReview;
    }
    if (flooringCategory !== project.flooringCategory) patch.flooringCategory = flooringCategory;
    if (squareFeet !== project.squareFeet) patch.squareFeet = squareFeet;
    if (segment !== project.segment) patch.segment = segment;

    if (isAdmin) {
      const status = String(form.get("status") ?? "").trim().toLowerCase();
      const estimatedValueText = String(form.get("estimatedValue") ?? "").trim();
      const estimatedValue = estimatedValueText ? Number(estimatedValueText) : null;
      const contractValueText = String(form.get("contractValue") ?? "").trim();
      const contractValue = contractValueText ? Number(contractValueText) : null;
      if (status !== project.status.toLowerCase()) patch.status = status;
      if (estimatedValue !== project.estimatedValue) patch.estimatedValue = estimatedValue;
      if (contractValue !== project.contractValue) patch.contractValue = contractValue;
    }

    if (Object.keys(patch).length === 0) {
      setError("Change at least one project field before saving.");
      return;
    }
    setSaving(true);
    try {
      await onSave(patch, version);
      onClose();
    } catch (saveError) {
      if (saveError instanceof ProjectEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError(addressReview
          ? "This project changed while you were editing. Your address review is still selected; review the other entries, then choose Re-apply changes."
          : "This project changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Project changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Edit ${project.number}`} contentClassName="modal project-edit-modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">{project.number}</p><h2>Edit project</h2></div><button type="button" onClick={onClose} aria-label="Close project editor" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Client<select data-overlay-initial-focus name="clientId" defaultValue={project.clientId} required disabled={saving}>{clients.map((client) => <option value={client.id} key={client.id}>{client.name} · {client.code}</option>)}</select>{savedValue("clientId")}</label>
      <label>Project name<input name="name" required maxLength={180} defaultValue={project.name} disabled={saving} />{savedValue("name")}</label>
      <div className="modal-address-field"><AddressValidationField id="project-site" name="site" label="Site" value={site} entityKind="project" targetId={project.id} mapsRuntime={mapsRuntime} disabled={saving} onChange={setSite} onReviewChange={setAddressReview} />{savedValue("site")}</div>
      {isAdmin ? <div className="form-row"><label>Status<select name="status" defaultValue={project.status.toLowerCase()} disabled={saving}>{PROJECT_STATUSES.map((status) => <option value={status} key={status}>{displayStatus(status, status)}</option>)}</select>{savedValue("status")}</label><label>Estimated value <span className="optional-label">Optional</span><input name="estimatedValue" type="number" min="0" step="1" inputMode="numeric" defaultValue={project.estimatedValue ?? ""} disabled={saving} />{savedValue("estimatedValue")}</label></div> : <><div className="drawer-stats" aria-label="Admin-only project fields"><div><span>Status</span><strong>{project.status}</strong></div><div><span>Estimated value</span><strong>{project.value}</strong></div><div><span>Contract value</span><strong>{FINANCIAL_RESTRICTION_LABEL}</strong></div></div><p className="form-help"><ShieldCheck size={14} /> Status and financial fields are read-only here. An admin can edit them.</p></>}
      <div className="form-row"><label>Flooring category <span className="optional-label">Optional</span><select name="flooringCategory" defaultValue={project.flooringCategory ?? ""} disabled={saving}><option value="">Not yet captured</option>{FLOORING_CATEGORIES.map((category) => <option key={category} value={category}>{displayStatus(category, category)}</option>)}</select>{savedValue("flooringCategory")}</label><label>Square feet <span className="optional-label">Optional</span><input name="squareFeet" type="number" min="1" step="1" inputMode="numeric" defaultValue={project.squareFeet ?? ""} disabled={saving} />{savedValue("squareFeet")}</label></div>
      <label>Project segment <span className="optional-label">Optional</span><select name="segment" defaultValue={project.segment ?? ""} disabled={saving}><option value="">Derived from client industry</option><option value="commercial">Commercial</option><option value="residential">Residential</option></select>{savedValue("segment")}</label>
      {isAdmin && <label>Contract value <span className="optional-label">Optional</span><input name="contractValue" type="number" min="0" step="1" inputMode="numeric" defaultValue={project.contractValue ?? ""} disabled={saving} />{savedValue("contractValue")}</label>}
      <p className="form-help"><ShieldCheck size={14} /> Saving appends one before-and-after activity record. A newer saved version is never overwritten automatically.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : conflictVersion ? "Re-apply changes" : "Save changes"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

export function InstallationDatesModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (installationStartedAt: number, installationCompletedAt: number) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const installationStartedAt = projectOperationTimestampFromDateInput(String(form.get("installationStartedAt") ?? ""));
    const installationCompletedAt = projectOperationTimestampFromDateInput(String(form.get("installationCompletedAt") ?? ""));
    if (installationStartedAt === null || installationCompletedAt === null) {
      setError("Enter valid installation start and completion dates.");
      return;
    }
    if (installationCompletedAt < installationStartedAt) {
      setError("Installation completion must be on or after installation start.");
      return;
    }
    setSaving(true);
    try {
      await onSave(installationStartedAt, installationCompletedAt);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Installation dates could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Record installation dates for ${project.number}`} contentClassName="modal project-operation-modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">{project.number}</p><h2>Record installation dates</h2></div><button type="button" onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>{error && <p className="project-operation-error" role="alert">{error}</p>}<div className="form-row"><label>Installation started<input data-overlay-initial-focus name="installationStartedAt" type="date" defaultValue={projectOperationDateInputValue(project.installationStartedAt)} required disabled={saving} /></label><label>Installation completed<input name="installationCompletedAt" type="date" defaultValue={projectOperationDateInputValue(project.installationCompletedAt)} required disabled={saving} /></label></div><p className="form-help"><ShieldCheck size={14} /> These dates feed install-cycle and completed-job reporting. Saving appends an activity event.</p><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Record installation dates"}</button></footer></form></AccessibleOverlay>;
}

export function FollowUpResultModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (hadCallback: boolean, callbackNote: string | null) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const callbackNote = String(form.get("callbackNote") ?? "").trim();
    setSaving(true);
    try {
      await onSave(form.get("hadCallback") === "yes", callbackNote || null);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The follow-up result could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Record follow-up result for ${project.number}`} contentClassName="modal project-operation-modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">{project.number}</p><h2>Record follow-up result</h2></div><button type="button" onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>{error && <p className="project-operation-error" role="alert">{error}</p>}<label>Post-installation callback<select data-overlay-initial-focus name="hadCallback" defaultValue={project.hadCallback ? "yes" : "no"} disabled={saving}><option value="yes">Yes</option><option value="no">No</option></select></label><label>Callback note <span className="optional-label">Optional</span><textarea name="callbackNote" defaultValue={project.callbackNote ?? ""} maxLength={CALLBACK_NOTE_MAX_LENGTH} placeholder="Record a concise result or issue" disabled={saving} /></label><p className="form-help"><ShieldCheck size={14} /> Callback notes are limited to {CALLBACK_NOTE_MAX_LENGTH.toLocaleString()} characters. Saving appends an activity event.</p><footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Record follow-up result"}</button></footer></form></AccessibleOverlay>;
}
