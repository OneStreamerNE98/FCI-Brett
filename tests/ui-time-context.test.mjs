import assert from "node:assert/strict";
import test from "node:test";
import { dashboardTimeContext, friendlyFirstName } from "../app/lib/time-context.ts";

test("uses the saved timezone for morning, afternoon, and evening greetings", () => {
  assert.equal(dashboardTimeContext(Date.parse("2026-07-12T13:00:00Z"), "America/New_York").greeting, "Good morning");
  assert.equal(dashboardTimeContext(Date.parse("2026-07-12T18:00:00Z"), "America/New_York").greeting, "Good afternoon");
  assert.equal(dashboardTimeContext(Date.parse("2026-07-12T23:00:00Z"), "America/New_York").greeting, "Good evening");
});

test("falls back safely for an invalid timezone", () => {
  const context = dashboardTimeContext(Date.parse("2026-07-12T23:00:00Z"), "Invalid/Timezone");
  assert.equal(context.timezone, "America/New_York");
  assert.equal(context.greeting, "Good evening");
});

test("uses the account name or derives a friendly first name from email", () => {
  assert.equal(friendlyFirstName("Jason Grass", "jason.grass@example.com"), "Jason");
  assert.equal(friendlyFirstName("jason.grass@example.com", "jason.grass@example.com"), "Jason");
  assert.equal(friendlyFirstName("", ""), null);
});
