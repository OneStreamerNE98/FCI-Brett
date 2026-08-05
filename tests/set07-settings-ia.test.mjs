import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calendarSettingsFeatureState,
  directorySettingsFeatureState,
} from "../app/lib/settings-feature-state.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("SET-07 derives the Calendar badge only from the SET-05 payload", () => {
  assert.equal(calendarSettingsFeatureState(undefined), "Setup required");
  assert.equal(calendarSettingsFeatureState({ workspace: { calendars: {} } }), "Setup required");
  assert.equal(calendarSettingsFeatureState({
    workspace: {
      connectionStatus: "connected",
      calendarEnabled: true,
      calendarConnected: true,
      calendars: {
        clientAppointments: { configured: true },
        fieldSchedule: { configured: false },
      },
    },
  }), "Setup required");
  assert.equal(calendarSettingsFeatureState({
    workspace: {
      connectionStatus: "connected",
      calendarEnabled: true,
      calendarConnected: true,
      calendars: {
        clientAppointments: { configured: true },
        fieldSchedule: { configured: true },
      },
    },
  }), "Working");
  assert.equal(calendarSettingsFeatureState({
    workspace: {
      connectionStatus: "disconnected",
      calendarEnabled: true,
      calendarConnected: true,
      calendars: {
        clientAppointments: { configured: true },
        fieldSchedule: { configured: true },
      },
    },
  }), "Setup required");
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

test("DES-16 keeps the derived state a data attribute and the build vocabulary out of the Settings nav", async () => {
  const [navigation, styles, declaration] = await Promise.all([
    read("app/settings/components/SettingsAudienceNavigation.tsx"),
    read("app/settings/components/SettingsAudienceNavigation.module.css"),
    read("app/settings/components/SettingsAudienceNavigation.module.css.d.ts"),
  ]);

  assert.match(navigation, /data-settings-feature-state=\{state\}/);
  assert.doesNotMatch(navigation, /<FeatureStateBadge/);
  assert.doesNotMatch(navigation, /styles\.badge/);
  assert.doesNotMatch(navigation, /className="sr-only" id=\{stateId\}/);
  assert.doesNotMatch(navigation, /aria-describedby/);
  assert.doesNotMatch(styles, /^\.badge\b/mu);

  // The hand-maintained CSS-module declaration must cover exactly what the component consumes.
  for (const consumed of [...navigation.matchAll(/styles\.([A-Za-z0-9_]+)/gu)].map((match) => match[1])) {
    assert.match(declaration, new RegExp(`^  ${consumed}: string;$`, "mu"), `${consumed} must be declared`);
  }
});
