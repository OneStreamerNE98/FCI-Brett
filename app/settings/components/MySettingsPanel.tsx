"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Check, Clock3, Reply, UserRound } from "lucide-react";
import { FeatureStateBadge } from "../../components/FeatureStateBadge";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import {
  defaultUserSettingsPreferences,
  normalizeUserNotificationPreferences,
  USER_NOTIFICATION_PREFERENCE_CATALOG,
  type UserSettingsPreferences,
} from "../../lib/user-settings";
import { SettingsDataNotice } from "./SettingsDataNotice";
import styles from "./MySettingsPanel.module.css";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type LoadState = "loading" | "ready" | "error";

function preferencesFromPayload(value: unknown): UserSettingsPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preferences = value as Partial<UserSettingsPreferences>;
  if (typeof preferences.displayTimezone !== "string" || typeof preferences.replySignature !== "string") return null;
  const notificationPreferences = normalizeUserNotificationPreferences(preferences.notificationPreferences);
  if (!notificationPreferences) return null;
  return {
    displayTimezone: preferences.displayTimezone,
    replySignature: preferences.replySignature,
    notificationPreferences,
  };
}

export function MySettingsPanel({ notify, userName, userEmail, onTimezoneChange }: { notify: Notify; userName: string; userEmail: string; onTimezoneChange: (timezone: string) => void }) {
  const [preferences, setPreferences] = useState<UserSettingsPreferences>(defaultUserSettingsPreferences);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const loadRequestRef = useRef(0);
  const sessionName = userName.trim();
  const sessionEmail = userEmail.trim();
  const hasDistinctDisplayName = Boolean(sessionName) && sessionName.toLowerCase() !== sessionEmail.toLowerCase();
  const accountTitle = hasDistinctDisplayName ? sessionName : sessionEmail;
  const accountSubtitle = hasDistinctDisplayName ? sessionEmail : "The current sign-in session did not provide a separate display name.";

  const loadMySettings = useCallback(async (force = false) => {
    const requestId = ++loadRequestRef.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const data = await cachedGetJson<{ preferences?: unknown }>("/api/v1/settings/me", { force });
      if (requestId !== loadRequestRef.current) return;
      const nextPreferences = preferencesFromPayload(data.preferences);
      if (!nextPreferences) throw new Error("The server returned no valid saved settings for this account.");
      setPreferences(nextPreferences);
      onTimezoneChange(nextPreferences.displayTimezone);
      setLoadState("ready");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(error instanceof Error ? error.message : "Your saved settings could not be loaded.");
      setLoadState("error");
    }
  }, [onTimezoneChange]);

  useEffect(() => {
    void Promise.resolve().then(() => loadMySettings());
    return () => { loadRequestRef.current += 1; };
  }, [loadMySettings]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadState !== "ready") return;
    setSaving(true);
    try {
      const response = await fetch("/api/v1/settings/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const data = await response.json().catch(() => ({})) as { preferences?: unknown; error?: string };
      const savedPreferences = preferencesFromPayload(data.preferences);
      if (!response.ok || !savedPreferences) throw new Error(data.error ?? "Your settings could not be saved.");
      invalidateCachedGet("/api/v1/settings/me");
      setPreferences(savedPreferences);
      onTimezoneChange(savedPreferences.displayTimezone);
      notify("My settings are saved to this signed-in FCI account", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Your settings could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel settings-form-panel" data-settings-audience="personal">
    <div className="settings-heading"><div><p className="eyebrow">Your signed-in account</p><h2>My settings</h2><p>Review the identity supplied by your current session and keep your own defaults separate from company setup.</p></div></div>
    <div className="account-identity" data-session-profile="true"><div className="avatar">{accountTitle.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC"}</div><div><strong>{accountTitle}</strong><span>{accountSubtitle}</span></div></div>
    {loadState !== "ready" ? <SettingsDataNotice state={loadState} error={loadError} onRetry={() => void loadMySettings(true)} /> : <form onSubmit={save}>
      <section className={styles.preferenceSection} aria-labelledby="personal-defaults-heading">
        <div className={styles.sectionHeading}><div><h3 id="personal-defaults-heading">Personal defaults</h3><p>These settings already have active consumers in the Overview and Gmail draft workflows.</p></div><FeatureStateBadge state="Working" /></div>
        <div className="form-row"><label>My display timezone<select value={preferences.displayTimezone} onChange={(event) => setPreferences((current) => ({ ...current, displayTimezone: event.target.value }))} disabled={saving}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select><small className={styles.fieldHelp}><Clock3 size={13} aria-hidden="true" /> Used for the Overview greeting and time context.</small></label><label>Default reply signature<textarea value={preferences.replySignature} onChange={(event) => setPreferences((current) => ({ ...current, replySignature: event.target.value }))} placeholder="Name, title, phone, and company" maxLength={2000} disabled={saving} /><small className={styles.fieldHelp}><Reply size={13} aria-hidden="true" /> Added to new Gmail reply drafts.</small></label></div>
      </section>
      <fieldset className={styles.notificationSection} aria-describedby="personal-notifications-planned-note">
        <legend><span><BellRing size={16} aria-hidden="true" /> My notification preferences</span></legend>
        <p id="personal-notifications-planned-note">These choices are saved for a future personal-notification consumer. Google Chat currently uses organization-level space routing only, so changing these choices does not alter delivery yet.</p>
        <div className={styles.notificationList}>
          {USER_NOTIFICATION_PREFERENCE_CATALOG.map((item) => <label className={styles.notificationRow} data-preference-consumer="planned" key={item.key}><input type="checkbox" checked={preferences.notificationPreferences[item.key]} onChange={(event) => setPreferences((current) => ({ ...current, notificationPreferences: { ...current.notificationPreferences, [item.key]: event.target.checked } }))} disabled={saving} /><span><strong>{item.label}</strong><small>{item.description}</small></span><FeatureStateBadge state="Planned" /></label>)}
        </div>
      </fieldset>
      <p className="form-help"><UserRound size={14} aria-hidden="true" /> This route reads and writes only the row owned by your authenticated account. Administrators use the separate company setup sections for organization-wide settings.</p>
      <footer><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : <><Check size={15} /> Save my settings</>}</button></footer>
    </form>}
  </section>;
}
