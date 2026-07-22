import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const TEST_EMAIL = "admincrm@cherryhillfci.com";
const originalNodeEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = {
  FCI_OFFICE_EMAILS: TEST_EMAIL,
  FCI_ADMIN_EMAILS: TEST_EMAIL,
  DB: {
    prepare() {
      throw new Error("Oversized request bodies must be rejected before database work.");
    },
    batch() {
      throw new Error("Oversized request bodies must be rejected before database work.");
    },
  },
};

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-bounded-api-bodies", import.meta.url)),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false },
});

const [
  clientsRoute,
  projectsRoute,
  filingRuleRoute,
  accountSettingsRoute,
  workspaceSettingsRoute,
  googleChatConfigRoute,
  workspaceBlueprintRoute,
  sharedDriveAdoptRoute,
  driveFolderRenameRoute,
  driveFolderEnsureRoute,
  templateEnsureRoute,
  spreadsheetEnsureRoute,
] =
  await Promise.all([
    vite.ssrLoadModule("/app/api/v1/clients/route.ts"),
    vite.ssrLoadModule("/app/api/v1/projects/route.ts"),
    vite.ssrLoadModule("/app/api/v1/filing-rules/[ruleId]/route.ts"),
    vite.ssrLoadModule("/app/api/v1/settings/me/route.ts"),
    vite.ssrLoadModule("/app/api/v1/settings/workspace/route.ts"),
    vite.ssrLoadModule("/app/api/v1/integrations/google/chat/config/route.ts"),
    vite.ssrLoadModule("/app/api/v1/integrations/google/setup/blueprint/route.ts"),
    vite.ssrLoadModule("/app/api/v1/integrations/google/drive/shared-drive/adopt/route.ts"),
    vite.ssrLoadModule("/app/api/v1/integrations/google/drive/folders/rename/route.ts"),
    vite.ssrLoadModule("/app/api/v1/integrations/google/drive/folders/ensure-roots/route.ts"),
    vite.ssrLoadModule("/app/api/v1/integrations/google/drive/templates/ensure/route.ts"),
    vite.ssrLoadModule("/app/api/v1/integrations/google/sheets/ensure/route.ts"),
  ]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function oversizedRequest(path, method, maximumBytes) {
  const url = new URL(path, "https://fci.example.test");
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: url.origin,
      "oai-authenticated-user-email": TEST_EMAIL,
    },
    body: JSON.stringify({ value: "x".repeat(maximumBytes) }),
  });
}

const cases = [
  {
    name: "client creation",
    maximumBytes: 64_000,
    error: "Client details are too large.",
    invoke: (request) => clientsRoute.POST(request),
  },
  {
    name: "project creation",
    maximumBytes: 64_000,
    error: "Project details are too large.",
    invoke: (request) => projectsRoute.POST(request),
  },
  {
    name: "project action",
    method: "PATCH",
    maximumBytes: 64_000,
    error: "Project action is too large.",
    invoke: (request) => projectsRoute.PATCH(request),
  },
  {
    name: "filing-rule update",
    method: "PATCH",
    maximumBytes: 8_000,
    error: "Rule update is too large.",
    invoke: (request) => filingRuleRoute.PATCH(request, {
      params: Promise.resolve({ ruleId: "rule-1" }),
    }),
  },
  {
    name: "account-preference update",
    method: "PATCH",
    maximumBytes: 8_000,
    error: "Account preference update is too large.",
    invoke: (request) => accountSettingsRoute.PATCH(request),
  },
  {
    name: "workspace-settings update",
    method: "PATCH",
    maximumBytes: 8_000,
    error: "Settings update is too large.",
    invoke: (request) => workspaceSettingsRoute.PATCH(request),
  },
  {
    name: "Google Chat notification settings update",
    method: "PATCH",
    maximumBytes: 8_000,
    error: "Google Chat notification settings are too large.",
    invoke: (request) => googleChatConfigRoute.PATCH(request),
  },
  {
    name: "Workspace blueprint update",
    method: "PUT",
    maximumBytes: 64 * 1024,
    error: "The Workspace blueprint request is too large.",
    invoke: (request) => workspaceBlueprintRoute.PUT(request),
  },
  {
    name: "Shared Drive adoption",
    maximumBytes: 8_000,
    error: "The Shared Drive adoption request is too large.",
    invoke: (request) => sharedDriveAdoptRoute.POST(request),
  },
  {
    name: "Drive root-folder rename",
    maximumBytes: 8_000,
    error: "The Drive folder rename request is too large.",
    invoke: (request) => driveFolderRenameRoute.POST(request),
  },
  {
    name: "Drive root-folder ensure",
    maximumBytes: 1_000,
    error: "The Drive root-folder ensure request is too large.",
    invoke: (request) => driveFolderEnsureRoute.POST(request),
  },
  {
    name: "Workspace template ensure",
    maximumBytes: 1_000,
    error: "The template ensure request is too large.",
    invoke: (request) => templateEnsureRoute.POST(request),
  },
  {
    name: "Workspace spreadsheet ensure",
    maximumBytes: 1_000,
    error: "The spreadsheet ensure request is too large.",
    invoke: (request) => spreadsheetEnsureRoute.POST(request),
  },
];

for (const scenario of cases) {
  test(`${scenario.name} uses the shared 413 oversized-body contract`, async () => {
    const response = await scenario.invoke(oversizedRequest(
      `/api/test/${encodeURIComponent(scenario.name)}`,
      scenario.method ?? "POST",
      scenario.maximumBytes,
    ));

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: scenario.error });
  });
}
