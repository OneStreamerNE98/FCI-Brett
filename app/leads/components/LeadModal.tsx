"use client";

import { type FormEvent, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { WorkspaceInfoHint } from "../../components/WorkspaceInfoHint";
import type { AddressReviewReference } from "../../domain/address-validation";
import { AddressValidationField } from "../../features/address-validation/AddressValidationField";
import type { JobSiteMapsRuntimeConfig } from "../../features/maps/job-site-map";
import {
  displayStatus,
  leadStages,
  money,
  recordInitials,
} from "../../lib/record-display";
import type {
  Lead,
  LeadConflictValues,
  LeadEditPatch,
} from "../../lib/record-types";

type LeadModalProps =
  | {
      mode: "create";
      // Optional prefill for create mode: AI-10 sub-PR (f) accepts an email-derived
      // lead proposal by opening THIS modal pre-filled and posting through the
      // ordinary create path — the implement-once contract this packet ships so the
      // modal is never reworked a second time (review finding, PR #231).
      initialValues?: Partial<Lead>;
      isAdmin: boolean;
      mapsRuntime: JobSiteMapsRuntimeConfig;
      onClose: () => void;
      onSave: (lead: Lead) => Promise<void>;
    }
  | {
      mode: "edit";
      initialValues: Lead;
      isAdmin: boolean;
      mapsRuntime: JobSiteMapsRuntimeConfig;
      onClose: () => void;
      onSave: (patch: LeadEditPatch, version: string) => Promise<void>;
    };

const LEAD_ESTIMATED_VALUE_HINT = "Your rough estimate of the job's size before it's quoted. Feeds pipeline totals; it is not a committed contract amount.";

export class LeadEditConflictError extends Error {
  currentVersion: string;
  currentValues: LeadConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: LeadConflictValues,
  ) {
    super(message);
    this.name = "LeadEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}

function dateTimeLocalInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function dateTimeIsoValue(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function LeadModal(props: LeadModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<LeadConflictValues>({});
  const editLead = props.mode === "edit" ? props.initialValues : null;
  // seed feeds defaultValues in BOTH modes: full row in edit, optional prefill in
  // create (the AI-10 (f) consumption path). Mode logic stays keyed on editLead.
  const seed: Partial<Lead> | null = props.mode === "edit" ? props.initialValues : props.initialValues ?? null;
  const [site, setSite] = useState(seed?.site ?? "");
  const [addressReview, setAddressReview] = useState<AddressReviewReference | null>(null);
  const inboxPrefill = props.mode === "create" && props.initialValues !== undefined;
  const sourceOptions = ["Website", "Referral", "Bid invite", "Repeat client"];
  if (seed?.source && !sourceOptions.includes(seed.source)) sourceOptions.push(seed.source);
  const stageOptions = [...leadStages];
  if (seed?.stage && !stageOptions.includes(seed.stage)) stageOptions.push(seed.stage);

  function savedValue(key: keyof LeadConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    let displayValue: string;
    if (key === "estimatedValue") {
      displayValue = typeof value === "number" ? money(value) : "Not set";
    } else if (key === "nextActionAt") {
      displayValue = typeof value === "number"
        ? new Date(value).toLocaleString()
        : "Not set";
    } else if (key === "status") {
      displayValue = displayStatus(value, "Not set");
    } else if (key === "ownerEmail" && value === null) {
      displayValue = "Unavailable";
    } else {
      displayValue = value === null || value === "" ? "Not set" : String(value);
    }
    return <small className="project-edit-saved-value">Saved value: {displayValue}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const company = String(form.get("company") ?? "").trim();
    const contactName = String(form.get("contact") ?? "").trim();
    const projectName = String(form.get("project") ?? "").trim();
    const source = String(form.get("source") ?? "").trim();
    const normalizedSite = site.trim();
    const estimatedValue = Number(form.get("value") ?? editLead?.estimatedValue ?? 0);
    const nextAction = String(form.get("notes") ?? "").trim();
    const contactEmailText = String(form.get("contactEmail") ?? "").trim().toLowerCase();
    const contactEmail = contactEmailText || null;
    const contactPhone = String(form.get("contactPhone") ?? "").trim() || null;
    const stage = String(form.get("stage") ?? "New inquiry").trim() || "New inquiry";
    const nextActionAtText = String(form.get("nextActionAt") ?? "");
    const nextActionAt = dateTimeIsoValue(nextActionAtText);
    const ownerEmail = String(form.get("ownerEmail") ?? "").trim().toLowerCase();
    const status = String(form.get("status") ?? "active").trim().toLowerCase();

    if (props.mode === "create") {
      setSaving(true);
      try {
        await props.onSave({
          id: "",
          number: "",
          company,
          contact: contactName,
          contactEmail,
          contactPhone,
          project: projectName,
          value: money(estimatedValue),
          estimatedValue,
          stage,
          source,
          next: nextAction,
          nextActionAt,
          ownerEmail: ownerEmail || null,
          site: normalizedSite,
          ...(addressReview ? { addressReview } : {}),
          status: "active",
          initials: recordInitials(company),
          color: "sage",
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    const version = conflictVersion ?? props.initialValues.version;
    if (!version) {
      setError("This lead is no longer in the current live list. Close and reopen it after the automatic update.");
      return;
    }
    if (!ownerEmail && props.initialValues.ownerEmail) {
      setError("Lead owner email cannot be empty.");
      return;
    }
    const patch: LeadEditPatch = {};
    if (company !== props.initialValues.company) patch.company = company;
    if (contactName !== props.initialValues.contact) patch.contactName = contactName;
    if (contactEmail !== props.initialValues.contactEmail) patch.contactEmail = contactEmail;
    if (contactPhone !== props.initialValues.contactPhone) patch.contactPhone = contactPhone;
    if (projectName !== props.initialValues.project) patch.projectName = projectName;
    if (source !== props.initialValues.source) patch.source = source;
    if (stage !== props.initialValues.stage) patch.stage = stage;
    if (normalizedSite !== props.initialValues.site || addressReview) {
      patch.site = normalizedSite;
      if (addressReview) patch.addressReview = addressReview;
    }
    if (props.isAdmin && estimatedValue !== props.initialValues.estimatedValue) {
      patch.estimatedValue = estimatedValue;
    }
    if (nextAction !== props.initialValues.next) patch.nextAction = nextAction;
    if (nextActionAtText !== dateTimeLocalInputValue(props.initialValues.nextActionAt)) {
      patch.nextActionAt = nextActionAt;
    }
    if (ownerEmail && ownerEmail !== props.initialValues.ownerEmail) patch.ownerEmail = ownerEmail;
    if (status !== props.initialValues.status.toLowerCase()) patch.status = status;
    if (Object.keys(patch).length === 0) {
      setError("Change at least one lead field before saving.");
      return;
    }

    setSaving(true);
    try {
      await props.onSave(patch, version);
      props.onClose();
    } catch (saveError) {
      if (saveError instanceof LeadEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError(addressReview
          ? "This lead changed while you were editing. Your address review is still selected; review the other entries, then choose Re-apply changes."
          : "This lead changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Lead changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  const editMode = props.mode === "edit";
  const ariaLabel = editLead ? `Edit ${editLead.number}` : "Add a lead";
  return <AccessibleOverlay ariaLabel={ariaLabel} contentClassName="modal lead-edit-modal" onClose={props.onClose} busy={saving}>
    <header><div><p className="eyebrow">{editLead ? editLead.number : "New opportunity"}</p><h2>{editLead ? "Edit lead" : "Add a lead"}</h2></div><button type="button" onClick={props.onClose} aria-label={editLead ? "Close lead editor" : "Close"} disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Client company<input data-overlay-initial-focus name="company" required maxLength={180} placeholder="Business name" defaultValue={seed?.company ?? ""} disabled={saving} />{savedValue("company")}</label>
      <div className="form-row"><label>Primary contact<input name="contact" required maxLength={160} placeholder="Full name" defaultValue={seed?.contact ?? ""} disabled={saving} />{savedValue("contactName")}</label><label>Lead source<select name="source" defaultValue={seed?.source ?? "Website"} disabled={saving}>{sourceOptions.map((option) => <option key={option}>{option}</option>)}</select>{savedValue("source")}</label></div>
      <div className="form-row"><label>Contact email <span className="optional-label">Optional</span><input name="contactEmail" type="email" maxLength={254} defaultValue={seed?.contactEmail ?? ""} disabled={saving} />{savedValue("contactEmail")}</label><label>Contact phone <span className="optional-label">Optional</span><input name="contactPhone" type="tel" maxLength={40} defaultValue={seed?.contactPhone ?? ""} disabled={saving} />{savedValue("contactPhone")}</label></div>
      <label>Project / opportunity<input name="project" required maxLength={180} placeholder="Project name" defaultValue={seed?.project ?? ""} disabled={saving} />{savedValue("projectName")}</label>
      <div className="form-row modal-hint-form-row"><div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="lead-estimated-value">Estimated value</label><WorkspaceInfoHint label="Lead value help" text={LEAD_ESTIMATED_VALUE_HINT} anchor="auto" /></div><input id="lead-estimated-value" name="value" type="number" min="0" max="2147483647" step="1" required placeholder="Estimated amount" defaultValue={seed?.estimatedValue ?? ""} disabled={saving || editMode && !props.isAdmin} aria-describedby={editMode && !props.isAdmin ? "lead-estimated-value-help" : undefined} />{inboxPrefill && seed?.estimatedValue === undefined && <small>Still needs typing before this lead can be added.</small>}{savedValue("estimatedValue")}</div><div className="modal-address-field"><AddressValidationField id="lead-site" name="site" label="Project site" value={site} required entityKind="lead" targetId={editLead?.id ?? "new"} mapsRuntime={props.mapsRuntime} disabled={saving} onChange={setSite} onReviewChange={setAddressReview} />{inboxPrefill && !seed?.site && <small>Still needs typing before this lead can be added.</small>}{savedValue("site")}</div></div>
      {editMode && !props.isAdmin && <p id="lead-estimated-value-help" className="form-help"><ShieldCheck size={14} /> Estimated value is read-only here. An administrator can edit it.</p>}
      {(editMode || inboxPrefill) && <div className="form-row"><label>Stage<select name="stage" defaultValue={seed?.stage ?? "New inquiry"} disabled={saving}>{stageOptions.map((option) => <option key={option}>{option}</option>)}</select>{savedValue("stage")}</label>{editMode && <label>Lead status<select name="status" defaultValue={editLead?.status.toLowerCase()} disabled={saving}><option value="active">Active</option><option value="converted">Converted</option><option value="lost">Lost</option><option value="archived">Archived</option></select>{savedValue("status")}</label>}</div>}
      <label>Next action<textarea name="notes" required maxLength={500} placeholder="What needs to happen next?" defaultValue={seed?.next ?? ""} disabled={saving} />{savedValue("nextAction")}</label>
      {(editMode || inboxPrefill) && <div className="form-row"><label>Next action date <span className="optional-label">Optional</span><input name="nextActionAt" type="datetime-local" defaultValue={dateTimeLocalInputValue(seed?.nextActionAt ?? null)} disabled={saving} />{savedValue("nextActionAt")}</label><label>Lead owner email {editMode ? null : <span className="optional-label">Optional</span>}<input name="ownerEmail" type="email" maxLength={254} placeholder={editMode ? "Authorized office email" : "Signed-in user when left blank"} defaultValue={seed?.ownerEmail ?? ""} disabled={saving} />{savedValue("ownerEmail")}{editMode && editLead?.ownerEmail === null && <small>The saved owner is unavailable because it is not a current authorized office identity.</small>}</label></div>}
      {editMode && <p className="form-help"><ShieldCheck size={14} /> Saving appends before-and-after activity records. A newer saved version is never overwritten automatically.</p>}
      <footer><button type="button" className="soft-button" onClick={props.onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : editMode ? conflictVersion ? "Re-apply changes" : "Save changes" : "Add to pipeline"}</button></footer>
    </form>
  </AccessibleOverlay>;
}
