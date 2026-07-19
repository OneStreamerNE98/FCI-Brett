import {
  createWorkspaceCalendarHold as createWorkspaceCalendarHoldCore,
  listWorkspaceCalendarEvents as listWorkspaceCalendarEventsCore,
} from "./google-calendar-client";
import {
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
  type GoogleRuntimeConfig,
} from "./google-oauth-sites";

export * from "./google-calendar-client";

const dependencies = Object.freeze({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  now: () => new Date(),
  getAccessToken: getGoogleAccessToken,
  writeIntegrationEvent: writeGoogleIntegrationEvent,
});

export function listWorkspaceCalendarEvents(config: GoogleRuntimeConfig, actor: string) {
  return listWorkspaceCalendarEventsCore(config, actor, dependencies);
}

export function createWorkspaceCalendarHold(
  config: GoogleRuntimeConfig,
  actor: string,
  start: Date,
) {
  return createWorkspaceCalendarHoldCore(config, actor, start, dependencies);
}
