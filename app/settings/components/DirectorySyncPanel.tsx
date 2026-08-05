"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  FolderTree,
  Inbox,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { FIRST_RUN_IMPORT_TEST_MARKER } from "../../domain/first-run-import";
import { FirstRunImportCard } from "../../import/components/FirstRunImportCard";
import {
  cachedGetJson,
  invalidateCachedGet,
  isTerminalCachedGetError,
} from "../../lib/client-get-cache";
import { useCachedGetSubscription } from "../../lib/client-get-hooks";
import { sheetMirrorStatusLabel, type SheetMirrorStatus } from "../../lib/sheet-mirror-status";
import { EFFECTIVE_WORKSPACE_RESOURCE_SPECS } from "../../lib/workspace-effective-config";
import styles from "./DirectorySyncPanel.module.css";

const FORM_LEAD_PATH = "/api/v1/integrations/google/forms/leads";
const LEADS_PATH = "/api/v1/leads";
const CLIENT_DIRECTORY_SHEET_KEY = EFFECTIVE_WORKSPACE_RESOURCE_SPECS.clientDirectorySheet.envVar;
const FORM_LEAD_SOURCE = "Google Form";

type FormLeadProposal = Readonly<{
  company: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  projectName: string;
  source: string;
  stage: string;
  site: string;
  estimatedValue: number | null;
  nextAction: string;
  nextActionAt: number | null;
  rooms: string | null;
  flooringType: string | null;
  preferredContact: string | null;
}>;

type FormLeadReview = Readonly<{
  id: string;
  sourceRow: number;
  submittedAt: string | null;
  state: "ready" | "duplicate" | "invalid";
  status: "needs-review";
  proposal: FormLeadProposal;
  reasons: readonly string[];
  createdAt: number;
  updatedAt: number;
}>;

type FormLeadIntakeState = Readonly<{
  configured: boolean;
  invalidConfiguration: boolean;
  configurationName: string;
  configurationSource: "simulation" | "app" | "env" | "none";
  simulation: boolean;
  actorEmail: string;
  rowLimit: number;
  watermark: Readonly<{
    lastProcessedRow: number;
    lastProcessedAt: number;
  }> | null;
  queue: readonly FormLeadReview[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown) {
  return value === null || typeof value === "string";
}

function isFormLeadProposal(value: unknown): value is FormLeadProposal {
  return isRecord(value)
    && typeof value.company === "string"
    && typeof value.contactName === "string"
    && optionalText(value.contactEmail)
    && optionalText(value.contactPhone)
    && typeof value.projectName === "string"
    && typeof value.source === "string"
    && typeof value.stage === "string"
    && typeof value.site === "string"
    && (value.estimatedValue === null || Number.isSafeInteger(value.estimatedValue))
    && typeof value.nextAction === "string"
    && (value.nextActionAt === null || Number.isSafeInteger(value.nextActionAt))
    && optionalText(value.rooms)
    && optionalText(value.flooringType)
    && optionalText(value.preferredContact);
}

function isFormLeadReview(value: unknown): value is FormLeadReview {
  return isRecord(value)
    && typeof value.id === "string"
    && Number.isSafeInteger(value.sourceRow)
    && optionalText(value.submittedAt)
    && ["ready", "duplicate", "invalid"].includes(String(value.state))
    && value.status === "needs-review"
    && isFormLeadProposal(value.proposal)
    && Array.isArray(value.reasons)
    && value.reasons.every((reason) => typeof reason === "string")
    && Number.isSafeInteger(value.createdAt)
    && Number.isSafeInteger(value.updatedAt);
}

function parseFormLeadIntakeState(value: unknown): FormLeadIntakeState | null {
  if (
    !isRecord(value)
    || typeof value.configured !== "boolean"
    || typeof value.invalidConfiguration !== "boolean"
    || typeof value.configurationName !== "string"
    || !["simulation", "app", "env", "none"].includes(String(value.configurationSource))
    || typeof value.simulation !== "boolean"
    || typeof value.actorEmail !== "string"
    || !Number.isSafeInteger(value.rowLimit)
    || !Array.isArray(value.queue)
    || !value.queue.every(isFormLeadReview)
  ) return null;
  const watermark = value.watermark;
  if (
    watermark !== null
    && (!isRecord(watermark)
      || !Number.isSafeInteger(watermark.lastProcessedRow)
      || !Number.isSafeInteger(watermark.lastProcessedAt))
  ) return null;
  return {
    configured: value.configured,
    invalidConfiguration: value.invalidConfiguration,
    configurationName: value.configurationName,
    configurationSource: value.configurationSource as FormLeadIntakeState["configurationSource"],
    simulation: value.simulation,
    actorEmail: value.actorEmail,
    rowLimit: Number(value.rowLimit),
    watermark: watermark as FormLeadIntakeState["watermark"],
    queue: value.queue,
  };
}

function formLeadConfigurationSourceLabel(source: FormLeadIntakeState["configurationSource"]) {
  if (source === "simulation") return "Simulation fixture";
  if (source === "app") return "App-saved";
  if (source === "env") return "Environment (bootstrap fallback)";
  return "None";
}

function responseError(body: unknown, fallback: string) {
  const message = isRecord(body) && typeof body.error === "string" ? body.error : fallback;
  // The real-data gate returns the offending sheet rows, and until now the client discarded
  // them — leaving the operator told that "responses are blocked" with no way to learn WHICH
  // row blocked them, and no in-app escape short of opening the spreadsheet and guessing.
  // Naming the rows is the difference between an actionable message and a dead end.
  if (isRecord(body) && Array.isArray(body.blockedRows) && body.blockedRows.length > 0) {
    const rows = body.blockedRows
      .filter((row): row is number => Number.isSafeInteger(row))
      .slice(0, 10);
    if (rows.length > 0) {
      const more = body.blockedRows.length > rows.length
        ? ` (and ${body.blockedRows.length - rows.length} more)`
        : "";
      return `${message} Sheet ${rows.length === 1 ? "row" : "rows"} ${rows.join(", ")}${more}.`;
    }
  }
  return message;
}

async function fetchFormLeadIntake(force = false) {
  const body = await cachedGetJson<unknown>(FORM_LEAD_PATH, { force });
  const parsed = parseFormLeadIntakeState(body);
  if (!parsed) {
    throw new Error(responseError(body, "Google Form lead intake could not be loaded."));
  }
  return parsed;
}

function localDateTimeValue(value: number | null) {
  if (value === null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function FormLeadReviewCard({
  review,
  actorEmail,
  onRetired,
}: {
  review: FormLeadReview;
  actorEmail: string;
  onRetired: () => Promise<void>;
}) {
  const proposal = review.proposal;
  const [company, setCompany] = useState(proposal.company);
  const [contactName, setContactName] = useState(proposal.contactName);
  const [contactEmail, setContactEmail] = useState(proposal.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(proposal.contactPhone ?? "");
  const [projectName, setProjectName] = useState(proposal.projectName);
  const [stage, setStage] = useState(proposal.stage);
  const [site, setSite] = useState(proposal.site);
  const [estimatedValue, setEstimatedValue] = useState(
    proposal.estimatedValue === null ? "" : String(proposal.estimatedValue),
  );
  const [nextAction, setNextAction] = useState(proposal.nextAction);
  const [nextActionAt, setNextActionAt] = useState(
    localDateTimeValue(proposal.nextActionAt),
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [requiresReload, setRequiresReload] = useState(false);
  const [acceptedLead, setAcceptedLead] = useState<Readonly<{
    id: string;
    label: string;
  }> | null>(null);

  async function createLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const amount = Number(estimatedValue);
      if (!estimatedValue.trim() || !Number.isSafeInteger(amount) || amount < 0) {
        throw new Error("Enter a non-negative whole-dollar estimated value before creating the lead.");
      }
      const dueAt = nextActionAt ? Date.parse(nextActionAt) : null;
      if (nextActionAt && !Number.isFinite(dueAt)) {
        throw new Error("Enter a valid next-action date and time.");
      }
      const response = await fetch(LEADS_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": review.id,
        },
        body: JSON.stringify({
          company,
          contactName,
          contactEmail: contactEmail || null,
          contactPhone: contactPhone || null,
          projectName,
          source: FORM_LEAD_SOURCE,
          stage,
          site,
          estimatedValue: amount,
          nextAction,
          nextActionAt: dueAt,
          ownerEmail: actorEmail,
          status: "active",
          formLeadReviewId: review.id,
        }),
      }).catch(() => {
        setRequiresReload(true);
        throw new Error("The lead result could not be confirmed. Reload the queue before trying again.");
      });
      const body = await response.json().catch(() => null) as unknown;
      const lead = isRecord(body) && isRecord(body.lead)
        && typeof body.lead.id === "string"
        && typeof body.lead.leadNumber === "string"
        ? { id: body.lead.id, label: body.lead.leadNumber }
        : null;
      const acceptedReview = isRecord(body) && isRecord(body.formLeadReview)
        && body.formLeadReview.id === review.id
        && body.formLeadReview.status === "accepted";
      if (!response.ok || !lead || !acceptedReview) {
        if (
          response.ok
          || response.status === 409
          || response.status >= 500
          || (isRecord(body) && body.code === "form_lead_review_not_found")
        ) {
          setRequiresReload(true);
        }
        throw new Error(responseError(
          body,
          "The lead result could not be confirmed. Reload the queue before trying again.",
        ));
      }
      setAcceptedLead(lead);
      invalidateCachedGet(FORM_LEAD_PATH);
      invalidateCachedGet("/api/v1/leads");
      invalidateCachedGet("/api/v1/dashboard");
      invalidateCachedGet("/api/v1/assistant/today");
      try {
        await onRetired();
      } catch {
        // The accepted-lead notice provides a GET-only queue-refresh recovery action.
      }
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : "The lead result could not be confirmed. Reload the queue before trying again.");
    } finally {
      setWorking(false);
    }
  }

  async function retryQueueRefresh() {
    setWorking(true);
    setError("");
    try {
      await onRetired();
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : "The queue could not be refreshed. Try again before reviewing another response.");
    } finally {
      setWorking(false);
    }
  }

  async function dismiss() {
    setWorking(true);
    setError("");
    let reviewSaved = false;
    try {
      const response = await fetch(FORM_LEAD_PATH, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: review.id, outcome: "dismissed" }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new Error(responseError(body, "The response could not be dismissed."));
      reviewSaved = true;
      invalidateCachedGet(FORM_LEAD_PATH);
      await onRetired();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Google Form lead intake could not be loaded.";
      setError(reviewSaved
        ? `The review was saved, but the queue could not be refreshed. The visible rows may be stale; reload before reviewing another response. ${detail}`
        : detail);
    } finally {
      setWorking(false);
    }
  }

  const stateLabel = review.state === "duplicate"
    ? "Possible duplicate"
    : review.state === "invalid"
      ? "Needs details"
      : "Ready for review";

  return <article className={styles.reviewCard} data-review-state={review.state}>
    <header className={styles.reviewHeader}>
      <div>
        <span className={styles.state}>{stateLabel}</span>
        <h3>{proposal.company || `Response row ${review.sourceRow}`}</h3>
        <small>Last observed at response Sheet row {review.sourceRow}{review.submittedAt ? ` · ${review.submittedAt}` : ""}</small>
      </div>
      <Inbox size={18} aria-hidden="true" />
    </header>
    {review.reasons.length > 0 && <div className={styles.reviewWarning} role="status">
      <CircleAlert size={16} aria-hidden="true" />
      <div>
        <strong>{review.state === "duplicate" ? "Check the existing client before creating another lead." : "Complete the missing details or dismiss this response."}</strong>
        <ul>{review.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div>
    </div>}
    {(proposal.rooms || proposal.flooringType || proposal.preferredContact) && <dl className={styles.responseContext}>
      {proposal.rooms && <div><dt>Rooms</dt><dd>{proposal.rooms}</dd></div>}
      {proposal.flooringType && <div><dt>Flooring</dt><dd>{proposal.flooringType}</dd></div>}
      {proposal.preferredContact && <div><dt>Preferred contact</dt><dd>{proposal.preferredContact}</dd></div>}
    </dl>}
    <form className={styles.reviewForm} onSubmit={createLead}>
      <label><span>Company or customer name</span><input value={company} onChange={(event) => setCompany(event.target.value)} required maxLength={180} /></label>
      <label><span>Contact name</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} required maxLength={160} /></label>
      <label><span>Contact email</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} maxLength={254} /></label>
      <label><span>Contact phone</span><input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} maxLength={40} /></label>
      <label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} required maxLength={180} /></label>
      <label><span>Site address</span><input value={site} onChange={(event) => setSite(event.target.value)} required maxLength={300} /></label>
      <label><span>Estimated value</span><input type="number" value={estimatedValue} onChange={(event) => setEstimatedValue(event.target.value)} required min={0} max={2147483647} step={1} placeholder="Required before create" /></label>
      <label><span>Stage</span><input value={stage} onChange={(event) => setStage(event.target.value)} required maxLength={80} /></label>
      <label><span>Source</span><input value={FORM_LEAD_SOURCE} readOnly aria-readonly="true" /></label>
      <label><span>Next action date</span><input type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></label>
      <label className={styles.fullField}><span>Next action</span><textarea value={nextAction} onChange={(event) => setNextAction(event.target.value)} required maxLength={500} /></label>
      <p className={styles.ownerLine}>Owner: <strong>{actorEmail}</strong></p>
      {acceptedLead && <div className={styles.createdWarning} role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <span>Lead {acceptedLead.label} and its review were saved, but the queue refresh failed.</span>
        <button type="button" className="soft-button" onClick={() => void retryQueueRefresh()} disabled={working}>
          <RefreshCw size={15} aria-hidden="true" /> {working ? "Refreshing…" : "Retry queue refresh"}
        </button>
      </div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      <footer className={styles.reviewActions}>
        <button type="button" className="soft-button" onClick={() => void dismiss()} disabled={working || Boolean(acceptedLead) || requiresReload}>Dismiss</button>
        <button type="submit" className="primary-button" disabled={working || Boolean(acceptedLead) || requiresReload}>
          {acceptedLead ? <CheckCircle2 size={16} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
          {working ? "Saving…" : acceptedLead ? "Review accepted" : "Create lead"}
        </button>
      </footer>
    </form>
  </article>;
}

function GoogleFormLeadIntakeCard({ isAdmin }: { isAdmin: boolean }) {
  const [intake, setIntake] = useState<FormLeadIntakeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadIntake = useCallback(async (force = false, silent = false) => {
    if (!silent) setLoading(true);
    try {
      setIntake(await fetchFormLeadIntake(force));
      setError("");
    } catch (caught) {
      if (isTerminalCachedGetError(caught)) {
        setIntake(null);
        setMessage("");
      }
      if (!silent || isTerminalCachedGetError(caught)) {
        setError(caught instanceof Error ? caught.message : "Google Form lead intake could not be loaded.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadIntake());
  }, [loadIntake]);

  useCachedGetSubscription([FORM_LEAD_PATH], () => loadIntake(false, true));

  async function checkResponses() {
    setChecking(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(FORM_LEAD_PATH, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new Error(responseError(body, "Form responses could not be checked."));
      setMessage(isRecord(body) && typeof body.message === "string" ? body.message : "Form responses checked.");
      invalidateCachedGet(FORM_LEAD_PATH);
      setIntake(await fetchFormLeadIntake(true));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Form responses could not be checked.");
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }

  async function refreshAfterRetirement() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      invalidateCachedGet(FORM_LEAD_PATH);
      setIntake(await fetchFormLeadIntake(true));
    } finally {
      setLoading(false);
    }
  }

  const queue = intake?.queue ?? [];
  return <section className={`panel ${styles.intakePanel}`} aria-labelledby="google-form-lead-intake-heading">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Review-first lead intake</p>
        <h2 id="google-form-lead-intake-heading">Google Forms responses</h2>
        <p>Check the linked response Sheet on demand. Up to {intake?.rowLimit ?? 25} new rows are proposed as leads; nothing creates a lead until an administrator completes and submits a review.</p>
        <p>While the test-data gate is closed, each response Name must begin with <strong>{FIRST_RUN_IMPORT_TEST_MARKER}</strong>.</p>
      </div>
      <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void checkResponses()} disabled={checking || loading || intake?.configured === false}>
        <RefreshCw size={16} aria-hidden="true" /> {checking ? "Checking…" : "Check for new form responses"}
      </AdministratorActionButton>
    </div>
    {loading && <p className={styles.statusLine} role="status">Loading the review queue…</p>}
    {intake && <p className={styles.statusLine}>Effective source: <strong>{formLeadConfigurationSourceLabel(intake.configurationSource)}</strong>.</p>}
    {intake && !intake.configured && <div className="workspace-missing">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{intake.invalidConfiguration ? "The response Sheet configuration is invalid." : "The response Sheet is not configured."} An Administrator can open Google Workspace → Stage 1, enter the response Sheet ID, and choose <strong>Verify and adopt</strong>. <code>{intake.configurationName}</code> is only a hosted bootstrap fallback.</span>
    </div>}
    {intake?.watermark && <p className={styles.statusLine}>Last checked through row <strong>{intake.watermark.lastProcessedRow}</strong> at {new Date(intake.watermark.lastProcessedAt).toLocaleString()}.</p>}
    {message && <div className={styles.success} role="status"><CheckCircle2 size={16} aria-hidden="true" /><span>{message}</span></div>}
    {error && <div className="workspace-missing" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}
    {!loading && intake && queue.length === 0 && <div className={styles.empty}>
      <Inbox size={20} aria-hidden="true" />
      <strong>No form responses need review</strong>
      <span>Run the check after the owner links the Google Form to its response Sheet.</span>
    </div>}
    {queue.length > 0 && <div className={styles.reviewList} aria-label="New lead review queue">
      {queue.map((review) => <FormLeadReviewCard
        key={review.id}
        review={review}
        actorEmail={intake?.actorEmail ?? ""}
        onRetired={refreshAfterRetirement}
      />)}
    </div>}
  </section>;
}

function syncTime(value: number | null | undefined) {
  return value === null || value === undefined ? "Not yet synced" : new Date(value).toLocaleString();
}

function DirectoryMirrorSummary({
  icon: Icon,
  label,
  entity,
  mirror,
  description,
}: {
  icon: typeof FolderTree;
  label: string;
  entity: "clients" | "projects";
  mirror: SheetMirrorStatus | null;
  description: string;
}) {
  const entityStatus = mirror?.[entity];
  return <article>
    <div><Icon size={17} /></div>
    <span>{label}</span>
    <strong>{sheetMirrorStatusLabel(mirror, entity)}</strong>
    <small>Last synced: {syncTime(entityStatus?.lastSyncedAt)}</small>
    {entityStatus?.lastError && <small role="alert">Last error: {entityStatus.lastError}</small>}
    <p>{description}</p>
  </article>;
}

export function DirectorySyncPanel({
  mirror,
  syncing,
  onSync,
  onImportConfirmed,
  isAdmin,
}: {
  mirror: SheetMirrorStatus | null;
  syncing: boolean;
  onSync: () => Promise<void>;
  onConfigure: () => void;
  onImportConfirmed: () => Promise<void>;
  isAdmin: boolean;
}) {
  const currentMirror = mirror;
  const ready = Boolean(currentMirror?.configured && currentMirror.enabled && currentMirror.connected);
  const unconfigured = currentMirror !== null && !currentMirror.configured;

  return <div className="settings-panel-stack">
    <section className="panel client-directory-settings" aria-labelledby="client-directory-settings-heading">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Google Sheets mirror</p>
        <h2 id="client-directory-settings-heading">Client Directory &amp; Project Register</h2>
        <p>FCI Operations stores the working metadata and relationships. Google Sheets provides a one-way mirror that updates after app changes and when you run a manual sync.</p>
      </div>
      <div className="workspace-actions">
        {currentMirror?.spreadsheetUrl && <a className="soft-button" href={currentMirror.spreadsheetUrl} target="_blank" rel="noreferrer"><FolderOpen size={15} /> Open spreadsheet</a>}
        <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void onSync()} disabled={syncing || !ready}>
          {syncing ? "Syncing…" : "Sync now"}
        </AdministratorActionButton>
      </div>
    </div>

    {!ready && <div className="workspace-missing">
      <CircleAlert size={16} />
      <span>
        {unconfigured
          ? <>The mirror is not configured. Set up the Client Directory spreadsheet in Workspace Stage 3; <code>{CLIENT_DIRECTORY_SHEET_KEY}</code> remains the fallback configuration name.</>
          : currentMirror?.reason ?? "Checking Google Sheets configuration…"}
      </span>
      <a className="soft-button" href="/settings?section=google-workspace#workspace-stage-3">Open Google Workspace setup</a>
    </div>}

    <div className="directory-sync-summary">
      <DirectoryMirrorSummary
        icon={FolderTree}
        label="Client Directory"
        entity="clients"
        mirror={currentMirror}
        description="Updates client code, contacts, project count, folder link, status, and last update. Your Account Notes column remains yours."
      />
      <DirectoryMirrorSummary
        icon={BriefcaseBusiness}
        label="Project Register"
        entity="projects"
        mirror={currentMirror}
        description="Generated from independent project records, including the client, status, site, value, manager, and Drive workspace link."
      />
    </div>

    <div className="directory-layout">
      <div>
        <h3>What lives in the app</h3>
        <ul>
          <li>Client-to-project relationships and project numbers</li>
          <li>Contacts, statuses, dates, values, and Drive mappings</li>
          <li>Future tasks, notes, meetings, communications, schedules, and activity history</li>
        </ul>
      </div>
      <div>
        <h3>How to use the spreadsheet</h3>
        <p>Use it to view, filter, export, and add account notes. Do not edit the generated Project Register; the next sync rebuilds it from FCI Operations. Spreadsheet edits do not write back to the app yet.</p>
      </div>
    </div>
    </section>
    <FirstRunImportCard onImportConfirmed={onImportConfirmed} />
    <GoogleFormLeadIntakeCard isAdmin={isAdmin} />
  </div>;
}
