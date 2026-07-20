"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, CalendarDays, CheckCircle2, CircleAlert, FileText, FolderOpen, Mail, ShieldCheck, X, Zap } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { OperationsDataTable, OperationsDataTableCell } from "../../components/operations/OperationsDataTable";
import { Status } from "../../components/operations/OperationsPrimitives";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { DRIVE_BLUEPRINT } from "../../lib/google-workspace";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type Project = { id: string; clientId: string; number: string; client: string; name: string; status: string; progress: number; value: string; site: string; managerId: string | null; lead: string; date: string; accent: string; driveFolderId?: string; driveUrl?: string };
export type WorkspaceMessage = { id: string; threadId?: string | null; from: string | null; to?: string | null; subject: string | null; date: string | null; snippet: string; labelIds?: string[] };
export type GmailFilingPreview = {
  message: { id: string; threadId: string | null; from: string | null; to: string | null; subject: string | null; date: string | null; attachmentCount: number; attachments: Array<{ filename: string; mimeType: string; byteSize: number }> };
  project: { id: string; number: string; name: string; client: string };
  destinations: { emailArchive: string; attachments: string };
  existing: { status: string; filed: boolean; emailDriveUrl: string | null; attachmentCount: number; filedAt: number | null } | null;
  inboxRetained: boolean;
};

type MissingDetail = { label: string; envVar: string; secret: boolean };
type WorkspaceReadiness = {
  mode?: "shared-drive";
  runtimeMode?: "simulation" | "workspace";
  simulation?: boolean;
  storageLabel?: string;
  storageName?: string;
  storageConfigured?: boolean;
  connectionStatus?: string;
  connectionAccount?: string | null;
  driveConnected?: boolean;
  gmailConnected?: boolean;
  calendarConnected?: boolean;
  sheetsConnected?: boolean;
  requiresReauthorization?: boolean;
  provisioningEnabled?: boolean;
  gmailEnabled?: boolean;
  calendarEnabled?: boolean;
  sheetsEnabled?: boolean;
  clientDirectorySheetConfigured?: boolean;
  enabledServices?: string[];
  broadScopeAcknowledged?: boolean;
};
type SheetMirrorStatus = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  spreadsheetName: string | null;
  clients: { status: string; lastSyncedAt: number | null; lastError: string | null };
  projects: { status: string; lastSyncedAt: number | null; lastError: string | null };
  lastSyncedAt: number | null;
  reason: string | null;
};
type SetupStepStatus = "Complete" | "Ready" | "Blocked by previous step" | "Blocked by prerequisites" | "Simulated";

const WORKSPACE_PREREQUISITE_COLUMNS = [
  { key: "requirement", label: "Requirement" },
  { key: "environment", label: "Environment key" },
  { key: "origin", label: "Origin" },
] as const;

function stepStatus({ simulation, previousComplete = true, prerequisitesReady, complete }: { simulation: boolean; previousComplete?: boolean; prerequisitesReady: boolean; complete: boolean }): SetupStepStatus {
  if (simulation) return "Simulated";
  if (!previousComplete) return "Blocked by previous step";
  if (!prerequisitesReady) return "Blocked by prerequisites";
  return complete ? "Complete" : "Ready";
}

function stepStatusClass(value: SetupStepStatus) {
  return value.toLowerCase().replaceAll(" ", "-");
}

function mirrorTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not synced yet";
}

export function GoogleWorkspacePanel({ notify, projects, isAdmin }: { notify: Notify; projects: Project[]; isAdmin: boolean }) {
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<"unknown" | "missing" | "credentials">("unknown");
  const [missing, setMissing] = useState<string[]>([]);
  const [missingDetails, setMissingDetails] = useState<MissingDetail[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceReadiness | null>(null);
  const [sheetMirror, setSheetMirror] = useState<SheetMirrorStatus | null>(null);
  const [sheetsStatusError, setSheetsStatusError] = useState<string | null>(null);
  const [driveVerified, setDriveVerified] = useState(false);
  const [gmailMessages, setGmailMessages] = useState<WorkspaceMessage[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<Array<{ id: string; title: string; start: string; end: string; url?: string }>>([]);
  const [gmailWorking, setGmailWorking] = useState(false);
  const [calendarWorking, setCalendarWorking] = useState(false);
  const [sheetsWorking, setSheetsWorking] = useState(false);
  const [gmailLabelsReady, setGmailLabelsReady] = useState(false);
  const [calendarChecked, setCalendarChecked] = useState(false);
  const [filingMessage, setFilingMessage] = useState<WorkspaceMessage | null>(null);
  const [filingProjectId, setFilingProjectId] = useState("");
  const [filingPreview, setFilingPreview] = useState<GmailFilingPreview | null>(null);
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingSubmitting, setFilingSubmitting] = useState(false);
  const [oauthResult, setOauthResult] = useState<string | null>(null);
  const readinessChecked = useRef(false);

  const checkSetup = useCallback(async (force = false) => {
    setChecking(true);
    try {
      const sheetsRequest = cachedGetJson<{ mirror?: SheetMirrorStatus }>("/api/v1/integrations/google/sheets/status", { force })
        .then((data) => ({ ok: true as const, data }))
        .catch(() => ({ ok: false as const, data: null }));
      const [data, sheetsResult] = await Promise.all([
        cachedGetJson<{ credentialsPresent?: boolean; missing?: string[]; missingDetails?: MissingDetail[]; workspace?: WorkspaceReadiness }>("/api/v1/google-workspace", { force }),
        sheetsRequest,
      ]);
      setMissing(data.missing ?? []);
      setMissingDetails(data.missingDetails ?? []);
      setWorkspace(data.workspace ?? null);
      setStatus(data.credentialsPresent ? "credentials" : "missing");
      if (sheetsResult.ok) {
        setSheetMirror(sheetsResult.data.mirror ?? null);
        setSheetsStatusError(null);
      } else {
        setSheetsStatusError("Mirror status could not be loaded. Refresh this step to try again.");
      }
      if (!data.workspace?.simulation && data.workspace?.connectionStatus !== "connected") {
        setDriveVerified(false);
        setGmailLabelsReady(false);
        setCalendarChecked(false);
      }
      notify(data.workspace?.simulation ? "Local Workspace simulation is ready. No Google account is connected." : data.credentialsPresent ? "Workspace configuration is present. Finish OAuth authorization before Google data can be accessed." : `Workspace setup still needs ${Math.max(1, data.missing?.length ?? 0)} item(s)`, data.workspace?.simulation || data.credentialsPresent ? "info" : "warning");
    } catch {
      setStatus("missing");
      notify("Workspace readiness could not be checked. Confirm the app is running and try again.", "error");
    } finally {
      setChecking(false);
    }
  }, [notify]);

  useEffect(() => {
    if (readinessChecked.current) return;
    readinessChecked.current = true;
    void checkSetup();
  }, [checkSetup]);

  useEffect(() => {
    const current = new URL(window.location.href);
    const result = current.searchParams.get("google");
    if (result === null) return;
    void Promise.resolve().then(() => setOauthResult(result));
    current.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
    invalidateCachedGet("/api/v1/google-workspace");
    invalidateCachedGet("/api/v1/integrations/google/sheets/status");
    void Promise.resolve().then(() => checkSetup(true));
  }, [checkSetup]);

  async function connectGoogleDrive() {
    setWorking(true);
    try {
      const response = await fetch("/api/v1/integrations/google/authorize", { method: "POST" });
      const data = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !data.authorizationUrl) throw new Error(data.error ?? "Google Workspace could not be authorized.");
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Google Workspace could not be authorized.", "error");
      setWorking(false);
    }
  }

  async function verifyGoogleDrive() {
    setWorking(true);
    try {
      const response = await fetch("/api/v1/integrations/google/drive/verify", { method: "POST" });
      const data = await response.json() as { verified?: boolean; error?: string };
      if (!response.ok || !data.verified) throw new Error(data.error ?? "The Drive workspace could not be verified.");
      setDriveVerified(true);
      notify("The active Drive workspace was verified. You can continue to Gmail setup.", "success");
      invalidateCachedGet("/api/v1/google-workspace");
      await checkSetup(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Drive workspace could not be verified.", "error");
    } finally {
      setWorking(false);
    }
  }

  async function disconnectGoogleDrive() {
    setWorking(true);
    try {
      const response = await fetch("/api/v1/integrations/google/connection", { method: "DELETE" });
      const data = await response.json() as { disconnected?: boolean; error?: string };
      if (!response.ok || !data.disconnected) throw new Error(data.error ?? "The Google connection could not be removed.");
      setDriveVerified(false);
      setGmailLabelsReady(false);
      setCalendarChecked(false);
      setGmailMessages([]);
      setCalendarEvents([]);
      notify("The active Google connection was removed from FCI Operations.", "success");
      invalidateCachedGet("/api/v1/google-workspace");
      invalidateCachedGet("/api/v1/integrations/google/sheets/status");
      await checkSetup(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Google connection could not be removed.", "error");
    } finally {
      setWorking(false);
    }
  }

  async function readApi<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "The Workspace action could not be completed.");
    return data;
  }

  async function prepareTestGmailLabels() {
    setGmailWorking(true);
    try {
      await readApi<{ prepared: boolean }>("/api/v1/integrations/google/gmail/labels/prepare", { method: "POST" });
      setGmailLabelsReady(true);
      notify("FCI Gmail labels are ready. No messages were moved or archived.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gmail labels could not be prepared.", "error");
    } finally {
      setGmailWorking(false);
    }
  }

  async function refreshTestGmail() {
    setGmailWorking(true);
    try {
      const data = await readApi<{ messages?: WorkspaceMessage[]; labelReady?: boolean }>("/api/v1/integrations/google/gmail/messages?label=inbox");
      setGmailMessages(data.messages ?? []);
      setGmailLabelsReady((current) => current || Boolean(data.labelReady));
      notify(`Loaded ${data.messages?.length ?? 0} Workspace inbox message(s).`, "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The test inbox could not be loaded.", "error");
    } finally {
      setGmailWorking(false);
    }
  }

  async function sendSelfTestEmail() {
    setGmailWorking(true);
    try {
      await readApi<{ sent: boolean }>("/api/v1/integrations/google/gmail/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      notify(workspace?.simulation ? "A sample email was added to the simulated Workspace inbox." : "A test email was sent only to the configured Workspace mailbox.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The self-test email could not be sent.", "error");
    } finally {
      setGmailWorking(false);
    }
  }

  function openFilingReview(message: WorkspaceMessage) {
    setFilingMessage(message);
    setFilingProjectId("");
    setFilingPreview(null);
  }

  function closeFilingReview() {
    if (filingLoading || filingSubmitting) return;
    setFilingMessage(null);
    setFilingProjectId("");
    setFilingPreview(null);
  }

  async function previewGmailFiling() {
    if (!filingMessage || !filingProjectId) {
      notify("Choose the exact independent project before reviewing this email filing.", "warning");
      return;
    }
    setFilingLoading(true);
    try {
      const data = await readApi<GmailFilingPreview>(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file?projectId=${encodeURIComponent(filingProjectId)}`);
      setFilingPreview(data);
      notify(`Ready to review the Drive filing for ${data.project.number}. Nothing has been copied yet.`, "info");
    } catch (error) {
      setFilingPreview(null);
      notify(error instanceof Error ? error.message : "The Gmail filing preview could not be loaded.", "error");
    } finally {
      setFilingLoading(false);
    }
  }

  async function confirmGmailFiling() {
    if (!filingMessage || !filingProjectId || !filingPreview) return;
    setFilingSubmitting(true);
    try {
      const data = await readApi<{ filed: boolean; alreadyFiled?: boolean; archive?: { attachmentCount?: number } }>(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: filingProjectId }),
      });
      notify(data.alreadyFiled ? "This email was already filed to the selected project. Your inbox was left intact." : `Email and ${data.archive?.attachmentCount ?? filingPreview.message.attachmentCount} attachment(s) were copied to the selected project. FCI/Filed was added; Inbox remains intact.`, data.alreadyFiled ? "info" : "success");
      setFilingMessage(null);
      setFilingProjectId("");
      setFilingPreview(null);
      await refreshTestGmail();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Gmail filing could not be completed.", "error");
    } finally {
      setFilingSubmitting(false);
    }
  }

  async function refreshTestCalendar() {
    setCalendarWorking(true);
    try {
      const data = await readApi<{ events?: Array<{ id: string; title: string; start: string; end: string; url?: string }> }>("/api/v1/integrations/google/calendar/events");
      setCalendarEvents(data.events ?? []);
      setCalendarChecked(true);
      notify(`Loaded ${data.events?.length ?? 0} upcoming Workspace Calendar event(s).`, "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Workspace Calendar could not be loaded.", "error");
    } finally {
      setCalendarWorking(false);
    }
  }

  async function createTestCalendarHold() {
    setCalendarWorking(true);
    try {
      await readApi<{ event: { start: string } }>("/api/v1/integrations/google/calendar/test-hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setCalendarChecked(true);
      notify(workspace?.simulation ? "A 30-minute hold was added to the simulated Workspace calendar." : "A private 30-minute Workspace test hold was created with no attendees or notifications.", "success");
      await refreshTestCalendar();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The test calendar hold could not be created.", "error");
    } finally {
      setCalendarWorking(false);
    }
  }

  async function refreshSheetsStatus() {
    setSheetsWorking(true);
    try {
      const data = await cachedGetJson<{ mirror?: SheetMirrorStatus }>("/api/v1/integrations/google/sheets/status", { force: true });
      setSheetMirror(data.mirror ?? null);
      setSheetsStatusError(null);
      notify("Google Sheets mirror status was refreshed.", "info");
    } catch {
      setSheetsStatusError("Mirror status could not be loaded. Refresh this step to try again.");
      notify("Google Sheets mirror status could not be refreshed.", "error");
    } finally {
      setSheetsWorking(false);
    }
  }

  async function syncGoogleSheets() {
    setSheetsWorking(true);
    try {
      const data = await readApi<{ mirror?: SheetMirrorStatus }>("/api/v1/integrations/google/sheets/sync", { method: "POST" });
      setSheetMirror(data.mirror ?? null);
      setSheetsStatusError(null);
      invalidateCachedGet("/api/v1/integrations/google/sheets/status");
      notify("The Client Directory and Project Register mirror finished syncing.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Google Sheets could not complete the directory sync.", "error");
    } finally {
      setSheetsWorking(false);
    }
  }

  async function resetSimulation() {
    setWorking(true);
    try {
      const data = await readApi<{ reset: boolean; messages: number; events: number }>("/api/v1/integrations/google/simulation/reset", { method: "POST" });
      setGmailMessages([]);
      setCalendarEvents([]);
      setGmailLabelsReady(true);
      setCalendarChecked(false);
      notify(`Workspace simulation reset with ${data.messages} sample messages and ${data.events} calendar events.`, "success");
      invalidateCachedGet("/api/v1/google-workspace");
      invalidateCachedGet("/api/v1/integrations/google/sheets/status");
      await checkSetup(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Workspace simulation could not be reset.", "error");
    } finally {
      setWorking(false);
    }
  }

  const configured = status === "credentials";
  const simulation = workspace?.simulation === true;
  const connected = workspace?.connectionStatus === "connected";
  const reconnectRequired = workspace?.requiresReauthorization === true;
  const connectComplete = connected && !reconnectRequired;
  const driveReady = connectComplete && workspace?.driveConnected === true && workspace?.storageConfigured === true;
  const gmailReady = connected && workspace?.gmailEnabled === true && workspace?.gmailConnected === true;
  const calendarReady = connected && workspace?.calendarEnabled === true && workspace?.calendarConnected === true;
  const sheetsReady = connected && workspace?.sheetsEnabled === true && workspace?.sheetsConnected === true && workspace?.clientDirectorySheetConfigured === true;
  const sheetsSynced = sheetMirror?.clients.status === "synced" && sheetMirror?.projects.status === "synced";
  const connectStepStatus: SetupStepStatus = simulation ? "Simulated" : connectComplete ? "Complete" : configured ? "Ready" : "Blocked by prerequisites";
  const driveStepStatus = stepStatus({ simulation, previousComplete: connectComplete, prerequisitesReady: driveReady, complete: driveVerified });
  const gmailStepStatus = stepStatus({ simulation, previousComplete: driveStepStatus === "Complete", prerequisitesReady: gmailReady, complete: gmailLabelsReady });
  const calendarStepStatus = stepStatus({ simulation, previousComplete: gmailStepStatus === "Complete", prerequisitesReady: calendarReady, complete: calendarChecked });
  const sheetsStepStatus = stepStatus({ simulation, previousComplete: calendarStepStatus === "Complete", prerequisitesReady: sheetsReady, complete: sheetsSynced });
  const selectedServices = workspace?.enabledServices?.join(", ") ?? "drive";
  const storageName = workspace?.storageName ?? "FCI Operations";
  const hasStoredConnection = Boolean(workspace?.connectionStatus && workspace.connectionStatus !== "not-connected");
  const gmailActionsEnabled = simulation || (driveStepStatus === "Complete" && gmailReady);
  const calendarActionsEnabled = simulation || (gmailStepStatus === "Complete" && calendarReady);
  const sheetsActionsEnabled = simulation || (calendarStepStatus === "Complete" && sheetsReady);
  const oauthMessage = oauthResult === "connected"
    ? "Google was connected. Workspace readiness refreshed automatically."
    : oauthResult === "authorization-cancelled"
      ? "Google authorization was cancelled; no connection was saved."
      : oauthResult === "authorization-expired"
        ? "Google authorization expired. Start the connection again from this page."
        : oauthResult === "admin-required"
          ? "An approved FCI administrator must complete the Google connection."
          : oauthResult === "setup-needed"
            ? "Google setup is incomplete. Review the missing configuration below."
            : oauthResult === "connection-failed"
              ? "Google could not be connected. Confirm the approved account, folder, and requested services, then try again."
              : null;

  return <section className="panel workspace-settings">
    <div className="settings-heading">
      <div><p className="eyebrow">Company integration</p><h2>Google Workspace</h2><p>Complete these five steps in order. Every status comes from the current Workspace readiness or service response.</p></div>
      <button className="primary-button" onClick={() => void checkSetup(true)} disabled={checking}>{checking ? "Checking…" : "Check readiness"}</button>
    </div>
    <div className={`workspace-mode-card ${simulation ? "simulation" : "live"}`}>
      {simulation ? <Zap size={18} /> : <Building2 size={18} />}
      <span><strong>{simulation ? "Local Workspace simulation" : "Company Google Workspace"}</strong><small>{simulation ? "Sample data only · no Google account connected · nothing is sent to Google" : "One administrator-approved organization connection"}</small></span>
      <b>{simulation ? "LOCAL" : connected ? "CONNECTED" : "SETUP"}</b>
    </div>
    {!simulation && oauthMessage && <p className={oauthResult === "connected" ? "workspace-warning" : "workspace-missing"}>{oauthMessage}</p>}
    {!simulation && <section className="workspace-prerequisites" aria-labelledby="workspace-prerequisites-heading">
      <header><div><p className="eyebrow">Environment prerequisites</p><h3 id="workspace-prerequisites-heading">Hosted Workspace configuration</h3></div><Status text={missingDetails.length ? "Setup required" : "Complete"} /></header>
      <p>Configured in the hosting environment, not this app. Only presence or absence is shown; configured values and secrets are never returned.</p>
      {missingDetails.length > 0 ? <OperationsDataTable className="workspace-prerequisite-table" columns={WORKSPACE_PREREQUISITE_COLUMNS} labelledBy="workspace-prerequisites-heading">
        {missingDetails.map((detail) => <tr key={`${detail.label}-${detail.envVar}`}>
          <OperationsDataTableCell label="Requirement"><strong>{detail.label}</strong></OperationsDataTableCell>
          <OperationsDataTableCell label="Environment key"><code>{detail.envVar}</code></OperationsDataTableCell>
          <OperationsDataTableCell label="Origin"><span className={`workspace-origin-tag ${detail.secret ? "secret" : "value"}`}>{detail.secret ? "Hosted secret — never in the app or Git" : "Hosted environment value"}</span></OperationsDataTableCell>
        </tr>)}
      </OperationsDataTable> : <p className="workspace-prerequisites-ready"><CheckCircle2 size={15} /> All required hosted values are present.</p>}
    </section>}
    <ol className="workspace-setup-steps" aria-label="Google Workspace setup steps">
      <li className={`workspace-setup-step ${stepStatusClass(connectStepStatus)}`}>
        <header><span className="workspace-step-number">1</span><div><h3>Connect Google Workspace</h3><p>Authorize the one approved company account, or reset the isolated local simulation.</p></div><span className="workspace-step-status">{connectStepStatus}</span></header>
        <div className="workspace-step-body">
          <div className={`workspace-connection ${connected ? "ready" : ""}`}><div className="integration-logo google"><Mail size={20} /></div><div><strong>{simulation ? "Simulated connection ready" : connected ? "Google Workspace connected" : reconnectRequired ? "Google permission update required" : configured ? "Ready for authorization" : "Hosted setup required"}</strong><span>{simulation ? "Gmail, Calendar, Shared Drive, and Sheets use local sample state." : connected ? `${workspace?.connectionAccount ?? "Approved Workspace account"} is connected with ${selectedServices}.` : reconnectRequired ? "Reconnect and approve every selected service." : configured ? `The connection will request ${selectedServices}.` : `${missing.length} prerequisite${missing.length === 1 ? "" : "s"} still need attention.`}</span></div><span>{simulation ? "Simulated" : connected ? "Connected" : "Not connected"}</span></div>
          {simulation && <p className="workspace-warning"><ShieldCheck size={15} /><span><strong>Safe local testing:</strong> OAuth is disabled, no refresh token exists, and all service results stay in this development environment.</span></p>}
          <div className="workspace-actions">{simulation ? <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void resetSimulation()} disabled={working}>{working ? "Resetting…" : "Reset simulation data"}</AdministratorActionButton> : <>
            {!connected && <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void connectGoogleDrive()} disabled={!configured || working}>{working ? "Preparing…" : reconnectRequired ? "Reconnect Google Workspace" : "Connect Google Workspace"}</AdministratorActionButton>}
            {hasStoredConnection && <AdministratorActionButton className="soft-button" isAdmin={isAdmin} onClick={() => void disconnectGoogleDrive()} disabled={working}>Disconnect Workspace</AdministratorActionButton>}
          </>}</div>
        </div>
      </li>
      <li className={`workspace-setup-step ${stepStatusClass(driveStepStatus)}`}>
        <header><span className="workspace-step-number">2</span><div><h3>Verify the Shared Drive</h3><p>Confirm the configured FCI Operations Shared Drive before any project folder is created.</p></div><span className="workspace-step-status">{driveStepStatus}</span></header>
        <div className="workspace-step-body"><p className="workspace-step-summary"><FolderOpen size={15} /> <span><strong>{storageName}</strong>{driveReady || simulation ? " is available for a direct verification." : " remains blocked until the connection and Drive prerequisite are ready."}</span></p><div className="workspace-actions"><AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void verifyGoogleDrive()} disabled={working || (!simulation && !driveReady)}>{working ? "Verifying…" : driveVerified ? "Verify Shared Drive again" : "Verify Shared Drive"}</AdministratorActionButton></div>{!simulation && <p className="workspace-env-note"><strong>Project-folder provisioning:</strong> <code>GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED</code> is a hosted environment value, not an in-app toggle. Keep it off until this verification passes.</p>}</div>
      </li>
      <li className={`workspace-setup-step ${stepStatusClass(gmailStepStatus)}`}>
        <header><span className="workspace-step-number">3</span><div><h3>Prepare Gmail</h3><p>Create or refresh the three FCI labels, then exercise the review-first inbox tools.</p></div><span className="workspace-step-status">{gmailStepStatus}</span></header>
        <div className="workspace-step-body test-service-card"><div className="test-service-heading"><Mail size={17} /><div><strong>{simulation ? "Simulated Workspace Gmail" : "Workspace Gmail"}</strong><span>{gmailActionsEnabled ? "Ready for explicit actions" : "Blocked until the prior step is complete"}</span></div></div><p>View up to 20 messages, add a sample email in simulation, and review-copy one message into the exact project. Inbox stays intact.</p><div className="workspace-actions"><AdministratorActionButton className="soft-button" isAdmin={isAdmin} onClick={() => void prepareTestGmailLabels()} disabled={!gmailActionsEnabled || gmailWorking}>{gmailWorking ? "Working…" : gmailLabelsReady ? "Refresh FCI labels" : "Prepare FCI labels"}</AdministratorActionButton><AdministratorActionButton className="soft-button" isAdmin={isAdmin} onClick={() => void refreshTestGmail()} disabled={!gmailActionsEnabled || gmailWorking}>{gmailWorking ? "Loading…" : "View inbox"}</AdministratorActionButton><AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void sendSelfTestEmail()} disabled={!gmailActionsEnabled || gmailWorking}>{gmailWorking ? "Working…" : simulation ? "Add sample email" : "Send Workspace test"}</AdministratorActionButton></div>{gmailMessages.length > 0 && <div className="test-service-list">{gmailMessages.map((message) => <article key={message.id}><div><strong>{message.subject || "(No subject)"}</strong><span>{message.from || "Unknown sender"}{message.date ? ` · ${new Date(message.date).toLocaleString()}` : ""}</span><p>{message.snippet}</p></div><div className="gmail-message-actions"><AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => openFilingReview(message)} disabled={gmailWorking || !gmailActionsEnabled}>Review & copy</AdministratorActionButton></div></article>)}</div>}</div>
      </li>
      <li className={`workspace-setup-step ${stepStatusClass(calendarStepStatus)}`}>
        <header><span className="workspace-step-number">4</span><div><h3>Verify Calendar</h3><p>Read the appointments window or create one private test hold with no notifications.</p></div><span className="workspace-step-status">{calendarStepStatus}</span></header>
        <div className="workspace-step-body test-service-card"><div className="test-service-heading"><CalendarDays size={17} /><div><strong>{simulation ? "Simulated shared calendars" : "Workspace shared calendars"}</strong><span>{calendarActionsEnabled ? "Ready for appointment testing" : "Blocked until Gmail setup is complete"}</span></div></div><p>View a seven-day appointments window or create one 30-minute hold. Simulation stores it locally; live mode uses the configured company calendar.</p><div className="workspace-actions"><AdministratorActionButton className="soft-button" isAdmin={isAdmin} onClick={() => void refreshTestCalendar()} disabled={!calendarActionsEnabled || calendarWorking}>{calendarWorking ? "Loading…" : "View upcoming events"}</AdministratorActionButton><AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void createTestCalendarHold()} disabled={!calendarActionsEnabled || calendarWorking}>{calendarWorking ? "Creating…" : "Create test hold"}</AdministratorActionButton></div>{calendarEvents.length > 0 && <div className="test-service-list">{calendarEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{new Date(event.start).toLocaleString()} – {new Date(event.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>{event.url && <button className="soft-button" onClick={() => window.open(event.url, "_blank", "noopener,noreferrer")}>Open</button>}</article>)}</div>}</div>
      </li>
      <li className={`workspace-setup-step ${stepStatusClass(sheetsStepStatus)}`}>
        <header><span className="workspace-step-number">5</span><div><h3>Sync the Sheets mirror</h3><p>Check and reconcile the generated Client Directory and Project Register.</p></div><span className="workspace-step-status">{sheetsStepStatus}</span></header>
        <div className="workspace-step-body"><div className="workspace-sheet-summary"><article><span>Client Directory</span><strong>{sheetMirror?.clients.status ?? "Status unavailable"}</strong><small>{mirrorTime(sheetMirror?.clients.lastSyncedAt)}</small></article><article><span>Project Register</span><strong>{sheetMirror?.projects.status ?? "Status unavailable"}</strong><small>{mirrorTime(sheetMirror?.projects.lastSyncedAt)}</small></article></div>{(sheetsStatusError || sheetMirror?.reason) && <p className="workspace-missing">{sheetsStatusError ?? sheetMirror?.reason}</p>}<div className="workspace-actions"><button className="soft-button" onClick={() => void refreshSheetsStatus()} disabled={sheetsWorking}>{sheetsWorking ? "Refreshing…" : "Refresh mirror status"}</button><AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void syncGoogleSheets()} disabled={sheetsWorking || !sheetsActionsEnabled}>{sheetsWorking ? "Syncing…" : "Sync now"}</AdministratorActionButton>{sheetMirror?.spreadsheetUrl && <a className="soft-button" href={sheetMirror.spreadsheetUrl} target="_blank" rel="noreferrer">Open spreadsheet</a>}</div><p className="workspace-env-note"><strong>Provisioning reminder:</strong> project-folder provisioning stays controlled by the hosted <code>GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED</code> value; this screen does not toggle it.</p></div>
      </li>
    </ol>
    <div className="drive-blueprint"><div><h3>{simulation ? "Simulated Shared Drive blueprint" : "Company Shared Drive blueprint"}</h3><p>{storageName}</p></div><ol>{DRIVE_BLUEPRINT.roots.map((item) => <li key={item}>{item}</li>)}</ol><div className="project-folder-list"><strong>Every independent project receives:</strong>{DRIVE_BLUEPRINT.projectFolders.map((item) => <span key={item}><FolderOpen size={13} />{item}</span>)}</div></div>
    <div className="workspace-checklist"><h3>{simulation ? "Simulation safeguards" : "Workspace launch safeguards"}</h3><label><input type="checkbox" /> {simulation ? "Use only seeded sample data" : "Use a company-owned Shared Drive and sender mailbox"}</label><label><input type="checkbox" /> {simulation ? "Confirm no OAuth account or Google token is connected" : "Restrict authorization to the approved Workspace domain"}</label><label><input type="checkbox" /> Keep Gmail filing review-first and project-specific</label><label><input type="checkbox" /> Verify the two shared calendars and Sheet mirror before staff launch</label></div>
    {filingMessage && <GmailFilingModal message={filingMessage} projects={projects} projectId={filingProjectId} preview={filingPreview} loading={filingLoading} submitting={filingSubmitting} onProject={(projectId) => { setFilingProjectId(projectId); setFilingPreview(null); }} onPreview={previewGmailFiling} onConfirm={confirmGmailFiling} onClose={closeFilingReview} />}
  </section>;
}

export function GmailFilingModal({ message, projects, projectId, preview, loading, submitting, onProject, onPreview, onConfirm, onClose }: {
  message: WorkspaceMessage;
  projects: Project[];
  projectId: string;
  preview: GmailFilingPreview | null;
  loading: boolean;
  submitting: boolean;
  onProject: (projectId: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const selectedProject = projects.find((project) => project.id === projectId);
  const attachmentLabel = preview?.message.attachmentCount ?? 0;
  const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const alreadyFiled = preview?.existing?.filed === true;
  return <AccessibleOverlay ariaLabel="File email to one project" contentClassName="modal gmail-filing-modal" onClose={onClose} busy={loading || submitting}><header><div><p className="eyebrow">Review-approved Gmail filing</p><h2>File to one project</h2></div><button onClick={onClose} aria-label="Close" disabled={loading || submitting}><X size={20} /></button></header><div className="modal-detail"><div className="filing-message-summary"><Mail size={17} /><div><strong>{message.subject || "(No subject)"}</strong><span>{message.from || "Unknown sender"}{message.date ? ` · ${new Date(message.date).toLocaleString()}` : ""}</span></div></div><label className="filing-project-select">Exact independent project<select data-overlay-initial-focus value={projectId} onChange={(event) => onProject(event.target.value)} disabled={loading || submitting}><option value="">Choose a project…</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.number} — {project.name} · {project.client}</option>)}</select></label>{selectedProject && <p className={selectedProject.driveFolderId ? "filing-workspace-ready" : "filing-workspace-pending"}>{selectedProject.driveFolderId ? <><CheckCircle2 size={14} /> Managed Drive workspace detected for this project.</> : <><CircleAlert size={14} /> This project needs its managed Drive workspace before email can be filed. The review will not create a folder.</>}</p>}<p className="form-help"><ShieldCheck size={14} /> The original email becomes an <b>.eml</b> in <b>05_Correspondence / Email Archive</b>. Attachments go to <b>05_Correspondence / Email Attachments</b>. Your Gmail Inbox label is retained.</p>{preview && <div className="filing-preview"><div className="filing-preview-heading"><div><FolderOpen size={16} /><strong>{preview.project.number} — {preview.project.name}</strong><span>{preview.project.client}</span></div>{alreadyFiled && <Status text="Filed" />}</div>{alreadyFiled ? <p className="filing-existing">This email was already filed to this project. No second copy will be made.</p> : <><dl><div><dt>Email archive</dt><dd>{preview.destinations.emailArchive}</dd></div><div><dt>Attachments</dt><dd>{preview.destinations.attachments}</dd></div></dl><div className="filing-attachments"><strong>{attachmentLabel} attachment{attachmentLabel === 1 ? "" : "s"}</strong>{preview.message.attachments.length ? <ul>{preview.message.attachments.map((attachment, index) => <li key={`${attachment.filename}-${index}`}><FileText size={13} /><span>{attachment.filename}</span><small>{attachment.mimeType} · {formatBytes(attachment.byteSize)}</small></li>)}</ul> : <p>No separate attachments were found. The original email will still be copied as an .eml file.</p>}</div><p className="filing-confirmation"><ShieldCheck size={14} /> Nothing has been copied yet. Select <b>Copy email to project</b> to complete this one approved filing.</p></>}</div>}</div><footer className="modal-footer"><button className="soft-button" onClick={onClose} disabled={loading || submitting}>Cancel</button>{preview ? <button className="primary-button" onClick={onConfirm} disabled={loading || submitting || alreadyFiled}>{submitting ? "Copying…" : alreadyFiled ? "Already filed" : `Copy email + ${attachmentLabel} attachment${attachmentLabel === 1 ? "" : "s"}`}</button> : <button className="primary-button" onClick={onPreview} disabled={!projectId || loading || submitting}>{loading ? "Reviewing…" : "Review destination"}</button>}</footer></AccessibleOverlay>;
}

