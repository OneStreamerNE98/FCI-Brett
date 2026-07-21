import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const settingsMutationRoutes = [
  "app/api/v1/settings/workspace/route.ts",
  "app/api/v1/integrations/google/chat/config/route.ts",
  "app/api/v1/integrations/google/simulation/reset/route.ts",
  "app/api/v1/integrations/google/authorize/route.ts",
  "app/api/v1/integrations/google/drive/verify/route.ts",
  "app/api/v1/integrations/google/connection/route.ts",
  "app/api/v1/integrations/google/gmail/labels/prepare/route.ts",
  "app/api/v1/integrations/google/gmail/send-test/route.ts",
  "app/api/v1/integrations/google/calendar/test-hold/route.ts",
  "app/api/v1/integrations/google/sheets/sync/route.ts",
];

test("exposes the authenticated user's Administrator flag through the shared account request", async () => {
  const [accountRoute, app, myAccount, cache] = await Promise.all([
    read("app/api/v1/settings/me/route.ts"),
    read("app/FloorOpsApp.tsx"),
    read("app/settings/components/MyAccountPanel.tsx"),
    read("app/lib/client-get-cache.ts"),
  ]);

  assert.match(accountRoute, /isAdmin: auth\.user\.isAdmin/);
  assert.match(app, /cachedGetJson<\{ preferences\?: \{ displayTimezone\?: unknown \}; isAdmin\?: unknown \}>\("\/api\/v1\/settings\/me"\)/);
  assert.match(myAccount, /cachedGetJson[^\n]+\("\/api\/v1\/settings\/me"/);
  assert.match(myAccount, /fetch\("\/api\/v1\/settings\/me", \{ method: "PATCH"/);
  assert.match(cache, /if \(!options\.force && existing\?\.inFlight\) return existing\.inFlight/);
});

test("keeps every existing Settings mutation gate enforced on the server", async () => {
  for (const routePath of settingsMutationRoutes) {
    const source = await read(routePath);
    assert.match(source, /requireOfficeUser\(request, \{ admin: true \}\)/, `${routePath} must remain Administrator-gated`);
  }

  const [gmailMessages, gmailFiling, calendarEvents] = await Promise.all([
    read("app/api/v1/integrations/google/gmail/messages/route.ts"),
    read("app/api/v1/integrations/google/gmail/messages/[messageId]/file/route.ts"),
    read("app/api/v1/integrations/google/calendar/events/route.ts"),
  ]);
  for (const source of [gmailMessages, gmailFiling, calendarEvents]) {
    assert.match(source, /requireOfficeUser\(request, \{ admin: true \}\)/);
  }
});

test("guards Administrator integration GETs before schema or persistence work", async () => {
  const [connectionSource, resourcesSource] = await Promise.all([
    read("app/api/v1/integrations/google/connection/route.ts"),
    read("app/api/v1/integrations/google/setup/resources/route.ts"),
  ]);
  const deleteStart = connectionSource.indexOf("export async function DELETE");
  const handlers = [
    connectionSource.slice(connectionSource.indexOf("export async function GET"), deleteStart),
    resourcesSource.slice(resourcesSource.indexOf("export async function GET")),
  ];

  assert.ok(deleteStart > connectionSource.indexOf("export async function GET"));
  for (const getHandler of handlers) {
    assert.match(getHandler, /requireOfficeUser\(request, \{ admin: true \}\)/);
    assert.ok(getHandler.indexOf("requireOfficeUser") < getHandler.indexOf("ensureWorkspaceSchema"));
    assert.ok(getHandler.indexOf('if ("response" in auth) return auth.response') < getHandler.indexOf("ensureWorkspaceSchema"));
  }
});

test("isolates rendered role tests from contributor environment files", async () => {
  const [viteConfig, collaborationGuide, continuousIntegration] = await Promise.all([
    read("vite.config.ts"),
    read("docs/collaboration-and-sharing.md"),
    read(".github/workflows/ci.yml"),
  ]);

  assert.match(viteConfig, /envFile: isE2eRuntime \? false : undefined/);
  assert.match(viteConfig, /process\.env\.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false"/);
  assert.match(collaborationGuide, /FCI_E2E=true[^\n]+disables Vite environment-file loading[^\n]+Cloudflare Worker[^\n]+\.env\.local[^\n]+does not disable explicit `\.dev\.vars` bindings/);
  assert.match(continuousIntegration, /FCI_OFFICE_EMAILS: e2e-admin@example\.test,e2e-office@example\.test/);
});
