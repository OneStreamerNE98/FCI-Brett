"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

import { AdministratorActionButton } from "../../../components/AdministratorActionButton";
import {
  OperationsDataTable,
  OperationsDataTableCell,
} from "../../../components/operations/OperationsDataTable";
import {
  adoptGoogleNameIntoWorkspaceBlueprint,
  type WorkspaceReconcileAction,
  type WorkspaceReconcileDrift,
} from "../../../lib/workspace-reconcile";
import type { WorkspaceBlueprint } from "../../../lib/workspace-blueprint";
import {
  cachedGetJson,
  invalidateCachedGet,
  invalidateWorkspaceOperationsReadCache,
} from "../../../lib/client-get-cache";
import styles from "./WorkspaceReconcileCard.module.css";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type ReconcileState = "idle" | "loading" | "ready" | "error";
type ReconcileError = Readonly<{ message: string; noMutation: boolean }>;

const NO_MUTATION_SUFFIX = "No Google resource was changed.";
const UNAVAILABLE_DESCRIPTION_ID = "workspace-reconcile-unavailable-description";

function withoutNoMutationSuffix(message: string) {
  const normalized = message.trim();
  return normalized.endsWith(NO_MUTATION_SUFFIX)
    ? normalized.slice(0, -NO_MUTATION_SUFFIX.length).trim()
    : normalized;
}

type WorkspaceReconcilePayload = Readonly<{
  reconciled: boolean;
  simulated: boolean;
  blueprintVersion: number;
  checkedAt: number;
  counts: Readonly<{ missing: number; renamed: number; unmanaged: number; inSync: number }>;
  drift: readonly WorkspaceReconcileDrift[];
}>;

type WorkspaceBlueprintPayload = Readonly<{
  blueprint: WorkspaceBlueprint;
  version: number;
}>;

const RECONCILE_COLUMNS = [
  { key: "resource", label: "Resource" },
  { key: "difference", label: "Difference" },
  { key: "names", label: "Google / blueprint" },
  { key: "actions", label: "Review action" },
] as const;

const MISSING_ENDPOINTS = Object.freeze({
  "ensure-folders": "/api/v1/integrations/google/drive/folders/ensure-roots",
  "ensure-spreadsheets": "/api/v1/integrations/google/sheets/ensure",
  "ensure-templates": "/api/v1/integrations/google/drive/templates/ensure",
} satisfies Partial<Record<WorkspaceReconcileAction, string>>);

async function readJson<T>(url: string, init?: RequestInit) {
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method === "GET") {
    return cachedGetJson<T>(url, { force: true });
  }
  try {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "The Workspace reconcile action could not be completed.");
    invalidateCachedGet("/api/v1/integrations/google/setup/resources");
    invalidateCachedGet("/api/v1/integrations/google/sheets/status");
    invalidateCachedGet("/api/v1/google-workspace");
    if (url === "/api/v1/integrations/google/setup/blueprint") {
      invalidateCachedGet(url);
    }
    return data;
  } finally {
    invalidateWorkspaceOperationsReadCache();
  }
}

function stateLabel(state: WorkspaceReconcileDrift["state"]) {
  if (state === "missing") return "Missing";
  if (state === "renamed") return "Renamed";
  return "Unmanaged";
}

function resourceLabel(item: WorkspaceReconcileDrift) {
  const identity = item.key ? ` · ${item.key}` : "";
  return `${item.label}${identity}`;
}

function allowedActions(item: WorkspaceReconcileDrift) {
  return item.actions.filter((action) => {
    if (action === "rename-drive") {
      return item.state === "renamed" && item.resourceType === "drive.folder" && Boolean(item.key);
    }
    if (action === "adopt-blueprint-name") {
      return item.state === "renamed"
        && (
          item.resourceType === "drive.folder"
          || item.resourceType === "sheets.spreadsheet"
          || item.resourceType === "drive.file"
        )
        && item.management === "owner"
        && Boolean(item.key && item.actualName);
    }
    return item.state === "missing" && action in MISSING_ENDPOINTS;
  });
}

export function WorkspaceReconcileCard({
  enabled,
  isAdmin,
  notify,
  onChanged,
  unavailableMessage,
}: {
  enabled: boolean;
  isAdmin: boolean;
  notify: Notify;
  onChanged: (change: Readonly<{ blueprintChanged?: boolean }>) => Promise<void> | void;
  unavailableMessage: string;
}) {
  const [state, setState] = useState<ReconcileState>("idle");
  const [result, setResult] = useState<WorkspaceReconcilePayload | null>(null);
  const [error, setError] = useState<ReconcileError | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function checkForDrift({
    announce = true,
    afterMutation = false,
  }: Readonly<{ announce?: boolean; afterMutation?: boolean }> = {}) {
    setState("loading");
    setError(null);
    setResult(null);
    try {
      const data = await readJson<WorkspaceReconcilePayload>(
        "/api/v1/integrations/google/setup/reconcile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (
        data.reconciled !== true
        || typeof data.simulated !== "boolean"
        || !Number.isSafeInteger(data.blueprintVersion)
        || !Array.isArray(data.drift)
        || !data.counts
        || !["missing", "renamed", "unmanaged", "inSync"].every((key) => (
          Number.isSafeInteger(data.counts[key as keyof typeof data.counts])
          && data.counts[key as keyof typeof data.counts] >= 0
        ))
      ) {
        throw new Error("The Workspace drift check returned an incomplete result. Try the check again.");
      }
      setResult(data);
      setState("ready");
      if (announce) {
        notify(
          data.drift.length === 0
            ? data.simulated
              ? "Simulation only — the Workspace blueprint and simulated resources are in sync. Google was not contacted."
              : "The Workspace blueprint and Google resources are in sync."
            : `${data.simulated ? "Simulation only — " : ""}Drift check found ${data.counts.missing} missing, ${data.counts.renamed} renamed, and ${data.counts.unmanaged} unmanaged resource(s).`,
          data.drift.length === 0 ? "success" : "warning",
        );
      }
    } catch (caught) {
      const detail = withoutNoMutationSuffix(caught instanceof Error
        ? caught.message
        : "Workspace drift could not be checked.");
      const message = afterMutation
        ? `The action completed, but Workspace drift could not be refreshed: ${detail}`
        : detail;
      setError({ message, noMutation: !afterMutation });
      setState("error");
      notify(message, "error");
    }
  }

  async function refreshAfterMutation(change: Readonly<{ blueprintChanged?: boolean }>) {
    try {
      await onChanged(change);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Workspace status could not be refreshed.";
      const message = `The action completed, but Workspace status could not be refreshed: ${detail}`;
      setResult(null);
      setError({ message, noMutation: false });
      setState("error");
      notify(message, "error");
      return;
    }
    await checkForDrift({ announce: false, afterMutation: true });
  }

  async function ensureMissing(item: WorkspaceReconcileDrift, action: WorkspaceReconcileAction) {
    const endpoint = MISSING_ENDPOINTS[action as keyof typeof MISSING_ENDPOINTS];
    if (!endpoint || !item.key || !result) return;
    setWorkingId(item.id);
    try {
      const ensured = await readJson<{
        ensured: boolean;
        reconciled?: boolean;
        resourceKey?: string;
        version?: number;
      }>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "reconcile-missing",
          resourceKey: item.key,
          expectedVersion: result.blueprintVersion,
        }),
      });
      if (
        ensured.ensured !== true
        || ensured.reconciled !== true
        || ensured.resourceKey !== item.key
        || ensured.version !== result.blueprintVersion
      ) {
        throw new Error("The setup ensure action returned an incomplete result. Check Workspace status before retrying.");
      }
      notify(`${item.expectedName ?? item.label} was reviewed and the matching setup ensure action completed.`, "success");
      await refreshAfterMutation({});
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "The missing Workspace resource could not be created.", "error");
    } finally {
      setWorkingId(null);
    }
  }

  async function renameInDrive(item: WorkspaceReconcileDrift) {
    if (!item.key || !item.externalId || !item.actualName || !result) return;
    setWorkingId(item.id);
    try {
      const renamed = await readJson<{ renamed: boolean }>("/api/v1/integrations/google/drive/folders/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: item.key,
          mode: "reconcile-drive-name",
          expectedVersion: result.blueprintVersion,
          externalId: item.externalId,
          actualName: item.actualName,
        }),
      });
      if (renamed.renamed !== true) {
        throw new Error("The Drive rename returned an incomplete result. Check Workspace drift before retrying.");
      }
      notify(`Google Drive now uses the blueprint name “${item.expectedName}”.`, "success");
      await refreshAfterMutation({});
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "The Drive folder name could not be reconciled.", "error");
    } finally {
      setWorkingId(null);
    }
  }

  async function adoptDriveName(item: WorkspaceReconcileDrift) {
    if (!item.key || !item.externalId || !item.actualName || item.management !== "owner" || !result) return;
    setWorkingId(item.id);
    try {
      const current = await readJson<WorkspaceBlueprintPayload>(
        "/api/v1/integrations/google/setup/blueprint",
        { cache: "no-store" },
      );
      if (current.version !== result.blueprintVersion) {
        throw new Error("The Workspace blueprint changed after this drift review. Check for drift again before using the Google name.");
      }
      const blueprint = adoptGoogleNameIntoWorkspaceBlueprint(
        current.blueprint,
        item.resourceType,
        item.key,
        item.actualName,
      );
      const saved = await readJson<WorkspaceBlueprintPayload>(
        "/api/v1/integrations/google/setup/blueprint",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blueprint,
            expectedVersion: current.version,
            reconcileReview: {
              resourceType: item.resourceType,
              key: item.key,
              expectedExternalId: item.externalId,
              expectedActualName: item.actualName,
              expectedVersion: result.blueprintVersion,
            },
          }),
        },
      );
      if (!saved.blueprint || saved.version !== current.version + 1) {
        throw new Error("The blueprint update returned an incomplete result. Reload the blueprint before retrying.");
      }
      notify(`The blueprint now uses the reviewed Drive name “${item.actualName}”.`, "success");
      await refreshAfterMutation({ blueprintChanged: true });
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "The Drive name could not be adopted into the blueprint.", "error");
    } finally {
      setWorkingId(null);
    }
  }

  function actionButtons(item: WorkspaceReconcileDrift) {
    const actions = allowedActions(item);
    const busy = workingId === item.id;
    const actionDisabled = !enabled || workingId !== null || state === "loading";
    const descriptionId = `workspace-reconcile-${item.id.replace(/[^A-Za-z0-9_-]/g, "-")}-description`;
    if (actions.length === 0) {
      return <span className={styles.informational}>Informational only — nothing will be deleted.</span>;
    }
    return <div className={styles.actionList}>
      {actions.map((action) => {
        if (action === "rename-drive") {
          return <AdministratorActionButton
            className="primary-button"
            isAdmin={isAdmin}
            key={action}
            aria-describedby={descriptionId}
            onClick={() => void renameInDrive(item)}
            disabled={actionDisabled}
          >{busy ? "Working…" : "Rename in Drive"}</AdministratorActionButton>;
        }
        if (action === "adopt-blueprint-name") {
          return <AdministratorActionButton
            className="soft-button"
            isAdmin={isAdmin}
            key={action}
            aria-describedby={descriptionId}
            onClick={() => void adoptDriveName(item)}
            disabled={actionDisabled}
          >{busy ? "Working…" : "Use Drive name in blueprint"}</AdministratorActionButton>;
        }
        return <AdministratorActionButton
          className="primary-button"
          isAdmin={isAdmin}
          key={action}
          aria-describedby={descriptionId}
          onClick={() => void ensureMissing(item, action)}
          disabled={actionDisabled}
        >{busy ? "Working…" : "Create from blueprint"}</AdministratorActionButton>;
      })}
      <span id={descriptionId} className="sr-only">{item.detail}</span>
    </div>;
  }

  return <div className={styles.reconcileBody}>
    <p>Check Google against the saved blueprint. The check reads provider metadata only; every repair waits for your click, and removed resources stay in Google.</p>
    <div className={styles.toolbar}>
      <AdministratorActionButton
        className="primary-button"
        isAdmin={isAdmin}
        aria-describedby={!enabled ? UNAVAILABLE_DESCRIPTION_ID : undefined}
        onClick={() => void checkForDrift()}
        disabled={!enabled || state === "loading" || workingId !== null}
      >{state === "loading" ? "Checking…" : result ? "Check again" : "Check for drift"}</AdministratorActionButton>
      {result && <span className={styles.checkedAt}>Last checked {new Date(result.checkedAt).toLocaleString()}</span>}
    </div>
    {!isAdmin && <p className={styles.readonly}>An Administrator can run the provider read and review each repair.</p>}
    {!enabled && <p id={UNAVAILABLE_DESCRIPTION_ID} className={styles.readonly}>{unavailableMessage}</p>}
    {state === "loading" && <p className={styles.status} role="status">Reading managed Google resource identities…</p>}
    {error && <p className={styles.error} role="alert">
      {error.message}{error.noMutation ? " No Google resource was changed." : ""}
    </p>}
    {result && result.simulated && state !== "loading" && <p className={styles.status}>Simulation only — this check used simulated Workspace resources. Google was not contacted.</p>}
    {result && result.drift.length === 0 && state !== "loading" && <p className={styles.inSync} role="status">
      {result.simulated ? "Blueprint and simulated Workspace resources are in sync." : "Blueprint and Google resources are in sync."}
    </p>}
    {result && result.drift.length > 0 && <>
      <p className={styles.status} role="status">
        {result.counts.missing} missing · {result.counts.renamed} renamed · {result.counts.unmanaged} unmanaged
      </p>
      <OperationsDataTable
        className={styles.reconcileTable}
        columns={RECONCILE_COLUMNS}
        labelledBy="workspace-upkeep-drift-heading"
      >
        {result.drift.map((item) => <tr
          key={item.id}
          data-workspace-reconcile-row={item.id}
          data-workspace-reconcile-state={item.state}
        >
          <OperationsDataTableCell label="Resource">
            <strong>{resourceLabel(item)}</strong>
            {item.url && <a href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
          </OperationsDataTableCell>
          <OperationsDataTableCell label="Difference">
            <span className={`${styles.stateChip} ${styles[item.state]}`}>{stateLabel(item.state)}</span>
            <small>{item.detail}</small>
          </OperationsDataTableCell>
          <OperationsDataTableCell label="Google / blueprint">
            <dl className={styles.names}>
              <div><dt>Google</dt><dd>{item.actualName ?? "Not found"}</dd></div>
              <div><dt>Blueprint</dt><dd>{item.expectedName ?? "No longer defined"}</dd></div>
            </dl>
          </OperationsDataTableCell>
          <OperationsDataTableCell label="Review action">{actionButtons(item)}</OperationsDataTableCell>
        </tr>)}
      </OperationsDataTable>
    </>}
  </div>;
}
