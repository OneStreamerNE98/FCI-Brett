export const ASSISTANT_FEATURE_KEYS = Object.freeze([
  "orgQa",
  "triage",
  "inboxAnalysis",
  "replyDrafts",
  "taskExtraction",
] as const);

export type AssistantFeatureKey = typeof ASSISTANT_FEATURE_KEYS[number];
export type AssistantFeatures = Readonly<Record<AssistantFeatureKey, boolean>>;

const ASSISTANT_FEATURE_KEY_SET = new Set<string>(ASSISTANT_FEATURE_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function defaultAssistantFeatures(keyConfigured: boolean): AssistantFeatures {
  return Object.freeze({
    orgQa: keyConfigured,
    triage: keyConfigured,
    inboxAnalysis: keyConfigured,
    replyDrafts: keyConfigured,
    taskExtraction: keyConfigured,
  });
}

/**
 * Widen-on-read keeps each known saved choice while filling newly introduced
 * feature keys from the current default. A missing provider key makes every
 * feature honestly unavailable without overwriting its stored choice.
 */
export function normalizeAssistantFeatures(
  value: unknown,
  keyConfigured: boolean,
): AssistantFeatures {
  const input = isRecord(value) ? value : {};
  const defaults = defaultAssistantFeatures(keyConfigured);
  return Object.freeze(Object.fromEntries(
    ASSISTANT_FEATURE_KEYS.map((key) => [
      key,
      keyConfigured && (typeof input[key] === "boolean" ? input[key] : defaults[key]),
    ]),
  ) as Record<AssistantFeatureKey, boolean>);
}

export function parseAssistantFeaturesUpdate(
  value: unknown,
): Readonly<Partial<Record<AssistantFeatureKey, boolean>>> | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.features)) {
    return null;
  }
  const featureValues = value.features;
  const featureKeys = Object.keys(featureValues);
  if (
    featureKeys.length === 0
    || featureKeys.some((key) => !ASSISTANT_FEATURE_KEY_SET.has(key))
    || featureKeys.some((key) => typeof featureValues[key] !== "boolean")
  ) {
    return null;
  }
  return Object.freeze(Object.fromEntries(
    featureKeys.map((key) => [key, featureValues[key]]),
  ) as Partial<Record<AssistantFeatureKey, boolean>>);
}

export type AssistantConfigurationUpdate = Readonly<{
  features?: Readonly<Partial<Record<AssistantFeatureKey, boolean>>>;
  model?: string;
}>;

/** Closed settings update with an open provider model id (no code allowlist). */
export function parseAssistantConfigurationUpdate(
  value: unknown,
): AssistantConfigurationUpdate | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length === 0
    || keys.some((key) => key !== "features" && key !== "model")
  ) return null;
  const parsedFeatures = Object.hasOwn(value, "features")
    ? parseAssistantFeaturesUpdate({ features: value.features })
    : undefined;
  if (Object.hasOwn(value, "features") && !parsedFeatures) return null;
  let model: string | undefined;
  if (Object.hasOwn(value, "model")) {
    if (typeof value.model !== "string") return null;
    model = value.model.trim();
    if (
      !model
      || model.length > 200
      || /[\u0000-\u001f\u007f]/u.test(model)
    ) return null;
  }
  return Object.freeze({
    ...(parsedFeatures ? { features: parsedFeatures } : {}),
    ...(model ? { model } : {}),
  });
}

export function mergeAssistantFeaturesIntoSettings(
  settings: Readonly<Record<string, unknown>>,
  update: Readonly<Partial<Record<AssistantFeatureKey, boolean>>>,
) {
  const storedFeatures = isRecord(settings.aiFeatures) ? settings.aiFeatures : {};
  return Object.freeze({
    ...settings,
    aiFeatures: Object.freeze({
      ...storedFeatures,
      ...update,
    }),
  });
}
