"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ChevronDown, RefreshCw } from "lucide-react";

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

type CategoryResult<T> = Readonly<{
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}>;

type OperationsPayload = Readonly<{
  runtimeMode: "simulation" | "workspace";
  simulation: boolean;
  checkedAt: number;
  limits: { perCategory: number };
  driveOperations: CategoryResult<DriveOperation>;
  failedArchives: CategoryResult<FailedArchive>;
  events: CategoryResult<IntegrationEvent>;
}>;

type LoadState = "idle" | "loading" | "ready" | "error";
type CategoryKey = "drive" | "archive" | "events";

type AccumulatedCategory<T> = {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  loadingMore: boolean;
};

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

function emptyAccumulator<T>(): AccumulatedCategory<T> {
  return { items: [], hasMore: false, nextCursor: null, loadingMore: false };
}

function mergeAccumulator<T>(
  current: AccumulatedCategory<T>,
  incoming: CategoryResult<T>,
): AccumulatedCategory<T> {
  return {
    items: [...current.items, ...incoming.items],
    hasMore: incoming.hasMore,
    nextCursor: incoming.nextCursor,
    loadingMore: false,
  };
}

export function WorkspaceOperationsHealthCard({ isAdmin }: { isAdmin: boolean }) {
  const [state, setState] = useState<LoadState>("idle");
  const [simulation, setSimulation] = useState<boolean | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [limits, setLimits] = useState<{ perCategory: number } | null>(null);
  const [drive, setDrive] = useState<AccumulatedCategory<DriveOperation>>(emptyAccumulator);
  const [archive, setArchive] = useState<AccumulatedCategory<FailedArchive>>(emptyAccumulator);
  const [events, setEvents] = useState<AccumulatedCategory<IntegrationEvent>>(emptyAccumulator);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (category?: CategoryKey, cursor?: string) => {
    if (!isAdmin) return;
    const sequence = ++requestSequence.current;
    const url = new URL("/api/v1/integrations/google/operations", window.location.origin);
    if (category) {
      url.searchParams.set("category", category);
    }
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    if (!category) {
      setState("loading");
      setError(null);
      setDrive(emptyAccumulator());
      setArchive(emptyAccumulator());
      setEvents(emptyAccumulator());
    } else {
      if (category === "drive") setDrive((d) => ({ ...d, loadingMore: true }));
      if (category === "archive") setArchive((a) => ({ ...a, loadingMore: true }));
      if (category === "events") setEvents((e) => ({ ...e, loadingMore: true }));
    }

    try {
      const response = await fetch(url.toString(), { cache: "no-store" });
      const body = await response.json().catch(() => null) as OperationsPayload | { error?: string } | null;
      if (!response.ok || !body || !("driveOperations" in body)) {
        throw new Error(body && "error" in body && body.error
          ? body.error
          : "Google operations could not be loaded.");
      }
      if (sequence !== requestSequence.current) return;

      if (!category) {
        setSimulation(body.simulation);
        setCheckedAt(body.checkedAt);
        setLimits(body.limits);
        setDrive({
          items: body.driveOperations.items,
          hasMore: body.driveOperations.hasMore,
          nextCursor: body.driveOperations.nextCursor,
          loadingMore: false,
        });
        setArchive({
          items: body.failedArchives.items,
          hasMore: body.failedArchives.hasMore,
          nextCursor: body.failedArchives.nextCursor,
          loadingMore: false,
        });
        setEvents({
          items: body.events.items,
          hasMore: body.events.hasMore,
          nextCursor: body.events.nextCursor,
          loadingMore: false,
        });
        setState("ready");
      } else {
        // Only update the targeted category; leave others untouched.
        if (category === "drive") {
          setDrive((current) => mergeAccumulator(current, body.driveOperations));
        }
        if (category === "archive") {
          setArchive((current) => mergeAccumulator(current, body.failedArchives));
        }
        if (category === "events") {
          setEvents((current) => mergeAccumulator(current, body.events));
        }
      }
    } catch (loadError) {
      if (sequence !== requestSequence.current) return;
      if (!category) {
        setError(loadError instanceof Error
          ? loadError.message
          : "Google operations could not be loaded.");
        setState("error");
      } else {
        setError(loadError instanceof Error
          ? loadError.message
          : "Google operations could not be loaded.");
        if (category === "drive") setDrive((d) => ({ ...d, loadingMore: false }));
        if (category === "archive") setArchive((a) => ({ ...a, loadingMore: false }));
        if (category === "events") setEvents((e) => ({ ...e, loadingMore: false }));
      }
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void Promise.resolve().then(() => load());
    return () => {
      requestSequence.current += 1;
    };
  }, [isAdmin, load]);

  if (!isAdmin) {
    return <p className={styles.explanation}>Administrator access is required to inspect Google operation failures.</p>;
  }

  const driveOperations = drive.items;
  const failedArchives = archive.items;
  const eventItems = events.items;
  const failureCount = driveOperations.length + failedArchives.length;
  const hasStuckDriveLease = driveOperations.some((operation) => operation.condition === "stuck");
  const hasFailedDriveOperation = driveOperations.some((operation) => operation.condition === "failed");
  const moreFailures = drive.hasMore || archive.hasMore;
  const moreEvents = events.hasMore;

  return <div className={styles.card} data-workspace-operations-health={state}>
    <div className={styles.toolbar}>
      <p>{simulation
        ? "Simulation only — these are locally recorded test operations and no Google call is made."
        : "Recorded Google work for the current company connection. This does not contact Google."}</p>
      <button className="soft-button" type="button" onClick={() => void load()} disabled={state === "loading"}>
        <RefreshCw size={14} aria-hidden="true" />
        {state === "loading" ? "Refreshing…" : "Refresh operations"}
      </button>
    </div>

    {state === "loading" && !driveOperations.length && !failedArchives.length && !eventItems.length
      ? <p className={styles.message} role="status">Loading recorded Google operations…</p>
      : null}
    {error && state === "error" && !driveOperations.length && !failedArchives.length && !eventItems.length
      ? <div className={styles.error} role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{error}</span>
      </div>
      : null}

    {state === "ready" || driveOperations.length > 0 || failedArchives.length > 0 || eventItems.length > 0 ? <>
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
        {moreFailures && <p className={styles.limitNote}>Showing the newest {limits?.perCategory ?? 50} items in each failure category. More recorded issues exist.</p>}
        {moreFailures && (
          <div className={styles.loadMoreRow}>
            {drive.hasMore && (
              <button
                className="soft-button"
                type="button"
                disabled={drive.loadingMore}
                onClick={() => void load("drive", drive.nextCursor ?? undefined)}
              >
                {drive.loadingMore ? "Loading…" : <>Load more Drive issues <ChevronDown size={14} aria-hidden="true" /></>}
              </button>
            )}
            {archive.hasMore && (
              <button
                className="soft-button"
                type="button"
                disabled={archive.loadingMore}
                onClick={() => void load("archive", archive.nextCursor ?? undefined)}
              >
                {archive.loadingMore ? "Loading…" : <>Load more archive issues <ChevronDown size={14} aria-hidden="true" /></>}
              </button>
            )}
          </div>
        )}
        {hasStuckDriveLease && <p className={styles.guidance}><strong>Stuck lease:</strong> wait out the five-minute lease before retrying. Never hand-edit Drive to clear it.</p>}
        {hasFailedDriveOperation && <p className={styles.guidance}><strong>Failed Drive operation:</strong> keep the recorded error code and retry only through the original app action. Never repair Drive or app records by hand.</p>}
        {failedArchives.length > 0 && <p className={styles.guidance}><strong>Failed archive:</strong> return to the Gmail project inbox and repeat Review &amp; copy. The saved archive identity makes the retry idempotent.</p>}
        {failedArchives.length > 0 && <a className="soft-button" href="/inbox">Open Gmail project inbox</a>}
      </section>

      <section className={styles.section} aria-labelledby="workspace-operations-events-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h5 id="workspace-operations-events-heading">Recent integration activity</h5>
            <span>{eventItems.length === 0 ? "No recorded activity" : `${eventItems.length}${moreEvents ? "+" : ""} newest event${eventItems.length === 1 ? "" : "s"}`}</span>
          </div>
        </div>
        {eventItems.length === 0
          ? <p className={styles.empty}>{simulation
              ? "No integration event is recorded for this connection. Resetting simulation clears this history."
              : "No integration event is recorded for this connection."}</p>
          : <OperationsDataTable
            className={styles.table}
            columns={EVENT_COLUMNS}
            labelledBy="workspace-operations-events-heading"
          >
            {eventItems.map((event) => <tr key={`event-${event.id ?? `${event.eventType}-${event.createdAt}`}`}>
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
        {moreEvents && <p className={styles.limitNote}>Showing the newest {limits?.perCategory ?? 50} events. Older activity remains stored.</p>}
        {moreEvents && (
          <div className={styles.loadMoreRow}>
            <button
              className="soft-button"
              type="button"
              disabled={events.loadingMore}
              onClick={() => void load("events", events.nextCursor ?? undefined)}
            >
              {events.loadingMore ? "Loading…" : <>Load more events <ChevronDown size={14} aria-hidden="true" /></>}
            </button>
          </div>
        )}
      </section>
      {checkedAt !== null && <p className={styles.checkedAt}>Last read from the app database: {formatTime(checkedAt)}</p>}
    </> : null}
  </div>;
}
