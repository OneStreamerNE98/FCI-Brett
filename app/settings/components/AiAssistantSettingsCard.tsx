"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Database, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { FeatureStateBadge } from "../../components/FeatureStateBadge";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { SettingsDataNotice } from "./SettingsDataNotice";
import styles from "./AiAssistantSettingsCard.module.css";

const ASSISTANT_CONFIG_URL = "/api/v1/assistant/config";
const AI_FEATURES = [
  { key: "orgQa", label: "Organization-wide answers", state: "In development" },
  { key: "triage", label: "Inbox filing suggestions", state: "In development" },
  { key: "inboxAnalysis", label: "Inbox analysis", state: "In development" },
  { key: "replyDrafts", label: "Reply drafting", state: "Planned" },
  { key: "taskExtraction", label: "Task extraction from meetings", state: "Planned" },
] as const;

type AiFeatureKey = (typeof AI_FEATURES)[number]["key"];
type AiFeatures = Record<AiFeatureKey, boolean>;
type AssistantConfig = {
  provider: "openai";
  keyState: "Configured" | "Missing";
  model: string;
  modelSource: "app" | "environment" | "none";
  savedModel: string | null;
  features: AiFeatures;
};
type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type LoadState = "loading" | "ready" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAssistantConfig(value: unknown): AssistantConfig {
  if (!isRecord(value) || value.provider !== "openai") {
    throw new Error("The server returned an invalid AI assistant configuration.");
  }
  if (value.keyState !== "Configured" && value.keyState !== "Missing") {
    throw new Error("The server returned an invalid AI key state.");
  }
  if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 200) {
    throw new Error("The server returned an invalid AI model name.");
  }
  const modelSource = value.modelSource === "app" || value.modelSource === "environment"
    ? value.modelSource
    : "none";
  const savedModel = typeof value.savedModel === "string" && value.savedModel.trim()
    ? value.savedModel.trim().slice(0, 200)
    : null;
  if (!isRecord(value.features)) {
    throw new Error("The server returned no AI feature settings.");
  }
  const featureValues = value.features;
  const features = Object.fromEntries(AI_FEATURES.map(({ key }) => {
    if (typeof featureValues[key] !== "boolean") {
      throw new Error("The server returned incomplete AI feature settings.");
    }
    return [key, featureValues[key]];
  })) as AiFeatures;
  return {
    provider: "openai",
    keyState: value.keyState,
    model: value.model.trim(),
    modelSource,
    savedModel,
    features,
  };
}

export function AiAssistantSettingsCard({ notify, isAdmin }: { notify: Notify; isAdmin: boolean }) {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [features, setFeatures] = useState<AiFeatures | null>(null);
  const [model, setModel] = useState("");
  const [modelDirty, setModelDirty] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const loadRequestRef = useRef(0);

  const loadConfig = useCallback(async (force = false) => {
    const requestId = ++loadRequestRef.current;
    setLoadState("loading");
    setLoadError("");
    try {
      const nextConfig = parseAssistantConfig(
        await cachedGetJson<unknown>(ASSISTANT_CONFIG_URL, { force }),
      );
      if (requestId !== loadRequestRef.current) return;
      setConfig(nextConfig);
      setFeatures({ ...nextConfig.features });
      setModel(nextConfig.modelSource === "environment"
        ? nextConfig.savedModel ?? ""
        : nextConfig.savedModel ?? nextConfig.model);
      setModelDirty(false);
      setLoadState("ready");
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      setConfig(null);
      setFeatures(null);
      setModel("");
      setModelDirty(false);
      setLoadError(
        error instanceof Error
          ? error.message
          : "AI assistant configuration could not be loaded.",
      );
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadConfig());
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadConfig]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !features || !isAdmin || config.keyState !== "Configured") return;
    setSaving(true);
    try {
      const response = await fetch(ASSISTANT_CONFIG_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features,
          ...(modelDirty ? { model } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as unknown;
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === "string"
          ? body.error
          : "AI assistant settings could not be saved.";
        throw new Error(message);
      }
      const savedConfig = parseAssistantConfig(body);
      invalidateCachedGet(ASSISTANT_CONFIG_URL);
      setConfig(savedConfig);
      setFeatures({ ...savedConfig.features });
      setModel(savedConfig.modelSource === "environment"
        ? savedConfig.savedModel ?? ""
        : savedConfig.savedModel ?? savedConfig.model);
      setModelDirty(false);
      notify("AI assistant settings saved", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "AI assistant settings could not be saved.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  const ready = loadState === "ready" && config && features;
  const editable = Boolean(ready && isAdmin && config.keyState === "Configured");

  return <section className={`panel settings-form-panel ${styles.card}`} aria-labelledby="ai-assistant-settings-title">
    <div className="settings-heading">
      <div>
        <p className="eyebrow">Assistant configuration</p>
        <h2 id="ai-assistant-settings-title">AI assistant</h2>
        <p>Review the provider and choose which assistant feature switches are saved.</p>
      </div>
      <Bot size={22} aria-hidden="true" />
    </div>

    {!ready ? <SettingsDataNotice
      state={loadState === "ready" ? "error" : loadState}
      error={loadError || "AI assistant configuration could not be loaded."}
      onRetry={() => void loadConfig(true)}
    /> : <>
      <dl className={styles.summary} aria-label="AI provider status">
        <div><dt>Provider</dt><dd>OpenAI</dd></div>
        <div><dt>API key</dt><dd><span className={config.keyState === "Configured" ? styles.configured : styles.missing}><KeyRound size={14} aria-hidden="true" /> {config.keyState}</span></dd></div>
        <div><dt>Model</dt><dd><code>{config.model}</code></dd></div>
        <div><dt>Model source</dt><dd>{config.modelSource === "app" ? "App-saved" : config.modelSource === "environment" ? "Environment" : "None (default)"}</dd></div>
      </dl>

      {config.keyState === "Missing" && <div className={styles.missingNote} role="note">
        <KeyRound size={18} aria-hidden="true" />
        <p>Add OPENAI_API_KEY to the hosting environment to enable AI features. Everything else keeps working without it.</p>
      </div>}

      {!isAdmin && <div className={styles.readOnlyNote} role="note">
        <ShieldCheck size={17} aria-hidden="true" />
        <div><strong>Read-only AI settings</strong><span>Office users can review availability. Only Administrators can change organization-wide feature switches.</span></div>
      </div>}

      <div className={styles.dataAtRestNote} role="note">
        <Database size={17} aria-hidden="true" />
        <div><strong>Data stored by Inbox analysis</strong><span>Inbox analysis stores the email subject, sender, received date, and analysis result in the app database. This can include customer names and subject lines. Turning Inbox analysis off stops future sweeps but does not erase saved results.</span></div>
      </div>

      {isAdmin ? <form onSubmit={save}>
        <label htmlFor="assistant-model">{config.modelSource === "environment" ? "App-saved fallback model" : "OpenAI model"}
          <input
            id="assistant-model"
            value={model}
            onChange={(event) => { setModel(event.target.value); setModelDirty(true); }}
            disabled={!editable || saving || config.modelSource === "environment"}
            maxLength={200}
            spellCheck={false}
            autoComplete="off"
          />
          <small>{config.modelSource === "environment"
            ? `Hosted OPENAI_MODEL is the active emergency override. ${config.savedModel ? "The saved fallback is preserved and cannot be overwritten from this screen until the override is removed." : "No app-saved fallback is set; remove the override before choosing one here."}`
            : "Validated with OpenAI only when changed. A hosted OPENAI_MODEL, when present, becomes the emergency override."}</small>
        </label>
        <fieldset className={styles.featureFieldset} disabled={!editable || saving}>
          <legend><Sparkles size={16} aria-hidden="true" /> AI features</legend>
          <div className={styles.featureList}>
            {AI_FEATURES.map(({ key, label, state }) => <label key={key}>
              <input
                type="checkbox"
                checked={features[key]}
                onChange={(changeEvent) => setFeatures((current) => current
                  ? { ...current, [key]: changeEvent.target.checked }
                  : current)}
              />
              <span className={styles.featureName}>{label}</span>
              <FeatureStateBadge state={state} />
            </label>)}
          </div>
        </fieldset>
        <p className={styles.footerCaption}>The assistant reads saved records and drafts text. It never sends email, never files messages, and never creates records without your confirmation.</p>
        <footer>
          <button className="primary-button" type="submit" disabled={!editable || saving}>
            {saving ? "Saving…" : <><Check size={15} aria-hidden="true" /> Save AI settings</>}
          </button>
        </footer>
      </form> : <>
        <div className={styles.readOnlyFeatures} aria-label="AI feature states">
          {AI_FEATURES.map(({ key, label, state }) => <div key={key}>
            <span className={styles.featureName}>{label}</span>
            <span className={styles.featureState}><FeatureStateBadge state={state} /><strong>{features[key] ? "On" : "Off"}</strong></span>
          </div>)}
        </div>
        <p className={styles.footerCaption}>The assistant reads saved records and drafts text. It never sends email, never files messages, and never creates records without your confirmation.</p>
      </>}
    </>}
  </section>;
}
