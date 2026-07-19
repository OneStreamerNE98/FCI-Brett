"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Building2, Check, Reply } from "lucide-react";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { SettingsDataNotice } from "./SettingsDataNotice";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type LoadState = "loading" | "ready" | "error";
type UserAccountPreferences = { displayTimezone: string; replySignature: string };
const defaultUserAccountPreferences: UserAccountPreferences = { displayTimezone: "America/New_York", replySignature: "" };

export function MyAccountPanel({ notify, userName, userEmail, onGoogleSetup, onTimezoneChange }: { notify: Notify; userName: string; userEmail: string; onGoogleSetup: () => void; onTimezoneChange: (timezone: string) => void }) {
  const [preferences, setPreferences] = useState<UserAccountPreferences>(defaultUserAccountPreferences);
  const [connectionAccount, setConnectionAccount] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const loadRequestRef = useRef(0);
  const hasDistinctDisplayName = Boolean(userName.trim()) && userName.trim().toLowerCase() !== userEmail.trim().toLowerCase();
  const accountTitle = hasDistinctDisplayName ? userName.trim() : "FCI operations account";
  const accountSubtitle = hasDistinctDisplayName ? userEmail : `${userEmail} · FCI Operations workspace`;

  const loadAccountSettings = useCallback(async (force = false) => {
    const requestId = ++loadRequestRef.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const [preferenceData, googleData] = await Promise.all([
        cachedGetJson<{ preferences?: UserAccountPreferences }>("/api/v1/settings/me", { force }),
        cachedGetJson<{ workspace?: { connectionAccount?: unknown } }>("/api/v1/google-workspace", { force }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (!preferenceData.preferences) throw new Error("The server returned no saved account preferences.");
      const nextPreferences = { ...defaultUserAccountPreferences, ...preferenceData.preferences };
      setPreferences(nextPreferences);
      setConnectionAccount(typeof googleData.workspace?.connectionAccount === "string" ? googleData.workspace.connectionAccount : null);
      onTimezoneChange(nextPreferences.displayTimezone);
      setLoadState("ready");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(error instanceof Error ? error.message : "Your saved account preferences could not be loaded.");
      setLoadState("error");
    }
  }, [onTimezoneChange]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAccountSettings());
    return () => { loadRequestRef.current += 1; };
  }, [loadAccountSettings]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadState !== "ready") return;
    setSaving(true);
    try {
      const response = await fetch("/api/v1/settings/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences) });
      const data = await response.json().catch(() => ({})) as { preferences?: UserAccountPreferences; error?: string };
      if (!response.ok || !data.preferences) throw new Error(data.error ?? "Your account preferences could not be saved.");
      invalidateCachedGet("/api/v1/settings/me");
      setPreferences({ ...defaultUserAccountPreferences, ...data.preferences });
      onTimezoneChange(data.preferences.displayTimezone);
      notify("Your preferences are saved to your signed-in FCI account", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Your account preferences could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel settings-form-panel"><div className="settings-heading"><div><p className="eyebrow">Signed-in account</p><h2>My account</h2><p>Your timezone and reply signature are saved to this FCI account and follow you between browsers.</p></div></div><div className="account-identity"><div className="avatar">{accountTitle.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "FC"}</div><div><strong>{accountTitle}</strong><span>{accountSubtitle}</span></div></div>{loadState !== "ready" ? <SettingsDataNotice state={loadState} error={loadError} onRetry={() => void loadAccountSettings(true)} /> : <form onSubmit={save}><div className="form-row"><label>My display timezone<select value={preferences.displayTimezone} onChange={(event) => setPreferences((current) => ({ ...current, displayTimezone: event.target.value }))} disabled={saving}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></label><label>Workspace connection<input value={connectionAccount ?? "Not connected"} readOnly /></label></div><label>Default reply signature<textarea value={preferences.replySignature} onChange={(event) => setPreferences((current) => ({ ...current, replySignature: event.target.value }))} placeholder="Name, title, phone, and company" maxLength={2000} disabled={saving} /></label><p className="form-help"><Reply size={14} /> Local simulation never connects a Google account. When the company Workspace is ready, one administrator-approved connection supplies Gmail, Calendar, Shared Drive, and Sheets.</p><footer><button type="button" className="soft-button" onClick={onGoogleSetup}><Building2 size={15} /> Manage Google Workspace</button><button type="submit" className="primary-button" disabled={loadState !== "ready" || saving}>{saving ? "Saving…" : <><Check size={15} /> Save my preferences</>}</button></footer></form>}</section>;
}

