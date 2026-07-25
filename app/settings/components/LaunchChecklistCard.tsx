"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import {
  LAUNCH_CHECKLIST_ITEMS,
  normalizeLaunchChecklist,
  type LaunchChecklist,
  type LaunchChecklistItemId,
} from "../../domain/launch-checklist";
import styles from "./LaunchChecklistCard.module.css";

const LAUNCH_CHECKLIST_PATH = "/api/v1/settings/launch-checklist";
const WORKSPACE_STATUS_PATH = "/api/v1/google-workspace";
const SHEET_STATUS_PATH = "/api/v1/integrations/google/sheets/status";

type VerificationState = "checking" | "verified" | "simulated" | "needed" | "unavailable";

type LaunchChecklistResponse = Readonly<{
  launchChecklist: LaunchChecklist;
  canAttest: boolean;
}>;

type WorkspaceVerification = Readonly<{
  workspace: boolean;
  calendar: boolean;
  simulation: boolean;
}>;

type VerificationSnapshot = Readonly<{
  workspace: VerificationState;
  calendar: VerificationState;
  mirror: VerificationState;
}>;

const CHECKING_VERIFICATIONS: VerificationSnapshot = Object.freeze({
  workspace: "checking",
  calendar: "checking",
  mirror: "checking",
});

// Simulation mode is app-global: when the Workspace endpoint reports it, every
// live row is simulated (the mirror status is simulated too), so none may claim
// a real Google connection.
const SIMULATED_VERIFICATIONS: VerificationSnapshot = Object.freeze({
  workspace: "simulated",
  calendar: "simulated",
  mirror: "simulated",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLaunchChecklistResponse(value: unknown): LaunchChecklistResponse | null {
  if (
    !isRecord(value)
    || !isRecord(value.launchChecklist)
    || typeof value.canAttest !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({
    launchChecklist: normalizeLaunchChecklist(value.launchChecklist),
    canAttest: value.canAttest,
  });
}

function parseWorkspaceVerification(value: unknown): WorkspaceVerification | null {
  if (
    !isRecord(value)
    || typeof value.connected !== "boolean"
    || !isRecord(value.workspace)
    || typeof value.workspace.connectionStatus !== "string"
    || typeof value.workspace.calendarConnected !== "boolean"
    || typeof value.workspace.calendarEnabled !== "boolean"
  ) {
    return null;
  }
  const workspace = value.connected && value.workspace.connectionStatus === "connected";
  return Object.freeze({
    workspace,
    calendar: workspace
      && value.workspace.calendarEnabled
      && value.workspace.calendarConnected,
    // Strict: only an explicit boolean true is simulation. An absent or
    // non-boolean field means a real connection, so existing callers that omit
    // it keep their live Verified/Needs-verification behavior unchanged.
    simulation: value.workspace.simulation === true,
  });
}

function parseMirrorVerification(value: unknown): boolean | null {
  if (!isRecord(value) || !isRecord(value.mirror)) return null;
  const mirror = value.mirror;
  if (
    typeof mirror.configured !== "boolean"
    || typeof mirror.enabled !== "boolean"
    || typeof mirror.connected !== "boolean"
    || !isRecord(mirror.clients)
    || !isRecord(mirror.projects)
    || typeof mirror.clients.status !== "string"
    || typeof mirror.projects.status !== "string"
  ) {
    return null;
  }
  return mirror.configured
    && mirror.enabled
    && mirror.connected
    && mirror.clients.status === "synced"
    && mirror.projects.status === "synced";
}

async function getJson(path: string, signal: AbortSignal) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("launch_checklist_read_failed");
  return response.json() as Promise<unknown>;
}

function stateLabel(state: VerificationState) {
  if (state === "verified") return "Verified";
  if (state === "simulated") return "Simulated";
  if (state === "needed") return "Needs verification";
  if (state === "unavailable") return "Unavailable";
  return "Checking";
}

function checkedAtLabel(value: number) {
  return new Date(value).toLocaleString();
}

function AttestationCheckbox({
  checked,
  disabled,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return <input
    ref={inputRef}
    type="checkbox"
    checked={checked}
    disabled={disabled}
    onChange={(event) => onChange(event.currentTarget.checked)}
  />;
}

function LiveVerificationRow({
  label,
  description,
  simulatedDescription,
  state,
}: {
  label: string;
  description: string;
  simulatedDescription: string;
  state: VerificationState;
}) {
  const verified = state === "verified";
  const simulated = state === "simulated";
  return <div className={styles.liveRow} data-checklist-kind="verified">
    <span className={verified ? styles.verifiedIcon : simulated ? styles.simulatedIcon : styles.pendingIcon}>
      {verified
        ? <CheckCircle2 size={18} aria-hidden="true" />
        : simulated
          ? <FlaskConical size={18} aria-hidden="true" />
          : state === "unavailable"
            ? <CircleAlert size={18} aria-hidden="true" />
            : <CircleDashed size={18} aria-hidden="true" />}
    </span>
    <span className={styles.rowCopy}>
      <strong>{label}</strong>
      <small>{simulated ? simulatedDescription : description}</small>
    </span>
    <span
      className={`status ${verified ? "status-connected" : simulated ? styles.simulatedPill : "status-inactive"}`}
      aria-label={`${label}: ${stateLabel(state)}`}
    >
      {stateLabel(state)}
    </span>
  </div>;
}

export function LaunchChecklistCard() {
  const [launchChecklist, setLaunchChecklist] = useState<LaunchChecklist | null>(null);
  const [canAttest, setCanAttest] = useState(false);
  const [checklistError, setChecklistError] = useState("");
  const [savingItemId, setSavingItemId] = useState<LaunchChecklistItemId | null>(null);
  const [verifications, setVerifications] = useState<VerificationSnapshot>(CHECKING_VERIFICATIONS);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const checklistRequest = getJson(LAUNCH_CHECKLIST_PATH, controller.signal)
      .then((value) => {
        const parsed = parseLaunchChecklistResponse(value);
        if (!parsed) throw new Error("launch_checklist_invalid");
        return parsed;
      });
    const workspaceRequest = getJson(WORKSPACE_STATUS_PATH, controller.signal)
      .then((value) => {
        const parsed = parseWorkspaceVerification(value);
        if (!parsed) throw new Error("workspace_status_invalid");
        return parsed;
      });
    const mirrorRequest = getJson(SHEET_STATUS_PATH, controller.signal)
      .then((value) => {
        const parsed = parseMirrorVerification(value);
        if (parsed === null) throw new Error("mirror_status_invalid");
        return parsed;
      });

    void Promise.allSettled([
      checklistRequest,
      workspaceRequest,
      mirrorRequest,
    ]).then(([checklistResult, workspaceResult, mirrorResult]) => {
      if (!current) return;
      if (checklistResult.status === "fulfilled") {
        setLaunchChecklist(checklistResult.value.launchChecklist);
        setCanAttest(checklistResult.value.canAttest);
      } else {
        setChecklistError("Saved attestations are unavailable. Nothing was changed.");
      }
      if (workspaceResult.status === "fulfilled" && workspaceResult.value.simulation) {
        setVerifications(SIMULATED_VERIFICATIONS);
        return;
      }
      setVerifications({
        workspace: workspaceResult.status === "fulfilled"
          ? workspaceResult.value.workspace ? "verified" : "needed"
          : "unavailable",
        calendar: workspaceResult.status === "fulfilled"
          ? workspaceResult.value.calendar ? "verified" : "needed"
          : "unavailable",
        mirror: mirrorResult.status === "fulfilled"
          ? mirrorResult.value ? "verified" : "needed"
          : "unavailable",
      });
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, []);

  async function saveAttestation(itemId: LaunchChecklistItemId, checked: boolean) {
    setSavingItemId(itemId);
    setChecklistError("");
    try {
      const response = await fetch(LAUNCH_CHECKLIST_PATH, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemId, checked }),
      });
      const body = await response.json().catch(() => null) as unknown;
      const parsed = parseLaunchChecklistResponse(body);
      if (!response.ok || !parsed) throw new Error("launch_checklist_save_failed");
      setLaunchChecklist(parsed.launchChecklist);
      setCanAttest(parsed.canAttest);
    } catch {
      setChecklistError("The attestation was not saved. Try again.");
    } finally {
      setSavingItemId(null);
    }
  }

  const simulatedEnvironment = Object.values(verifications).every((state) => state === "simulated");
  const verifiedCount = Object.values(verifications).filter((state) => state === "verified").length;
  const checklistKnown = launchChecklist !== null;
  const checklistUnavailable = !checklistKnown && Boolean(checklistError);

  return <section className={`panel test-launch ${styles.card}`} aria-labelledby="launch-checklist-heading">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Development verification</p>
        <h2 id="launch-checklist-heading">Test &amp; launch checklist</h2>
        <p>Live checks are verified from current app state. Human acceptance steps are saved as attestations with the Administrator and time.</p>
      </div>
      <a className="primary-button" href="/settings?section=google-workspace#workspace-stage-4">Open Google Workspace setup</a>
    </div>

    <p className={styles.developmentBoundary}>
      <ShieldCheck size={16} aria-hidden="true" />
      <span>This is the development checklist. Production acceptance stays in checklist 05 and is not completed in this app.</span>
    </p>

    <div className={styles.group}>
      <div className={styles.groupHeading}>
        <div><h3>Verified from live status</h3><p>These rows are computed from existing connection and mirror endpoints. They never render a checkbox.</p></div>
        <span className={styles.groupCount}>{simulatedEnvironment ? "Simulated" : `${verifiedCount} of 3 verified`}</span>
      </div>
      {simulatedEnvironment && <p className={styles.simulationNote}>
        <FlaskConical size={16} aria-hidden="true" />
        <span>Simulated environment — live verification runs against a real Workspace connection.</span>
      </p>}
      <div className={styles.rows}>
        <LiveVerificationRow
          label="Workspace connected"
          description="The saved Workspace connection currently reports connected."
          simulatedDescription="Local Workspace simulation is active. No Google account is connected."
          state={verifications.workspace}
        />
        <LiveVerificationRow
          label="Calendar access verified"
          description="Calendar is enabled and present on the current Workspace connection."
          simulatedDescription="Calendar runs in the local Workspace simulation, not a live Google connection."
          state={verifications.calendar}
        />
        <LiveVerificationRow
          label="Client Directory mirror synced"
          description="Both client and project mirror states currently report synced."
          simulatedDescription="The Client Directory mirror runs in the local simulation. No data is sent to Google."
          state={verifications.mirror}
        />
      </div>
    </div>

    <div className={styles.group}>
      <div className={styles.groupHeading}>
        <div><h3>Administrator attestations</h3><p>Check each row only after completing the described development acceptance step.</p></div>
        {!canAttest && launchChecklist && <span className={styles.readOnly}>Read-only</span>}
      </div>
      <div className={styles.rows}>
        {LAUNCH_CHECKLIST_ITEMS.map((item) => {
          const attestation = launchChecklist?.[item.itemId];
          const checked = attestation?.checked === true;
          const attestationState = checklistKnown
            ? checked ? "attested" : "not-attested"
            : checklistUnavailable ? "unavailable" : "checking";
          return <label
            className={styles.attestationRow}
            key={item.itemId}
            data-attestation-state={attestationState}
            data-checklist-kind="attested"
          >
            <AttestationCheckbox
              checked={checked}
              disabled={!launchChecklist || !canAttest || savingItemId !== null}
              indeterminate={!checklistKnown}
              onChange={(nextChecked) => void saveAttestation(item.itemId, nextChecked)}
            />
            <span className={styles.rowCopy}>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
              {checked && attestation?.actorEmail && attestation.checkedAt
                ? <small className={styles.auditLine}>Checked by {attestation.actorEmail} on {checkedAtLabel(attestation.checkedAt)}</small>
                : checklistKnown
                  ? <small className={styles.auditLine}>Not yet attested</small>
                  : <small className={styles.auditLine}>
                    {checklistUnavailable ? "Saved attestation unavailable" : "Checking saved attestation"}
                  </small>}
            </span>
            <span className={`status ${checked ? "status-connected" : "status-inactive"}`}>
              {savingItemId === item.itemId
                ? "Saving"
                : checklistKnown
                  ? checked ? "Attested" : "Not attested"
                  : checklistUnavailable ? "Unavailable" : "Checking"}
            </span>
          </label>;
        })}
      </div>
    </div>

    {checklistError && <p className={styles.error} role="alert"><CircleAlert size={16} aria-hidden="true" /> {checklistError}</p>}
  </section>;
}
