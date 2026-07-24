import { createD1WorkspaceSettingsRepository } from "../adapters/d1/workspace-settings-repository";
import type { D1Database } from "../adapters/d1/d1-database";
import {
  mergeAssistantFeaturesIntoSettings,
  normalizeAssistantFeatures,
  type AssistantFeatures,
} from "../domain/assistant-config";
import { WORKSPACE_SETTINGS_ID } from "../domain/workspace-settings";

export type AssistantConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

export type AssistantPublicConfiguration = Readonly<{
  provider: "openai";
  keyState: "Configured" | "Missing";
  model: string;
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
) {
  const apiKey = runtimeValue(environment, "OPENAI_API_KEY");
  const keyConfigured = typeof apiKey === "string" && apiKey.trim().length > 0;
  const configuredModel = runtimeValue(environment, "OPENAI_MODEL")?.trim();
  const model = configuredModel
    ? configuredModel.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "gpt-5.4"
    : "gpt-5.4";
  return Object.freeze({ keyConfigured, model });
}

export async function readSitesAssistantConfiguration(
  database: D1Database,
  environment: AssistantConfigurationEnvironment,
): Promise<AssistantPublicConfiguration> {
  const repository = createD1WorkspaceSettingsRepository(database);
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  const runtime = assistantRuntimeConfiguration(environment);
  return Object.freeze({
    provider: "openai",
    keyState: runtime.keyConfigured ? "Configured" : "Missing",
    model: runtime.model,
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
  const repository = createD1WorkspaceSettingsRepository(database);
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  const runtime = assistantRuntimeConfiguration(environment);
  // Availability and saved preference are separate truths. Keep the stored
  // defaults enabled even while the provider key is missing so adding the key
  // later does not turn untouched features off.
  const currentFeatures = normalizeAssistantFeatures(
    record?.settings.aiFeatures,
    true,
  );
  const settings = mergeAssistantFeaturesIntoSettings(
    record?.settings ?? {},
    { ...currentFeatures, ...update },
  );
  await repository.upsert({
    id: WORKSPACE_SETTINGS_ID,
    settings,
    updatedBy: actor,
    updatedAt: now,
  });
  return Object.freeze({
    provider: "openai",
    keyState: runtime.keyConfigured ? "Configured" : "Missing",
    model: runtime.model,
    features: normalizeAssistantFeatures(settings.aiFeatures, runtime.keyConfigured),
  });
}
