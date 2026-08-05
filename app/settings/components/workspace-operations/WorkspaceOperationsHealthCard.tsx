"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ChevronDown } from "lucide-react";

import {
  OperationsDataTable,
  OperationsDataTableCell,
} from "../../../components/operations/OperationsDataTable";
import {
  cachedGetJson,
  invalidateCachedGet,
  isTerminalCachedGetError,
} from "../../../lib/client-get-cache";
import {
  useCachedGetSubscription,
  useClientLoadState,
} from "../../../lib/client-get-hooks";
import { SettingsDataNotice } from "../SettingsDataNotice";
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
  nextCursor?: string;
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

type CategoryKey = "drive" | "archive" | "events";

type CategoryDepths = Record<CategoryKey, number>;

type CategoryRequestTicket = Readonly<{
  category: CategoryKey;
  epoch: number;
  token: number;
  url: string;
}>;

type BaseRequestTicket = Readonly<{
  epoch: number;
  token: number;
  desiredDepths: CategoryDepths;
  canceledUrls: string[];
}>;

type AccumulatedCategory<T> = {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
  loadingMore: boolean;
  error?: string;
  retryMode?: "category" | "base";
};

const OPERATIONS_URL = "/api/v1/integrations/google/operations";

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
  return { items: [], hasMore: false, loadingMore: false };
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
    error: undefined,
    retryMode: undefined,
  };
}

const EMPTY_CATEGORY_DEPTHS: CategoryDepths = { drive: 0, archive: 0, events: 0 };

/**
 * Keeps a lifecycle base read and explicit cursor reads in one generation.
 * A base read supersedes cursor requests, but remembers each pending click so
 * the fresh generation can replay to the same visible depth before swapping.
 */
export function createOperationsRequestCoordinator() {
  let epoch = 0;
  let nextToken = 0;
  let depths: CategoryDepths = { ...EMPTY_CATEGORY_DEPTHS };
  let requestedDepths: CategoryDepths = { ...EMPTY_CATEGORY_DEPTHS };
  let baseToken: number | null = null;
  const baseReplayUrls = new Set<string>();
  const categories = new Map<CategoryKey, CategoryRequestTicket>();

  const isCurrentCategory = (ticket: CategoryRequestTicket) => (
    baseToken === null
    && ticket.epoch === epoch
    && categories.get(ticket.category)?.token === ticket.token
  );

  const isCurrentBase = (ticket: BaseRequestTicket) => (
    ticket.epoch === epoch && baseToken === ticket.token
  );

  return {
    beginCategory(category: CategoryKey, url: string) {
      if (baseToken !== null || categories.has(category)) return null;
      const ticket: CategoryRequestTicket = {
        category,
        epoch,
        token: ++nextToken,
        url,
      };
      categories.set(category, ticket);
      return ticket;
    },
    beginBase() {
      // A new lifecycle signal is authoritative immediately. The prior base
      // request may keep using the network, but its ticket can no longer
      // publish rows while this trailing generation resolves.
      epoch += 1;
      const desiredDepths: CategoryDepths = {
        drive: Math.max(depths.drive, requestedDepths.drive),
        archive: Math.max(depths.archive, requestedDepths.archive),
        events: Math.max(depths.events, requestedDepths.events),
      };
      for (const category of categories.keys()) {
        desiredDepths[category] = Math.max(desiredDepths[category], depths[category] + 1);
      }
      requestedDepths = { ...desiredDepths };
      const canceledUrls = [
        ...[...categories.values()].map((ticket) => ticket.url),
        ...baseReplayUrls,
      ];
      categories.clear();
      baseReplayUrls.clear();
      baseToken = ++nextToken;
      return {
        epoch,
        token: baseToken,
        desiredDepths,
        canceledUrls,
      } satisfies BaseRequestTicket;
    },
    isCurrentCategory,
    isCurrentBase,
    supersedeBase() {
      if (baseToken === null) return false;
      epoch += 1;
      baseToken = null;
      return true;
    },
    registerBaseReplayUrl(ticket: BaseRequestTicket, url: string) {
      if (!isCurrentBase(ticket)) return false;
      baseReplayUrls.add(url);
      return true;
    },
    settleCategory(ticket: CategoryRequestTicket, appended: boolean) {
      if (!isCurrentCategory(ticket)) return false;
      categories.delete(ticket.category);
      if (appended) {
        depths[ticket.category] += 1;
        requestedDepths[ticket.category] = depths[ticket.category];
      }
      return true;
    },
    settleBase(ticket: BaseRequestTicket, nextDepths: CategoryDepths) {
      if (!isCurrentBase(ticket)) return false;
      depths = { ...nextDepths };
      requestedDepths = { ...nextDepths };
      baseToken = null;
      baseReplayUrls.clear();
      return true;
    },
    cancelBase(ticket: BaseRequestTicket) {
      if (!isCurrentBase(ticket)) return false;
      baseToken = null;
      return true;
    },
    failClosed() {
      epoch += 1;
      depths = { ...EMPTY_CATEGORY_DEPTHS };
      requestedDepths = { ...EMPTY_CATEGORY_DEPTHS };
      baseToken = null;
      const canceledUrls = [
        ...[...categories.values()].map((ticket) => ticket.url),
        ...baseReplayUrls,
      ];
      categories.clear();
      baseReplayUrls.clear();
      return canceledUrls;
    },
  };
}

export async function replayOperationsCategoryPages<T>(
  initial: CategoryResult<T>,
  desiredExtraPages: number,
  readPage: (cursor: string) => Promise<CategoryResult<T>>,
) {
  let result: CategoryResult<T> = {
    items: [...initial.items],
    hasMore: initial.hasMore,
    nextCursor: initial.nextCursor,
  };
  let loadedExtraPages = 0;
  try {
    while (loadedExtraPages < desiredExtraPages && result.hasMore && result.nextCursor) {
      const page = await readPage(result.nextCursor);
      result = {
        items: [...result.items, ...page.items],
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
      loadedExtraPages += 1;
    }
    return { result, loadedExtraPages } as const;
  } catch (failure) {
    return { result, loadedExtraPages, failure } as const;
  }
}

export function shouldQueueOperationsBaseLoad(
  silent: boolean,
  visibleBaseReadsInFlight: number,
) {
  return silent && visibleBaseReadsInFlight > 0;
}

function operationsCategoryUrl(category: CategoryKey, cursor?: string) {
  const search = new URLSearchParams({ category });
  if (cursor) search.set("cursor", cursor);
  return `${OPERATIONS_URL}?${search.toString()}`;
}

async function readOperationsPayload(url: string, force: boolean) {
  const body = await cachedGetJson<OperationsPayload>(url, { force });
  if (!body || !("driveOperations" in body)) {
    throw new Error("Google operations could not be loaded.");
  }
  return body;
}

export function WorkspaceOperationsHealthCard({ isAdmin }: { isAdmin: boolean }) {
  const [simulation, setSimulation] = useState<boolean | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [limits, setLimits] = useState<{ perCategory: number } | null>(null);
  const [drive, setDrive] = useState<AccumulatedCategory<DriveOperation>>(emptyAccumulator);
  const [archive, setArchive] = useState<AccumulatedCategory<FailedArchive>>(emptyAccumulator);
  const [events, setEvents] = useState<AccumulatedCategory<IntegrationEvent>>(emptyAccumulator);
  const [reconciling, setReconciling] = useState(false);
  const { state, error, run: runLoad } = useClientLoadState(
    "Google operations could not be loaded.",
  );
  const requestCoordinator = useRef(createOperationsRequestCoordinator());
  const visibleBaseReadsInFlight = useRef(0);
  const trailingBaseLoadQueued = useRef(false);
  const baseLoadRef = useRef<((force?: boolean, silent?: boolean) => Promise<void> | undefined) | undefined>(undefined);
  const operationsCardActive = useRef(false);
  const failuresHeadingRef = useRef<HTMLHeadingElement>(null);
  const eventsHeadingRef = useRef<HTMLHeadingElement>(null);
  const prevDriveHasMore = useRef(drive.hasMore);
  const prevArchiveHasMore = useRef(archive.hasMore);
  const prevEventsHasMore = useRef(events.hasMore);

  const clearPrivilegedOperations = useCallback(() => {
    setSimulation(null);
    setCheckedAt(null);
    setLimits(null);
    setDrive(emptyAccumulator());
    setArchive(emptyAccumulator());
    setEvents(emptyAccumulator());
    setReconciling(false);
  }, []);

  const invalidateCanceledCategoryReads = useCallback((urls: readonly string[]) => {
    for (const url of urls) invalidateCachedGet(url, { notify: false });
  }, []);

  const stopCategoryLoads = useCallback(() => {
    setDrive((current) => ({ ...current, loadingMore: false }));
    setArchive((current) => ({ ...current, loadingMore: false }));
    setEvents((current) => ({ ...current, loadingMore: false }));
  }, []);

  const resetCoordinatorAndClear = useCallback(() => {
    invalidateCanceledCategoryReads(requestCoordinator.current.failClosed());
    clearPrivilegedOperations();
  }, [clearPrivilegedOperations, invalidateCanceledCategoryReads]);

  const failClosedOperations = useCallback(async (loadError: unknown) => {
    resetCoordinatorAndClear();
    invalidateCachedGet(OPERATIONS_URL, { notify: false });
    await runLoad(
      () => Promise.reject(loadError),
      {
        onSuccess: () => undefined,
        onFailure: clearPrivilegedOperations,
      },
      { silent: true },
    );
  }, [clearPrivilegedOperations, resetCoordinatorAndClear, runLoad]);

  const load = useCallback(async (force = false, silent = false) => {
    if (!isAdmin || !operationsCardActive.current) return;
    // useClientLoadState deliberately declines a silent read while a visible
    // one is pending. Fence that visible ticket now and queue one trailing
    // read, rather than dropping a mutation/terminal cache notification.
    if (shouldQueueOperationsBaseLoad(silent, visibleBaseReadsInFlight.current)) {
      trailingBaseLoadQueued.current = true;
      requestCoordinator.current.supersedeBase();
      return;
    }
    const ticket = requestCoordinator.current.beginBase();
    if (!ticket) return;
    invalidateCanceledCategoryReads(ticket.canceledUrls);
    setReconciling(true);

    if (!silent) visibleBaseReadsInFlight.current += 1;
    let body: OperationsPayload | undefined;
    try {
      body = await runLoad(
        () => readOperationsPayload(OPERATIONS_URL, force),
        {
          onSuccess: () => undefined,
          onFailure: resetCoordinatorAndClear,
        },
        { silent },
      );
    } finally {
      if (!silent) {
        visibleBaseReadsInFlight.current -= 1;
        if (visibleBaseReadsInFlight.current === 0 && trailingBaseLoadQueued.current) {
          trailingBaseLoadQueued.current = false;
          queueMicrotask(() => void baseLoadRef.current?.(false, true));
        }
      }
    }

    if (!body || !requestCoordinator.current.isCurrentBase(ticket)) {
      if (requestCoordinator.current.cancelBase(ticket)) {
        stopCategoryLoads();
        setReconciling(false);
      }
      return;
    }

    const [nextDrive, nextArchive, nextEvents] = await Promise.all([
      replayOperationsCategoryPages(
        body.driveOperations,
        ticket.desiredDepths.drive,
        async (cursor) => {
          const url = operationsCategoryUrl("drive", cursor);
          if (!requestCoordinator.current.registerBaseReplayUrl(ticket, url)) {
            throw new Error("The operations refresh was superseded.");
          }
          const page = await readOperationsPayload(url, true);
          return page.driveOperations;
        },
      ),
      replayOperationsCategoryPages(
        body.failedArchives,
        ticket.desiredDepths.archive,
        async (cursor) => {
          const url = operationsCategoryUrl("archive", cursor);
          if (!requestCoordinator.current.registerBaseReplayUrl(ticket, url)) {
            throw new Error("The operations refresh was superseded.");
          }
          const page = await readOperationsPayload(url, true);
          return page.failedArchives;
        },
      ),
      replayOperationsCategoryPages(
        body.events,
        ticket.desiredDepths.events,
        async (cursor) => {
          const url = operationsCategoryUrl("events", cursor);
          if (!requestCoordinator.current.registerBaseReplayUrl(ticket, url)) {
            throw new Error("The operations refresh was superseded.");
          }
          const page = await readOperationsPayload(url, true);
          return page.events;
        },
      ),
    ]);

    const failures = [nextDrive.failure, nextArchive.failure, nextEvents.failure].filter(
      (failure) => failure !== undefined,
    );
    const terminalFailure = failures.find(isTerminalCachedGetError);
    if (terminalFailure) {
      await failClosedOperations(terminalFailure);
      return;
    }
    if (!requestCoordinator.current.isCurrentBase(ticket)) return;
    if (failures.length > 0) {
      if (nextDrive.failure !== undefined) {
        const message = nextDrive.failure instanceof Error
          ? nextDrive.failure.message
          : "Google operations could not be loaded.";
        setDrive((current) => ({ ...current, loadingMore: false, error: message, retryMode: "base" }));
      }
      if (nextArchive.failure !== undefined) {
        const message = nextArchive.failure instanceof Error
          ? nextArchive.failure.message
          : "Google operations could not be loaded.";
        setArchive((current) => ({ ...current, loadingMore: false, error: message, retryMode: "base" }));
      }
      if (nextEvents.failure !== undefined) {
        const message = nextEvents.failure instanceof Error
          ? nextEvents.failure.message
          : "Google operations could not be loaded.";
        setEvents((current) => ({ ...current, loadingMore: false, error: message, retryMode: "base" }));
      }
      requestCoordinator.current.cancelBase(ticket);
      stopCategoryLoads();
      setReconciling(false);
      return;
    }

    if (!requestCoordinator.current.settleBase(ticket, {
      drive: nextDrive.loadedExtraPages,
      archive: nextArchive.loadedExtraPages,
      events: nextEvents.loadedExtraPages,
    })) return;
    setSimulation(body.simulation);
    setCheckedAt(body.checkedAt);
    setLimits(body.limits);
    setDrive({ ...nextDrive.result, loadingMore: false });
    setArchive({ ...nextArchive.result, loadingMore: false });
    setEvents({ ...nextEvents.result, loadingMore: false });
    setReconciling(false);
  }, [
    failClosedOperations,
    invalidateCanceledCategoryReads,
    isAdmin,
    resetCoordinatorAndClear,
    runLoad,
    stopCategoryLoads,
  ]);

  useEffect(() => {
    baseLoadRef.current = load;
    return () => {
      if (baseLoadRef.current === load) baseLoadRef.current = undefined;
    };
  }, [load]);

  const loadCategory = useCallback(async (category: CategoryKey, cursor?: string) => {
    if (!isAdmin) return;
    const url = operationsCategoryUrl(category, cursor);
    const ticket = requestCoordinator.current.beginCategory(category, url);
    if (!ticket) return;
    if (category === "drive") setDrive((current) => ({ ...current, loadingMore: true, error: undefined, retryMode: undefined }));
    if (category === "archive") setArchive((current) => ({ ...current, loadingMore: true, error: undefined, retryMode: undefined }));
    if (category === "events") setEvents((current) => ({ ...current, loadingMore: true, error: undefined, retryMode: undefined }));

    let appended = false;
    try {
      const body = await readOperationsPayload(url, true);
      if (!requestCoordinator.current.isCurrentCategory(ticket)) return;
      if (category === "drive") setDrive((current) => mergeAccumulator(current, body.driveOperations));
      if (category === "archive") setArchive((current) => mergeAccumulator(current, body.failedArchives));
      if (category === "events") setEvents((current) => mergeAccumulator(current, body.events));
      appended = true;
    } catch (loadError) {
      if (isTerminalCachedGetError(loadError)) {
        await failClosedOperations(loadError);
        return;
      }
      if (!requestCoordinator.current.isCurrentCategory(ticket)) return;
      const message = loadError instanceof Error
        ? loadError.message
        : "Google operations could not be loaded.";
      if (category === "drive") setDrive((current) => ({ ...current, loadingMore: false, error: message, retryMode: "category" }));
      if (category === "archive") setArchive((current) => ({ ...current, loadingMore: false, error: message, retryMode: "category" }));
      if (category === "events") setEvents((current) => ({ ...current, loadingMore: false, error: message, retryMode: "category" }));
    } finally {
      requestCoordinator.current.settleCategory(ticket, appended);
    }
  }, [failClosedOperations, isAdmin]);

  const retryCategory = useCallback((
    category: CategoryKey,
    cursor: string | undefined,
    retryMode: "category" | "base" | undefined,
  ) => {
    if (retryMode === "base") return load(true);
    return loadCategory(category, cursor);
  }, [load, loadCategory]);

  useEffect(() => {
    if (!isAdmin) return;
    operationsCardActive.current = true;
    void Promise.resolve().then(load);
    const coordinator = requestCoordinator.current;
    return () => {
      operationsCardActive.current = false;
      trailingBaseLoadQueued.current = false;
      invalidateCanceledCategoryReads(coordinator.failClosed());
    };
  }, [invalidateCanceledCategoryReads, isAdmin, load]);

  useCachedGetSubscription([OPERATIONS_URL], () => load(false, true), isAdmin);

  useEffect(() => {
    if (prevDriveHasMore.current && !drive.hasMore && !drive.loadingMore) {
      failuresHeadingRef.current?.focus();
    }
    prevDriveHasMore.current = drive.hasMore;
  }, [drive.hasMore, drive.loadingMore]);

  useEffect(() => {
    if (prevArchiveHasMore.current && !archive.hasMore && !archive.loadingMore) {
      failuresHeadingRef.current?.focus();
    }
    prevArchiveHasMore.current = archive.hasMore;
  }, [archive.hasMore, archive.loadingMore]);

  useEffect(() => {
    if (prevEventsHasMore.current && !events.hasMore && !events.loadingMore) {
      eventsHeadingRef.current?.focus();
    }
    prevEventsHasMore.current = events.hasMore;
  }, [events.hasMore, events.loadingMore]);

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
  const anyLoading = state === "loading" || reconciling || drive.loadingMore || archive.loadingMore || events.loadingMore;

  return <div className={styles.card} data-workspace-operations-health={state} aria-live="polite" aria-busy={anyLoading}>
    <div className={styles.toolbar}>
      <p>{simulation
        ? "Simulation only — these are locally recorded test operations and no Google call is made."
        : "Recorded Google work for the current company connection. This does not contact Google."}</p>
    </div>

    {state === "loading" && !driveOperations.length && !failedArchives.length && !eventItems.length
      ? <p className={styles.message} role="status">Loading recorded Google operations…</p>
      : null}
    {state === "error" ? <SettingsDataNotice
      state="error"
      error={error || "Google operations could not be loaded."}
      errorTitle="Recorded Google operations could not be loaded"
      onRetry={() => void load(true)}
    /> : null}

    {state === "ready" || driveOperations.length > 0 || failedArchives.length > 0 || eventItems.length > 0 ? <>
      <section className={styles.section} aria-labelledby="workspace-operations-failures-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h5 id="workspace-operations-failures-heading" ref={failuresHeadingRef} tabIndex={-1}>Needs attention</h5>
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
        {drive.error && (
          <div className={styles.error} role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{drive.error}</span>
            <button className="soft-button" type="button" disabled={reconciling} onClick={() => void retryCategory("drive", drive.nextCursor, drive.retryMode)}>Retry</button>
          </div>
        )}
        {archive.error && (
          <div className={styles.error} role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{archive.error}</span>
            <button className="soft-button" type="button" disabled={reconciling} onClick={() => void retryCategory("archive", archive.nextCursor, archive.retryMode)}>Retry</button>
          </div>
        )}
        {failureCount > 0 && (
          <p className={styles.limitNote}>
            Showing {failureCount} recorded issue{failureCount === 1 ? "" : "s"}
            {moreFailures ? ` (newest ${limits?.perCategory ?? 50} per category). More exist.` : ""}
          </p>
        )}
        {moreFailures && (
          <div className={styles.loadMoreRow}>
            {drive.hasMore && (
              <button
                className="soft-button"
                type="button"
                disabled={reconciling || drive.loadingMore}
                onClick={() => void loadCategory("drive", drive.nextCursor)}
              >
                {drive.loadingMore ? "Loading…" : <>Load more Drive issues <ChevronDown size={14} aria-hidden="true" /></>}
              </button>
            )}
            {archive.hasMore && (
              <button
                className="soft-button"
                type="button"
                disabled={reconciling || archive.loadingMore}
                onClick={() => void loadCategory("archive", archive.nextCursor)}
              >
                {archive.loadingMore ? "Loading…" : <>Load more archive issues <ChevronDown size={14} aria-hidden="true" /></>}
              </button>
            )}
          </div>
        )}
        {hasStuckDriveLease && <p className={styles.guidance}><strong>Stuck lease:</strong> wait out the five-minute lease before retrying. Never hand-edit Drive to clear it.</p>}
        {hasFailedDriveOperation && <p className={styles.guidance}><strong>Failed Drive operation:</strong> keep the recorded error code and retry only through the original app action. Never repair Drive or app records by hand.</p>}
        {failedArchives.length > 0 && <p className={styles.guidance}><strong>Failed archive:</strong> return to the Gmail project inbox and repeat Review & copy. The saved archive identity makes the retry idempotent.</p>}
        {failedArchives.length > 0 && <a className="soft-button" href="/inbox">Open Gmail project inbox</a>}
      </section>

      <section className={styles.section} aria-labelledby="workspace-operations-events-heading">
        <div className={styles.sectionHeading}>
          <div>
            <h5 id="workspace-operations-events-heading" ref={eventsHeadingRef} tabIndex={-1}>Recent integration activity</h5>
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
        {events.error && (
          <div className={styles.error} role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{events.error}</span>
            <button className="soft-button" type="button" disabled={reconciling} onClick={() => void retryCategory("events", events.nextCursor, events.retryMode)}>Retry</button>
          </div>
        )}
        {eventItems.length > 0 && (
          <p className={styles.limitNote}>
            Showing {eventItems.length} event{eventItems.length === 1 ? "" : "s"}
            {moreEvents ? ` (newest ${limits?.perCategory ?? 50} per fetch). Older activity remains stored.` : ""}
          </p>
        )}
        {moreEvents && (
          <div className={styles.loadMoreRow}>
            <button
              className="soft-button"
              type="button"
              disabled={reconciling || events.loadingMore}
              onClick={() => void loadCategory("events", events.nextCursor)}
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
