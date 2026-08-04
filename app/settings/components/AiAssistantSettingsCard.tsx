"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Database, KeyRound, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { FeatureStateBadge } from "../../components/FeatureStateBadge";
import {
  assistantLabelCodePointLength,
  MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH,
} from "../../domain/assistant-label-definition";
import { cachedGetJson, invalidateCachedGet } from "../../lib/client-get-cache";
import { SettingsDataNotice } from "./SettingsDataNotice";
import styles from "./AiAssistantSettingsCard.module.css";

const ASSISTANT_CONFIG_URL = "/api/v1/assistant/config";
const ASSISTANT_LABELS_URL = "/api/v1/inbox-analysis/labels";
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
  modelSource: "app" | "env" | "none";
  savedModel: string | null;
  features: AiFeatures;
};
type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type LoadState = "loading" | "ready" | "error";
type AssistantLabel = {
  slug: string;
  description: string;
  retired: boolean;
  createdAt: number;
  updatedAt: number;
};
type AssistantLabelCatalog = { labels: AssistantLabel[]; maximumLabels: number };

function limitAssistantLabelDescription(value: string) {
  return [...value]
    .slice(0, MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH)
    .join("");
}

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
  const modelSource = value.modelSource === "app" || value.modelSource === "env"
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

function parseAssistantLabelCatalog(value: unknown): AssistantLabelCatalog {
  if (
    !isRecord(value)
    || !Array.isArray(value.labels)
    || !Number.isSafeInteger(value.maximumLabels)
    || Number(value.maximumLabels) < 1
    || value.labels.length > Number(value.maximumLabels)
  ) {
    throw new Error("The server returned an invalid AI label catalog.");
  }
  const labels = value.labels.map((candidate) => {
    if (
      !isRecord(candidate)
      || typeof candidate.slug !== "string"
      || !/^[A-Za-z0-9_-]{1,60}$/.test(candidate.slug)
      || typeof candidate.description !== "string"
      || !candidate.description.trim()
      || assistantLabelCodePointLength(candidate.description)
        > MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH
      || typeof candidate.retired !== "boolean"
      || !Number.isSafeInteger(candidate.createdAt)
      || !Number.isSafeInteger(candidate.updatedAt)
    ) {
      throw new Error("The server returned an invalid AI label catalog.");
    }
    return candidate as AssistantLabel;
  });
  if (new Set(labels.map(({ slug }) => slug)).size !== labels.length) {
    throw new Error("The server returned duplicate AI labels.");
  }
  return { labels, maximumLabels: Number(value.maximumLabels) };
}

export function AiAssistantSettingsCard({ notify, isAdmin }: { notify: Notify; isAdmin: boolean }) {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [features, setFeatures] = useState<AiFeatures | null>(null);
  const [model, setModel] = useState("");
  const [modelDirty, setModelDirty] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [labelCatalog, setLabelCatalog] = useState<AssistantLabelCatalog | null>(null);
  const [labelEdits, setLabelEdits] = useState<Record<string, string>>({});
  const [newLabelDescription, setNewLabelDescription] = useState("");
  const [labelLoadState, setLabelLoadState] = useState<LoadState>("loading");
  const [labelLoadError, setLabelLoadError] = useState("");
  const [labelSaving, setLabelSaving] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const labelLoadRequestRef = useRef(0);

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
      setModel(nextConfig.modelSource === "env"
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

  const loadLabels = useCallback(async (force = false) => {
    if (!isAdmin) return;
    const requestId = ++labelLoadRequestRef.current;
    setLabelLoadState("loading");
    setLabelLoadError("");
    try {
      const nextCatalog = parseAssistantLabelCatalog(
        await cachedGetJson<unknown>(ASSISTANT_LABELS_URL, { force }),
      );
      if (requestId !== labelLoadRequestRef.current) return;
      setLabelCatalog(nextCatalog);
      setLabelEdits(Object.fromEntries(
        nextCatalog.labels.map(({ slug, description }) => [slug, description]),
      ));
      setLabelLoadState("ready");
    } catch (error) {
      if (requestId !== labelLoadRequestRef.current) return;
      setLabelCatalog(null);
      setLabelEdits({});
      setLabelLoadError(
        error instanceof Error ? error.message : "AI labels could not be loaded.",
      );
      setLabelLoadState("error");
    }
  }, [isAdmin]);

  useEffect(() => {
    void Promise.resolve().then(() => loadConfig());
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadConfig]);

  useEffect(() => {
    if (isAdmin) void Promise.resolve().then(() => loadLabels());
    return () => {
      labelLoadRequestRef.current += 1;
    };
  }, [isAdmin, loadLabels]);

  async function mutateLabel(
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, string>,
    pendingKey: string,
    successMessage: (response: Record<string, unknown>) => string,
  ) {
    setLabelSaving(pendingKey);
    try {
      const response = await fetch(ASSISTANT_LABELS_URL, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as unknown;
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "AI label could not be saved.",
        );
      }
      invalidateCachedGet(ASSISTANT_LABELS_URL);
      await loadLabels(true);
      notify(successMessage(isRecord(payload) ? payload : {}), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI label could not be saved.", "error");
    } finally {
      setLabelSaving(null);
    }
  }

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
      setModel(savedConfig.modelSource === "env"
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
        <div><dt>Model source</dt><dd>{config.modelSource === "app" ? "App-saved" : config.modelSource === "env" ? "Environment" : "None (default)"}</dd></div>
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

      {isAdmin ? <><form onSubmit={save}>
        <label htmlFor="assistant-model">{config.modelSource === "env" ? "App-saved fallback model" : "OpenAI model"}
          <input
            id="assistant-model"
            value={model}
            onChange={(event) => { setModel(event.target.value); setModelDirty(true); }}
            disabled={!editable || saving || config.modelSource === "env"}
            maxLength={200}
            spellCheck={false}
            autoComplete="off"
          />
          <small>{config.modelSource === "env"
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
      </form>

      <section className={styles.labelCatalog} aria-labelledby="assistant-label-catalog-title">
        <div className={styles.labelHeading}>
          <div>
            <h3 id="assistant-label-catalog-title">Inbox analysis labels</h3>
            <p>Descriptions guide classification. Identifiers are generated by the app and never reused.</p>
          </div>
          {labelCatalog && <span>{labelCatalog.labels.length}/{labelCatalog.maximumLabels}</span>}
        </div>
        {labelLoadState !== "ready" || !labelCatalog ? <SettingsDataNotice
          state={labelLoadState}
          error={labelLoadError || "AI labels could not be loaded."}
          onRetry={() => void loadLabels(true)}
        /> : <>
          <div className={styles.newLabel}>
            <label htmlFor="assistant-new-label-description">New label description
              <textarea
                id="assistant-new-label-description"
                value={newLabelDescription}
                onChange={(event) => setNewLabelDescription(
                  limitAssistantLabelDescription(event.target.value),
                )}
                maxLength={MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH * 2}
                rows={2}
                disabled={labelSaving !== null || labelCatalog.labels.length >= labelCatalog.maximumLabels}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={!newLabelDescription.trim() || labelSaving !== null || labelCatalog.labels.length >= labelCatalog.maximumLabels}
              onClick={() => void mutateLabel(
                "POST",
                { description: newLabelDescription },
                "new",
                () => {
                  setNewLabelDescription("");
                  return "AI label added";
                },
              )}
            >
              <Plus size={15} aria-hidden="true" /> {labelSaving === "new" ? "Adding…" : "Add label"}
            </button>
          </div>
          <div className={styles.labelList}>
            {labelCatalog.labels.map((label) => <article key={label.slug} className={styles.labelRow}>
              <div className={styles.labelIdentity}>
                <code>{label.slug}</code>
                <span className={label.retired ? styles.retired : styles.active}>
                  {label.retired ? "Retired" : "Active"}
                </span>
              </div>
              <label htmlFor={`assistant-label-${label.slug}`}>Description
                <textarea
                  id={`assistant-label-${label.slug}`}
                  value={labelEdits[label.slug] ?? label.description}
                  onChange={(event) => setLabelEdits((current) => ({
                    ...current,
                    [label.slug]: limitAssistantLabelDescription(event.target.value),
                  }))}
                  maxLength={MAX_ASSISTANT_LABEL_DESCRIPTION_LENGTH * 2}
                  rows={2}
                  disabled={labelSaving !== null}
                />
              </label>
              <div className={styles.labelActions}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    labelSaving !== null
                    || !(labelEdits[label.slug] ?? "").trim()
                    || labelEdits[label.slug] === label.description
                  }
                  onClick={() => void mutateLabel(
                    "PATCH",
                    { slug: label.slug, description: labelEdits[label.slug] ?? label.description },
                    `save:${label.slug}`,
                    () => "AI label description saved",
                  )}
                >
                  {labelSaving === `save:${label.slug}` ? "Saving…" : "Save description"}
                </button>
                {!label.retired && <button
                  type="button"
                  className="secondary-button"
                  disabled={labelSaving !== null}
                  onClick={() => void mutateLabel(
                    "DELETE",
                    { slug: label.slug },
                    `remove:${label.slug}`,
                    (response) => response.outcome === "retired"
                      ? "Used AI label retired"
                      : "Unused AI label removed",
                  )}
                >
                  {labelSaving === `remove:${label.slug}` ? "Removing…" : "Remove label"}
                </button>}
              </div>
            </article>)}
          </div>
          <p className={styles.labelPolicy}>A label already present in saved analysis is retired rather than deleted. Retired descriptions remain editable so historical queue rows stay understandable.</p>
        </>}
      </section>
      </> : <>
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
