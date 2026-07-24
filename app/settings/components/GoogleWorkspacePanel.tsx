"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, CircleAlert, FileText, FolderOpen, Mail, ShieldCheck, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { OperationsDataTable, OperationsDataTableCell } from "../../components/operations/OperationsDataTable";
import { Status } from "../../components/operations/OperationsPrimitives";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { sheetMirrorStatusLabel, type SheetMirrorStatus } from "../../lib/sheet-mirror-status";
import panelStyles from "./GoogleWorkspacePanel.module.css";
import { WorkspaceBlueprintEditor } from "./WorkspaceBlueprintEditor";
import {
  deriveWorkspaceCreationProgress,
  WorkspaceDriveResourceActions,
  WorkspaceFolderRenameActions,
  type WorkspaceSetupResourcesPayload,
} from "./WorkspaceDriveResourceActions";
import { WorkspaceDomainChecklistCard } from "./workspace-domain-checklist/WorkspaceDomainChecklistCard";
import {
  deriveWorkspaceDomainChecklist,
  workspaceDomainChecklistDisplayStatus,
} from "./workspace-domain-checklist/workspace-domain-checklist";
import { WorkspaceInfoHint } from "./workspace-setup-shell/WorkspaceInfoHint";

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
type SetupStepStatus = "Complete" | "Ready" | "Blocked by previous step" | "Blocked by prerequisites" | "Administrator access" | "Simulated";
type GoogleServiceKey = "drive" | "gmail" | "calendar" | "sheets";
type ConnectionHealthPayload = {
  runtimeMode: "simulation" | "workspace";
  simulation: boolean;
  enabledServices: GoogleServiceKey[];
  connection: {
    status: string;
    account: string | null;
    grantedServices: Record<GoogleServiceKey, boolean> | null;
    requiresReauthorization: boolean;
  };
};
type ConnectionHealthState = "idle" | "loading" | "ready" | "error";
type WorkspaceReadinessState = "idle" | "loading" | "ready" | "error";
type WorkspaceSetupResourcesState = "idle" | "loading" | "ready" | "error";
type StageFourVerificationState = "idle" | "loading" | "ready" | "error";
type WorkspaceStageNumber = 1 | 2 | 3 | 4;
type WorkspaceStageTone = "done" | "current" | "waiting" | "ready" | "neutral";

type SetupStageProps = Readonly<{
  number: WorkspaceStageNumber;
  title: string;
  description: string;
  status: string;
  tone: WorkspaceStageTone;
  complete: boolean;
  firstIncomplete: boolean;
  layoutSettled: boolean;
  statusHint: string;
  children: ReactNode;
}>;

type StageFourRowProps = Readonly<{
  rowKey: string;
  label: string;
  info: string;
  status: string;
  complete?: boolean;
  dependencyBlocked?: boolean;
  children: ReactNode | ((dependencyDescriptionId: string | undefined) => ReactNode);
}>;

const CONNECTION_SERVICE_COLUMNS = [
  { key: "service", label: "Service" },
  { key: "enabled", label: "FCI configuration" },
  { key: "granted", label: "Recorded OAuth permission" },
] as const;

const CONNECTION_SERVICES: readonly { key: GoogleServiceKey; label: string }[] = [
  { key: "drive", label: "Shared Drive" },
  { key: "gmail", label: "Gmail" },
  { key: "calendar", label: "Calendar" },
  { key: "sheets", label: "Sheets" },
];

const WORKSPACE_STAGE_NAMES = [
  "Prepare the tenant",
  "Connect",
  "Define & create your workspace",
  "Verify & maintain",
] as const;

const GMAIL_VERIFICATION_INFO = "Creates the three FCI labels and sends one test email to yourself to confirm filing works. Nothing is ever sent to clients from here.";
const CALENDAR_VERIFICATION_INFO = "Reads the upcoming appointments window and can create one private test hold with no invitations — confirm access without touching anyone's calendar.";
const SHEETS_VERIFICATION_INFO = "Runs one sync of the Client Directory and Project Register mirrors and reports exactly what changed.";
const DRIFT_CHECK_INFO = "Compares your blueprint with what's actually in Drive and shows any differences before you fix them.";
const FOLDER_RENAMES_INFO = "Rename managed folders safely — the app updates Drive and its own records together.";
const NOTIFICATION_ROUTING_COPY = "Review the closed event-to-space map. Hosted webhook secrets stay outside the browser, application data, logs, and source control.";
const NOTIFICATION_ROUTING_INFO = "Choose which supported events can notify each approved Google Chat space. The routing page shows what is available before anything is enabled.";

function SetupStage({
  number,
  title,
  description,
  status,
  tone,
  complete,
  firstIncomplete,
  layoutSettled,
  statusHint,
  children,
}: SetupStageProps) {
  const anchorId = `workspace-stage-${number}`;
  const bodyId = `workspace-stage-${number}-content`;
  const headingId = `workspace-stage-${number}-heading`;
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(!complete && firstIncomplete);
  const hashTargeted = useRef(false);
  const previousComplete = useRef(complete);
  const previousFirstIncomplete = useRef(firstIncomplete);
  const closeStage = useCallback(() => {
    if (bodyRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    setOpen(false);
  }, []);
  const scheduleAnchorScroll = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (hashTargeted.current) sectionRef.current?.scrollIntoView({ block: "start" });
      });
    });
  }, []);

  useEffect(() => {
    const syncHashTarget = () => {
      const targeted = window.location.hash === `#${anchorId}`;
      const wasTargeted = hashTargeted.current;
      hashTargeted.current = targeted;
      if (targeted) {
        setOpen(true);
        scheduleAnchorScroll();
      } else if (wasTargeted) {
        if (!complete && firstIncomplete) setOpen(true);
        else closeStage();
      }
    };
    syncHashTarget();
    window.addEventListener("hashchange", syncHashTarget);
    return () => window.removeEventListener("hashchange", syncHashTarget);
  }, [anchorId, closeStage, complete, firstIncomplete, scheduleAnchorScroll]);

  useEffect(() => {
    if (layoutSettled) {
      if (hashTargeted.current) scheduleAnchorScroll();
      return;
    }
    const stageList = sectionRef.current?.parentElement;
    if (!stageList || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (hashTargeted.current) scheduleAnchorScroll();
    });
    observer.observe(stageList);
    return () => observer.disconnect();
  }, [layoutSettled, scheduleAnchorScroll]);

  useEffect(() => {
    if (!hashTargeted.current && complete && !previousComplete.current) {
      closeStage();
    } else if (!hashTargeted.current && firstIncomplete && !previousFirstIncomplete.current) {
      setOpen(true);
    } else if (!hashTargeted.current && !firstIncomplete && previousFirstIncomplete.current && !complete) {
      closeStage();
    }
    previousComplete.current = complete;
    previousFirstIncomplete.current = firstIncomplete;
    if (hashTargeted.current) scheduleAnchorScroll();
  }, [closeStage, complete, firstIncomplete, scheduleAnchorScroll]);

  return <section
    ref={sectionRef}
    id={anchorId}
    className={`workspace-setup-stage ${panelStyles.stageAnchor}${open ? " open" : ""}${complete ? " complete" : ""}`}
    data-workspace-stage={number}
    aria-labelledby={headingId}
  >
    <header className="workspace-stage-header">
      <h3 className="workspace-stage-heading">
        <button
          ref={toggleRef}
          type="button"
          className="workspace-stage-toggle"
          aria-label={`${open ? "Collapse" : "Expand"} Stage ${number}: ${title}`}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="workspace-stage-number" aria-hidden="true">{number}</span>
          <span className="workspace-stage-copy">
            <span id={headingId} className="workspace-stage-title">{title}</span>
            <span className="workspace-stage-description">{description}</span>
          </span>
          <ChevronDown className="workspace-stage-chevron" size={17} aria-hidden="true" />
        </button>
      </h3>
      <span className="workspace-stage-meta">
        <span className={`workspace-stage-chip ${tone}${tone === "neutral" ? ` ${panelStyles.stageChipNeutral}` : ""}`}>{status}</span>
        <WorkspaceInfoHint label={`About Stage ${number} status`} text={statusHint} />
      </span>
    </header>
    <div ref={bodyRef} id={bodyId} className="workspace-stage-body" hidden={!open}>{children}</div>
  </section>;
}

function StageFourRow({
  rowKey,
  label,
  info,
  status,
  complete = false,
  dependencyBlocked = false,
  children,
}: StageFourRowProps) {
  const headingId = `workspace-verification-${rowKey}-heading`;
  const dependencyDescriptionId = dependencyBlocked ? `workspace-verification-${rowKey}-dependency` : undefined;
  return <article
    className={`${panelStyles.verificationRow}${complete ? ` ${panelStyles.verificationRowComplete}` : ""}`}
    data-stage-four-verification={rowKey}
    data-stage-four-state={status}
    aria-labelledby={headingId}
  >
    <header className={panelStyles.verificationRowHeader}>
      <div className={panelStyles.verificationRowHeading}>
        <h4 id={headingId}>{label}</h4>
        <WorkspaceInfoHint label={`About ${label}`} text={info} />
      </div>
      <span className={`${panelStyles.verificationState}${complete ? ` ${panelStyles.verificationStateReady}` : ""}`}>{status}</span>
    </header>
    <div className={panelStyles.verificationBody}>
      {typeof children === "function" ? children(dependencyDescriptionId) : children}
    </div>
  </article>;
}

function OngoingTool({
  rowKey,
  label,
  info,
  state,
  children,
}: {
  rowKey: string;
  label: string;
  info: string;
  state: "AVAILABLE" | "WAITING" | "PLANNED";
  children: ReactNode;
}) {
  const headingId = `workspace-upkeep-${rowKey}-heading`;
  return <article
    className={panelStyles.ongoingTool}
    data-stage-four-upkeep={rowKey}
    data-stage-four-upkeep-state={state}
    aria-labelledby={headingId}
  >
    <header className={panelStyles.ongoingToolHeader}>
      <div className={panelStyles.ongoingToolHeading}>
        <h4 id={headingId}>{label}</h4>
        <WorkspaceInfoHint label={`About ${label}`} text={info} />
      </div>
      <span className={`${panelStyles.ongoingState} ${state === "PLANNED" ? panelStyles.ongoingStatePlanned : ""}`}>{state}</span>
    </header>
    <div className={panelStyles.ongoingToolBody}>{children}</div>
  </article>;
}

function stepStatus({ simulation, previousComplete = true, prerequisitesReady, complete }: { simulation: boolean; previousComplete?: boolean; prerequisitesReady: boolean; complete: boolean }): SetupStepStatus {
  if (simulation) return "Simulated";
  if (!previousComplete) return "Blocked by previous step";
  if (!prerequisitesReady) return "Blocked by prerequisites";
  return complete ? "Complete" : "Ready";
}

function mirrorTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not synced yet";
}

function sheetMirrorFullySynced(mirror: SheetMirrorStatus | null | undefined) {
  return mirror?.clients.status === "synced" && mirror.projects.status === "synced";
}

async function readStageFourVerification<T>(url: string) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { ok: false as const, data: null };
    return { ok: true as const, data: await response.json() as T };
  } catch {
    return { ok: false as const, data: null };
  }
}

function stageFourServiceEligible(
  workspace: WorkspaceReadiness | null | undefined,
  service: "gmail" | "calendar",
) {
  const enabled = service === "gmail"
    ? workspace?.gmailEnabled === true
    : workspace?.calendarEnabled === true;
  if (!enabled) return false;
  if (workspace?.simulation === true) return true;
  if (workspace?.connectionStatus !== "connected") return false;
  return service === "gmail"
    ? workspace.gmailConnected === true
    : workspace.calendarConnected === true;
}

function maskWorkspaceAccountForDisplay(value: string | null | undefined) {
  if (!value) return "Not connected";
  if (value === "Local Workspace simulation") return value;
  const separator = value.lastIndexOf("@");
  if (separator < 1 || separator === value.length - 1) return "Account hidden";
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (local.includes("•")) return `${local}@${domain}`;
  return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`;
}

export function GoogleWorkspacePanel({ notify, projects, isAdmin }: { notify: Notify; projects: Project[]; isAdmin: boolean }) {
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [missingDetails, setMissingDetails] = useState<MissingDetail[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceReadiness | null>(null);
  const [workspaceReadinessState, setWorkspaceReadinessState] = useState<WorkspaceReadinessState>("idle");
  const [sheetMirror, setSheetMirror] = useState<SheetMirrorStatus | null>(null);
  const [sheetsStatusError, setSheetsStatusError] = useState<string | null>(null);
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealthPayload | null>(null);
  const [connectionHealthState, setConnectionHealthState] = useState<ConnectionHealthState>("idle");
  const [connectionHealthError, setConnectionHealthError] = useState<string | null>(null);
  const [workspaceResources, setWorkspaceResources] = useState<WorkspaceSetupResourcesPayload | null>(null);
  const [workspaceResourcesState, setWorkspaceResourcesState] = useState<WorkspaceSetupResourcesState>("idle");
  const [workspaceResourcesError, setWorkspaceResourcesError] = useState<string | null>(null);
  const [driveVerified, setDriveVerified] = useState(false);
  const [gmailMessages, setGmailMessages] = useState<WorkspaceMessage[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<Array<{ id: string; title: string; start: string; end: string; url?: string }>>([]);
  const [gmailWorking, setGmailWorking] = useState(false);
  const [calendarWorking, setCalendarWorking] = useState(false);
  const [sheetsWorking, setSheetsWorking] = useState(false);
  const [gmailLabelsReady, setGmailLabelsReady] = useState(false);
  const [gmailTestEmailPassed, setGmailTestEmailPassed] = useState(false);
  const [calendarChecked, setCalendarChecked] = useState(false);
  const [sheetsVerificationPassed, setSheetsVerificationPassed] = useState(false);
  const [gmailVerificationState, setGmailVerificationState] = useState<StageFourVerificationState>("idle");
  const [calendarVerificationState, setCalendarVerificationState] = useState<StageFourVerificationState>("idle");
  const [filingMessage, setFilingMessage] = useState<WorkspaceMessage | null>(null);
  const [filingProjectId, setFilingProjectId] = useState("");
  const [filingPreview, setFilingPreview] = useState<GmailFilingPreview | null>(null);
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingSubmitting, setFilingSubmitting] = useState(false);
  const [oauthResult, setOauthResult] = useState<string | null>(null);
  const [blueprintEditorRevision, setBlueprintEditorRevision] = useState(0);
  const readinessChecked = useRef(false);

  const checkSetup = useCallback(async (force = false) => {
    setChecking(true);
    setWorkspaceReadinessState("loading");
    try {
      const sheetsRequest = cachedGetJson<{ mirror?: SheetMirrorStatus }>("/api/v1/integrations/google/sheets/status", { force })
        .then((data) => ({ ok: true as const, data }))
        .catch(() => ({ ok: false as const, data: null }));
      const [data, sheetsResult] = await Promise.all([
        cachedGetJson<{ credentialsPresent?: boolean; missing?: string[]; missingDetails?: MissingDetail[]; workspace?: WorkspaceReadiness }>("/api/v1/google-workspace", { force }),
        sheetsRequest,
      ]);
      const nextWorkspace = data.workspace ?? null;
      const gmailVerificationEligible = isAdmin && stageFourServiceEligible(nextWorkspace, "gmail");
      const calendarVerificationEligible = isAdmin && stageFourServiceEligible(nextWorkspace, "calendar");
      setMissingDetails(data.missingDetails ?? []);
      setWorkspace(nextWorkspace);
      setWorkspaceReadinessState("ready");
      if (sheetsResult.ok) {
        const mirror = sheetsResult.data.mirror ?? null;
        setSheetMirror(mirror);
        setSheetsVerificationPassed((current) => current || sheetMirrorFullySynced(mirror));
        setSheetsStatusError(null);
      } else {
        setSheetsStatusError("Mirror status could not be loaded. Refresh this step to try again.");
      }
      if (gmailVerificationEligible) {
        setGmailVerificationState("loading");
      } else {
        setGmailLabelsReady(false);
        setGmailTestEmailPassed(false);
        setGmailVerificationState("idle");
      }
      if (calendarVerificationEligible) {
        setCalendarVerificationState("loading");
      } else {
        setCalendarChecked(false);
        setCalendarVerificationState("idle");
      }
      const [gmailVerification, calendarVerification] = await Promise.all([
        gmailVerificationEligible
          ? readStageFourVerification<{ labelReady?: boolean; testEmailPassed?: boolean }>(
              "/api/v1/integrations/google/gmail/messages?label=needs-review&verification=status",
            )
          : Promise.resolve(null),
        calendarVerificationEligible
          ? readStageFourVerification<{ verificationPassed?: boolean }>(
              "/api/v1/integrations/google/calendar/events?verification=status",
            )
          : Promise.resolve(null),
      ]);
      if (gmailVerification?.ok) {
        setGmailLabelsReady(Boolean(gmailVerification.data.labelReady));
        setGmailTestEmailPassed(Boolean(gmailVerification.data.testEmailPassed));
        setGmailVerificationState("ready");
      } else if (gmailVerificationEligible) {
        setGmailVerificationState("error");
      }
      if (calendarVerification?.ok) {
        setCalendarChecked(Boolean(calendarVerification.data.verificationPassed));
        setCalendarVerificationState("ready");
      } else if (calendarVerificationEligible) {
        setCalendarVerificationState("error");
      }
      if (!nextWorkspace?.simulation && nextWorkspace?.connectionStatus !== "connected") {
        setDriveVerified(false);
        setSheetsVerificationPassed(false);
      }
      notify("Workspace readiness refreshed. Current status is shown above.", nextWorkspace?.simulation || data.credentialsPresent ? "info" : "warning");
    } catch {
      setWorkspaceReadinessState("error");
      if (isAdmin) {
        setGmailVerificationState("error");
        setCalendarVerificationState("error");
      }
      notify("Workspace readiness could not be checked. Confirm the app is running and try again.", "error");
    } finally {
      setChecking(false);
    }
  }, [isAdmin, notify]);

  const loadConnectionHealth = useCallback(async (force = false) => {
    if (!isAdmin) return;
    setConnectionHealthState("loading");
    setConnectionHealthError(null);
    try {
      const data = await cachedGetJson<ConnectionHealthPayload>("/api/v1/integrations/google/connection", { force });
      setConnectionHealth(data);
      setConnectionHealthState("ready");
    } catch {
      setConnectionHealthError("Connection details could not be loaded. Retry before changing the saved connection.");
      setConnectionHealthState("error");
    }
  }, [isAdmin]);

  const loadWorkspaceResources = useCallback(async (force = false) => {
    if (!isAdmin) return;
    setWorkspaceResourcesState("loading");
    setWorkspaceResourcesError(null);
    try {
      const data = await cachedGetJson<WorkspaceSetupResourcesPayload>("/api/v1/integrations/google/setup/resources", { force });
      setWorkspaceResources(data);
      setWorkspaceResourcesState("ready");
    } catch {
      setWorkspaceResourcesError("Workspace resource status could not be loaded. Retry before using this setup summary.");
      setWorkspaceResourcesState("error");
    }
  }, [isAdmin]);

  const refreshWorkspaceSetup = useCallback(async (force = false) => {
    await Promise.all([
      checkSetup(force),
      isAdmin ? loadConnectionHealth(force) : Promise.resolve(),
      isAdmin ? loadWorkspaceResources(force) : Promise.resolve(),
    ]);
  }, [checkSetup, isAdmin, loadConnectionHealth, loadWorkspaceResources]);

  const refreshAfterDriveSetup = useCallback(async (change: { driveVerified?: boolean; blueprintChanged?: boolean }) => {
    if (change.driveVerified) setDriveVerified(true);
    if (change.blueprintChanged) setBlueprintEditorRevision((current) => current + 1);
    invalidateCachedGet("/api/v1/google-workspace");
    invalidateCachedGet("/api/v1/integrations/google/setup/resources");
    invalidateCachedGet("/api/v1/integrations/google/sheets/status");
    await Promise.all([checkSetup(true), loadWorkspaceResources(true)]);
  }, [checkSetup, loadWorkspaceResources]);

  useEffect(() => {
    if (readinessChecked.current) return;
    readinessChecked.current = true;
    void checkSetup();
  }, [checkSetup]);

  useEffect(() => {
    if (!isAdmin) return;
    void Promise.resolve().then(() => Promise.all([loadConnectionHealth(), loadWorkspaceResources()]));
  }, [isAdmin, loadConnectionHealth, loadWorkspaceResources]);

  useEffect(() => {
    const current = new URL(window.location.href);
    const result = current.searchParams.get("google");
    if (result === null) return;
    void Promise.resolve().then(() => setOauthResult(result));
    current.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
    invalidateCachedGet("/api/v1/google-workspace");
    invalidateCachedGet("/api/v1/integrations/google/connection");
    invalidateCachedGet("/api/v1/integrations/google/setup/resources");
    invalidateCachedGet("/api/v1/integrations/google/sheets/status");
    void Promise.resolve().then(() => refreshWorkspaceSetup(true));
  }, [refreshWorkspaceSetup]);

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
      setGmailTestEmailPassed(false);
      setCalendarChecked(false);
      setSheetsVerificationPassed(false);
      setGmailMessages([]);
      setCalendarEvents([]);
      notify("The active Google connection was removed from FCI Operations.", "success");
      invalidateCachedGet("/api/v1/google-workspace");
      invalidateCachedGet("/api/v1/integrations/google/connection");
      invalidateCachedGet("/api/v1/integrations/google/setup/resources");
      invalidateCachedGet("/api/v1/integrations/google/sheets/status");
      await refreshWorkspaceSetup(true);
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
      const data = await readApi<{ messages?: WorkspaceMessage[] }>("/api/v1/integrations/google/gmail/messages?label=inbox");
      setGmailMessages(data.messages ?? []);
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
      setGmailTestEmailPassed(true);
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
      const mirror = data.mirror ?? null;
      setSheetMirror(mirror);
      setSheetsVerificationPassed((current) => current || sheetMirrorFullySynced(mirror));
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
      const mirror = data.mirror ?? null;
      setSheetMirror(mirror);
      setSheetsVerificationPassed((current) => current || sheetMirrorFullySynced(mirror));
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
      setGmailTestEmailPassed(false);
      setCalendarChecked(false);
      setSheetsVerificationPassed(false);
      setBlueprintEditorRevision((current) => current + 1);
      notify(`Workspace simulation reset with ${data.messages} sample messages and ${data.events} calendar events.`, "success");
      invalidateCachedGet("/api/v1/google-workspace");
      invalidateCachedGet("/api/v1/integrations/google/connection");
      invalidateCachedGet("/api/v1/integrations/google/setup/resources");
      invalidateCachedGet("/api/v1/integrations/google/sheets/status");
      await refreshWorkspaceSetup(true);
      setSheetsVerificationPassed(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Workspace simulation could not be reset.", "error");
    } finally {
      setWorking(false);
    }
  }

  const simulation = workspace?.simulation === true;
  const resourceRows = workspaceResources?.resources ?? [];
  const workspaceResourcesKnown = workspaceResources !== null && workspaceResourcesState !== "error";
  const workspaceCreationProgress = deriveWorkspaceCreationProgress(
    resourceRows,
    simulation,
    workspaceResourcesKnown,
  );
  const configured = simulation || workspaceResources?.connectReady === true;
  const connected = workspace?.connectionStatus === "connected";
  const reconnectRequired = workspace?.requiresReauthorization === true;
  const connectComplete = connected && !reconnectRequired;
  const effectiveSharedDriveConfigured = Boolean(workspaceResources?.resources.some((resource) => (
    (resource.resourceType === "drive.shared-drive" || (!resource.resourceType && resource.key === "primary"))
    && resource.key === "primary"
    && resource.externalId
  )));
  const driveReady = connectComplete && workspace?.driveConnected === true && (workspace?.storageConfigured === true || effectiveSharedDriveConfigured);
  const gmailReady = connected && workspace?.gmailEnabled === true && workspace?.gmailConnected === true;
  const calendarReady = connected && workspace?.calendarEnabled === true && workspace?.calendarConnected === true;
  const sheetsReady = connected && workspace?.sheetsEnabled === true && workspace?.sheetsConnected === true && workspace?.clientDirectorySheetConfigured === true;
  const gmailVerificationPassed = gmailLabelsReady && gmailTestEmailPassed;
  const driveStepStatus = stepStatus({
    simulation,
    previousComplete: connectComplete,
    prerequisitesReady: driveReady,
    complete: driveVerified || workspaceCreationProgress.sharedDriveComplete,
  });
  const gmailStepStatus = stepStatus({ simulation, previousComplete: driveStepStatus === "Complete", prerequisitesReady: gmailReady, complete: gmailLabelsReady });
  const calendarStepStatus = stepStatus({ simulation, previousComplete: gmailStepStatus === "Complete", prerequisitesReady: calendarReady, complete: calendarChecked });
  const hasStoredConnection = !simulation && Boolean(workspace?.connectionStatus && workspace.connectionStatus !== "not-connected");
  const sharedDriveDomainUsersOnly = resourceRows.find((resource) => resource.key === "primary")?.restrictions?.domainUsersOnly ?? null;
  const gmailActionsEnabled = simulation || (driveStepStatus === "Complete" && gmailReady);
  const calendarActionsEnabled = simulation || (gmailStepStatus === "Complete" && calendarReady);
  const sheetsActionsEnabled = simulation || (calendarStepStatus === "Complete" && sheetsReady);
  const statusSourcesLoading = checking
    || workspaceReadinessState === "idle"
    || workspaceReadinessState === "loading"
    || connectionHealthState === "idle"
    || connectionHealthState === "loading"
    || workspaceResourcesState === "idle"
    || workspaceResourcesState === "loading"
    || sheetsWorking;
  const allStatusSourcesAvailable = Boolean(workspace && connectionHealth && workspaceResources);
  const statusSourcesUnavailable = workspaceReadinessState === "error"
    || connectionHealthState === "error"
    || workspaceResourcesState === "error"
    || sheetsStatusError !== null
    || (!statusSourcesLoading && !allStatusSourcesAvailable);
  const sourceModes = [
    workspace?.runtimeMode,
    connectionHealth?.runtimeMode,
    workspaceResources?.identity.mode,
  ].filter((mode): mode is "simulation" | "workspace" => mode === "simulation" || mode === "workspace");
  const bannerSimulation = allStatusSourcesAvailable
    && sourceModes.length === 3
    && sourceModes.every((mode) => mode === "simulation");
  const bannerWorkspace = allStatusSourcesAvailable
    && sourceModes.length === 3
    && sourceModes.every((mode) => mode === "workspace");
  const modeDisagreement = sourceModes.length > 1 && new Set(sourceModes).size > 1;
  const readinessConnectionComplete = workspace?.connectionStatus === "connected"
    && workspace.requiresReauthorization !== true;
  const healthConnectionComplete = connectionHealth?.connection.status === "connected"
    && connectionHealth.connection.requiresReauthorization !== true;
  const resourceConnectionPresent = Boolean(workspaceResources?.identity.connectionAccount);
  const sourceAccounts = [
    workspace?.connectionAccount,
    connectionHealth?.connection.account,
    workspaceResources?.identity.connectionAccount,
  ].filter((account): account is string => Boolean(account?.trim()))
    .map((account) => maskWorkspaceAccountForDisplay(account).trim().toLowerCase());
  const anyConnectionClaim = readinessConnectionComplete || healthConnectionComplete || resourceConnectionPresent;
  const accountDisagreement = anyConnectionClaim
    && (sourceAccounts.length !== 3 || new Set(sourceAccounts).size > 1);
  const liveConnectionComplete = bannerWorkspace
    && !accountDisagreement
    && readinessConnectionComplete
    && healthConnectionComplete
    && resourceConnectionPresent;
  const connectionSignals = allStatusSourcesAvailable
    ? [readinessConnectionComplete, healthConnectionComplete, resourceConnectionPresent]
    : [];
  const connectionDisagreement = connectionSignals.some(Boolean) && connectionSignals.some((signal) => !signal);
  const stageOneChecklist = deriveWorkspaceDomainChecklist({
    isAdmin,
    simulation,
    readinessKnown: workspaceReadinessState === "ready",
    missingDetails,
    resourcesKnown: workspaceResourcesState === "ready" && workspaceResources !== null,
    connectReady: workspaceResources?.connectReady === true,
    allowedDomainCount: workspaceResources?.identity.allowedDomains.length ?? 0,
    intakeMailboxMatches: workspaceResources?.identity.intakeMailboxMatches ?? null,
    hasConnectionAccount: Boolean(workspaceResources?.identity.connectionAccount),
    connectionKnown: connectionHealthState === "ready",
    connectionStatus: connectionHealth?.connection.status ?? null,
    requiresReauthorization: connectionHealth?.connection.requiresReauthorization === true,
  });
  const stageOneCompleteCount = stageOneChecklist.filter(({ status }) => (
    workspaceDomainChecklistDisplayStatus(status) === "DONE"
  )).length;
  const stageOneComplete = workspaceResources?.connectReady === true;
  const stageTwoComplete = bannerSimulation || liveConnectionComplete;
  const bannerWorkspaceCreationProgress = deriveWorkspaceCreationProgress(
    resourceRows,
    bannerSimulation,
    workspaceResourcesKnown,
  );
  const completeWorkspaceCreationCount = bannerWorkspaceCreationProgress.completedCount;
  const stageThreeResourcesComplete = completeWorkspaceCreationCount === 4;
  const stageThreeComplete = stageTwoComplete && stageThreeResourcesComplete;
  const folderRenamesEnabled = stageTwoComplete
    && workspaceResourcesKnown
    && workspaceCreationProgress.sharedDriveComplete;
  const stageFourVerificationUnavailable = gmailVerificationState === "error"
    || calendarVerificationState === "error";
  const stageFourCompleteCount = [gmailVerificationPassed, calendarChecked, sheetsVerificationPassed].filter(Boolean).length;
  const stageFourReady = !stageFourVerificationUnavailable && stageFourCompleteCount === 3;
  const stageCompletion = [stageOneComplete, stageTwoComplete, stageThreeComplete, false] as const;
  const currentStageNumber = (stageCompletion.findIndex((complete) => !complete) + 1) as WorkspaceStageNumber;
  const currentStageName = WORKSPACE_STAGE_NAMES[currentStageNumber - 1];
  const statusAgreement = statusSourcesUnavailable
    ? "unavailable"
    : (!bannerSimulation && !bannerWorkspace) || modeDisagreement || connectionDisagreement || accountDisagreement
      ? "conservative"
      : "agreed";
  const bannerReconnectRequired = reconnectRequired || connectionHealth?.connection.requiresReauthorization === true;
  const bannerAccount = maskWorkspaceAccountForDisplay(
    connectionHealth?.connection.account
      ?? workspace?.connectionAccount
      ?? workspaceResources?.identity.connectionAccount,
  );
  let bannerHeadline: string;
  let bannerNextStep: string;
  if (statusSourcesLoading) {
    bannerHeadline = "Checking current status…";
    bannerNextStep = "Waiting for all setup status checks to finish.";
  } else if (statusSourcesUnavailable) {
    bannerHeadline = "Current Workspace status is unavailable";
    bannerNextStep = "Next: retry Check readiness before changing setup.";
  } else if (bannerSimulation) {
    bannerHeadline = "Simulation ready";
    bannerNextStep = "Everything below runs locally.";
  } else if (currentStageNumber === 1) {
    bannerHeadline = "Not connected to Google yet";
    bannerNextStep = "Next: finish Stage 1, then Connect.";
  } else if (currentStageNumber === 2) {
    bannerHeadline = bannerReconnectRequired ? "Google permission update required" : "Ready to connect Google";
    bannerNextStep = bannerReconnectRequired
      ? "Next: reconnect the company account in Stage 2."
      : "Next: connect the company account in Stage 2.";
  } else if (currentStageNumber === 3) {
    bannerHeadline = bannerAccount === "Not connected" ? "Google Workspace connected" : `Connected as ${bannerAccount}`;
    bannerNextStep = "Next: create your workspace in Stage 3.";
  } else if (stageFourReady) {
    bannerHeadline = "Workspace setup is ready";
    bannerNextStep = "Next: use Stage 4 for ongoing checks.";
  } else {
    bannerHeadline = bannerAccount === "Not connected" ? "Google Workspace connected" : `Connected as ${bannerAccount}`;
    bannerNextStep = "Next: verify Gmail, Calendar, and Sheets in Stage 4.";
  }
  const bannerModeLabel = statusSourcesLoading
    ? "CHECKING"
    : statusSourcesUnavailable
      ? "UNAVAILABLE"
      : bannerSimulation
        ? "SIMULATION"
        : "WORKSPACE";
  const bannerProgressLabel = statusSourcesLoading
    ? "Stage status pending"
    : statusSourcesUnavailable
      ? "Current stage unavailable"
      : `Stage ${currentStageNumber} of 4`;
  const bannerProgressDetail = statusSourcesLoading
    ? "Waiting for all status sources"
    : statusSourcesUnavailable
      ? "Retry Check readiness"
      : currentStageName;
  const neutralStageStatus = statusSourcesLoading
    ? "CHECKING"
    : statusSourcesUnavailable
      ? "UNAVAILABLE"
      : null;
  const stageOneStatus = neutralStageStatus ?? (stageOneComplete ? "DONE" : `IN PROGRESS · ${stageOneCompleteCount} of ${stageOneChecklist.length}`);
  const stageTwoStatus = neutralStageStatus ?? (stageTwoComplete ? "DONE" : stageOneComplete ? "IN PROGRESS" : "WAITING ON STAGE 1");
  const stageThreeStatus = neutralStageStatus ?? (stageThreeComplete
    ? "DONE"
    : stageTwoComplete
      ? `IN PROGRESS · ${completeWorkspaceCreationCount} of 4`
      : "WAITING ON STAGE 2");
  const stageFourStatus = statusSourcesLoading
    ? "CHECKING"
    : statusSourcesUnavailable || stageFourVerificationUnavailable
        ? "UNAVAILABLE"
        : stageFourReady
          ? "READY"
          : `${stageFourCompleteCount} OF 3 VERIFIED`;
  const stageFourStatusNeutral = stageFourStatus === "CHECKING" || stageFourStatus === "UNAVAILABLE";
  const gmailVerificationStatus = gmailVerificationState === "error"
    ? "UNAVAILABLE"
    : gmailVerificationPassed
      ? "VERIFIED"
      : gmailLabelsReady
        ? "TEST EMAIL NEEDED"
        : gmailActionsEnabled
          ? "READY TO VERIFY"
          : "WAITING";
  const calendarVerificationStatus = calendarVerificationState === "error"
    ? "UNAVAILABLE"
    : calendarChecked
      ? "VERIFIED"
      : calendarActionsEnabled
        ? "READY TO VERIFY"
        : "WAITING";
  const sheetsVerificationStatus = sheetsVerificationPassed
    ? "VERIFIED"
    : sheetsStatusError
      ? "UNAVAILABLE"
      : sheetsActionsEnabled
        ? "READY TO VERIFY"
        : "WAITING";
  const oauthMessage = oauthResult === "connected"
    ? "Google authorization completed. Current Workspace status is shown above."
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
      <div><p className="eyebrow">Company integration</p><h2>Google Workspace</h2><p>Work through four stages in order. Every status comes from the current Workspace readiness or service response.</p></div>
      <button className="primary-button" onClick={() => void refreshWorkspaceSetup(true)} disabled={checking}>{checking ? "Checking…" : "Check readiness"}</button>
    </div>
    <div className="workspace-status-banner" data-status-agreement={statusAgreement} role="status" aria-live="polite">
      <span className={`workspace-status-mode${statusSourcesLoading || statusSourcesUnavailable ? ` ${panelStyles.statusModeNeutral}` : ""}`}>{bannerModeLabel}</span>
      <span className="workspace-status-copy"><strong>{bannerHeadline}</strong><span>{bannerNextStep}</span></span>
      <span className="workspace-status-progress"><strong>{bannerProgressLabel}</strong><span>{bannerProgressDetail}</span></span>
    </div>
    {!simulation && oauthMessage && <p className={oauthResult === "connected" ? "workspace-warning" : "workspace-missing"}>{oauthMessage}</p>}
    <div className="workspace-stage-list" role="group" aria-label="Google Workspace setup stages">
      <SetupStage
        number={1}
        title="Prepare the tenant"
        description="One-time steps done in Google's consoles — usually your Workspace admin"
        status={stageOneStatus}
        tone={neutralStageStatus ? "neutral" : stageOneComplete ? "done" : "current"}
        complete={stageOneComplete}
        firstIncomplete={currentStageNumber === 1}
        layoutSettled={!statusSourcesLoading}
        statusHint="This stage is complete when the required connection prerequisites are ready."
      >
        <WorkspaceDomainChecklistCard
          isAdmin={isAdmin}
          simulation={simulation}
          readinessState={workspaceReadinessState}
          missingDetails={missingDetails}
          resourcesState={workspaceResourcesState}
          resourcesAvailable={workspaceResources !== null}
          resources={resourceRows}
          connectReady={workspaceResources?.connectReady === true}
          allowedDomainCount={workspaceResources?.identity.allowedDomains.length ?? 0}
          intakeMailboxMatches={workspaceResources?.identity.intakeMailboxMatches ?? null}
          hasConnectionAccount={Boolean(workspaceResources?.identity.connectionAccount)}
          connectionState={connectionHealthState}
          connectionStatus={connectionHealth?.connection.status ?? null}
          requiresReauthorization={connectionHealth?.connection.requiresReauthorization === true}
          sharedDriveDomainUsersOnly={sharedDriveDomainUsersOnly}
          environmentNotes={<>
            {!simulation && <p className="workspace-env-note"><strong>Drive authority:</strong> adopt the Shared Drive in Resources to save its ID in the app; <code>GOOGLE_WORKSPACE_SHARED_DRIVE_ID</code> remains a first-boot fallback. Project-folder provisioning still uses the hosted <code>GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED</code> gate.</p>}
            <p className="workspace-env-note"><strong>Sheets authority:</strong> ensure blueprint spreadsheets in Resources to save their IDs in the app. <code>GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID</code> remains a first-boot fallback.</p>
          </>}
          notify={notify}
        />
      </SetupStage>
      <SetupStage
        number={2}
        title="Connect"
        description="Authorize the one company Google account"
        status={stageTwoStatus}
        tone={neutralStageStatus ? "neutral" : stageTwoComplete ? "done" : stageOneComplete ? "current" : "waiting"}
        complete={stageTwoComplete}
        firstIncomplete={currentStageNumber === 2}
        layoutSettled={!statusSourcesLoading}
        statusHint="This stage is complete when the company account is connected; simulation is ready immediately."
      >
        <section className={panelStyles.connectionActions} aria-labelledby="workspace-connection-actions-heading">
          <header className={panelStyles.connectionActionsHeader}>
            <span className="integration-logo google" aria-hidden="true"><Mail size={20} /></span>
            <div>
              <h3 id="workspace-connection-actions-heading">Company account authorization</h3>
              <p>{simulation
                ? "Simulation runs locally, and nothing is sent to Google. Reset restores the isolated sample Gmail, Calendar, Drive, and Sheets state."
                : "Authorize the one approved company account. Reconnect to confirm enabled services again, or disconnect the saved account from FCI Operations."}</p>
            </div>
          </header>
          <div className={`workspace-actions ${panelStyles.connectionActionButtons}`}>
            {simulation
              ? <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void resetSimulation()} disabled={working}>{working ? "Resetting…" : "Reset simulation data"}</AdministratorActionButton>
              : <>
                {!connected && <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void connectGoogleDrive()} disabled={!configured || working}>{working ? "Preparing…" : reconnectRequired ? "Reconnect Google Workspace" : "Connect Google Workspace"}</AdministratorActionButton>}
                {hasStoredConnection && <AdministratorActionButton className="soft-button" isAdmin={isAdmin} onClick={() => void disconnectGoogleDrive()} disabled={working}>{working ? "Disconnecting…" : "Disconnect Workspace"}</AdministratorActionButton>}
              </>}
          </div>
        </section>
        {isAdmin && <details className={`workspace-connection-health ${panelStyles.connectionHealthExpander}`}>
          <summary className={panelStyles.connectionHealthToggle}>
            <span className={panelStyles.connectionHealthToggleCopy}>
              <span className="eyebrow">Administrator details</span>
              <strong id="workspace-connection-health-heading">Connection health</strong>
              <span>Account and recorded service permissions</span>
            </span>
            <ChevronDown className={panelStyles.connectionHealthChevron} size={18} aria-hidden="true" />
          </summary>
          <div className={panelStyles.connectionHealthBody} aria-labelledby="workspace-connection-health-heading">
            {connectionHealthState === "loading" && !connectionHealth && <p className="workspace-connection-health-message" role="status">Loading the saved connection details…</p>}
            {connectionHealthError && <div className="workspace-connection-health-error" role="alert"><span>{connectionHealthError}</span><button className="soft-button" type="button" onClick={() => void loadConnectionHealth(true)}>Retry details</button></div>}
            {connectionHealth && <>
              <dl className={panelStyles.connectionHealthAccount}>
                <div><dt>Account</dt><dd>{maskWorkspaceAccountForDisplay(connectionHealth.connection.account)}</dd></div>
              </dl>
              {connectionHealth.connection.requiresReauthorization && <p className="workspace-warning"><CircleAlert size={15} /><span><strong>Reauthorization required:</strong> Disconnect this saved connection, then reconnect the exact approved account and approve every enabled service.</span></p>}
              <OperationsDataTable className="workspace-connection-service-table" columns={CONNECTION_SERVICE_COLUMNS} labelledBy="workspace-connection-health-heading">
                {CONNECTION_SERVICES.map((service) => {
                  const enabled = connectionHealth.enabledServices.includes(service.key);
                  const granted = connectionHealth.connection.grantedServices?.[service.key];
                  const grantLabel = connectionHealth.simulation ? "Not applicable — simulated" : granted ? "Granted" : "Not granted";
                  return <tr key={service.key}>
                    <OperationsDataTableCell label="Service"><strong>{service.label}</strong></OperationsDataTableCell>
                    <OperationsDataTableCell label="FCI configuration"><span className={`workspace-service-state ${enabled ? "ready" : "inactive"}`}>{enabled ? "Enabled" : "Not enabled"}</span></OperationsDataTableCell>
                    <OperationsDataTableCell label="Recorded OAuth permission"><span className={`workspace-service-state ${granted ? "ready" : "inactive"}`}>{grantLabel}</span></OperationsDataTableCell>
                  </tr>;
                })}
              </OperationsDataTable>
              <p className="workspace-connection-health-note">Recorded permission reflects the saved Google consent only. It is not a live provider-health or freshness check.</p>
            </>}
          </div>
        </details>}
      </SetupStage>
      <SetupStage
        number={3}
        title="Define & create your workspace"
        description="Decide what exists, then create it — in order"
        status={stageThreeStatus}
        tone={neutralStageStatus ? "neutral" : stageThreeComplete ? "done" : stageTwoComplete ? "current" : "waiting"}
        complete={stageThreeComplete}
        firstIncomplete={currentStageNumber === 3}
        layoutSettled={!statusSourcesLoading}
        statusHint="This stage is complete when every required Drive, folder, spreadsheet, and template resource is created or adopted."
      >
        {isAdmin ? <div className={panelStyles.stageThreeFrame}>
          <div className={panelStyles.stageThreeUnified}>
            <div className={panelStyles.stageThreeCreation} data-stage-three-pane="creation">
              <WorkspaceDriveResourceActions
                resources={resourceRows}
                simulation={simulation}
                resourcesReady={workspaceResourcesKnown}
                resourcesLoading={workspaceResourcesState === "idle" || workspaceResourcesState === "loading"}
                resourcesError={workspaceResourcesError}
                stageReady={stageTwoComplete}
                driveReady={driveReady}
                driveVerificationReady={simulation || driveReady}
                driveVerified={driveVerified}
                driveWorking={working}
                calendarReady={calendarReady}
                calendarWorking={calendarWorking}
                notify={notify}
                onRetryResources={() => loadWorkspaceResources(true)}
                onVerifyDrive={verifyGoogleDrive}
                onVerifyCalendar={refreshTestCalendar}
                onChanged={refreshAfterDriveSetup}
              />
            </div>
            <div className={panelStyles.stageThreeBlueprint} data-stage-three-pane="blueprint">
              <WorkspaceBlueprintEditor notify={notify} refreshKey={blueprintEditorRevision} />
            </div>
          </div>
        </div> : <section className="workspace-setup-card">
          <p className="workspace-admin-readonly"><ShieldCheck size={15} /><span>Workspace definition and creation are available to Administrators. No administrator setup request is made for this Office view.</span></p>
        </section>}
      </SetupStage>
      <SetupStage
        number={4}
        title="Verify & maintain"
        description="Prove each service works, then ongoing upkeep"
        status={stageFourStatus}
        tone={stageFourStatusNeutral ? "neutral" : stageFourReady ? "ready" : stageThreeComplete ? "current" : "waiting"}
        complete={false}
        firstIncomplete={currentStageNumber === 4}
        layoutSettled={!statusSourcesLoading}
        statusHint="This stage stays available for ongoing checks and reads Ready after Gmail, Calendar, and Sheets are verified."
      >
        <div className={panelStyles.stageFourFrame}>
          <section className={panelStyles.verificationGroup} aria-labelledby="workspace-first-run-verification-heading">
            <header className={panelStyles.stageFourGroupHeader}>
              <div>
                <p className="eyebrow">First-run checks</p>
                <h3 id="workspace-first-run-verification-heading">Verify each service</h3>
              </div>
            </header>
            <div className={panelStyles.verificationList}>
              <StageFourRow
                rowKey="gmail"
                label="Gmail — labels & test email"
                info={GMAIL_VERIFICATION_INFO}
                status={gmailVerificationStatus}
                complete={gmailVerificationState !== "error" && gmailVerificationPassed}
                dependencyBlocked={!gmailActionsEnabled}
              >
                {(dependencyDescriptionId) => <div className="test-service-card">
                  <div className="test-service-heading">
                    <Mail size={17} />
                    <div>
                      <strong>Gmail verification</strong>
                      <span id={dependencyDescriptionId}>{gmailActionsEnabled ? "Ready for explicit actions" : "Blocked until the prior step is complete"}</span>
                    </div>
                  </div>
                  <p>View up to 20 messages, add a sample email in simulation, and review-copy one message into the exact project. Inbox stays intact.</p>
                  <div className="workspace-actions">
                    <AdministratorActionButton className="soft-button" isAdmin={isAdmin} aria-describedby={dependencyDescriptionId} onClick={() => void prepareTestGmailLabels()} disabled={!gmailActionsEnabled || gmailWorking}>{gmailWorking ? "Working…" : gmailLabelsReady ? "Refresh FCI labels" : "Prepare FCI labels"}</AdministratorActionButton>
                    <AdministratorActionButton className="soft-button" isAdmin={isAdmin} aria-describedby={dependencyDescriptionId} onClick={() => void refreshTestGmail()} disabled={!gmailActionsEnabled || gmailWorking}>{gmailWorking ? "Loading…" : "View inbox"}</AdministratorActionButton>
                    <AdministratorActionButton className="primary-button" isAdmin={isAdmin} aria-describedby={dependencyDescriptionId} onClick={() => void sendSelfTestEmail()} disabled={!gmailActionsEnabled || gmailWorking}>{gmailWorking ? "Working…" : simulation ? "Add sample email" : "Send Workspace test"}</AdministratorActionButton>
                  </div>
                  {gmailMessages.length > 0 && <div className="test-service-list">{gmailMessages.map((message) => <article key={message.id}><div><strong>{message.subject || "(No subject)"}</strong><span>{message.from || "Unknown sender"}{message.date ? ` · ${new Date(message.date).toLocaleString()}` : ""}</span><p>{message.snippet}</p></div><div className="gmail-message-actions"><AdministratorActionButton className="primary-button" isAdmin={isAdmin} aria-describedby={dependencyDescriptionId} onClick={() => openFilingReview(message)} disabled={gmailWorking || !gmailActionsEnabled}>Review & copy</AdministratorActionButton></div></article>)}</div>}
                </div>}
              </StageFourRow>
              <StageFourRow
                rowKey="calendar"
                label="Calendar — appointments & test hold"
                info={CALENDAR_VERIFICATION_INFO}
                status={calendarVerificationStatus}
                complete={calendarVerificationState !== "error" && calendarChecked}
                dependencyBlocked={!calendarActionsEnabled}
              >
                {(dependencyDescriptionId) => <div className="test-service-card">
                  <div className="test-service-heading">
                    <CalendarDays size={17} />
                    <div>
                      <strong>Calendar verification</strong>
                      <span id={dependencyDescriptionId}>{calendarActionsEnabled ? "Ready for appointment testing" : "Blocked until Gmail setup is complete"}</span>
                    </div>
                  </div>
                  <p>View a seven-day appointments window or create one 30-minute hold. Simulation stores it locally; live mode uses the configured company calendar.</p>
                  <div className="workspace-actions">
                    <AdministratorActionButton className="soft-button" isAdmin={isAdmin} aria-describedby={dependencyDescriptionId} onClick={() => void refreshTestCalendar()} disabled={!calendarActionsEnabled || calendarWorking}>{calendarWorking ? "Loading…" : "View upcoming events"}</AdministratorActionButton>
                    <AdministratorActionButton className="primary-button" isAdmin={isAdmin} aria-describedby={dependencyDescriptionId} onClick={() => void createTestCalendarHold()} disabled={!calendarActionsEnabled || calendarWorking}>{calendarWorking ? "Creating…" : "Create test hold"}</AdministratorActionButton>
                  </div>
                  {calendarEvents.length > 0 && <div className="test-service-list">{calendarEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{new Date(event.start).toLocaleString()} – {new Date(event.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>{event.url && <button className="soft-button" onClick={() => window.open(event.url, "_blank", "noopener,noreferrer")}>Open</button>}</article>)}</div>}
                </div>}
              </StageFourRow>
              <StageFourRow
                rowKey="sheets"
                label="Sheets — mirror sync"
                info={SHEETS_VERIFICATION_INFO}
                status={sheetsVerificationStatus}
                complete={sheetsVerificationPassed}
              >
                <div className="workspace-sheet-summary">
                  <article><span>Client Directory</span><strong>{sheetMirrorStatusLabel(sheetMirror, "clients")}</strong><small>{mirrorTime(sheetMirror?.clients.lastSyncedAt)}</small></article>
                  <article><span>Project Register</span><strong>{sheetMirrorStatusLabel(sheetMirror, "projects")}</strong><small>{mirrorTime(sheetMirror?.projects.lastSyncedAt)}</small></article>
                </div>
                {(sheetsStatusError || sheetMirror?.reason) && <p className="workspace-missing">{sheetsStatusError ?? sheetMirror?.reason}</p>}
                <div className="workspace-actions">
                  <button className="soft-button" onClick={() => void refreshSheetsStatus()} disabled={sheetsWorking}>{sheetsWorking ? "Refreshing…" : "Refresh mirror status"}</button>
                  <AdministratorActionButton className="primary-button" isAdmin={isAdmin} onClick={() => void syncGoogleSheets()} disabled={sheetsWorking || !sheetsActionsEnabled}>{sheetsWorking ? "Syncing…" : "Sync now"}</AdministratorActionButton>
                  {sheetMirror?.spreadsheetUrl && <a className="soft-button" href={sheetMirror.spreadsheetUrl} target="_blank" rel="noreferrer">Open spreadsheet</a>}
                </div>
              </StageFourRow>
            </div>
          </section>
          <section className={panelStyles.ongoingGroup} aria-labelledby="workspace-ongoing-upkeep-heading">
            <header className={panelStyles.ongoingGroupHeader}>
              <h3 id="workspace-ongoing-upkeep-heading">Ongoing upkeep</h3>
              <p>{"Tools you'll come back to — these never block setup."}</p>
            </header>
            <div className={panelStyles.ongoingList}>
              <OngoingTool
                rowKey="drift"
                label="Drift check"
                info={DRIFT_CHECK_INFO}
                state="PLANNED"
              >
                <p>Planned for SET-18. No reconcile action is available yet.</p>
              </OngoingTool>
              <OngoingTool
                rowKey="renames"
                label="Renames"
                info={FOLDER_RENAMES_INFO}
                state={folderRenamesEnabled ? "AVAILABLE" : "WAITING"}
              >
                <p>Use the managed rename action here instead of renaming an app-owned folder directly in Drive.</p>
                {isAdmin && <WorkspaceFolderRenameActions
                  resources={resourceRows}
                  resourcesReady={workspaceResourcesKnown}
                  enabled={folderRenamesEnabled}
                  notify={notify}
                  onChanged={refreshAfterDriveSetup}
                />}
              </OngoingTool>
              <OngoingTool
                rowKey="notifications"
                label="Notification routing"
                info={NOTIFICATION_ROUTING_INFO}
                state="AVAILABLE"
              >
                <p>{NOTIFICATION_ROUTING_COPY}</p>
                <a className="soft-button" href="/settings?section=workflow-notifications">Open notification routing</a>
              </OngoingTool>
            </div>
          </section>
        </div>
      </SetupStage>
    </div>
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

