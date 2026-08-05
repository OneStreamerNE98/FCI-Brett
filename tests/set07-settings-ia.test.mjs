import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarSettingsFeatureState,
  directorySettingsFeatureState,
} from "../app/lib/settings-feature-state.ts";

test("SET-07 derives the Calendar badge only from the SET-05 payload", () => {
  assert.equal(calendarSettingsFeatureState(undefined), "Setup required");
  assert.equal(calendarSettingsFeatureState({ workspace: { calendars: {} } }), "Setup required");
  assert.equal(calendarSettingsFeatureState({
    workspace: {
      calendars: {
        clientAppointments: { configured: true },
        fieldSchedule: { configured: false },
      },
    },
  }), "Setup required");
  assert.equal(calendarSettingsFeatureState({
    workspace: {
      calendars: {
        clientAppointments: { configured: true },
        fieldSchedule: { configured: true },
      },
    },
  }), "Working");
});

test("SET-07 derives the Client Directory badge only from sheets/status", () => {
  assert.equal(directorySettingsFeatureState(undefined), "Setup required");
  assert.equal(directorySettingsFeatureState({ mirror: null }), "Setup required");
  assert.equal(directorySettingsFeatureState({
    mirror: { configured: true, enabled: true, connected: false },
  }), "Setup required");
  assert.equal(directorySettingsFeatureState({
    mirror: { configured: true, enabled: true, connected: true },
  }), "Working");
});
