"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Building2, CalendarDays, Check, Mail, ShieldCheck } from "lucide-react";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { FeatureStateBadge } from "../../components/FeatureStateBadge";
import { WorkspaceInfoHint } from "../../components/WorkspaceInfoHint";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { ChatNotificationSettingsCard } from "./ChatNotificationSettingsCard";
import { SettingsDataNotice } from "./SettingsDataNotice";
import styles from "./WorkspaceDefaultsPanel.module.css";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type LoadState = "loading" | "ready" | "error";
type CalendarConfigurationState = Readonly<{
  configured: boolean;
  source: "app" | "env" | "none";
  /** The id runtime actually resolves. `source` cannot distinguish an adopted registry row
   *  from the saved setting — both are "app" — and the registry row wins, so this is the only
   *  way the panel can tell the operator which value is really in force. */
  externalId?: string | null;
}>;
type WorkspacePreferenceValues = {
  timezone: string;
  appointmentCalendarName: string;
  fieldCalendarName: string;
  calendarSetupMode: "create-shared" | "use-existing";
  appointmentCalendarId: string;
  fieldCalendarId: string;
  calendarEditPolicy: "app-authoritative";
  appointmentReminderHours: number;
  clientReminderHours: number;
  crewReminderHours: number;
  inboxReviewMode: "review-first";
  intakeMailbox: string;
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
  clientReminderHours: 24,
  crewReminderHours: 24,
  inboxReviewMode: "review-first",
  intakeMailbox: "",
  officeNotificationEmail: "",
};

const PLANNED_AUTOMATION_COPY = "Saved for the upcoming reminder worker — nothing sends yet";
const APPOINTMENT_REMINDER_HINT = "How many hours ahead a reminder is planned to go out. Saved now; reminder sending is not built yet.";
const CLIENT_REMINDER_HINT = "Hours before a client appointment a reminder is planned to send. Saved as a default; sending is not built yet.";
const CREW_REMINDER_HINT = "Hours before a scheduled field day a crew reminder is planned to send. Saved as a default; sending is not built yet.";

function PlannedSettingField({
  id,
  label,
  hint,
  hintAnchor = "right",
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  hintAnchor?: "left" | "right" | "auto";
  children: ReactNode;
}) {
  const descriptionId = `${id}-planned-note`;
  return <div className={styles.plannedField} data-setting-consumer="planned">
    <div className={styles.plannedFieldHeader}>
      <div className={styles.plannedFieldLabel}>
        <label htmlFor={id}>{label}</label>
        {hint && <WorkspaceInfoHint label={`About ${label.toLowerCase()}`} text={hint} anchor={hintAnchor} />}
      </div>
      <FeatureStateBadge state="Planned" />
    </div>
    {children}
    <small id={descriptionId}>{PLANNED_AUTOMATION_COPY}</small>
  </div>;
}

function WorkflowSettingsStack({ children, notify, isAdmin }: { children: ReactNode; notify: Notify; isAdmin: boolean }) {
  return <div className="settings-panel-stack">
    {children}
    <ChatNotificationSettingsCard notify={notify} isAdmin={isAdmin} />
  </div>;
}

export function WorkspaceDefaultsPanel({ mode, notify, onGoogleSetup, isAdmin }: { mode: "calendar" | "workflow"; notify: Notify; onGoogleSetup: () => void; isAdmin: boolean }) {
  const [settings, setSettings] = useState<WorkspacePreferenceValues>(defaultWorkspacePreferences);
  const [saving, setSaving] = useState(false);
  const [verifyingCalendar, setVerifyingCalendar] = useState<"client-appointments" | "field-schedule" | null>(null);
  const [calendarAccount, setCalendarAccount] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarConfiguration, setCalendarConfiguration] = useState<Readonly<{
    clientAppointments: CalendarConfigurationState;
    fieldSchedule: CalendarConfigurationState;
  }> | null>(null);
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
        cachedGetJson<{ workspace?: { connectionAccount?: unknown; calendarConnected?: boolean; calendarEnabled?: boolean; connectionStatus?: string; calendars?: { clientAppointments?: CalendarConfigurationState; fieldSchedule?: CalendarConfigurationState } } }>("/api/v1/google-workspace", { force }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (!settingsData.settings) throw new Error("The server returned no saved Workspace defaults.");
      setSettings({ ...defaultWorkspacePreferences, ...settingsData.settings });
      setCalendarAccount(typeof googleData.workspace?.connectionAccount === "string" ? googleData.workspace.connectionAccount : null);
      setCalendarConnected(googleData.workspace?.calendarConnected === true && googleData.workspace?.calendarEnabled === true && googleData.workspace?.connectionStatus === "connected");
      setCalendarConfiguration({
        clientAppointments: googleData.workspace?.calendars?.clientAppointments ?? { configured: false, source: "none", externalId: null },
        fieldSchedule: googleData.workspace?.calendars?.fieldSchedule ?? { configured: false, source: "none", externalId: null },
      });
      setLoadState("ready");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(error instanceof Error ? error.message : "The saved Workspace defaults could not be loaded.");
      setLoadState("error");
    }
  }, []);

  function calendarConfigurationLabel(value: CalendarConfigurationState | undefined, typed: string) {
    if (!value?.configured || value.source === "none") return "Not configured";
    if (value.source === "env") return "In use (environment value — saving here will override it)";
    // A verified calendar is stored as a workspace_resources row, and that row outranks the
    // saved setting — so saving a different id here does NOT change what runtime uses. Saying
    // "In use (saved setting)" in that state is false, and it is the state a second edit
    // always lands in. Name the divergence and the id, rather than implying the field wins.
    const effective = value.externalId?.trim();
    if (effective && typed.trim() && effective !== typed.trim()) {
      return `In use: ${effective} — a verified calendar overrides the ID shown here. Verify this ID to switch.`;
    }
    return "In use (saved setting)";
  }

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
      invalidateCachedGet("/api/v1/google-workspace");
      setSettings({ ...defaultWorkspacePreferences, ...data.settings });
      await loadWorkspaceSettings(true);
      notify(mode === "calendar" ? "Calendar defaults saved" : "Workflow and notification defaults saved", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Settings could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function verifyCalendar(calendarKey: "client-appointments" | "field-schedule", calendarId: string) {
    if (!isAdmin || !calendarId.trim()) return;
    setVerifyingCalendar(calendarKey);
    try {
      const response = await fetch("/api/v1/integrations/google/calendar/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarKey, calendarId }),
      });
      const data = await response.json().catch(() => ({})) as {
        verified?: boolean; simulated?: boolean; calendar?: { name?: string; id?: string }; error?: string;
      };
      if (!response.ok || !data.verified) throw new Error(data.error ?? "The calendar could not be verified.");
      invalidateCachedGet("/api/v1/google-workspace");
      const name = data.calendar?.name ?? "Workspace calendar";
      // In simulation the route returns early and persists nothing (calendar/verify/route.ts),
      // so "saved for use" was false there — and the label underneath still read "Not
      // configured", contradicting the toast on the same screen.
      notify(
        data.simulated
          ? `${name} verified. Simulation does not save a calendar — nothing was adopted.`
          : `${name} verified and now in use.`,
        "success",
      );
      // Adoption made the typed id runtime-authoritative. Reloading settings would repaint the
      // field with the *saved* value, leaving the screen showing one id while another drives
      // every appointment write. Keep the field on what was actually adopted.
      const adopted = data.simulated ? null : (data.calendar?.id ?? calendarId).trim();
      await loadWorkspaceSettings(true);
      // Applied AFTER the reload, not before: loadWorkspaceSettings repaints every field from
      // workspace_settings, so setting this first would simply be overwritten.
      if (adopted) {
        setSettings((current) => (calendarKey === "client-appointments"
          ? { ...current, appointmentCalendarId: adopted }
          : { ...current, fieldCalendarId: adopted }));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "The calendar could not be verified.", "error");
    } finally {
      setVerifyingCalendar(null);
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
        <div className="form-row">
          <label>Client appointments calendar ID<input value={settings.appointmentCalendarId} onChange={(event) => setSettings((current) => ({ ...current, appointmentCalendarId: event.target.value }))} placeholder="Calendar ID, not an event ID" /><small>{calendarConfigurationLabel(calendarConfiguration?.clientAppointments, settings.appointmentCalendarId)}</small><AdministratorActionButton type="button" className="soft-button" isAdmin={isAdmin} disabled={!settings.appointmentCalendarId.trim() || verifyingCalendar !== null} onClick={() => void verifyCalendar("client-appointments", settings.appointmentCalendarId)}>{verifyingCalendar === "client-appointments" ? "Verifying…" : "Verify calendar"}</AdministratorActionButton></label>
          <label>Field schedule calendar ID<input value={settings.fieldCalendarId} onChange={(event) => setSettings((current) => ({ ...current, fieldCalendarId: event.target.value }))} placeholder="Calendar ID, not an event ID" /><small>{calendarConfigurationLabel(calendarConfiguration?.fieldSchedule, settings.fieldCalendarId)}</small><AdministratorActionButton type="button" className="soft-button" isAdmin={isAdmin} disabled={!settings.fieldCalendarId.trim() || verifyingCalendar !== null} onClick={() => void verifyCalendar("field-schedule", settings.fieldCalendarId)}>{verifyingCalendar === "field-schedule" ? "Verifying…" : "Verify calendar"}</AdministratorActionButton></label>
        </div>
        <div className="form-row">
          <PlannedSettingField id="appointment-reminder-hours" label="Appointment reminder hours" hint={APPOINTMENT_REMINDER_HINT} hintAnchor="auto">
            <input id="appointment-reminder-hours" aria-describedby="appointment-reminder-hours-planned-note" type="number" min="0" max="168" value={settings.appointmentReminderHours} onChange={(event) => setSettings((current) => ({ ...current, appointmentReminderHours: Number(event.target.value) || 0 }))} />
          </PlannedSettingField>
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
          <PlannedSettingField id="client-reminder-hours" label="Client reminder hours" hint={CLIENT_REMINDER_HINT} hintAnchor="auto">
            <input id="client-reminder-hours" aria-describedby="client-reminder-hours-planned-note" type="number" min="0" max="168" value={settings.clientReminderHours} onChange={(event) => setSettings((current) => ({ ...current, clientReminderHours: Number(event.target.value) || 0 }))} />
          </PlannedSettingField>
          <PlannedSettingField id="crew-reminder-hours" label="Crew reminder hours" hint={CREW_REMINDER_HINT} hintAnchor="right">
            <input id="crew-reminder-hours" aria-describedby="crew-reminder-hours-planned-note" type="number" min="0" max="168" value={settings.crewReminderHours} onChange={(event) => setSettings((current) => ({ ...current, crewReminderHours: Number(event.target.value) || 0 }))} />
          </PlannedSettingField>
        </div>
        <PlannedSettingField id="office-notification-email" label="Office notification email">
          <input id="office-notification-email" aria-describedby="office-notification-email-planned-note" type="email" value={settings.officeNotificationEmail} onChange={(event) => setSettings((current) => ({ ...current, officeNotificationEmail: event.target.value }))} placeholder="office@example.com" />
        </PlannedSettingField>
        <div className="settings-static-row"><ShieldCheck size={16} /><div><strong>Inbox action policy</strong><span>Review-first is enforced: no email is automatically archived, labeled Filed, or copied to a project without an explicit project selection and confirmation.</span></div></div>
        <footer><AdministratorActionButton type="submit" className="primary-button" isAdmin={isAdmin} disabled={loadState !== "ready" || saving}>{saving ? "Saving…" : <><Check size={15} /> Save defaults</>}</AdministratorActionButton></footer>
      </form>
    </section>
  </WorkflowSettingsStack>;
}
