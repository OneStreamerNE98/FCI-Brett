import { createD1WorkspaceSettingsRepository } from "../adapters/d1/workspace-settings-repository";
import type { D1Database } from "../adapters/d1/d1-database";
import {
  type AssistantConfigurationUpdate,
  mergeAssistantFeaturesIntoSettings,
  normalizeAssistantFeatures,
  type AssistantFeatures,
} from "../domain/assistant-config";
import { WORKSPACE_SETTINGS_ID } from "../domain/workspace-settings";
import { lookupOpenAIModel } from "../adapters/openai/responses-provider";
import { resolveEffectiveTextConfiguration } from "./workspace-effective-config";

export type AssistantConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

export type AssistantPublicConfiguration = Readonly<{
  provider: "openai";
  keyState: "Configured" | "Missing";
  model: string;
  modelSource: "app" | "environment" | "none";
  savedModel: string | null;
  features: AssistantFeatures;
}>;

function runtimeValue(
  environment: AssistantConfigurationEnvironment,
  name: string,
) {
  return environment[name] ?? process.env[name];
}

export function assistantRuntimeConfiguration(
  environment: AssistantConfigurationEnvironment,
  savedModel?: unknown,
) {
  const apiKey = runtimeValue(environment, "OPENAI_API_KEY");
  const keyConfigured = typeof apiKey === "string" && apiKey.trim().length > 0;
  // OPENAI_MODEL is the one explicit precedence exception: a hosted value is
  // an emergency override. Without it, the app-saved value is authoritative.
  const emergencyModel = runtimeValue(environment, "OPENAI_MODEL")?.trim();
  const configuredModel = emergencyModel
    ? Object.freeze({ value: emergencyModel, source: "environment" as const })
    : resolveEffectiveTextConfiguration(savedModel, undefined);
  const sanitized = configuredModel.value
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 200);
  return Object.freeze({
    keyConfigured,
    model: sanitized || "gpt-5.4",
    modelSource: configuredModel.source,
  });
}

export async function readSitesAssistantConfiguration(
  database: D1Database,
  environment: AssistantConfigurationEnvironment,
): Promise<AssistantPublicConfiguration> {
  const repository = createD1WorkspaceSettingsRepository(database);
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  const runtime = assistantRuntimeConfiguration(environment, record?.settings.aiModel);
  const savedModel = resolveEffectiveTextConfiguration(
    record?.settings.aiModel,
    undefined,
  ).value ?? null;
  return Object.freeze({
    provider: "openai",
    keyState: runtime.keyConfigured ? "Configured" : "Missing",
    model: runtime.model,
    modelSource: runtime.modelSource,
    savedModel,
    features: normalizeAssistantFeatures(
      record?.settings.aiFeatures,
      runtime.keyConfigured,
    ),
  });
}

export async function saveSitesAssistantFeatures(
  database: D1Database,
  environment: AssistantConfigurationEnvironment,
  update: Readonly<Partial<AssistantFeatures>>,
  actor: string,
  now: number,
): Promise<AssistantPublicConfiguration> {
  return saveSitesAssistantConfiguration(
    database,
    environment,
    { features: update },
    actor,
    now,
  );
}

export class AssistantModelValidationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AssistantModelValidationError";
  }
}

export async function saveSitesAssistantConfiguration(
  database: D1Database,
  environment: AssistantConfigurationEnvironment,
  update: AssistantConfigurationUpdate,
  actor: string,
  now: number,
): Promise<AssistantPublicConfiguration> {
  const repository = createD1WorkspaceSettingsRepository(database);
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  const apiKey = runtimeValue(environment, "OPENAI_API_KEY")?.trim();
  if (update.model) {
    if (!apiKey) {
      throw new AssistantModelValidationError(
        "Configure OPENAI_API_KEY before saving an AI model.",
        409,
      );
    }
    const lookup = await lookupOpenAIModel({ apiKey, model: update.model });
    if (!lookup.ok) {
      throw new AssistantModelValidationError(
        `OpenAI rejected model "${lookup.model}": ${lookup.reason}`,
        lookup.status >= 400 && lookup.status < 500 ? 400 : lookup.status,
      );
    }
  }
  const runtime = assistantRuntimeConfiguration(
    environment,
    update.model ?? record?.settings.aiModel,
  );
  const savedModel = resolveEffectiveTextConfiguration(
    update.model ?? record?.settings.aiModel,
    undefined,
  ).value ?? null;
  // Availability and saved preference are separate truths. Keep the stored
  // defaults enabled even while the provider key is missing so adding the key
  // later does not turn untouched features off.
  const currentFeatures = normalizeAssistantFeatures(
    record?.settings.aiFeatures,
    true,
  );
  const settings = mergeAssistantFeaturesIntoSettings(
    record?.settings ?? {},
    { ...currentFeatures, ...(update.features ?? {}) },
  );
  const ownedSettings = Object.freeze({
    aiFeatures: settings.aiFeatures,
    ...(update.model ? { aiModel: update.model } : {}),
  });
  await repository.mergeSettings({
    id: WORKSPACE_SETTINGS_ID,
    settings: ownedSettings,
    updatedBy: actor,
    updatedAt: now,
  });
  return Object.freeze({
    provider: "openai",
    keyState: runtime.keyConfigured ? "Configured" : "Missing",
    model: runtime.model,
    modelSource: runtime.modelSource,
    savedModel,
    features: normalizeAssistantFeatures(settings.aiFeatures, runtime.keyConfigured),
  });
}
