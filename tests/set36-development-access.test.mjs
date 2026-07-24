import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@example.test";
const OFFICE_EMAIL = "office@example.test";
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const routePath = "app/api/v1/settings/development-access/route.ts";
const componentPath = "app/settings/components/DataSecurityPanel.tsx";
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-set36-development-access", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24749 } },
});

const route = await vite.ssrLoadModule(`/${routePath}`);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function setEnvironment(overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_OFFICE_DOMAINS: "",
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    ...overrides,
  });
}

function routeRequest(email, origin = "https://fci.example.test") {
  const url = new URL("/api/v1/settings/development-access", origin);
  const request = new Request(url, {
    headers: email ? { "oai-authenticated-user-email": email } : {},
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("SET-36 GET preserves configured identifier spelling and order while exposing no unrelated environment value", async () => {
  const unrelatedSecret = "sk-set36-secret-never-return";
  setEnvironment({
    FCI_OFFICE_EMAILS: " Admin@Example.TEST , second@example.test, Admin@Example.TEST ",
    FCI_OFFICE_DOMAINS: " Example.COM, @Partner.Test ",
    FCI_ADMIN_EMAILS: "Admin@Example.TEST, SecondAdmin@example.test",
    OPENAI_API_KEY: unrelatedSecret,
    GOOGLE_WORKSPACE_CLIENT_SECRET: "google-secret-never-return",
  });

  const response = await route.GET(routeRequest("admin@example.test"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    officeEmails: [
      "Admin@Example.TEST",
      "second@example.test",
      "Admin@Example.TEST",
    ],
    officeDomains: ["Example.COM", "@Partner.Test"],
    adminEmails: ["Admin@Example.TEST", "SecondAdmin@example.test"],
  });
  assert.deepEqual(Object.keys(body).sort(), [
    "adminEmails",
    "officeDomains",
    "officeEmails",
  ]);
  assert.doesNotMatch(JSON.stringify(body), /set36-secret-never-return|google-secret-never-return/u);
});

test("SET-36 GET is Administrator-only and every denial is no-store", async () => {
  setEnvironment();

  for (const [name, email, status] of [
    ["missing identity", null, 401],
    ["office user", OFFICE_EMAIL, 403],
    ["outside user", "outsider@example.test", 403],
  ]) {
    const response = await route.GET(routeRequest(email));
    assert.equal(response.status, status, name);
    assert.equal(response.headers.get("cache-control"), "no-store", name);
  }
});

test("SET-36 GET reports all three lists empty while local development auth remains fail-closed for hosted access", async () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  setEnvironment({
    FCI_OFFICE_EMAILS: "",
    FCI_OFFICE_DOMAINS: "",
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    FCI_LOCAL_DEV_USER_EMAIL: ADMIN_EMAIL,
  });

  try {
    const response = await route.GET(routeRequest(null, "http://localhost"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      officeEmails: [],
      officeDomains: [],
      adminEmails: [ADMIN_EMAIL],
    });
  } finally {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
});

test("SET-36 endpoint is a GET-only display projection with a pinned no-store and authorization boundary", async () => {
  const source = await readFile(new URL(routePath, rootUrl), "utf8");
  const environmentNames = [...source.matchAll(/\bFCI_[A-Z0-9_]+\b/gu)].map((match) => match[0]);

  assert.equal([...source.matchAll(/export async function GET/gu)].length, 1);
  assert.doesNotMatch(source, /export async function (?:POST|PATCH|PUT|DELETE)/u);
  assert.doesNotMatch(source, /request\.json|parseBoundedJsonObject|requireSameOrigin|env\.DB|\.prepare\(|\bfetch\(/u);
  assert.match(source, /requireOfficeUser\(request, \{ admin: true \}\)/);
  assert.match(source, /"Cache-Control": "no-store"/);
  assert.match(source, /response\.headers\.set\("Cache-Control", "no-store"\)/);
  assert.deepEqual([...new Set(environmentNames)].sort(), [
    "FCI_ADMIN_EMAILS",
    "FCI_OFFICE_DOMAINS",
    "FCI_OFFICE_EMAILS",
  ]);
});

test("SET-36 card stays inside the Administrator-only settings branch and pins its honest boundary copy", async () => {
  const [component, app] = await Promise.all([
    readFile(new URL(componentPath, rootUrl), "utf8"),
    readFile(new URL("app/FloorOpsApp.tsx", rootUrl), "utf8"),
  ]);

  assert.match(app, /\{isAdmin && visibleSection === "Data & security" && <DataSecurityPanel \/>\}/);
  assert.match(component, /fetch\(DEVELOPMENT_ACCESS_URL, \{ cache: "no-store" \}\)/);
  assert.match(component, /Office access is not configured — the app denies everyone/);
  assert.match(component, /access\.officeEmails\.length > 0 \|\| access\.officeDomains\.length > 0/);
  assert.match(component, /Maintain these identifiers in hosting configuration\. When live Google login is activated, manage people and roles in People &amp; Access\./);
  assert.doesNotMatch(component, /FCI_(?:OFFICE|ADMIN)_[A-Z_]+/u);
});
