"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  isTerminalCachedGetError,
  revalidateSubscribedCachedGets,
  subscribeClientGetLifecycle,
  subscribeCachedGet,
} from "./client-get-cache";

export type ClientLoadState = "loading" | "ready" | "error";

type LoadHandlers<T> = Readonly<{
  onSuccess: (value: T) => void;
  onFailure?: () => void;
}>;

type LoadOptions = Readonly<{
  silent?: boolean;
}>;

/**
 * One latest-request-wins state machine for component GETs. Silent cache
 * revalidation keeps stale content mounted when the network is unavailable.
 */
export function useClientLoadState(defaultError: string) {
  const [state, setState] = useState<ClientLoadState>("loading");
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const visibleRequestsInFlight = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, []);

  const run = useCallback(async <T,>(
    request: () => Promise<T>,
    handlers: LoadHandlers<T>,
    options: LoadOptions = {},
  ): Promise<T | undefined> => {
    // A successful cache fill notifies subscribers before the initiating
    // component's parser has resumed. Let that visible request finish instead
    // of allowing its own silent subscription callback to supersede it. This
    // is especially important when the transport is 200 but the payload is
    // malformed: the visible reader must surface the parser failure.
    if (options.silent && visibleRequestsInFlight.current > 0) return;
    const sequence = ++requestSequence.current;
    if (!options.silent) {
      visibleRequestsInFlight.current += 1;
      setState("loading");
      setError("");
    }
    try {
      const value = await request();
      if (!mounted.current || sequence !== requestSequence.current) return;
      handlers.onSuccess(value);
      setState("ready");
      setError("");
      return value;
    } catch (caught) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (options.silent && !isTerminalCachedGetError(caught)) return;
      handlers.onFailure?.();
      setState("error");
      setError(caught instanceof Error ? caught.message : defaultError);
    } finally {
      if (!options.silent) visibleRequestsInFlight.current -= 1;
    }
  }, [defaultError]);

  return { state, error, run } as const;
}

/** Re-runs a mounted reader after one of its cached URLs receives fresh data. */
export function useCachedGetSubscription(
  urls: readonly string[],
  onUpdate: () => void | Promise<void>,
  enabled = true,
) {
  const handleUpdate = useEffectEvent(onUpdate);
  const queued = useRef(false);
  const urlKey = urls.join("\n");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const subscriber = () => {
      if (!active || queued.current) return;
      queued.current = true;
      queueMicrotask(() => {
        queued.current = false;
        if (active) void handleUpdate();
      });
    };
    const unsubscribe = urls.map((url) => subscribeCachedGet(url, subscriber));
    return () => {
      active = false;
      for (const stop of unsubscribe) stop();
    };
    // urlKey is the stable semantic dependency for callers that build arrays inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, urlKey]);
}

/** Lifecycle trigger for readers whose URL contains a sliding time window. */
export function useClientLifecycleRefresh(
  onUpdate: () => void | Promise<void>,
  enabled = true,
) {
  const handleUpdate = useEffectEvent(onUpdate);
  useEffect(() => {
    if (!enabled) return;
    return subscribeClientGetLifecycle(() => handleUpdate());
  }, [enabled]);
}

/** Installs the packet's request-driven freshness triggers once in the app shell. */
export function useClientGetRevalidation(routeKey: string) {
  const previousRouteKey = useRef<string | null>(null);

  useEffect(() => {
    const revalidate = () => void revalidateSubscribedCachedGets();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (previousRouteKey.current !== null && previousRouteKey.current !== routeKey) {
      let active = true;
      // Destination subscriptions are passive effects too. Queueing the route
      // revalidation gives them a chance to register before the census runs,
      // including when navigating back to a still-fresh cached page.
      queueMicrotask(() => {
        if (active) void revalidateSubscribedCachedGets();
      });
      previousRouteKey.current = routeKey;
      return () => {
        active = false;
      };
    }
    previousRouteKey.current = routeKey;
  }, [routeKey]);
}
