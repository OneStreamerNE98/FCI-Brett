import {
  GoogleIntegrationError,
  assertGoogleService,
  getGoogleAccessToken,
  type GoogleRuntimeConfig,
  writeGoogleIntegrationEvent,
} from "./google-oauth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UPCOMING_EVENTS = 20;
const TEST_HOLD_DURATION_MS = 30 * 60 * 1000;

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
};

export type CalendarEventSummary = {
  id: string;
  title: string;
  status: string;
  start: string;
  end: string;
  url?: string;
};

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

function requireWorkspaceCalendarId(config: GoogleRuntimeConfig) {
  assertGoogleService(config, "calendar");
  const calendarId = config.clientAppointmentsCalendarId?.trim();
  if (!config.oauthReady || !calendarId) {
    throw new GoogleIntegrationError(
      "calendar_configuration_required",
      "Complete the Google Workspace Calendar setup before using appointments.",
      409,
    );
  }
  return calendarId;
}

export class GoogleCalendarClient {
  constructor(private readonly accessToken: string, private readonly config: GoogleRuntimeConfig) {}

  private workspaceCalendarId() {
    return requireWorkspaceCalendarId(this.config);
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    this.workspaceCalendarId();
    let response: Response;
    try {
      response = await fetch(`${CALENDAR_API}/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
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
        throw new GoogleIntegrationError("calendar_rate_limited", "Google Calendar is busy. Try again shortly.", 503);
      }
      throw new GoogleIntegrationError("calendar_request_failed", "Google Calendar could not complete that operation. Try again.", 503);
    }
    return data as T;
  }

  async listUpcomingEvents(now = new Date()) {
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
    const result = await this.request<{ items?: CalendarApiEvent[] }>(`calendars/${calendarId}/events?${query.toString()}`);
    return {
      window: { start: timeMin, end: timeMax },
      events: (result.items ?? []).map(safeEvent).filter((event): event is CalendarEventSummary => event !== null),
    };
  }

  async createTestHold(start: Date) {
    const end = new Date(start.getTime() + TEST_HOLD_DURATION_MS);
    const query = new URLSearchParams({ sendUpdates: "none", conferenceDataVersion: "0" });
    const calendarId = encodeURIComponent(this.workspaceCalendarId());
    const result = await this.request<CalendarApiEvent>(`calendars/${calendarId}/events?${query.toString()}`, {
      method: "POST",
      body: JSON.stringify({
        summary: "FCI Operations — Workspace test appointment",
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        visibility: "private",
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        guestsCanSeeOtherGuests: false,
        reminders: { useDefault: false, overrides: [] },
      }),
    });
    const event = safeEvent(result);
    if (!event) {
      throw new GoogleIntegrationError("calendar_invalid_response", "Google Calendar created a test hold without the expected details. Check Calendar before retrying.", 503);
    }
    return event;
  }
}

export async function listWorkspaceCalendarEvents(config: GoogleRuntimeConfig, actor: string) {
  const calendarId = requireWorkspaceCalendarId(config);
  const calendar = new GoogleCalendarClient(await getGoogleAccessToken(config, "calendar"), config);
  const result = await calendar.listUpcomingEvents();
  await writeGoogleIntegrationEvent(
    config,
    "calendar.workspace_events_listed",
    actor,
    "calendar",
    calendarId,
    `window=${result.window.start}/${result.window.end};count=${result.events.length}`,
  );
  return result;
}

export async function createWorkspaceCalendarHold(config: GoogleRuntimeConfig, actor: string, start: Date) {
  requireWorkspaceCalendarId(config);
  const calendar = new GoogleCalendarClient(await getGoogleAccessToken(config, "calendar"), config);
  const event = await calendar.createTestHold(start);
  await writeGoogleIntegrationEvent(
    config,
    "calendar.workspace_hold_created",
    actor,
    "calendar_event",
    event.id,
    `start=${event.start};end=${event.end};visibility=private;attendees=none;notifications=none`,
  );
  return event;
}
