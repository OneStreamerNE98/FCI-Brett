"use client";

import { useCallback, useEffect, useState } from "react";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import {
  DEFAULT_RECORD_LIST_PREFERENCES,
  normalizeRecordListPreferences,
  type RecordListPage,
  type RecordListPreferences,
} from "../../lib/record-list-preferences";

type PreferenceLoad = { preferences?: { recordListPreferences?: unknown } };

export function useRecordListPreferences<Page extends RecordListPage>(page: Page) {
  const [preferences, setPreferences] = useState<RecordListPreferences>(() => normalizeRecordListPreferences(DEFAULT_RECORD_LIST_PREFERENCES));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void cachedGetJson<PreferenceLoad>("/api/v1/settings/me")
      .then((payload) => {
        if (!active) return;
        setPreferences(normalizeRecordListPreferences(payload.preferences?.recordListPreferences));
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setLoaded(false);
        setError("Your saved list preferences could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  const update = useCallback(async (nextPagePreference: RecordListPreferences[Page]) => {
    if (!loaded) return;
    const previous = preferences;
    const next = { ...preferences, [page]: nextPagePreference } as RecordListPreferences;
    setPreferences(next);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/settings/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordListPreferences: next }),
      });
      const payload = await response.json().catch(() => ({})) as PreferenceLoad & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Your list preferences could not be saved.");
      const saved = normalizeRecordListPreferences(payload.preferences?.recordListPreferences);
      setPreferences(saved);
      invalidateCachedGet("/api/v1/settings/me");
    } catch (caught) {
      setPreferences(previous);
      setError(caught instanceof Error ? caught.message : "Your list preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [loaded, page, preferences]);

  return { preference: preferences[page], update, loaded, saving, error };
}
