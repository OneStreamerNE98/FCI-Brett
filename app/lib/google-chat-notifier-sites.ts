import { env, waitUntil } from "cloudflare:workers";

import {
  readGoogleChatRouting,
  saveGoogleChatRouting,
  type GoogleChatRoutingDatabase,
} from "../adapters/d1/google-chat-routing";
import {
  buildGoogleChatPublicConfig,
  deferGoogleChatTask,
  deliverGoogleChatNotification,
  googleChatNotificationsEnabled,
  googleChatWebhookEnvironmentName,
  type GoogleChatDefer,
  type GoogleChatEnvironment,
  type GoogleChatNotificationEvent,
  type GoogleChatPublicConfig,
  type GoogleChatRoutingSettings,
} from "./google-chat-notifier";
import { getGoogleRuntimeConfig, writeGoogleIntegrationEvent } from "./google-oauth-sites";

type SitesGoogleChatEnvironment = GoogleChatEnvironment & Readonly<{
  DB: GoogleChatRoutingDatabase;
}>;

function sitesEnvironment() {
  return env as unknown as SitesGoogleChatEnvironment;
}

/**
 * Reads the office-safe configuration projection. Authorization belongs to the
 * calling route; this helper never returns a webhook value.
 */
export async function readGoogleChatPublicConfig(): Promise<GoogleChatPublicConfig> {
  const environment = sitesEnvironment();
  const stored = await readGoogleChatRouting(environment.DB);
  const googleConfig = getGoogleRuntimeConfig(environment);
  return buildGoogleChatPublicConfig({
    environment,
    simulation: googleConfig.simulation,
    routing: stored.routing,
    updatedAt: stored.updatedAt,
  });
}

export async function saveSitesGoogleChatRouting(
  routing: GoogleChatRoutingSettings,
  actor: string,
) {
  const environment = sitesEnvironment();
  const saved = await saveGoogleChatRouting(environment.DB, routing, actor, Date.now());
  const googleConfig = getGoogleRuntimeConfig(environment);
  return buildGoogleChatPublicConfig({
    environment,
    simulation: googleConfig.simulation,
    routing: saved.routing,
    updatedAt: saved.updatedAt,
  });
}

async function runGoogleChatNotification(
  event: GoogleChatNotificationEvent,
  actor: string,
  appOrigin: string,
) {
  const environment = sitesEnvironment();
  const stored = await readGoogleChatRouting(environment.DB);
  const googleConfig = getGoogleRuntimeConfig(environment);
  await deliverGoogleChatNotification(
    event,
    actor,
    appOrigin,
    {
      notificationsEnabled: googleChatNotificationsEnabled(environment),
      simulation: googleConfig.simulation,
      routing: stored.routing,
    },
    {
      fetch: (input, init) => globalThis.fetch(input, init),
      // This closure is never called in simulation or for a disabled route.
      resolveWebhook: (spaceKey) => environment[googleChatWebhookEnvironmentName(spaceKey)],
      writeAudit: (record) => writeGoogleIntegrationEvent(
        googleConfig,
        record.eventType,
        record.actor,
        record.entityType,
        record.entityId,
        record.detail,
      ),
      randomUUID: () => crypto.randomUUID(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
    },
  );
}

/**
 * Hands notification work to the Worker lifetime and returns synchronously.
 * The exact gate is checked before D1, secret resolution, network, or audit work.
 */
export function queueGoogleChatNotification(
  event: GoogleChatNotificationEvent,
  actor: string,
  appOrigin: string,
  defer: GoogleChatDefer = waitUntil,
): void {
  let enabled = false;
  try {
    enabled = googleChatNotificationsEnabled(sitesEnvironment());
  } catch {
    return;
  }
  if (!enabled) return;
  deferGoogleChatTask(defer, () => runGoogleChatNotification(event, actor, appOrigin));
}
