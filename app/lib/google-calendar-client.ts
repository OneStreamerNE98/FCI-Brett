import {
  GoogleIntegrationError,
  assertGoogleService,
  type GoogleFetch,
  type GoogleRuntimeConfig,
} from "./google-oauth";
import {
  calendarEventsListedIntegrationEvent,
  calendarHoldCreatedIntegrationEvent,
} from "./google-integration-events";
import {
  fetchGoogleProvider,
  type GoogleFetchPolicy,
  type GoogleFetchResilienceDependencies,
} from "./google-fetch-resilience";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UPCOMING_EVENTS = 20;
const TEST_HOLD_DURATION_MS = 30 * 60 * 1000;
export const CALENDAR_TEST_HOLD_DEDUP_PROPERTY = "fciTestHoldKey";

export function calendarTestHoldDedupKey(start: Date) {
  return `v1:${start.toISOString()}`;
}

export async function calendarTestHoldEventId(start: Date) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(calendarTestHoldDedupKey(start)),
  ));
  // Hex is a valid subset of Calendar's lowercase base32hex event-ID alphabet.
  return `fci${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type CalendarDateTime = {
  dateTime?: string;
  date?: string;
};

type CalendarApiEvent = {
  id?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: CalendarDateTime;
  end?: CalendarDateTime;
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

type CalendarApiEventList = {
  summary?: string;
  timeZone?: string;
  items?: CalendarApiEvent[];
};

export type CalendarEventSummary = {
  id: string;
  title: string;
  status: string;
  start: string;
  end: string;
  url?: string;
};

export type GoogleCalendarResource = Readonly<{
  id: string;
  name: string;
  timeZone: string | null;
  url: string;
}>;

export type GoogleCalendarClientDependencies = Readonly<{
  fetch: GoogleFetch;
  now: () => Date;
  resilience?: GoogleFetchResilienceDependencies;
}>;

export type GoogleCalendarOperationsDependencies = GoogleCalendarClientDependencies & Readonly<{
  getAccessToken(config: GoogleRuntimeConfig, service: "calendar"): Promise<string>;
  writeIntegrationEvent(
    config: GoogleRuntimeConfig,
    eventType: string,
    actor: string,
    entityType: string,
    entityId: string,
    detail: string,
  ): Promise<void>;
}>;

const DEFAULT_CLIENT_DEPENDENCIES: GoogleCalendarClientDependencies = Object.freeze({
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => new Date(),
});

function calendarTime(value: CalendarDateTime | undefined) {
  if (typeof value?.dateTime === "string") return value.dateTime;
  if (typeof value?.date === "string") return value.date;
  return null;
}

function safeEvent(event: CalendarApiEvent): CalendarEventSummary | null {
  const start = calendarTime(event.start);
  const end = calendarTime(event.end);
  if (typeof event.id !== "string" || !start || !end) return null;
  return {
    id: event.id,
    title: typeof event.summary === "string" && event.summary.trim() ? event.summary.trim().slice(0, 160) : "Untitled",
    status: typeof event.status === "string" ? event.status : "confirmed",
    start,
    end,
    ...(typeof event.htmlLink === "string" ? { url: event.htmlLink } : {}),
  };
}

function requireCalendarReadiness(config: GoogleRuntimeConfig) {
  assertGoogleService(config, "calendar");
  if (!config.oauthReady) {
    throw new GoogleIntegrationError(
      "calendar_configuration_required",
      "Complete the Google Workspace Calendar setup before using appointments.",
      409,
    );
  }
}

function requireWorkspaceCalendarId(config: GoogleRuntimeConfig) {
  requireCalendarReadiness(config);
  const calendarId = config.clientAppointmentsCalendarId?.trim();
  if (!calendarId) {
    throw new GoogleIntegrationError(
      "calendar_configuration_required",
      "Complete the Google Workspace Calendar setup before using appointments.",
      409,
    );
  }
  return calendarId;
}

export class GoogleCalendarClient {
  constructor(
    private readonly accessToken: string,
    private readonly config: GoogleRuntimeConfig,
    private readonly dependencies: GoogleCalendarClientDependencies = DEFAULT_CLIENT_DEPENDENCIES,
  ) {}

  private workspaceCalendarId() {
    return requireWorkspaceCalendarId(this.config);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    policy: GoogleFetchPolicy = {},
    readiness: "configured" | "service" = "configured",
  ) {
    if (readiness === "configured") requireCalendarReadiness(this.config);
    else assertGoogleService(this.config, "calendar");
    let response: Response;
    try {
      response = await fetchGoogleProvider(this.dependencies.fetch, `${CALENDAR_API}/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      }, policy, this.dependencies.resilience);
    } catch {
      throw new GoogleIntegrationError("calendar_unavailable", "Google Calendar is temporarily unavailable. Try again.", 503);
    }

    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !data) {
      if (response.status === 401) {
        throw new GoogleIntegrationError("calendar_reauthorization_required", "Google Calendar authorization needs to be reconnected.", 409);
      }
      if (response.status === 403) {
        throw new GoogleIntegrationError("calendar_permission_denied", "The Google Workspace account has not granted Calendar access. Reconnect it and approve Calendar permission.", 409);
      }
      if (response.status === 404) {
        throw new GoogleIntegrationError("calendar_not_found", "The configured Workspace calendar could not be found.", 404);
      }
      if (response.status === 429) {
        throw new GoogleIntegrationError("calendar_rate_limited", "Google Calendar is busy. Try again shortly.", 429);
      }
      if (response.status === 409) {
        throw new GoogleIntegrationError("calendar_event_conflict", "The Calendar event already exists.", 409);
      }
      throw new GoogleIntegrationError("calendar_request_failed", "Google Calendar could not complete that operation. Try again.", 503);
    }
    return data as T;
  }

  /**
   * Reads one registered Calendar through its events collection. That response
   * includes the Calendar summary and time zone while remaining within the
   * existing calendar.events grant; reconcile must not widen OAuth consent.
   */
  async getCalendarMetadata(calendarId: string): Promise<GoogleCalendarResource | null> {
    const normalizedId = calendarId.trim();
    if (!normalizedId || normalizedId.length > 1_024 || /[\u0000-\u001f\u007f]/.test(normalizedId)) {
      throw new GoogleIntegrationError("calendar_configuration_required", "The registered Workspace calendar ID is invalid.", 409);
    }
    const query = new URLSearchParams({
      maxResults: "1",
      showDeleted: "false",
      fields: "summary,timeZone,items(id)",
    });
    let result: CalendarApiEventList;
    try {
      result = await this.request<CalendarApiEventList>(
        `calendars/${encodeURIComponent(normalizedId)}/events?${query.toString()}`,
        {},
        { idempotent: true },
        "service",
      );
    } catch (error) {
      if (error instanceof GoogleIntegrationError && error.code === "calendar_not_found") return null;
      throw error;
    }
    if (typeof result.summary !== "string" || !result.summary.trim()) {
      throw new GoogleIntegrationError(
        "calendar_invalid_response",
        "Google Calendar returned incomplete registered-calendar details.",
        503,
      );
    }
    return Object.freeze({
      id: normalizedId,
      name: result.summary.trim(),
      timeZone: typeof result.timeZone === "string" && result.timeZone.trim() ? result.timeZone.trim() : null,
      url: `https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(normalizedId)}`,
    });
  }

  async listUpcomingEvents(now = this.dependencies.now()) {
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + UPCOMING_WINDOW_MS).toISOString();
    const query = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: String(MAX_UPCOMING_EVENTS),
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      fields: "items(id,summary,status,htmlLink,start,end)",
    });
    const calendarId = encodeURIComponent(this.workspaceCalendarId());
    const result = await this.request<{ items?: CalendarApiEvent[] }>(
      `calendars/${calendarId}/events?${query.toString()}`,
      {},
      { idempotent: true },
    );
    return {
      window: { start: timeMin, end: timeMax },
      events: (result.items ?? []).map(safeEvent).filter((event): event is CalendarEventSummary => event !== null),
    };
  }

  async createTestHold(start: Date) {
    const end = new Date(start.getTime() + TEST_HOLD_DURATION_MS);
    const calendarId = encodeURIComponent(this.workspaceCalendarId());
    const dedupKey = calendarTestHoldDedupKey(start);
    const findExisting = async () => {
      const lookup = new URLSearchParams({
        privateExtendedProperty: `${CALENDAR_TEST_HOLD_DEDUP_PROPERTY}=${dedupKey}`,
        maxResults: "1",
        showDeleted: "false",
        fields: "items(id,summary,status,htmlLink,start,end)",
      });
      const existing = await this.request<{ items?: CalendarApiEvent[] }>(
        `calendars/${calendarId}/events?${lookup.toString()}`,
        {},
        { idempotent: true },
      );
      return existing.items?.map(safeEvent).find((event) => event !== null) ?? null;
    };
    const existingEvent = await findExisting();
    if (existingEvent) return { event: existingEvent, created: false } as const;

    const insert = new URLSearchParams({ sendUpdates: "none", conferenceDataVersion: "0" });
    let result: CalendarApiEvent;
    try {
      result = await this.request<CalendarApiEvent>(`calendars/${calendarId}/events?${insert.toString()}`, {
        method: "POST",
        body: JSON.stringify({
          id: await calendarTestHoldEventId(start),
          summary: "FCI Operations — Workspace test appointment",
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
          visibility: "private",
          guestsCanInviteOthers: false,
          guestsCanModify: false,
          guestsCanSeeOtherGuests: false,
          reminders: { useDefault: false, overrides: [] },
          extendedProperties: {
            private: { [CALENDAR_TEST_HOLD_DEDUP_PROPERTY]: dedupKey },
          },
        }),
      }, { idempotent: true });
    } catch (error) {
      if (error instanceof GoogleIntegrationError && error.code === "calendar_event_conflict") {
        const concurrentEvent = await findExisting();
        if (concurrentEvent) return { event: concurrentEvent, created: false } as const;
        throw new GoogleIntegrationError(
          "calendar_event_conflict",
          "This Calendar test-hold slot was previously used. Choose another start time and try again.",
          409,
        );
      }
      throw error;
    }
    const event = safeEvent(result);
    if (!event) {
      throw new GoogleIntegrationError("calendar_invalid_response", "Google Calendar created a test hold without the expected details. Check Calendar before retrying.", 503);
    }
    return { event, created: true } as const;
  }
}

export async function listWorkspaceCalendarEvents(
  config: GoogleRuntimeConfig,
  actor: string,
  dependencies: GoogleCalendarOperationsDependencies,
) {
  const calendarId = requireWorkspaceCalendarId(config);
  const calendar = new GoogleCalendarClient(
    await dependencies.getAccessToken(config, "calendar"),
    config,
    dependencies,
  );
  const result = await calendar.listUpcomingEvents();
  const event = calendarEventsListedIntegrationEvent(
    calendarId,
    result.window,
    result.events.length,
  );
  await dependencies.writeIntegrationEvent(
    config,
    event.eventType,
    actor,
    event.entityType,
    event.entityId,
    event.detail,
  );
  return result;
}

export async function createWorkspaceCalendarHold(
  config: GoogleRuntimeConfig,
  actor: string,
  start: Date,
  dependencies: GoogleCalendarOperationsDependencies,
) {
  requireWorkspaceCalendarId(config);
  const calendar = new GoogleCalendarClient(
    await dependencies.getAccessToken(config, "calendar"),
    config,
    dependencies,
  );
  const result = await calendar.createTestHold(start);
  if (result.created) {
    const integrationEvent = calendarHoldCreatedIntegrationEvent(result.event);
    await dependencies.writeIntegrationEvent(
      config,
      integrationEvent.eventType,
      actor,
      integrationEvent.entityType,
      integrationEvent.entityId,
      integrationEvent.detail,
    );
  }
  return result.event;
}
