"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";

import {
  OperationsDataTable,
  OperationsDataTableCell,
} from "../../../components/operations/OperationsDataTable";
import styles from "./WorkspaceOperationsHealthCard.module.css";

type DriveOperation = Readonly<{
  id: string | null;
  operationKey: string | null;
  projectId: string | null;
  condition: "failed" | "stuck";
  status: string | null;
  leaseExpiresAt: number | null;
  lastErrorCode: string | null;
  updatedAt: number;
}>;

type FailedArchive = Readonly<{
  id: string | null;
  gmailMessageId: string | null;
  projectId: string | null;
  status: string | null;
  lastErrorCode: string | null;
  updatedAt: number;
}>;

type IntegrationEvent = Readonly<{
  id: string | null;
  eventType: string | null;
  actor: string | null;
  entityType: string | null;
  entityId: string | null;
  detail: string | null;
  createdAt: number;
}>;

type OperationsPayload = Readonly<{
  runtimeMode: "simulation" | "workspace";
  simulation: boolean;
  checkedAt: number;
  limits: { perCategory: number };
  driveOperations: { items: DriveOperation[]; hasMore: boolean };
  failedArchives: { items: FailedArchive[]; hasMore: boolean };
  events: { items: IntegrationEvent[]; hasMore: boolean };
}>;

type LoadState = "idle" | "loading" | "ready" | "error";

const FAILURE_COLUMNS = [
  { key: "kind", label: "Work item" },
  { key: "record", label: "Record" },
  { key: "error", label: "Recorded problem" },
  { key: "updated", label: "Last update" },
] as const;

const EVENT_COLUMNS = [
  { key: "event", label: "Event" },
  { key: "actor", label: "Recorded actor" },
  { key: "record", label: "Record" },
  { key: "time", label: "Time" },
] as const;

function formatTime(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function readableCode(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value
    .replace(/[._-]+/gu, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function recordLabel(type: string | null, id: string | null) {
  if (!type && !id) return "Company connector";
  if (!type) return id ?? "Company connector";
  if (!id) return readableCode(type, "Company connector");
  return `${readableCode(type, "Record")} · ${id}`;
}

export function WorkspaceOperationsHealthCard({ isAdmin }: { isAdmin: boolean }) {
  const [state, setState] = useState<LoadState>("idle");
  const [payload, setPayload] = useState<OperationsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const sequence = ++requestSequence.current;
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/v1/integrations/google/operations", {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as OperationsPayload | { error?: string } | null;
      if (!response.ok || !body || !("driveOperations" in body)) {
        throw new Error(body && "error" in body && body.error
          ? body.error
          : "Google operations could not be loaded.");
      }
      if (sequence !== requestSequence.current) return;
      setPayload(body);
      setState("ready");
    } catch (loadError) {
      if (sequence !== requestSequence.current) return;
      setError(loadError instanceof Error
        ? loadError.message
        : "Google operations could not be loaded.");
      setState("error");
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void Promise.resolve().then(load);
    return () => {
      requestSequence.current += 1;
    };
  }, [isAdmin, load]);

  if (!isAdmin) {
    return <p className={styles.explanation}>Administrator access is required to inspect Google operation failures.</p>;
  }

  const driveOperations = payload?.driveOperations.items ?? [];
  const failedArchives = payload?.failedArchives.items ?? [];
  const events = payload?.events.items ?? [];
  const failureCount = driveOperations.length + failedArchives.length;
  const hasStuckDriveLease = driveOperations.some((operation) => operation.condition === "stuck");
  const hasFailedDriveOperation = driveOperations.some((operation) => operation.condition === "failed");
  const moreFailures = payload?.driveOperations.hasMore === true
    || payload?.failedArchives.hasMore === true;

  return <div className={styles.card} data-workspace-operations-health={state}>
    <div className={styles.toolbar}>
      <p>{payload?.simulation
        ? "Simulation only — these are locally recorded test operations and no Google call is made."
        : "Recorded Google work for the current company connection. This does not contact Google."}</p>
      <button className="soft-button" type="button" onClick={() => void load()} disabled={state === "loading"}>
        <RefreshCw size={14} aria-hidden="true" />
        {state === "loading" ? "Refreshing…" : "Refresh operations"}
      </button>
    </div>

    {state === "loading" && !payload
      ? <p className={styles.message} role="status">Loading recorded Google operations…</p>
      : null}
    {error
      ? <div className={styles.error} role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{error}</span>
      </div>
      : null}

    {payload ? <>
      <section className={styles.section} aria-labelledby="workspace-operations-failures-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h5 id="workspace-operations-failures-heading">Needs attention</h5>
            <span>{failureCount === 0 ? "No stuck leases or failed archives" : `${failureCount}${moreFailures ? "+" : ""} recorded issue${failureCount === 1 ? "" : "s"}`}</span>
          </div>
          {failureCount === 0
            ? <CheckCircle2 className={styles.successIcon} size={18} aria-label="No recorded failures" />
            : <CircleAlert className={styles.warningIcon} size={18} aria-label="Recorded failures need attention" />}
        </div>
        {failureCount === 0
          ? <p className={styles.empty}>No failed archive or expired Drive-operation lease is recorded for this connection.</p>
          : <OperationsDataTable
            className={styles.table}
            columns={FAILURE_COLUMNS}
            labelledBy="workspace-operations-failures-heading"
          >
            {driveOperations.map((operation) => <tr key={`drive-${operation.id ?? operation.operationKey}`}>
              <OperationsDataTableCell label="Work item">
                <strong>{operation.condition === "stuck" ? "Stuck Drive lease" : "Failed Drive operation"}</strong>
                <small>{readableCode(operation.status, "Unknown status")}</small>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Record">
                <span>Project · {operation.projectId ?? "Unknown"}</span>
                <small>{operation.operationKey ?? operation.id ?? "No operation ID"}</small>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Recorded problem">
                <code>{operation.lastErrorCode ?? (operation.condition === "stuck" ? "lease_expired" : "No error code")}</code>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Last update">
                <span>{formatTime(operation.updatedAt)}</span>
                {operation.condition === "stuck" && <small>Lease ended {formatTime(operation.leaseExpiresAt)}</small>}
              </OperationsDataTableCell>
            </tr>)}
            {failedArchives.map((archive) => <tr key={`archive-${archive.id ?? archive.gmailMessageId}`}>
              <OperationsDataTableCell label="Work item">
                <strong>Failed Gmail archive</strong>
                <small>{readableCode(archive.status, "Unknown status")}</small>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Record">
                <span>Project · {archive.projectId ?? "Unknown"}</span>
                <small>Archive {archive.id ?? "Unknown"} · Message {archive.gmailMessageId ?? "Unknown"}</small>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Recorded problem">
                <code>{archive.lastErrorCode ?? "No error code"}</code>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Last update">
                <span>{formatTime(archive.updatedAt)}</span>
              </OperationsDataTableCell>
            </tr>)}
          </OperationsDataTable>}
        {moreFailures && <p className={styles.limitNote}>Showing the newest {payload.limits.perCategory} items in each failure category. More recorded issues exist.</p>}
        {hasStuckDriveLease && <p className={styles.guidance}><strong>Stuck lease:</strong> wait out the five-minute lease before retrying. Never hand-edit Drive to clear it.</p>}
        {hasFailedDriveOperation && <p className={styles.guidance}><strong>Failed Drive operation:</strong> keep the recorded error code and retry only through the original app action. Never repair Drive or app records by hand.</p>}
        {failedArchives.length > 0 && <p className={styles.guidance}><strong>Failed archive:</strong> return to the Gmail project inbox and repeat Review &amp; copy. The saved archive identity makes the retry idempotent.</p>}
        {failedArchives.length > 0 && <a className="soft-button" href="/inbox">Open Gmail project inbox</a>}
      </section>

      <section className={styles.section} aria-labelledby="workspace-operations-events-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h5 id="workspace-operations-events-heading">Recent integration activity</h5>
            <span>{events.length === 0 ? "No recorded activity" : `${events.length}${payload.events.hasMore ? "+" : ""} newest event${events.length === 1 ? "" : "s"}`}</span>
          </div>
        </div>
        {events.length === 0
          ? <p className={styles.empty}>{payload?.simulation
              ? "No integration event is recorded for this connection. Resetting simulation clears this history."
              : "No integration event is recorded for this connection."}</p>
          : <OperationsDataTable
            className={styles.table}
            columns={EVENT_COLUMNS}
            labelledBy="workspace-operations-events-heading"
          >
            {events.map((event) => <tr key={`event-${event.id ?? `${event.eventType}-${event.createdAt}`}`}>
              <OperationsDataTableCell label="Event">
                <strong>{readableCode(event.eventType, "Integration event")}</strong>
                {event.detail && <small>{event.detail}</small>}
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Recorded actor">
                <span>{event.actor ?? "Unknown actor"}</span>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Record">
                <span>{recordLabel(event.entityType, event.entityId)}</span>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Time">
                <span>{formatTime(event.createdAt)}</span>
              </OperationsDataTableCell>
            </tr>)}
          </OperationsDataTable>}
        {payload.events.hasMore && <p className={styles.limitNote}>Showing the newest {payload.limits.perCategory} events. Older activity remains stored.</p>}
      </section>
      <p className={styles.checkedAt}>Last read from the app database: {formatTime(payload.checkedAt)}</p>
    </> : null}
  </div>;
}
