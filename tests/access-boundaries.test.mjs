import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("enforces the office allowlist before rendering the operational app shell", async () => {
  const [page, protectedPage, auth, app] = await Promise.all([
    read("app/page.tsx"),
    read("app/OperationsRoutePage.tsx"),
    read("app/lib/workspace-auth.ts"),
    read("app/FloorOpsApp.tsx"),
  ]);
  const routePages = await Promise.all([
    "leads",
    "clients",
    "projects",
    "schedule",
    "inbox",
    "assistant",
    "reports",
    "settings",
  ].map((route) => read(`app/${route}/page.tsx`)));

  assert.match(auth, /export function officeIdentityForEmail/);
  assert.match(page, /OperationsRoutePage/);
  for (const routePage of routePages) assert.match(routePage, /OperationsRoutePage/);
  assert.match(protectedPage, /requireChatGPTUser\(returnPath\)/);
  assert.match(protectedPage, /officeIdentityForEmail\(user\.email\)/);
  assert.match(protectedPage, /Access not authorized/);
  assert.match(auth, /const user = officeIdentityForEmail\(email\)/);
  assert.match(protectedPage, /const officeUser = officeIdentityForEmail\(user\.email\)/);
  assert.match(protectedPage, /officeUser\.isAdmin \? "Admin" : "Office"/);
  assert.match(protectedPage, /accessLabel=\{accessLabel\}/);
  assert.match(app, /accessLabel: "Admin" \| "Office"/);
  assert.match(app, /\{userEmail\} · \{accessLabel\}/);
  assert.doesNotMatch(app, /Administrator/);
  assert.doesNotMatch(auth, /isLocalDevelopmentIdentity/);
  assert.match(auth, /if \(!email \|\| !isAllowedOfficeEmail\(email\)\) return null/);
  assert.match(auth, /developmentEmail === email/);
  assert.match(auth, /const hostname = request\.nextUrl\.hostname\.toLowerCase\(\)/);
  assert.match(auth, /hostname !== "localhost"/);
});

test("requires and revalidates the explicitly approved Workspace connection account", async () => {
  const [oauth, d1] = await Promise.all([
    read("app/lib/google-oauth.ts"),
    read("app/adapters/d1/google-oauth-persistence.ts"),
  ]);

  assert.match(oauth, /approved Google Workspace connection account/);
  assert.match(oauth, /googleAccountIsAllowed\(config, connection\.googleEmail\)/);
  assert.match(d1, /account_no_longer_allowed/);
  assert.match(d1, /status = 'reauthorization-required'/);
});

test("scopes dashboard Gmail archive totals to the active Google connection", async () => {
  const dashboard = await read("app/api/v1/dashboard/route.ts");

  assert.match(dashboard, /getGoogleRuntimeConfig/);
  assert.match(dashboard, /gmail_file_archives WHERE connection_key = \? AND status = 'filed'/);
  assert.match(dashboard, /bind\(google\.connectionKey\)/);
});

test("task mutations reject non-office identities before body or database work", async () => {
  const previousEnvironment = globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = {
    FCI_OFFICE_EMAILS: "office@example.test",
    FCI_ADMIN_EMAILS: "office@example.test",
    DB: {
      prepare() {
        throw new Error("Non-office task requests must not reach database work.");
      },
      batch() {
        throw new Error("Non-office task requests must not reach database work.");
      },
    },
  };
  const vite = await createServer({
    root: fileURLToPath(root),
    cacheDir: fileURLToPath(new URL("../node_modules/.vite-task-access-boundaries", import.meta.url)),
    configFile: false,
    appType: "custom",
    resolve: {
      alias: {
        "cloudflare:workers": fileURLToPath(
          new URL("fixtures/cloudflare-workers.mjs", import.meta.url),
        ),
      },
    },
    server: { middlewareMode: true, hmr: { port: 24714 } },
  });
  try {
    const tasksRoute = await vite.ssrLoadModule("/app/api/v1/tasks/route.ts");
    const url = new URL("https://fci.example.test/api/v1/tasks");
    const request = new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://fci.example.test",
        "oai-authenticated-user-email": "outsider@example.test",
      },
      body: JSON.stringify({ title: "Must not be accepted" }),
    });
    Object.defineProperty(request, "nextUrl", { value: url });
    const response = await tasksRoute.POST(request);

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Your account is not allowed to access this workspace.",
    });
  } finally {
    await vite.close();
    if (previousEnvironment === undefined) delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
    else globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = previousEnvironment;
  }
});
