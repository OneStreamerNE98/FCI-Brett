import type { FeatureState } from "../components/FeatureStateBadge";

export const SETTINGS_CALENDAR_STATUS_PATH = "/api/v1/google-workspace";
export const SETTINGS_DIRECTORY_STATUS_PATH = "/api/v1/integrations/google/sheets/status";

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
