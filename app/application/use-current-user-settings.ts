"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cachedGetJson, invalidateCachedGet, isTerminalCachedGetError } from "../lib/client-get-cache";
import { useCachedGetSubscription } from "../lib/client-get-hooks";
import {
  defaultPageLayouts,
  normalizePageLayoutsForRead,
  type PageLayout,
  type PageLayoutPage,
  type PageLayouts,
} from "../lib/page-layouts";

export type CurrentUserSettingsPayload = {
  preferences?: { displayTimezone?: unknown; pageLayouts?: unknown };
  isAdmin?: unknown;
};

export function useCurrentUserSettings(initialIsAdmin: boolean) {
  const [displayTimezone, setDisplayTimezone] = useState("America/New_York");
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin);
  const [pageLayouts, setPageLayouts] = useState<PageLayouts>(() => defaultPageLayouts(initialIsAdmin));
  const [pageLayoutsReady, setPageLayoutsReady] = useState(false);
  const [pageLayoutsError, setPageLayoutsError] = useState("");
  const pageLayoutsLoadIdRef = useRef(0);

  const reconcileCurrentUserSettings = useCallback((data: CurrentUserSettingsPayload) => {
    const nextIsAdmin = data?.isAdmin === true;
    const timezone = data?.preferences?.displayTimezone;
    if (typeof timezone === "string") setDisplayTimezone(timezone);
    setIsAdmin(nextIsAdmin);
    setPageLayouts(normalizePageLayoutsForRead(data?.preferences?.pageLayouts, nextIsAdmin));
    setPageLayoutsReady(true);
    setPageLayoutsError("");
  }, []);

  const failClosedCurrentUserSettings = useCallback(() => {
    setIsAdmin(false);
    setPageLayouts((current) => normalizePageLayoutsForRead(current, false));
    setPageLayoutsReady(false);
    setPageLayoutsError("Your saved layout could not be loaded. Retry before editing.");
  }, []);

  useEffect(() => {
    const loadId = ++pageLayoutsLoadIdRef.current;
    void cachedGetJson<CurrentUserSettingsPayload>("/api/v1/settings/me")
      .then((data) => {
        if (loadId !== pageLayoutsLoadIdRef.current) return;
        reconcileCurrentUserSettings(data);
      })
      .catch(() => {
        if (loadId === pageLayoutsLoadIdRef.current) failClosedCurrentUserSettings();
      });
    return () => { pageLayoutsLoadIdRef.current += 1; };
  }, [failClosedCurrentUserSettings, reconcileCurrentUserSettings]);

  useCachedGetSubscription(["/api/v1/settings/me"], async () => {
    const loadId = ++pageLayoutsLoadIdRef.current;
    try {
      const data = await cachedGetJson<CurrentUserSettingsPayload>("/api/v1/settings/me");
      if (loadId === pageLayoutsLoadIdRef.current) reconcileCurrentUserSettings(data);
    } catch (error) {
      if (loadId === pageLayoutsLoadIdRef.current && isTerminalCachedGetError(error)) {
        failClosedCurrentUserSettings();
      }
    }
  });

  const retryPageLayouts = useCallback(async () => {
    const loadId = ++pageLayoutsLoadIdRef.current;
    setPageLayoutsReady(false);
    setPageLayoutsError("");
    try {
      const data = await cachedGetJson<CurrentUserSettingsPayload>("/api/v1/settings/me", { force: true });
      if (loadId !== pageLayoutsLoadIdRef.current) return;
      reconcileCurrentUserSettings(data);
    } catch {
      if (loadId === pageLayoutsLoadIdRef.current) failClosedCurrentUserSettings();
    }
  }, [failClosedCurrentUserSettings, reconcileCurrentUserSettings]);

  const savePageLayout = useCallback(async (page: PageLayoutPage, layout: PageLayout) => {
    const nextPageLayouts = { ...pageLayouts, [page]: layout };
    const response = await fetch("/api/v1/settings/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageLayouts: nextPageLayouts }),
    });
    const data = await response.json().catch(() => ({})) as { preferences?: { pageLayouts?: unknown }; error?: string };
    if (!response.ok) throw new Error(data.error ?? `The ${page === "overview" ? "Overview" : "Reports"} layout could not be saved.`);
    invalidateCachedGet("/api/v1/settings/me");
    setPageLayouts(normalizePageLayoutsForRead(data.preferences?.pageLayouts ?? nextPageLayouts, isAdmin));
  }, [isAdmin, pageLayouts]);

  return {
    displayTimezone,
    isAdmin,
    pageLayouts,
    pageLayoutsReady,
    pageLayoutsError,
    reconcileCurrentUserSettings,
    retryPageLayouts,
    savePageLayout,
    setDisplayTimezone,
  };
}
