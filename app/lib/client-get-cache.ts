type CachedJsonOptions = {
  force?: boolean;
  ttlMs?: number;
};

type CachedJsonEntry = {
  expiresAt: number;
  hasValue: boolean;
  ttlMs: number;
  value?: unknown;
  inFlight?: Promise<unknown>;
  terminalError?: CachedGetError;
};

const DEFAULT_TTL_MS = 15_000;
/**
 * Every cached GET carries an abort deadline. Without one, a single stalled
 * response wedges the whole freshness doctrine: lifecycleRevalidationInFlight
 * is only cleared in the `.finally()` of a `Promise.allSettled` that waits for
 * every member, so one hung request suppresses focus, visibility, and
 * navigation revalidation for the life of the tab. An abort deadline on a
 * request that is already open is not a scheduler — it queues nothing, repeats
 * nothing, and cannot run while no request is in flight.
 */
const REQUEST_DEADLINE_MS = 20_000;
const jsonGetCache = new Map<string, CachedJsonEntry>();
const jsonGetSubscribers = new Map<string, Set<() => void>>();
const clientLifecycleSubscribers = new Set<() => void | Promise<void>>();
let lifecycleRevalidationInFlight: Promise<void> | undefined;
let lifecycleRevalidationQueued = false;
/**
 * Whether the running census round has already taken delivery of a response.
 * Until it has, every read still open will answer with server state observed
 * after any trigger arriving now, so that trigger is genuinely satisfied by the
 * round already running. Once a response has landed, it is not.
 */
let lifecycleRoundReceivedResponse = false;

function markLifecycleCensusChanged() {
  if (lifecycleRevalidationInFlight) lifecycleRevalidationQueued = true;
}

export class CachedGetError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(
    status: number,
    body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "CachedGetError";
    this.status = status;
    this.body = body;
  }
}

export function isTerminalCachedGetError(error: unknown): error is CachedGetError {
  return error instanceof CachedGetError && (error.status === 401 || error.status === 403);
}

function notifySubscribers(url: string) {
  for (const subscriber of jsonGetSubscribers.get(url) ?? []) subscriber();
}

function responseError(url: string, status: number, body: unknown) {
  if (
    typeof body === "object"
    && body !== null
    && !Array.isArray(body)
    && typeof (body as { error?: unknown }).error === "string"
  ) {
    return new CachedGetError(status, body, (body as { error: string }).error);
  }
  return new CachedGetError(status, body, `GET ${url} failed (${status})`);
}

function startJsonGet<T>(url: string, ttlMs: number, existing?: CachedJsonEntry): Promise<T> {
  const notifyOnSettlement = Boolean(existing?.hasValue || existing?.terminalError);
  const deadline = AbortSignal.timeout(REQUEST_DEADLINE_MS);
  const request = fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: deadline,
  })
    .then(async (response) => {
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw responseError(url, response.status, body);
      return body as T;
    })
    .then((value) => {
      if (jsonGetCache.get(url)?.inFlight === request) {
        jsonGetCache.set(url, {
          expiresAt: Date.now() + ttlMs,
          hasValue: true,
          ttlMs,
          value,
        });
        if (notifyOnSettlement) notifySubscribers(url);
      }
      return value;
    })
    .catch((error) => {
      // A timed-out request is an ordinary, retryable transport failure: it
      // never becomes a terminal authorization state and never poisons a
      // stale-but-honest cached value.
      const failure = deadline.aborted && !isTerminalCachedGetError(error)
        ? new CachedGetError(0, null, `GET ${url} did not respond within ${REQUEST_DEADLINE_MS / 1_000} seconds.`)
        : error;
      const current = jsonGetCache.get(url);
      if (current?.inFlight === request) {
        if (isTerminalCachedGetError(failure)) {
          jsonGetCache.set(url, {
            expiresAt: Number.POSITIVE_INFINITY,
            hasValue: false,
            ttlMs,
            terminalError: failure,
          });
          if (notifyOnSettlement) notifySubscribers(url);
        } else if (current.hasValue) {
          jsonGetCache.set(url, { ...current, inFlight: undefined });
        } else {
          jsonGetCache.delete(url);
        }
      }
      throw failure;
    });

  jsonGetCache.set(url, existing?.hasValue
    ? { ...existing, ttlMs, inFlight: request }
    : { expiresAt: 0, hasValue: false, ttlMs, inFlight: request });
  return request;
}

/**
 * Shares same-origin GETs across panels without retaining errors. A stale value
 * is returned immediately while one background request revalidates it.
 * Mutations must invalidate their corresponding URL explicitly.
 */
export function cachedGetJson<T>(url: string, options: CachedJsonOptions = {}): Promise<T> {
  const existing = jsonGetCache.get(url);
  const ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
  if (!options.force && existing?.terminalError) {
    return Promise.reject(existing.terminalError);
  }
  if (existing?.inFlight) {
    if (!options.force && existing.hasValue) return Promise.resolve(existing.value as T);
    return existing.inFlight as Promise<T>;
  }
  if (!options.force && existing?.hasValue) {
    if (existing.expiresAt <= Date.now()) {
      void startJsonGet<T>(url, ttlMs, existing).catch(() => {
        // Background revalidation never replaces an honest stale value with an
        // unhandled rejection. A direct retry still surfaces the failure.
      });
    }
    return Promise.resolve(existing.value as T);
  }
  return startJsonGet<T>(url, ttlMs, existing);
}

export function subscribeCachedGet(url: string, subscriber: () => void) {
  const subscribers = jsonGetSubscribers.get(url) ?? new Set<() => void>();
  subscribers.add(subscriber);
  jsonGetSubscribers.set(url, subscribers);
  markLifecycleCensusChanged();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) jsonGetSubscribers.delete(url);
    markLifecycleCensusChanged();
  };
}

/** Registers a reader whose URL changes whenever its relative query window slides. */
export function subscribeClientGetLifecycle(subscriber: () => void | Promise<void>) {
  clientLifecycleSubscribers.add(subscriber);
  markLifecycleCensusChanged();
  return () => {
    clientLifecycleSubscribers.delete(subscriber);
    markLifecycleCensusChanged();
  };
}

/** Revalidates only resources with a mounted reader; no polling is used. */
export function revalidateSubscribedCachedGets() {
  if (lifecycleRevalidationInFlight) {
    // A trigger that lands once the running round has already taken delivery of
    // a response is a NEW freshness demand, not a duplicate: that round can no
    // longer speak for state which changed after it read. Returning the
    // in-flight promise without queueing dropped such a trigger outright — an
    // administrator who tabbed back mid-pass got no revalidation at all, and
    // since SET-42 deleted the manual refresh buttons that trigger is the only
    // refresh path left. Queue exactly one more round, the same single
    // generation markLifecycleCensusChanged() already uses for subscriber
    // churn, so a burst coalesces instead of stacking rounds.
    //
    // Before any response has landed, every read still open will answer with
    // server state observed after this trigger, so the running round already
    // satisfies it and joining stays both correct and single-flight.
    if (lifecycleRoundReceivedResponse) lifecycleRevalidationQueued = true;
    return lifecycleRevalidationInFlight;
  }
  lifecycleRevalidationInFlight = (async () => {
    do {
      lifecycleRevalidationQueued = false;
      lifecycleRoundReceivedResponse = false;
      const urls = [...jsonGetSubscribers.keys()];
      const lifecycleReaders = [...clientLifecycleSubscribers];
      await Promise.allSettled([
        ...urls.map(async (url) => {
          const existing = jsonGetCache.get(url);
          try {
            await cachedGetJson(url, {
              force: true,
              ttlMs: existing?.ttlMs ?? DEFAULT_TTL_MS,
            });
            lifecycleRoundReceivedResponse = true;
            // A mutation may deliberately discard a stale transport value
            // without notifying because its authoritative response has already
            // updated the mounted UI. The next lifecycle read still has to
            // deliver its fresh network value on the first focus/navigation.
            if (!existing) notifySubscribers(url);
          } catch (error) {
            // A failure is delivery too: the round has observed this URL's
            // current state and can no longer speak for a later trigger.
            lifecycleRoundReceivedResponse = true;
            // Terminal authorization failures always clear privileged mounted
            // state, including after a quiet mutation invalidation.
            if (!existing && isTerminalCachedGetError(error)) notifySubscribers(url);
            throw error;
          }
        }),
        ...lifecycleReaders.map((subscriber) => Promise.resolve().then(subscriber)),
      ]);
    } while (lifecycleRevalidationQueued);
  })().finally(() => {
    lifecycleRevalidationInFlight = undefined;
  });
  return lifecycleRevalidationInFlight;
}

export function invalidateCachedGet(url: string, options: { notify?: boolean } = {}) {
  jsonGetCache.delete(url);
  if (options.notify !== false) notifySubscribers(url);
}

export function invalidateCachedGetPrefix(
  prefix: string,
  options: { notify?: boolean } = {},
) {
  const urls = new Set([
    ...jsonGetCache.keys(),
    ...jsonGetSubscribers.keys(),
  ].filter((url) => url.startsWith(prefix)));
  for (const url of urls) {
    jsonGetCache.delete(url);
    if (options.notify !== false) notifySubscribers(url);
  }
}

/** A task write changes both the task query family and Today's projection. */
export function invalidateTaskReadCaches(options: { notifyToday?: boolean } = {}) {
  invalidateCachedGetPrefix("/api/v1/tasks");
  invalidateCachedGet("/api/v1/assistant/today", { notify: options.notifyToday !== false });
}

/** Any Workspace provider mutation may append an event or persist a failed operation. */
export function invalidateWorkspaceOperationsReadCache() {
  invalidateCachedGet("/api/v1/integrations/google/operations");
}

/** Review mutations change both the pending queue and the human outcome history. */
export function invalidateInboxAnalysisReadCaches(options: { notify?: boolean } = {}) {
  invalidateCachedGet("/api/v1/inbox-analysis", options);
  invalidateCachedGet("/api/v1/inbox-analysis/activity", options);
}

/** A review-approved Gmail filing changes archive totals and retires its review row. */
export function invalidateGmailFilingReadCaches(options: { includeOperations?: boolean } = {}) {
  invalidateCachedGet("/api/v1/dashboard");
  invalidateInboxAnalysisReadCaches();
  if (options.includeOperations !== false) invalidateWorkspaceOperationsReadCache();
}

/**
 * Simulation reset removes connection-scoped mail, form-intake, operation, audit,
 * resource, blueprint, and Sheet state. Keep every mounted projection honest.
 */
export function invalidateWorkspaceSimulationResetReadCaches(options: { includeOperations?: boolean } = {}) {
  invalidateCachedGet("/api/v1/dashboard");
  invalidateInboxAnalysisReadCaches();
  invalidateCachedGetPrefix("/api/v1/integrations/google/forms/leads");
  if (options.includeOperations !== false) invalidateWorkspaceOperationsReadCache();
  invalidateCachedGetPrefix("/api/v1/admin/audit");
  invalidateCachedGet("/api/v1/integrations/google/setup/blueprint");
}

/**
 * Tenant cutover also clears Drive fields on clients/projects, email task source
 * references, and saved Workspace settings. Invalidate that full derived family.
 */
export function invalidateWorkspaceTenantResetReadCaches(options: { includeOperations?: boolean } = {}) {
  invalidateWorkspaceSimulationResetReadCaches(options);
  invalidateCachedGetPrefix("/api/v1/clients");
  invalidateCachedGetPrefix("/api/v1/projects");
  invalidateTaskReadCaches();
  invalidateCachedGet("/api/v1/settings/workspace");
}

export function clearCachedGets() {
  jsonGetCache.clear();
}
