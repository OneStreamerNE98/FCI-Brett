import type { GoogleWorkspaceMode } from "./google-oauth";

export type GoogleIntegrationEventSpec = Readonly<{
  eventType: string;
  entityType: string;
  entityId: string;
  detail: string;
}>;

function eventSpec(
  eventType: string,
  entityType: string,
  entityId: string,
  detail: string,
): GoogleIntegrationEventSpec {
  return Object.freeze({ eventType, entityType, entityId, detail });
}

function boundedCount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

export function gmailArchiveApprovedIntegrationEvent(
  mode: GoogleWorkspaceMode,
  projectId: string,
) {
  return eventSpec(
    "gmail.archive_approved",
    "project",
    projectId,
    `mode=${mode};inbox_retained=true`,
  );
}

export function gmailArchiveFiledIntegrationEvent(
  mode: GoogleWorkspaceMode,
  projectId: string,
  attachmentCount: number,
) {
  return eventSpec(
    "gmail.archive_filed",
    "project",
    projectId,
    `mode=${mode};attachment_count=${boundedCount(attachmentCount, "Attachment count")};inbox_retained=true`,
  );
}

export function gmailArchiveFailedIntegrationEvent(
  mode: GoogleWorkspaceMode,
  projectId: string,
  code: string,
) {
  return eventSpec(
    "gmail.archive_failed",
    "project",
    projectId,
    `mode=${mode};code=${code}`,
  );
}

export function calendarEventsListedIntegrationEvent(
  calendarId: string,
  window: Readonly<{ start: string; end: string }>,
  count: number,
) {
  return eventSpec(
    "calendar.workspace_events_listed",
    "calendar",
    calendarId,
    `window=${window.start}/${window.end};count=${boundedCount(count, "Calendar event count")}`,
  );
}

export function calendarHoldCreatedIntegrationEvent(event: Readonly<{
  id: string;
  start: string;
  end: string;
}>) {
  return eventSpec(
    "calendar.workspace_hold_created",
    "calendar_event",
    event.id,
    `start=${event.start};end=${event.end};visibility=private;attendees=none;notifications=none`,
  );
}

export function sheetsDirectorySyncedIntegrationEvent(
  spreadsheetId: string,
  counts: Readonly<{ clients: number; projects: number }>,
) {
  return eventSpec(
    "sheets.directory.synced",
    "google-sheet",
    spreadsheetId,
    JSON.stringify({
      clients: boundedCount(counts.clients, "Client row count"),
      projects: boundedCount(counts.projects, "Project row count"),
    }),
  );
}
