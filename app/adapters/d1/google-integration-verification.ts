import type { D1Database } from "./d1-database";

const GMAIL_TEST_SENT_EVENT = "gmail.test_sent";
const CALENDAR_EVENTS_LISTED_EVENT = "calendar.workspace_events_listed";
const CALENDAR_HOLD_CREATED_EVENT = "calendar.workspace_hold_created";

type GoogleIntegrationEventRow = Readonly<{
  event_type: string;
}>;

export type GoogleIntegrationVerification = Readonly<{
  gmailTestEmailPassed: boolean;
  calendarChecked: boolean;
}>;

/**
 * Reads the durable, secret-free Stage-4 verification latches already written
 * by the Gmail and Calendar routes. The events remain the audit source of
 * truth; this projection only answers whether each verification passed since
 * the latest successful OAuth connection (or ever, for simulation/legacy data).
 */
export async function readGoogleIntegrationVerification(
  database: Pick<D1Database, "prepare">,
  connectionKey: string,
): Promise<GoogleIntegrationVerification> {
  const { results } = await database
    .prepare(
      "SELECT event_type FROM google_integration_events WHERE connection_key = ? AND created_at >= COALESCE((SELECT MAX(created_at) FROM google_integration_events WHERE connection_key = ? AND event_type = ?), 0) AND event_type IN (?, ?, ?) GROUP BY event_type",
    )
    .bind(
      connectionKey,
      connectionKey,
      "oauth.connected",
      GMAIL_TEST_SENT_EVENT,
      CALENDAR_EVENTS_LISTED_EVENT,
      CALENDAR_HOLD_CREATED_EVENT,
    )
    .all<GoogleIntegrationEventRow>();
  const eventTypes = new Set(results.map((row) => row.event_type));
  return Object.freeze({
    gmailTestEmailPassed: eventTypes.has(GMAIL_TEST_SENT_EVENT),
    calendarChecked: (
      eventTypes.has(CALENDAR_EVENTS_LISTED_EVENT)
      || eventTypes.has(CALENDAR_HOLD_CREATED_EVENT)
    ),
  });
}
