"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, MessageSquare, ShieldCheck } from "lucide-react";
import { AdministratorActionButton } from "../../components/AdministratorActionButton";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { SettingsDataNotice } from "./SettingsDataNotice";

const CHAT_CONFIG_URL = "/api/v1/integrations/google/chat/config";
const CHAT_EVENT_TYPES = [
  "lead.created",
  "gmail.filing_review_needed",
  "calendar.schedule_changed",
  "project.warranty_follow_up_due",
] as const;

type ChatEventType = (typeof CHAT_EVENT_TYPES)[number];
type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type LoadState = "loading" | "ready" | "error";
type ChatMode = "disabled" | "simulation" | "webhook";
type ChatEventConfig = {
  type: ChatEventType;
  label: string;
  description: string;
  enabled: boolean;
  spaceKey: string;
};
type ChatSpaceConfig = {
  key: string;
  label: string;
  secretEnvVar: string;
  configured: boolean;
};
type MissingChatDetail = {
  label: string;
  envVar: string;
  secret: boolean;
};
type ChatNotificationConfig = {
  canEdit: boolean;
  mode: ChatMode;
  featureEnabled: boolean;
  events: ChatEventConfig[];
  spaces: ChatSpaceConfig[];
  missingDetails: MissingChatDetail[];
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatEventType(value: unknown): value is ChatEventType {
  return typeof value === "string" && CHAT_EVENT_TYPES.some((eventType) => eventType === value);
}

function safeText(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function parseChatConfig(value: unknown): ChatNotificationConfig {
  if (!isRecord(value)) throw new Error("The server returned an invalid Google Chat configuration.");
  const mode = value.mode;
  if (mode !== "disabled" && mode !== "simulation" && mode !== "webhook") {
    throw new Error("The server returned an invalid Google Chat mode.");
  }

  const spaces = Array.isArray(value.spaces) ? value.spaces.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const key = safeText(candidate.key, 32);
    const label = safeText(candidate.label, 80);
    const secretEnvVar = safeText(candidate.secretEnvVar, 100);
    if (!/^[a-z][a-z0-9_-]*$/.test(key) || !label || !/^GOOGLE_CHAT_[A-Z0-9_]+_WEBHOOK_URL$/.test(secretEnvVar)) return [];
    return [{ key, label, secretEnvVar, configured: candidate.configured === true }];
  }) : [];

  const events = Array.isArray(value.events) ? value.events.flatMap((candidate) => {
    if (!isRecord(candidate) || !isChatEventType(candidate.type)) return [];
    const label = safeText(candidate.label, 80);
    const description = safeText(candidate.description, 240);
    const spaceKey = safeText(candidate.spaceKey, 32);
    if (!label || !description || !spaces.some((space) => space.key === spaceKey)) return [];
    return [{ type: candidate.type, label, description, enabled: candidate.enabled === true, spaceKey }];
  }) : [];

  const missingDetails = Array.isArray(value.missingDetails) ? value.missingDetails.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const label = safeText(candidate.label, 80);
    const envVar = safeText(candidate.envVar, 100);
    if (!label || !/^GOOGLE_CHAT_[A-Z0-9_]+(?:_WEBHOOK_URL|_ENABLED)$/.test(envVar)) return [];
    return [{ label, envVar, secret: candidate.secret === true }];
  }) : [];

  if (spaces.length === 0 || events.length !== CHAT_EVENT_TYPES.length) {
    throw new Error("The server returned an incomplete Google Chat notification catalog.");
  }

  return {
    canEdit: value.canEdit === true,
    mode,
    featureEnabled: value.featureEnabled === true,
    events,
    spaces,
    missingDetails,
    updatedAt: safeText(value.updatedAt, 80),
  };
}

function modeSummary(config: ChatNotificationConfig) {
  if (!config.featureEnabled) {
    return { className: "disabled", label: "Off by default", detail: "The hosted Google Chat notification gate is off, so no messages or simulation events are scheduled." };
  }
  if (config.mode === "simulation") {
    return { className: "simulation", label: "Simulation log only", detail: "Enabled routes write sanitized integration audit events only. They never post a message to Google Chat." };
  }
  if (config.mode === "webhook") {
    return { className: "webhook", label: "Webhook delivery enabled", detail: "Enabled routes may post to their mapped space when that space's hosted secret is configured." };
  }
  return { className: "disabled", label: "Delivery disabled", detail: "This runtime does not deliver Google Chat notifications." };
}

export function ChatNotificationSettingsCard({ notify, isAdmin }: { notify: Notify; isAdmin: boolean }) {
  const [config, setConfig] = useState<ChatNotificationConfig | null>(null);
  const [events, setEvents] = useState<ChatEventConfig[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const loadRequestRef = useRef(0);

  const loadConfig = useCallback(async (force = false) => {
    const requestId = ++loadRequestRef.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const nextConfig = parseChatConfig(await cachedGetJson<unknown>(CHAT_CONFIG_URL, { force }));
      if (requestId !== loadRequestRef.current) return;
      setConfig(nextConfig);
      setEvents(nextConfig.events.map((event) => ({ ...event })));
      setLoadState("ready");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setConfig(null);
      setEvents([]);
      setLoadError(error instanceof Error ? error.message : "Google Chat notification routing could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadConfig());
    return () => { loadRequestRef.current += 1; };
  }, [loadConfig]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || loadState !== "ready" || !isAdmin || !config.canEdit) return;
    setSaving(true);
    try {
      const response = await fetch(CHAT_CONFIG_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: events.map(({ type, enabled, spaceKey }) => ({ type, enabled, spaceKey })) }),
      });
      const responseBody = await response.json().catch(() => ({})) as unknown;
      if (!response.ok) {
        const message = isRecord(responseBody) ? safeText(responseBody.error, 240) : "";
        throw new Error(message || "Google Chat notification routing could not be saved.");
      }
      const savedConfig = parseChatConfig(responseBody);
      invalidateCachedGet(CHAT_CONFIG_URL);
      setConfig(savedConfig);
      setEvents(savedConfig.events.map((savedEvent) => ({ ...savedEvent })));
      notify("Google Chat notification routing saved", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Google Chat notification routing could not be saved.", "error");
    } finally {
      setSaving(false);
    }
  }

  function updateEvent(type: ChatEventType, update: Partial<Pick<ChatEventConfig, "enabled" | "spaceKey">>) {
    setEvents((current) => current.map((event) => event.type === type ? { ...event, ...update } : event));
  }

  const editable = Boolean(config && isAdmin && config.canEdit);
  const summary = config ? modeSummary(config) : null;

  return <section className="panel settings-form-panel chat-notification-settings" aria-labelledby="chat-notification-settings-title">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">One-way operations alerts</p>
        <h2 id="chat-notification-settings-title">Google Chat notifications</h2>
        <p>Review the closed event-to-space map. Hosted webhook secrets stay outside the browser, application data, logs, and source control.</p>
      </div>
      <MessageSquare size={22} aria-hidden="true" />
    </div>

    {loadState !== "ready" || !config || !summary ? <SettingsDataNotice
      state={loadState === "ready" ? "error" : loadState}
      error={loadError || "Google Chat notification routing could not be loaded."}
      onRetry={() => void loadConfig(true)}
    /> : <>
      <div className={`chat-mode-summary ${summary.className}`} role="status">
        <MessageSquare size={18} aria-hidden="true" />
        <div><strong>{summary.label}</strong><span>{summary.detail}</span></div>
      </div>

      {!editable && <div className="settings-static-row chat-read-only-note" role="note">
        <ShieldCheck size={17} aria-hidden="true" />
        <div><strong>Read-only notification routing</strong><span>Office users can review the same mapping and hosted-secret presence. Only Administrators can change event routing.</span></div>
      </div>}

      <div className="chat-secret-section" aria-labelledby="chat-secret-heading">
        <div className="chat-section-heading">
          <div><h3 id="chat-secret-heading">Hosted space configuration</h3><p>Only exact setting names and configured or missing presence are shown. Secret values never enter this page.</p></div>
          <span className="workspace-origin-tag secret">Hosted secrets</span>
        </div>
        <ul className="chat-secret-list">
          {config.spaces.map((space) => <li key={space.key}>
            <div><strong>{space.label}</strong><code>{space.secretEnvVar}</code></div>
            <span className={`chat-secret-status ${space.configured ? "ready" : "missing"}`}>{space.configured ? "Configured" : "Missing"}</span>
          </li>)}
        </ul>
        {config.missingDetails.length > 0 && <div className="chat-missing-details" role="note">
          <strong>Missing hosted configuration</strong>
          <ul>{config.missingDetails.map((detail) => <li key={detail.envVar}><code>{detail.envVar}</code><span>{detail.label} · {detail.secret ? "secret" : "setting"}</span></li>)}</ul>
        </div>}
      </div>

      <form onSubmit={save}>
        <fieldset className="chat-routing-fieldset" disabled={!editable || saving}>
          <legend>Event routing</legend>
          <p>Each event has one fixed, safe deep link back to FCI Operations. Routing stores only the space alias below.</p>
          <ul className="chat-routing-list">
            {events.map((chatEvent) => {
              const controlId = `chat-event-${chatEvent.type.replaceAll(".", "-")}`;
              return <li key={chatEvent.type}>
                <label className="settings-checkbox" htmlFor={controlId}>
                  <input id={controlId} type="checkbox" checked={chatEvent.enabled} onChange={(changeEvent) => updateEvent(chatEvent.type, { enabled: changeEvent.target.checked })} />
                  <span><strong>{chatEvent.label}</strong><small>{chatEvent.description}</small></span>
                </label>
                <label className="chat-space-select" htmlFor={`${controlId}-space`}>
                  <span>Chat space</span>
                  <select id={`${controlId}-space`} aria-label={`Chat space for ${chatEvent.label}`} value={chatEvent.spaceKey} onChange={(changeEvent) => updateEvent(chatEvent.type, { spaceKey: changeEvent.target.value })}>
                    {config.spaces.map((space) => <option key={space.key} value={space.key}>{space.label}</option>)}
                  </select>
                </label>
              </li>;
            })}
          </ul>
        </fieldset>
        <footer>
          <AdministratorActionButton type="submit" className="primary-button" isAdmin={isAdmin} disabled={!editable || saving}>
            {saving ? "Saving…" : <><Check size={15} aria-hidden="true" /> Save Chat routing</>}
          </AdministratorActionButton>
        </footer>
      </form>
    </>}
  </section>;
}
