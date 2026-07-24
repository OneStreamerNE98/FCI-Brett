"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Building2, CalendarDays, Check, Mail, ShieldCheck } from "lucide-react";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { AiAssistantSettingsCard } from "./AiAssistantSettingsCard";
import { ChatNotificationSettingsCard } from "./ChatNotificationSettingsCard";
import { SettingsDataNotice } from "./SettingsDataNotice";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type LoadState = "loading" | "ready" | "error";
type WorkspacePreferenceValues = {
  timezone: string;
  appointmentCalendarName: string;
  fieldCalendarName: string;
  calendarSetupMode: "create-shared" | "use-existing";
  appointmentCalendarId: string;
  fieldCalendarId: string;
  calendarEditPolicy: "app-authoritative";
  appointmentReminderHours: number;
  crewReminderHours: number;
  inboxReviewMode: "review-first";
  officeNotificationEmail: string;
};
const defaultWorkspacePreferences: WorkspacePreferenceValues = {
  timezone: "America/New_York",
  appointmentCalendarName: "FCI • Client Appointments",
  fieldCalendarName: "FCI • Field Schedule",
  calendarSetupMode: "create-shared",
  appointmentCalendarId: "",
  fieldCalendarId: "",
  calendarEditPolicy: "app-authoritative",
  appointmentReminderHours: 24,
  crewReminderHours: 24,
  inboxReviewMode: "review-first",
  officeNotificationEmail: "",
};

function WorkflowSettingsStack({ children, notify, isAdmin }: { children: ReactNode; notify: Notify; isAdmin: boolean }) {
  return <div className="settings-panel-stack">
    {children}
    <AiAssistantSettingsCard notify={notify} isAdmin={isAdmin} />
    <ChatNotificationSettingsCard notify={notify} isAdmin={isAdmin} />
  </div>;
}

export function WorkspaceDefaultsPanel({ mode, notify, onGoogleSetup, isAdmin }: { mode: "calendar" | "workflow"; notify: Notify; onGoogleSetup: () => void; isAdmin: boolean }) {
  const [settings, setSettings] = useState<WorkspacePreferenceValues>(defaultWorkspacePreferences);
  const [saving, setSaving] = useState(false);
  const [calendarAccount, setCalendarAccount] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const loadRequestRef = useRef(0);

  const loadWorkspaceSettings = useCallback(async (force = false) => {
    const requestId = ++loadRequestRef.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const [settingsData, googleData] = await Promise.all([
        cachedGetJson<{ settings?: WorkspacePreferenceValues }>("/api/v1/settings/workspace", { force }),
        cachedGetJson<{ workspace?: { connectionAccount?: unknown; calendarConnected?: boolean; calendarEnabled?: boolean; connectionStatus?: string } }>("/api/v1/google-workspace", { force }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (!settingsData.settings) throw new Error("The server returned no saved Workspace defaults.");
      setSettings({ ...defaultWorkspacePreferences, ...settingsData.settings });
      setCalendarAccount(typeof googleData.workspace?.connectionAccount === "string" ? googleData.workspace.connectionAccount : null);
      setCalendarConnected(googleData.workspace?.calendarConnected === true && googleData.workspace?.calendarEnabled === true && googleData.workspace?.connectionStatus === "connected");
      setLoadState("ready");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(error instanceof Error ? error.message : "The saved Workspace defaults could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadWorkspaceSettings());
    return () => { loadRequestRef.current += 1; };
  }, [loadWorkspaceSettings]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || loadState !== "ready") return;
    setSaving(true);
    try {
      const response = await fetch("/api/v1/settings/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json().catch(() => ({})) as { settings?: WorkspacePreferenceValues; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error ?? "Settings could not be saved.");
      invalidateCachedGet("/api/v1/settings/workspace");
      setSettings({ ...defaultWorkspacePreferences, ...data.settings });
      notify(mode === "calendar" ? "Calendar defaults saved" : "Workflow and notification defaults saved", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Settings could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }
  if (loadState !== "ready") {
    const panel = <section className="panel settings-form-panel">
      <div className="settings-heading">
        <div><p className="eyebrow">{mode === "calendar" ? "Organization calendar plan" : "Operating defaults"}</p><h2>{mode === "calendar" ? "Calendar & appointments" : "Workflow & notifications"}</h2><p>{mode === "calendar" ? "Keep company work in two shared FCI Workspace calendars: one for client appointments and one for field scheduling." : "Set simple defaults for the office. These are saved now and will be used by appointment and field-message automation as it is enabled."}</p></div>
        <button className="soft-button" type="button" onClick={onGoogleSetup}><Building2 size={15} /> Google connection</button>
      </div>
      <SettingsDataNotice state={loadState} error={loadError} onRetry={() => void loadWorkspaceSettings(true)} />
    </section>;
    return mode === "workflow" ? <WorkflowSettingsStack notify={notify} isAdmin={isAdmin}>{panel}</WorkflowSettingsStack> : panel;
  }
  if (mode === "calendar") {
    return <section className="panel settings-form-panel">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">Organization calendar plan</p>
          <h2>Calendar & appointments</h2>
          <p>Keep company work in two shared FCI Workspace calendars: one for client appointments and one for field scheduling.</p>
        </div>
        <button className="soft-button" type="button" onClick={onGoogleSetup}><Building2 size={15} /> Google connection</button>
      </div>
      <div className={`settings-connection ${calendarConnected ? "ready" : ""}`}>
        <CalendarDays size={18} />
        <div>
          <strong>{calendarConnected ? "Google Calendar connection ready" : "Google Calendar connection required"}</strong>
          <span>{calendarConnected ? `${calendarAccount ?? "Connected Workspace account"} can access Google Calendar. Verify both shared calendar IDs before appointment testing.` : "Connect Google Workspace and approve Calendar before publishing appointments."}</span>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="settings-static-row">
          <CalendarDays size={16} />
          <div><strong>Recommended setup</strong><span>Create or select one shared <b>FCI • Client Appointments</b> calendar and one shared <b>FCI • Field Schedule</b> calendar. Do not create one calendar per user; invite assigned people to the same company event instead.</span></div>
        </div>
        <div className="form-row">
          <label>Calendar setup<select value={settings.calendarSetupMode} onChange={(event) => setSettings((current) => ({ ...current, calendarSetupMode: event.target.value as WorkspacePreferenceValues["calendarSetupMode"] }))}><option value="create-shared">Plan to create two shared FCI calendars (recommended)</option><option value="use-existing">Use existing company calendars</option></select></label>
          <label>Workspace timezone<select value={settings.timezone} onChange={(event) => setSettings((current) => ({ ...current, timezone: event.target.value }))}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></label>
        </div>
        <div className="form-row">
          <label>Client appointments calendar name<input value={settings.appointmentCalendarName} onChange={(event) => setSettings((current) => ({ ...current, appointmentCalendarName: event.target.value }))} /></label>
          <label>Field schedule calendar name<input value={settings.fieldCalendarName} onChange={(event) => setSettings((current) => ({ ...current, fieldCalendarName: event.target.value }))} /></label>
        </div>
        {settings.calendarSetupMode === "use-existing" && <div className="form-row">
          <label>Client appointments calendar ID<input value={settings.appointmentCalendarId} onChange={(event) => setSettings((current) => ({ ...current, appointmentCalendarId: event.target.value }))} placeholder="Calendar ID, not an event ID" /></label>
          <label>Field schedule calendar ID<input value={settings.fieldCalendarId} onChange={(event) => setSettings((current) => ({ ...current, fieldCalendarId: event.target.value }))} placeholder="Calendar ID, not an event ID" /></label>
        </div>}
        <div className="form-row">
          <label>Appointment reminder hours<input type="number" min="0" max="168" value={settings.appointmentReminderHours} onChange={(event) => setSettings((current) => ({ ...current, appointmentReminderHours: Number(event.target.value) || 0 }))} /></label>
          <label>Scheduling source<input value="FCI Operations + shared Workspace calendars" readOnly /></label>
        </div>
        <div className="settings-static-row">
          <ShieldCheck size={16} />
          <div><strong>Sync & conflict policy</strong><span>FCI Operations will remain authoritative. A later edit to an app-created Google event will be flagged for review instead of silently overwriting the project schedule.</span></div>
        </div>
        <div className="settings-static-row">
          <Mail size={16} />
          <div><strong>Gmail relationship</strong><span>Gmail and Calendar are separate. When a message becomes an appointment, the app will link the thread to the appointment; Gmail-generated travel or reservation events are never imported into the company schedule automatically.</span></div>
        </div>
        <p className="form-help"><CalendarDays size={14} /> Local simulation stores safe sample holds without contacting Google. Live mode uses the configured company calendar IDs and keeps FCI Operations authoritative.</p>
        <footer><AdministratorActionButton type="submit" className="primary-button" isAdmin={isAdmin} disabled={loadState !== "ready" || saving}>{saving ? "Saving…" : <><Check size={15} /> Save calendar plan</>}</AdministratorActionButton></footer>
      </form>
    </section>;
  }
  return <WorkflowSettingsStack notify={notify} isAdmin={isAdmin}>
    <section className="panel settings-form-panel">
      <div className="settings-heading">
        <div><p className="eyebrow">Operating defaults</p><h2>Workflow & notifications</h2><p>Set simple defaults for the office. These are saved now and will be used by appointment and field-message automation as it is enabled.</p></div>
        <button className="soft-button" type="button" onClick={onGoogleSetup}><Building2 size={15} /> Google connection</button>
      </div>
      <form onSubmit={save}>
        <div className="form-row">
          <label>Client reminder hours<input type="number" min="0" max="168" value={settings.appointmentReminderHours} onChange={(event) => setSettings((current) => ({ ...current, appointmentReminderHours: Number(event.target.value) || 0 }))} /></label>
          <label>Crew reminder hours<input type="number" min="0" max="168" value={settings.crewReminderHours} onChange={(event) => setSettings((current) => ({ ...current, crewReminderHours: Number(event.target.value) || 0 }))} /></label>
        </div>
        <label>Office notification email<input type="email" value={settings.officeNotificationEmail} onChange={(event) => setSettings((current) => ({ ...current, officeNotificationEmail: event.target.value }))} placeholder="office@example.com" /></label>
        <div className="settings-static-row"><ShieldCheck size={16} /><div><strong>Inbox action policy</strong><span>Review-first is enforced: no email is automatically archived, labeled Filed, or copied to a project without an explicit project selection and confirmation.</span></div></div>
        <footer><AdministratorActionButton type="submit" className="primary-button" isAdmin={isAdmin} disabled={loadState !== "ready" || saving}>{saving ? "Saving…" : <><Check size={15} /> Save defaults</>}</AdministratorActionButton></footer>
      </form>
    </section>
  </WorkflowSettingsStack>;
}

