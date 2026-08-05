import type { FeatureState } from "../components/FeatureStateBadge";

export const SETTINGS_CALENDAR_STATUS_PATH = "/api/v1/google-workspace";
// There is deliberately no directory-status path here. The Sheet mirror is loaded once by
// FloorOpsApp's bootstrap (a raw fetch that cannot dedupe against client-get-cache) and handed
// down as a prop; giving the nav its own constant to fetch reintroduces a second request per
// Settings load, which the fix15 N7-7 and SET-11 sequence mocks both catch.

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function calendarSettingsFeatureState(payload: unknown): FeatureState {
  if (!isRecord(payload) || !isRecord(payload.workspace) || !isRecord(payload.workspace.calendars)) {
    return "Setup required";
  }
  const clientAppointments = payload.workspace.calendars.clientAppointments;
  const fieldSchedule = payload.workspace.calendars.fieldSchedule;
  return payload.workspace.connectionStatus === "connected"
    && payload.workspace.calendarEnabled === true
    && payload.workspace.calendarConnected === true
    && isRecord(clientAppointments)
    && clientAppointments.configured === true
    && isRecord(fieldSchedule)
    && fieldSchedule.configured === true
    ? "Working"
    : "Setup required";
}

export function directorySettingsFeatureState(payload: unknown): FeatureState {
  if (!isRecord(payload) || !isRecord(payload.mirror)) return "Setup required";
  return payload.mirror.configured === true
    && payload.mirror.enabled === true
    && payload.mirror.connected === true
    ? "Working"
    : "Setup required";
}
