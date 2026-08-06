"use client";

import { type FormEvent, useState } from "react";
import { FolderTree, ShieldCheck, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { WorkspaceInfoHint } from "../../components/WorkspaceInfoHint";
import { CLIENT_STATUSES } from "../../domain/client-creation";
import type { AddressReviewReference } from "../../domain/address-validation";
import { AddressValidationField } from "../../features/address-validation/AddressValidationField";
import { normalizeJobSiteLocation, type JobSiteMapsRuntimeConfig } from "../../features/maps/job-site-map";
import { CLIENT_INDUSTRY_OPTIONS } from "../../lib/client-industries";
import { displayStatus, recordInitials } from "../../lib/record-display";
import type {
  Client,
  ClientConflictValues,
  ClientEditPatch,
  ContactConflictValues,
  ContactEditPatch,
} from "../../lib/record-types";

const CLIENT_STATUS_HINT = "Active is a current working account, Prospect is not yet won, Inactive is dormant or closed.";

export class ClientEditConflictError extends Error {
  currentVersion: string;
  currentValues: ClientConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: ClientConflictValues,
  ) {
    super(message);
    this.name = "ClientEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}

export class ContactEditConflictError extends Error {
  currentVersion: string;
  currentValues: ContactConflictValues;

  constructor(
    message: string,
    currentVersion: string,
    currentValues: ContactConflictValues,
  ) {
    super(message);
    this.name = "ContactEditConflictError";
    this.currentVersion = currentVersion;
    this.currentValues = currentValues;
  }
}

export function ClientModal({ mapsRuntime, onClose, onSave }: { mapsRuntime: JobSiteMapsRuntimeConfig; onClose: () => void; onSave: (client: Client) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [siteAddress, setSiteAddress] = useState("");
  const [addressReview, setAddressReview] = useState<AddressReviewReference | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name"));
    const phone = String(form.get("phone") ?? "").trim() || null;
    try {
      await onSave({
        id: "",
        code: "",
        name,
        contact: String(form.get("contact")),
        contactPhone: phone,
        contactRole: String(form.get("role")),
        email: String(form.get("email")),
        industry: String(form.get("industry")),
        status: String(form.get("status")),
        initials: recordInitials(name),
        color: "sage",
        googleStatus: "Setup pending",
        jobSite: normalizeJobSiteLocation({ address: siteAddress }),
        ...(addressReview ? { addressReview } : {}),
      });
    } finally {
      setSaving(false);
    }
  }
  return <AccessibleOverlay ariaLabel="Add a client" contentClassName="modal" onClose={onClose} busy={saving}><header><div><p className="eyebrow">Client Directory</p><h2>Add a client</h2></div><button onClick={onClose} aria-label="Close" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>
    <label>Client business name<input data-overlay-initial-focus name="name" required maxLength={180} placeholder="Business name" /></label>
    <div className="form-row"><label>Primary contact<input name="contact" required maxLength={180} placeholder="Full name" /></label><label>Work email<input name="email" type="email" maxLength={254} required placeholder="name@company.com" /></label></div>
    <div className="form-row"><label>Contact phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={80} placeholder="Phone number" /></label><label>Contact role<input name="role" required maxLength={120} defaultValue="Primary contact" /></label></div>
    <div className="form-row modal-hint-form-row"><label>Industry<select name="industry">{CLIENT_INDUSTRY_OPTIONS.map((industry) => <option value={industry} key={industry}>{industry}</option>)}</select></label><div className="modal-hinted-field"><div className="modal-hint-label-row"><label htmlFor="new-client-status">Client status</label><WorkspaceInfoHint label="Client lifecycle help" text={CLIENT_STATUS_HINT} anchor="right" /></div><select id="new-client-status" name="status" defaultValue="active">{CLIENT_STATUSES.map((status) => <option value={status} key={status}>{displayStatus(status, status)}</option>)}</select></div></div>
    <div className="modal-address-field"><AddressValidationField id="new-client-site-address" name="siteAddress" label="Primary site address" value={siteAddress} entityKind="client" targetId="new" mapsRuntime={mapsRuntime} disabled={saving} onChange={setSiteAddress} onReviewChange={setAddressReview} /></div>
    <p className="form-help"><FolderTree size={14} /> The app saves the client and primary contact first, then syncs the Client Directory when Google Sheets is connected. The account folder is created with the first project workspace.</p>
    <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add client"}</button></footer>
  </form></AccessibleOverlay>;
}

export function ClientEditModal({ client, mapsRuntime, onClose, onSave }: { client: Client; mapsRuntime: JobSiteMapsRuntimeConfig; onClose: () => void; onSave: (patch: ClientEditPatch, version: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<ClientConflictValues>({});
  const initialSiteAddress = client.jobSite?.address ?? "";
  const [siteAddress, setSiteAddress] = useState(initialSiteAddress);
  const [addressReview, setAddressReview] = useState<AddressReviewReference | null>(null);
  const industry = client.industryRaw ?? null;
  const industryOptions = industry && !(CLIENT_INDUSTRY_OPTIONS as readonly string[]).includes(industry)
    ? [industry, ...CLIENT_INDUSTRY_OPTIONS]
    : CLIENT_INDUSTRY_OPTIONS;

  function savedValue(key: keyof ClientConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    const displayValue = key === "status"
      ? displayStatus(value, "Not set")
      : value === null || value === ""
        ? "Not set"
        : String(value);
    return <small className="project-edit-saved-value">Saved value: {displayValue}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const version = conflictVersion ?? client.version;
    if (!version) {
      setError("This client is no longer in the current live list. Close and reopen it after the automatic update.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const nextIndustry = String(form.get("industry") ?? "").trim() || null;
    const status = String(form.get("status") ?? "").trim().toLowerCase();
    const patch: ClientEditPatch = {};
    if (name !== client.name) patch.name = name;
    if (nextIndustry !== industry) patch.industry = nextIndustry;
    if (status !== client.status.toLowerCase()) patch.status = status;
    const normalizedSiteAddress = siteAddress.trim() || null;
    if (normalizedSiteAddress !== (initialSiteAddress || null) || addressReview) {
      patch.siteAddress = normalizedSiteAddress;
      if (addressReview) patch.addressReview = addressReview;
    }
    if (Object.keys(patch).length === 0) {
      setError("Change at least one client field before saving.");
      return;
    }
    setSaving(true);
    try {
      await onSave(patch, version);
      onClose();
    } catch (saveError) {
      if (saveError instanceof ClientEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError(addressReview
          ? "This client changed while you were editing. Your address review is still selected; review the other entries, then choose Re-apply changes."
          : "This client changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Client changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Edit ${client.code} client`} contentClassName="modal project-edit-modal client-edit-modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">{client.code}</p><h2>Edit client</h2></div><button type="button" onClick={onClose} aria-label="Close client editor" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Client business name<input data-overlay-initial-focus name="name" required maxLength={180} defaultValue={client.name} disabled={saving} />{savedValue("name")}</label>
      <div className="modal-address-field"><AddressValidationField id="client-site-address" name="siteAddress" label="Primary site address" value={siteAddress} entityKind="client" targetId={client.id} mapsRuntime={mapsRuntime} disabled={saving} onChange={setSiteAddress} onReviewChange={setAddressReview} />{savedValue("siteAddress")}</div>
      <div className="form-row"><label>Industry <span className="optional-label">Optional</span><select name="industry" defaultValue={industry ?? ""} disabled={saving}><option value="">Not set</option>{industryOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select>{savedValue("industry")}</label><label>Client status<select name="status" defaultValue={client.status.toLowerCase()} disabled={saving}>{CLIENT_STATUSES.map((status) => <option value={status} key={status}>{displayStatus(status, status)}</option>)}</select>{savedValue("status")}</label></div>
      <p className="form-help"><ShieldCheck size={14} /> Saving appends one before-and-after activity record. A newer saved version is never overwritten automatically.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : conflictVersion ? "Re-apply changes" : "Save changes"}</button></footer>
    </form>
  </AccessibleOverlay>;
}

export function ContactEditModal({ client, onClose, onSave }: { client: Client; onClose: () => void; onSave: (patch: ContactEditPatch, version: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<string | null>(null);
  const [conflictValues, setConflictValues] = useState<ContactConflictValues>({});

  function savedValue(key: keyof ContactConflictValues) {
    if (!Object.hasOwn(conflictValues, key)) return null;
    const value = conflictValues[key];
    return <small className="project-edit-saved-value">Saved value: {value === null || value === "" ? "Not set" : String(value)}</small>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const version = conflictVersion ?? client.contactVersion;
    if (!client.contactId || !version) {
      setError("This contact is no longer in the current live list. Close and reopen it after the automatic update.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim() || null;
    const phone = String(form.get("phone") ?? "").trim() || null;
    const role = String(form.get("role") ?? "").trim();
    const patch: ContactEditPatch = {};
    if (name !== client.contact) patch.name = name;
    if (email !== (client.email || null)) patch.email = email;
    if (phone !== client.contactPhone) patch.phone = phone;
    if (role !== client.contactRole) patch.role = role;
    if (Object.keys(patch).length === 0) {
      setError("Change at least one contact field before saving.");
      return;
    }
    setSaving(true);
    try {
      await onSave(patch, version);
      onClose();
    } catch (saveError) {
      if (saveError instanceof ContactEditConflictError) {
        setConflictVersion(saveError.currentVersion);
        setConflictValues(saveError.currentValues);
        setError("This contact changed while you were editing. Review your entries, then choose Re-apply changes.");
      } else {
        setError(saveError instanceof Error ? saveError.message : "Contact changes could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Edit primary contact for ${client.code}`} contentClassName="modal project-edit-modal contact-edit-modal" onClose={onClose} busy={saving}>
    <header><div><p className="eyebrow">{client.code}</p><h2>Edit primary contact</h2></div><button type="button" onClick={onClose} aria-label="Close contact editor" disabled={saving}><X size={20} /></button></header>
    <form onSubmit={submit}>
      {error && <p className="project-operation-error" role="alert">{error}</p>}
      <label>Primary contact<input data-overlay-initial-focus name="name" required maxLength={180} defaultValue={client.contact} disabled={saving} />{savedValue("name")}</label>
      <div className="form-row"><label>Work email <span className="optional-label">Optional</span><input name="email" type="email" maxLength={254} defaultValue={client.email} disabled={saving} />{savedValue("email")}</label><label>Contact phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={80} defaultValue={client.contactPhone ?? ""} disabled={saving} />{savedValue("phone")}</label></div>
      <label>Contact role<input name="role" required maxLength={120} defaultValue={client.contactRole} disabled={saving} />{savedValue("role")}</label>
      <p className="form-help"><ShieldCheck size={14} /> Saving appends one before-and-after activity record. A newer saved version is never overwritten automatically.</p>
      <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : conflictVersion ? "Re-apply changes" : "Save changes"}</button></footer>
    </form>
  </AccessibleOverlay>;
}
