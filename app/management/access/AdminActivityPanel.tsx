"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AdminAuditClientError,
  type AdminAuditCategoryFilter,
  type AdminAuditPage,
  type AdminAuditPeriod,
  type AdminAuditReadInput,
  type AdminAuditResult,
  type AdminAuditResultFilter,
  readAdminAuditActivity,
} from "../../lib/admin-audit-client";

type ActivityFilters = Readonly<{
  period: AdminAuditPeriod;
  result: AdminAuditResultFilter;
  category: AdminAuditCategoryFilter;
}>;

type AppliedActivityRequest = Omit<AdminAuditReadInput, "cursor">;

const PAGE_SIZE = 25;
const DEFAULT_FILTERS: ActivityFilters = Object.freeze({
  period: "30d",
  result: "all",
  category: "all",
});
const PERIOD_MILLISECONDS: Readonly<Partial<Record<AdminAuditPeriod, number>>> = Object.freeze({
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
  "90d": 90 * 24 * 60 * 60_000,
});
const RESULT_LABELS: Readonly<Record<AdminAuditResult, string>> = Object.freeze({
  succeeded: "Succeeded",
  failed: "Failed",
  denied: "Denied",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function requestFor(filters: ActivityFilters): AppliedActivityRequest {
  const beforeTime = Date.now() + 1;
  const duration = PERIOD_MILLISECONDS[filters.period];
  return Object.freeze({
    limit: PAGE_SIZE,
    from: duration === undefined
      ? null
      : new Date(beforeTime - duration).toISOString(),
    before: new Date(beforeTime).toISOString(),
    result: filters.result,
    category: filters.category,
  });
}

function initialErrorMessage(error: unknown) {
  if (error instanceof AdminAuditClientError && error.status === 403) {
    return "Only an active Administrator can view security activity.";
  }
  if (error instanceof AdminAuditClientError && error.status === 400) {
    return "Those activity filters are no longer valid. Clear them and try again.";
  }
  return "Security activity could not be loaded. People and access settings were not affected.";
}

function filtersAreDefault(filters: ActivityFilters) {
  return filters.period === DEFAULT_FILTERS.period
    && filters.result === DEFAULT_FILTERS.result
    && filters.category === DEFAULT_FILTERS.category;
}

export function AdminActivityPanel({
  active,
  onSessionEnded,
}: {
  active: boolean;
  onSessionEnded: () => void;
}) {
  const [draftFilters, setDraftFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const [appliedRequest, setAppliedRequest] = useState<AppliedActivityRequest | null>(null);
  const [activityPage, setActivityPage] = useState<AdminAuditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const requestSequence = useRef(0);
  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFilterFocusAfterLoad = useRef(false);

  const loadPage = useCallback(async (
    request: AppliedActivityRequest,
    cursor: string | null,
    append: boolean,
    replacementFilters: ActivityFilters | null = null,
    restoreFilterFocus = false,
  ) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!append && restoreFilterFocus) {
      restoreFilterFocusAfterLoad.current = true;
    }
    if (append) {
      setLoadingMore(true);
      setLoadMoreError("");
    } else {
      setLoading(true);
      setLoadingMore(false);
      setLoadError("");
      setLoadMoreError("");
    }
    try {
      const next = await readAdminAuditActivity({ ...request, cursor });
      if (requestSequence.current !== sequence) return;
      setActivityPage((current) => append && current
        ? Object.freeze({
            events: Object.freeze([...current.events, ...next.events]),
            nextCursor: next.nextCursor,
            generatedAt: next.generatedAt,
          })
        : next);
      if (!append && replacementFilters !== null) {
        setAppliedFilters(replacementFilters);
        setAppliedRequest(request);
      }
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      if (error instanceof AdminAuditClientError && error.status === 401) {
        onSessionEnded();
        return;
      }
      if (append) {
        setLoadMoreError("More activity could not be loaded. The records already shown were kept.");
      } else {
        setLoadError(initialErrorMessage(error));
      }
    } finally {
      if (requestSequence.current === sequence) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [onSessionEnded]);

  useEffect(() => {
    if (!active || hasStarted) return;
    const timer = window.setTimeout(() => {
      setHasStarted(true);
      const request = requestFor(DEFAULT_FILTERS);
      void loadPage(request, null, false, DEFAULT_FILTERS);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, hasStarted, loadPage]);

  useEffect(() => {
    if (loading || !restoreFilterFocusAfterLoad.current) return;
    restoreFilterFocusAfterLoad.current = false;
    const timer = window.setTimeout(() => applyButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [loading]);

  function applyFilters(filters: ActivityFilters) {
    if (loading || loadingMore) return;
    const request = requestFor(filters);
    void loadPage(request, null, false, filters, true);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilters(draftFilters);
  }

  function clearFilters() {
    if (loading || loadingMore) return;
    setDraftFilters(DEFAULT_FILTERS);
    applyFilters(DEFAULT_FILTERS);
  }

  function loadMore() {
    if (!appliedRequest || !activityPage?.nextCursor || loadingMore) return;
    void loadPage(appliedRequest, activityPage.nextCursor, true);
  }

  if (!hasStarted || (loading && activityPage === null)) {
    return <section className="panel access-management-state" role="status">
      <h2>Loading Activity…</h2>
      <p>Checking the current Administrator session and minimized security records.</p>
    </section>;
  }

  if (activityPage === null) {
    return <section className="panel access-management-state" role="alert">
      <h2>Activity is unavailable</h2>
      <p>{loadError || "The activity projection could not be loaded."}</p>
      <button
        type="button"
        className="soft-button"
        onClick={() => {
          const request = appliedRequest ?? requestFor(appliedFilters);
          void loadPage(request, null, false, appliedFilters);
        }}
      >Retry</button>
    </section>;
  }

  const filtered = !filtersAreDefault(appliedFilters);
  const filteredByDecision = appliedFilters.result !== "all"
    || appliedFilters.category !== "all";
  const emptyTitle = filteredByDecision
    ? "No activity matches these filters"
    : appliedFilters.period === "all"
      ? "No activity has been recorded yet"
      : "No activity in this period";

  return <section
    className="panel access-management-activity"
    aria-labelledby="activity-heading"
    aria-busy={loading || loadingMore}
  >
    <div className="access-management-section-heading">
      <div>
        <p className="eyebrow">Security evidence</p>
        <h2 id="activity-heading">Activity</h2>
      </div>
      <span>{activityPage.events.length} shown</span>
    </div>

    <form className="access-management-activity-filters" onSubmit={submitFilters}>
      <label>Date
        <select
          value={draftFilters.period}
          onChange={(event) => setDraftFilters((current) => ({
            ...current,
            period: event.target.value as AdminAuditPeriod,
          }))}
          disabled={loading || loadingMore}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All available activity</option>
        </select>
      </label>
      <label>Result
        <select
          value={draftFilters.result}
          onChange={(event) => setDraftFilters((current) => ({
            ...current,
            result: event.target.value as AdminAuditResultFilter,
          }))}
          disabled={loading || loadingMore}
        >
          <option value="all">All results</option>
          <option value="succeeded">Succeeded</option>
          <option value="denied">Denied</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <label>Action
        <select
          value={draftFilters.category}
          onChange={(event) => setDraftFilters((current) => ({
            ...current,
            category: event.target.value as AdminAuditCategoryFilter,
          }))}
          disabled={loading || loadingMore}
        >
          <option value="all">All actions</option>
          <option value="access">Access decisions</option>
          <option value="people">People and sessions</option>
          <option value="workspace">Workspace actions</option>
          <option value="files">File actions</option>
          <option value="records">Record actions</option>
          <option value="other">Other security actions</option>
        </select>
      </label>
      <div className="access-management-filter-actions">
        <button
          ref={applyButtonRef}
          type="submit"
          className="soft-button"
          disabled={loading || loadingMore}
        >Apply filters</button>
        <button
          type="button"
          className="text-button"
          onClick={clearFilters}
          disabled={loading || loadingMore || (filtersAreDefault(draftFilters) && filtersAreDefault(appliedFilters))}
        >Clear</button>
      </div>
    </form>

    {loadError && <div className="access-management-form-error" role="alert">{loadError}</div>}

    <p className="sr-only" role="status" aria-live="polite">
      {activityPage.events.length} activity records loaded.
    </p>

    {activityPage.events.length === 0 ? <div className="access-management-activity-empty">
      <strong>{emptyTitle}</strong>
      <p>{filteredByDecision
        ? "Clear or change the filters to review a wider period."
        : appliedFilters.period === "all"
          ? "Security decisions will appear here after they are recorded."
          : "Choose a wider date range to review older activity."}</p>
      {filtered && <button type="button" className="soft-button" onClick={clearFilters} disabled={loadingMore}>Clear filters</button>}
    </div> : <div className="access-management-activity-table-wrap">
      <table aria-label="Security activity">
        <thead><tr>
          <th scope="col">Time</th>
          <th scope="col">Actor</th>
          <th scope="col">Action</th>
          <th scope="col">Target</th>
          <th scope="col">Result</th>
          <th scope="col">Reason</th>
        </tr></thead>
        <tbody>{activityPage.events.map((activity, index) => <tr
          key={`${activity.occurredAt}:${activity.actorLabel}:${activity.actionLabel}:${index}`}
        >
          <td data-label="Time"><time dateTime={new Date(activity.occurredAt).toISOString()}>{dateFormatter.format(activity.occurredAt)}</time></td>
          <td data-label="Actor"><strong>{activity.actorLabel}</strong></td>
          <td data-label="Action">{activity.actionLabel}</td>
          <td data-label="Target">{activity.targetLabel}</td>
          <td data-label="Result"><span className={`access-management-result ${activity.result}`}>{RESULT_LABELS[activity.result]}</span></td>
          <td data-label="Reason">{activity.reason ?? "No reason recorded"}</td>
        </tr>)}</tbody>
      </table>
    </div>}

    <footer className="access-management-activity-footer">
      <span>Updated {dateFormatter.format(activityPage.generatedAt)}</span>
      {loadMoreError && <div role="alert">
        <span>{loadMoreError}</span>
        <button type="button" className="text-button" onClick={loadMore} disabled={loadingMore}>Retry</button>
      </div>}
      {!loadMoreError && activityPage.nextCursor && <button
        type="button"
        className="soft-button"
        onClick={loadMore}
        disabled={loadingMore}
      >{loadingMore ? "Loading more…" : "Load more"}</button>}
      {!activityPage.nextCursor && activityPage.events.length > 0 && <strong>All matching activity is shown.</strong>}
    </footer>
  </section>;
}
