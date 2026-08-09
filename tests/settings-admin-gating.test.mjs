import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function sourceSection(source, start, end, label) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label} start marker must remain present`);
  if (end === null) return source.slice(startIndex);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label} end marker must remain present`);
  assert.ok(endIndex > startIndex, `${label} markers must remain ordered`);
  return source.slice(startIndex, endIndex);
}

const settingsMutationRoutes = [
  "app/api/v1/assistant/config/route.ts",
  // SET-08 launch attestation mutation; kept separate from the Workspace defaults route.
  "app/api/v1/settings/launch-checklist/route.ts",
  "app/api/v1/settings/workspace/route.ts",
  "app/api/v1/integrations/google/chat/config/route.ts",
  "app/api/v1/integrations/google/simulation/reset/route.ts",
  "app/api/v1/integrations/google/authorize/route.ts",
  "app/api/v1/integrations/google/drive/verify/route.ts",
  "app/api/v1/integrations/google/drive/shared-drive/adopt/route.ts",
  "app/api/v1/integrations/google/drive/folders/ensure-roots/route.ts",
  "app/api/v1/integrations/google/drive/folders/rename/route.ts",
  "app/api/v1/integrations/google/drive/templates/ensure/route.ts",
  "app/api/v1/integrations/google/connection/route.ts",
  "app/api/v1/integrations/google/gmail/labels/prepare/route.ts",
  "app/api/v1/integrations/google/gmail/send-test/route.ts",
  "app/api/v1/integrations/google/calendar/test-hold/route.ts",
  "app/api/v1/integrations/google/sheets/sync/route.ts",
  "app/api/v1/integrations/google/sheets/ensure/route.ts",
  "app/api/v1/integrations/google/setup/blueprint/route.ts",
  "app/api/v1/integrations/google/setup/reconcile/route.ts",
];

test("exposes the authenticated user's Administrator flag through the shared account request", async () => {
  const [accountRoute, app, myAccount, cache] = await Promise.all([
    read("app/api/v1/settings/me/route.ts"),
    read("app/FloorOpsApp.tsx"),
    read("app/settings/components/MySettingsPanel.tsx"),
    read("app/lib/client-get-cache.ts"),
  ]);

  assert.match(accountRoute, /isAdmin: auth\.user\.isAdmin/);
  assert.match(app, /cachedGetJson<[^;]+>\("\/api\/v1\/settings\/me"\)/);
  assert.match(app, /pageLayouts\?: unknown/);
  assert.match(myAccount, /cachedGetJson[^\n]+\("\/api\/v1\/settings\/me"/);
  assert.match(myAccount, /fetch\("\/api\/v1\/settings\/me", \{[\s\S]+method: "PATCH"/);
  // SET-42 serves a mounted stale value immediately while sharing the same
  // in-flight revalidation; a cold/forced caller awaits that one request.
  assert.match(cache, /if \(existing\?\.inFlight\) \{\s*if \(!options\.force && existing\.hasValue\) return Promise\.resolve\(existing\.value as T\);\s*return existing\.inFlight as Promise<T>;\s*\}/);
});

test("uses one reconciled Administrator flag for shell and Settings content gates", async () => {
  const app = await read("app/FloorOpsApp.tsx");
  const workspaceNavigationItems = sourceSection(app, "const workspaceNavItems", "const managementNavItems", "Workspace navigation item catalog");
  const managementNavigationItems = sourceSection(app, "const managementNavItems", "function optionalRecordNumber", "Management navigation item catalog");
  const shell = sourceSection(app, "export function FloorOpsApp", "function Overview", "FloorOpsApp shell");
  const settingsView = app.slice(app.indexOf("function SettingsView"));
  assert.ok(settingsView.startsWith("function SettingsView"), "SettingsView start anchor");

  assert.match(shell, /const \[isAdmin, setIsAdmin\] = useState\(accessLabel === "Admin"\)/);
  assert.equal([...shell.matchAll(/accessLabel === "Admin"/g)].length, 1);
  assert.match(shell, /useState<PageLayouts>\(\(\) => defaultPageLayouts\(isAdmin\)\)/);
  assert.match(shell, /const nextIsAdmin = data\?\.isAdmin === true/);
  assert.match(shell, /const failClosedCurrentUserSettings = useCallback\(\(\) => \{[\s\S]+setIsAdmin\(false\)/);
  assert.equal([...shell.matchAll(/failClosedCurrentUserSettings\(\);/g)].length, 3);
  assert.match(shell, /isTerminalCachedGetError\(error\)[\s\S]{0,120}failClosedCurrentUserSettings\(\)/);
  assert.match(shell, /onCurrentUserSettingsLoaded=\{reconcileCurrentUserSettings\}/);
  assert.deepEqual(
    [...workspaceNavigationItems.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]),
    ["Overview", "Leads", "Clients", "Projects", "Inbox", "AI Assistant"],
  );
  assert.deepEqual(
    [...managementNavigationItems.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]),
    ["Reports", "Settings"],
  );
  assert.doesNotMatch(workspaceNavigationItems, /Schedule|Settings|Reports/);
  assert.doesNotMatch(managementNavigationItems, /Schedule|AI Assistant/);
  assert.match(shell, /managementNavItems\.filter\(\(\{ label \}\) => label !== "Settings" \|\| isAdmin\)\.map/);
  assert.match(shell, /\{isAdmin && <a href="\/management\/access"/);
  assert.match(shell, /Client Directory<\/button>\{isAdmin && <><button onClick=\{openDirectorySettings\}/);
  assert.match(shell, /\{isAdmin && <button onClick=\{openGoogleWorkspace\}><Building2 size=\{15\} \/> Google connection<\/button>\}/);
  assert.match(shell, /<SettingsView[^>]+isAdmin=\{isAdmin\}/);
  assert.doesNotMatch(shell, /accessLabel === "Admin" &&/);
  assert.match(
    settingsView,
    /const headingText = isAdmin && visibleSection !== "My settings"\s+\? "Manage shared Workspace, company defaults, security, and launch-readiness settings\."\s+: "Manage the preferences tied to your signed-in FCI account\."/,
  );
  assert.doesNotMatch(settingsView, /Manage your own preferences separately from Workspace and company setup\./);

  const mySettings = await read("app/settings/components/MySettingsPanel.tsx");
  assert.match(mySettings, /typeof data\.isAdmin !== "boolean"/);
  assert.match(mySettings, /onSettingsLoaded\(\{[\s\S]+isAdmin: data\.isAdmin/);
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
  const [connectionSource, resourcesSource, blueprintSource] = await Promise.all([
    read("app/api/v1/integrations/google/connection/route.ts"),
    read("app/api/v1/integrations/google/setup/resources/route.ts"),
    read("app/api/v1/integrations/google/setup/blueprint/route.ts"),
  ]);
  const handlers = [
    sourceSection(connectionSource, "export async function GET", "export async function DELETE", "connection GET handler"),
    sourceSection(resourcesSource, "export async function GET", null, "resources GET handler"),
    sourceSection(blueprintSource, "export async function GET", "export async function PUT", "blueprint GET handler"),
  ];

  for (const getHandler of handlers) {
    assert.match(getHandler, /requireOfficeUser\(request, \{ admin: true \}\)/);
    assert.ok(getHandler.indexOf("requireOfficeUser") < getHandler.indexOf("ensureWorkspaceSchema"));
    assert.ok(getHandler.indexOf('if ("response" in auth) return auth.response') < getHandler.indexOf("ensureWorkspaceSchema"));
  }
});

test("isolates rendered role tests from contributor environment files", async () => {
  const [viteConfig, collaborationGuide, continuousIntegration] = await Promise.all([
    read("vite.config.ts"),
    read("docs/specs/collaboration-and-sharing.md"),
    read(".github/workflows/ci.yml"),
  ]);

  assert.match(viteConfig, /envFile: isE2eRuntime \? false : undefined/);
  assert.match(viteConfig, /process\.env\.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false"/);
  assert.match(collaborationGuide, /FCI_E2E=true[^\n]+disables Vite environment-file loading[^\n]+Cloudflare Worker[^\n]+\.env\.local[^\n]+does not disable explicit `\.dev\.vars` bindings/);
  assert.match(continuousIntegration, /FCI_OFFICE_EMAILS: e2e-admin@example\.test,e2e-office@example\.test/);
});
