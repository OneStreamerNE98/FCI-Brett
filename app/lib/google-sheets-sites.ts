import { env } from "cloudflare:workers";

import { createD1GoogleSheetsPersistence } from "../adapters/d1/google-sheets-persistence";
import {
  getGoogleSheetMirrorStatus as getGoogleSheetMirrorStatusCore,
  syncGoogleDirectory as syncGoogleDirectoryCore,
  trySyncGoogleDirectory as trySyncGoogleDirectoryCore,
} from "./google-sheets";
import {
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
  type GoogleRuntimeConfig,
} from "./google-oauth-sites";

export * from "./google-sheets";

const dependencies = Object.freeze({
  persistence: createD1GoogleSheetsPersistence(env.DB),
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  now: Date.now,
  getAccessToken: getGoogleAccessToken,
  writeIntegrationEvent: writeGoogleIntegrationEvent,
});

export function syncGoogleDirectory(config: GoogleRuntimeConfig, actor: string) {
  return syncGoogleDirectoryCore(config, actor, dependencies);
}

export function trySyncGoogleDirectory(config: GoogleRuntimeConfig, actor: string) {
  return trySyncGoogleDirectoryCore(config, actor, dependencies);
}

export function getGoogleSheetMirrorStatus(
  config: GoogleRuntimeConfig,
  connection: { services: { sheets: boolean } },
) {
  return getGoogleSheetMirrorStatusCore(config, connection, dependencies);
}
