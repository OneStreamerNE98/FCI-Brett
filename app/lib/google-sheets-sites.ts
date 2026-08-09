import { env } from "cloudflare:workers";

import { createD1GoogleSheetsPersistence } from "../adapters/d1/google-sheets-persistence";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
} from "../adapters/d1/workspace-setup-leases";
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
  acquireSyncLease: ({ connectionKey, authConnectionId, authConnectionKey, authConnectionEmail, authConnectionRefreshTokenCiphertext, actor, now }: Readonly<{
    connectionKey: string;
    authConnectionId?: string;
    authConnectionKey: string;
    authConnectionEmail?: string;
    authConnectionRefreshTokenCiphertext?: string;
    actor: string;
    now: number;
  }>) => (
    acquireWorkspaceSetupLease(env.DB, {
      id: crypto.randomUUID(),
      connectionKey,
      action: "sheets-directory-sync",
      scopeKey: "sheets-directory-sync",
      actor,
      now,
      connectionFence: googleConnectionLeaseFence({
        simulation: false,
        authConnectionId,
        authConnectionKey,
        authConnectionEmail,
        authConnectionRefreshTokenCiphertext,
      }),
    })
  ),
  completeSyncLease: completeWorkspaceSetupLease.bind(null, env.DB),
  failSyncLease: failWorkspaceSetupLease.bind(null, env.DB),
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
  source?: "app" | "env" | "none",
) {
  return getGoogleSheetMirrorStatusCore(config, connection, dependencies, source);
}
