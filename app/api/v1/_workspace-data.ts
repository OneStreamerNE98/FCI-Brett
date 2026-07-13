import { env } from "cloudflare:workers";
import { createPilotSchemaEnsurer } from "../../platform/pilot-schema-migrations";

let ensurePilotSchema: ReturnType<typeof createPilotSchemaEnsurer> | undefined;

export function ensureWorkspaceSchema() {
  ensurePilotSchema ??= createPilotSchemaEnsurer(env.DB);
  return ensurePilotSchema();
}

export function actorFrom(headers: Headers) {
  const actor = headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!actor) throw new Error("Authenticated office user is required");
  return actor;
}
