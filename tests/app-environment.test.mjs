import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppEnvironment } from "../app/lib/app-environment.ts";

test("defaults the current Sites application to development", () => {
  assert.equal(resolveAppEnvironment(undefined), "development");
  assert.equal(resolveAppEnvironment("development"), "development");
  assert.equal(resolveAppEnvironment("staging"), "development");
});

test("requires an explicit production environment value", () => {
  assert.equal(resolveAppEnvironment("production"), "production");
  assert.equal(resolveAppEnvironment(" PRODUCTION "), "production");
});
