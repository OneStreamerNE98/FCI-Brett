import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const vite = await createServer({
  root: rootPath,
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-set40-effective-config", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24782 } },
});

const [sites, effective, chat, runtimeConfigRoute] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
  vite.ssrLoadModule("/app/lib/workspace-effective-config.ts"),
  vite.ssrLoadModule("/app/lib/google-chat-notifier.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/config/route.ts"),
]);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function routeRequest(body) {
  const url = new URL("https://fci.example.test/api/v1/integrations/google/config");
  const request = new Request(url, {
    method: "PATCH",
    headers: {
      origin: url.origin,
      "content-type": "application/json",
      "oai-authenticated-user-email": "admin@example.test",
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("getConnectionScope executes synchronously without reading DB", () => {
  const input = {
    NODE_ENV: "development",
    GOOGLE_INTEGRATION_MODE: "simulation",
    get DB() {
      throw new Error("getConnectionScope must never read DB");
    },
  };
  const scope = sites.getConnectionScope(input);
  assert.equal(scope instanceof Promise, false);
  assert.deepEqual(scope, {
    connectionKey: "workspace-simulation",
    simulation: true,
  });
  assert.ok(Object.isFrozen(scope));
});

test("shared text and boolean resolvers pin app-first bootstrap semantics", () => {
  assert.deepEqual(
    effective.resolveEffectiveTextConfiguration("app-value", "environment-value"),
    { value: "app-value", source: "app" },
  );
  assert.deepEqual(
    effective.resolveEffectiveTextConfiguration(null, "environment-value"),
    { value: "environment-value", source: "environment" },
  );
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(false, "true"),
    { value: false, source: "app" },
  );
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(undefined, "true"),
    { value: true, source: "environment" },
  );
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(undefined, "TRUE"),
    { value: false, source: "none" },
  );
});

test("Drive preserves its normalized legacy gate while Chat remains literal-only", () => {
  const drive = sites.getGoogleRuntimeConfig({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED: " TRUE ",
  });
  assert.equal(drive.provisioningEnabled, true);
  assert.equal(drive.driveProvisioningEnvironmentValue, "true");
  assert.deepEqual(
    effective.resolveEffectiveBooleanConfiguration(
      undefined,
      drive.driveProvisioningEnvironmentValue,
    ),
    { value: true, source: "environment" },
  );
  assert.deepEqual(
    chat.googleChatNotificationsResolution({
      GOOGLE_CHAT_NOTIFICATIONS_ENABLED: " TRUE ",
    }),
    { value: false, source: "none" },
  );
});

test("simulation rejects Drive provisioning writes after validation and before persistence", async () => {
  let databaseCalls = 0;
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: "admin@example.test",
    FCI_ADMIN_EMAILS: "admin@example.test",
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: {
      prepare() {
        databaseCalls += 1;
        throw new Error("simulation configuration must not touch persistence");
      },
    },
  });

  const invalid = await runtimeConfigRoute.PATCH(routeRequest({
    driveProvisioningEnabled: false,
    extra: true,
  }));
  assert.equal(invalid.status, 400);

  const response = await runtimeConfigRoute.PATCH(routeRequest({
    driveProvisioningEnabled: false,
  }));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Drive provisioning is always enabled in simulation and cannot be changed.",
    code: "simulation_configuration_fixed",
  });
  assert.equal(databaseCalls, 0);
});

test("hot list GET handlers use only the synchronous connection scope", async () => {
  const routes = [
    "app/api/v1/clients/route.ts",
    "app/api/v1/projects/route.ts",
    "app/api/v1/tasks/route.ts",
    "app/api/v1/leads/route.ts",
    "app/api/v1/dashboard/route.ts",
    "app/api/v1/integrations/google/operations/route.ts",
  ];
  for (const relative of routes) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), "utf8");
    assert.match(source, /getConnectionScope\(\)/u, relative);
    const getHandler = source.split("export async function GET", 2)[1]?.split(/\nexport async function /u, 1)[0] ?? "";
    assert.doesNotMatch(getHandler, /getEffectiveGoogleRuntime(?:Config|Setup)\(/u, relative);
  }
});

test("spreadsheet adoption fields remain Administrator-only while their sources stay explicit", async () => {
  const panel = await readFile(
    new URL("../app/settings/components/GoogleWorkspacePanel.tsx", import.meta.url),
    "utf8",
  );
  const checklist = await readFile(
    new URL("../app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "Client Directory spreadsheet ID",
    "Lead-form response spreadsheet ID",
  ]) {
    const start = panel.indexOf(`aria-label="${label}"`);
    assert.notEqual(start, -1, label);
    assert.match(
      panel.slice(start, start + 500),
      /disabled=\{!isAdmin \|\| runtimeConfigurationWorking !== null\}/u,
      label,
    );
  }
  assert.match(panel, /Source: \{effectiveConfigurationSourceLabel/u);
  assert.match(checklist, /\{isAdmin && environmentNotes\}/u);
});

test("Forms review queue consumes every effective Sheet source and points remediation to Stage 1 adoption", async () => {
  const panel = await readFile(
    new URL("../app/settings/components/DirectorySyncPanel.tsx", import.meta.url),
    "utf8",
  );
  const parser = panel.slice(
    panel.indexOf("function parseFormLeadIntakeState"),
    panel.indexOf("function responseError"),
  );
  assert.match(
    parser,
    /\["simulation", "app-saved", "environment", "none"\]\.includes\(String\(value\.configurationSource\)\)/u,
  );
  assert.match(
    parser,
    /configurationSource: value\.configurationSource as FormLeadIntakeState\["configurationSource"\]/u,
  );
  const sourceLabeler = panel.slice(
    panel.indexOf("function formLeadConfigurationSourceLabel"),
    panel.indexOf("function responseError"),
  );
  assert.match(sourceLabeler, /source === "simulation"\) return "Simulation fixture"/u);
  assert.match(sourceLabeler, /source === "app-saved"\) return "App-saved"/u);
  assert.match(sourceLabeler, /source === "environment"\) return "Environment \(bootstrap fallback\)"/u);
  assert.match(sourceLabeler, /return "None"/u);
  assert.match(
    panel,
    /Effective source: <strong>\{formLeadConfigurationSourceLabel\(intake\.configurationSource\)\}<\/strong>/u,
  );
  assert.match(panel, /Google Workspace → Stage 1[\s\S]+<strong>Verify and adopt<\/strong>/u);
  assert.match(panel, /configurationName\}<\/code> is only a hosted bootstrap fallback/u);
  assert.doesNotMatch(panel, /Set <code>\{intake\.configurationName\}<\/code> in the hosted environment/u);
});

test("simulation presents Drive provisioning as forced and cannot claim a saved toggle", async () => {
  const [panel, guide] = await Promise.all([
    readFile(
      new URL("../app/settings/components/GoogleWorkspacePanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../docs/settings-guide.md", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /if \(!isAdmin \|\| simulation\) return;/u);
  assert.match(panel, /Source: \{simulation \? "Simulation fixture \(always enabled\)"/u);
  assert.match(panel, /disabled=\{simulation \|\| runtimeConfigurationWorking !== null\}/u);
  assert.match(panel, /simulation \? "Always enabled in simulation"/u);
  assert.match(guide, /Simulation fixture \(always enabled\)[\s\S]+neither the UI nor the API can save a misleading future live-mode value/u);
});

const COVERED_ENVIRONMENT_NAMES = Object.freeze([
  "GOOGLE_WORKSPACE_SHARED_DRIVE_ID",
  "GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID",
  "GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID",
  "GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID",
  "GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID",
  "GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED",
  "GOOGLE_CHAT_NOTIFICATIONS_ENABLED",
  "OPENAI_MODEL",
]);
const COVERED_TOP_LEVEL_CONFIGURATION_PROPERTIES = Object.freeze([
  "clientDirectorySheetId",
  "clientAppointmentsCalendarId",
  "fieldScheduleCalendarId",
  "leadFormResponseSheetId",
  "provisioningEnabled",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoRawResolverReads(source, relative) {
  for (const name of COVERED_ENVIRONMENT_NAMES) {
    const escaped = escapeRegex(name);
    const rawRead = new RegExp(
      `(?:process\\.env|environment|env)\\s*(?:\\.\\s*${escaped}|\\[\\s*["']${escaped}["']\\s*\\])`,
      "u",
    );
    assert.doesNotMatch(source, rawRead, `${relative} reads ${name} outside its resolver owner`);
  }

  const topLevel = COVERED_TOP_LEVEL_CONFIGURATION_PROPERTIES.map(escapeRegex).join("|");
  const destructured = `(?:${topLevel}|rootFolderId)`;
  const directAccess = new RegExp(
    `getGoogleRuntimeConfig\\([^;)]*\\)\\s*(?:(?:\\.\\s*(?:${topLevel}))|(?:\\[\\s*["'](?:${topLevel})["']\\s*\\])|(?:\\.\\s*drive\\s*\\.\\s*rootFolderId))`,
    "u",
  );
  assert.doesNotMatch(
    source,
    directAccess,
    `${relative} chains a resolver-covered field from raw configuration`,
  );
  for (const directDestructuring of source.matchAll(
    /(?:const|let)\s*\{([^;]*?)\}\s*=\s*getGoogleRuntimeConfig\([^;]*\)\s*;/gu,
  )) {
    assert.doesNotMatch(
      directDestructuring[1],
      new RegExp(`\\b${destructured}\\b`, "u"),
      `${relative} destructures a resolver-covered field from raw configuration`,
    );
  }

  for (const assignment of source.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*getGoogleRuntimeConfig\([^;]*\);/gu,
  )) {
    const variable = escapeRegex(assignment[1]);
    const boundAccess = new RegExp(
      `(?<!\\.)\\b${variable}\\s*(?:(?:\\.\\s*(?:${topLevel}))|(?:\\[\\s*["'](?:${topLevel})["']\\s*\\])|(?:\\.\\s*drive\\s*\\.\\s*rootFolderId))`,
      "u",
    );
    assert.doesNotMatch(
      source,
      boundAccess,
      `${relative} reads a resolver-covered field from raw ${assignment[1]}`,
    );
    for (const boundDestructuring of source.matchAll(
      new RegExp(`(?:const|let)\\s*\\{([^;]*?)\\}\\s*=\\s*${variable}\\s*;`, "gu"),
    )) {
      assert.doesNotMatch(
        boundDestructuring[1],
        new RegExp(`\\b${destructured}\\b`, "u"),
        `${relative} destructures a resolver-covered field from raw ${assignment[1]}`,
      );
    }
  }
}

test("raw-reader guard catches direct and bound destructuring mutations", () => {
  assert.throws(
    () => assertNoRawResolverReads(
      "const { provisioningEnabled } = getGoogleRuntimeConfig();",
      "direct-destructuring-fixture.ts",
    ),
    /destructures a resolver-covered field/u,
  );
  assert.throws(
    () => assertNoRawResolverReads(
      "const raw = getGoogleRuntimeConfig(); const { leadFormResponseSheetId: sheet } = raw;",
      "bound-destructuring-fixture.ts",
    ),
    /destructures a resolver-covered field/u,
  );
  assert.throws(
    () => assertNoRawResolverReads(
      "const { drive: { rootFolderId } } = getGoogleRuntimeConfig();",
      "nested-destructuring-fixture.ts",
    ),
    /destructures a resolver-covered field/u,
  );
});

test("resolver-covered environment values have no raw readers outside their owners", async () => {
  const allowed = new Set([
    "app/lib/google-oauth.ts",
    "app/lib/workspace-effective-config.ts",
    "app/lib/google-chat-notifier.ts",
    "app/lib/assistant-config-sites.ts",
  ]);
  const entries = await readdir(new URL("../app", import.meta.url), {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
    const absolute = `${entry.parentPath.replaceAll("\\", "/")}/${entry.name}`;
    const relative = absolute.slice(rootPath.replaceAll("\\", "/").length);
    if (allowed.has(relative)) continue;
    const source = await readFile(absolute, "utf8");
    assertNoRawResolverReads(source, relative);
  }
});
