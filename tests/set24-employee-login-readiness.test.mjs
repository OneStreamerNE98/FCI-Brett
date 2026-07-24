import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const ADMIN_EMAIL = "admin@example.test";
const OFFICE_EMAIL = "office@example.test";
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-set24-login-readiness", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24764 } },
});

const readinessRoute = await vite.ssrLoadModule(
  "/app/api/v1/settings/employee-login-readiness/route.ts",
);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

const REQUIREMENT_NAMES = [
  "FCI_EMPLOYEE_OIDC_CLIENT_ID",
  "FCI_EMPLOYEE_OIDC_CLIENT_SECRET or FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE",
  "FCI_EMPLOYEE_OIDC_REDIRECT_URI",
  "FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN",
];

function setEnvironment(overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_OFFICE_DOMAINS: "",
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    FCI_EMPLOYEE_OIDC_CLIENT_ID: "",
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET: "",
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE: "",
    FCI_EMPLOYEE_OIDC_REDIRECT_URI: "",
    FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN: "",
    ...overrides,
  });
}

function routeRequest(email) {
  const url = new URL("https://fci.example.test/api/v1/settings/employee-login-readiness");
  const request = new Request(url, {
    headers: email ? { "oai-authenticated-user-email": email } : {},
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

async function readReadiness(overrides = {}) {
  setEnvironment(overrides);
  const response = await readinessRoute.GET(routeRequest(ADMIN_EMAIL));
  return { response, body: await response.json() };
}

test("SET-24 derives unconfigured, partial, and ready states from logical configuration presence", async () => {
  const secretValue = "direct-secret-never-render";
  const secretFilePath = "C:\\private\\employee-oidc-secret";
  const unconfigured = await readReadiness();
  const directSecret = await readReadiness({
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET: secretValue,
  });
  const fileSecret = await readReadiness({
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE: secretFilePath,
  });
  const ready = await readReadiness({
    FCI_EMPLOYEE_OIDC_CLIENT_ID: "employee-client-id-never-render",
    FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE: secretFilePath,
    FCI_EMPLOYEE_OIDC_REDIRECT_URI: "https://app.example.test/auth/callback",
    FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN: "example.test",
  });

  assert.deepEqual(
    [unconfigured.body.employeeLogin.configuration.state, unconfigured.body.employeeLogin.configuration.configuredCount],
    ["unconfigured", 0],
  );
  for (const result of [directSecret, fileSecret]) {
    assert.equal(result.body.employeeLogin.configuration.state, "partial");
    assert.equal(result.body.employeeLogin.configuration.configuredCount, 1);
    assert.deepEqual(
      result.body.employeeLogin.configuration.requirements.map(({ name }) => name),
      REQUIREMENT_NAMES,
    );
    assert.deepEqual(
      result.body.employeeLogin.configuration.requirements.map(({ configured }) => configured),
      [false, true, false, false],
    );
  }
  assert.equal(ready.body.employeeLogin.configuration.state, "ready");
  assert.equal(ready.body.employeeLogin.configuration.configuredCount, 4);
  assert.equal(ready.body.employeeLogin.configuration.totalCount, 4);
  assert.deepEqual(
    ready.body.employeeLogin.configuration.requirements.map(({ configured }) => configured),
    [true, true, true, true],
  );
  assert.deepEqual(ready.body.employeeLogin.activationGate, {
    state: "owner-approval-required",
    active: false,
  });
  for (const result of [unconfigured, directSecret, fileSecret, ready]) {
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("cache-control"), "no-store");
    const serialized = JSON.stringify(result.body);
    assert.doesNotMatch(serialized, /direct-secret-never-render|employee-client-id-never-render|private|auth\/callback|example\.test/u);
    assert.deepEqual(
      Object.keys(result.body.employeeLogin.configuration).sort(),
      ["configuredCount", "requirements", "state", "totalCount"],
    );
  }
});

test("SET-24 readiness is Administrator-only and keeps denied responses no-store", async () => {
  setEnvironment();
  for (const [name, email, expectedStatus] of [
    ["missing identity", null, 401],
    ["office user", OFFICE_EMAIL, 403],
    ["outside office", "outsider@example.test", 403],
  ]) {
    const response = await readinessRoute.GET(routeRequest(email));
    assert.equal(response.status, expectedStatus, name);
    assert.equal(response.headers.get("cache-control"), "no-store", name);
  }
});

test("SET-24 exposes one admin-only, no-store, display-only readiness endpoint", async () => {
  const route = await read("app/api/v1/settings/employee-login-readiness/route.ts");
  const getHandler = route.slice(route.indexOf("export async function GET"));

  assert.match(getHandler, /requireOfficeUser\(request, \{ admin: true \}\)/);
  assert.ok(getHandler.indexOf("requireOfficeUser") < getHandler.indexOf("runtimeEnvironment()"));
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /withNoStore\(auth\.response\)/);
  assert.equal([...route.matchAll(/export async function (?:POST|PUT|PATCH|DELETE)/g)].length, 0);
  assert.doesNotMatch(route, /parseBoundedJsonObject|requireSameOrigin|env\.DB|INSERT|UPDATE|DELETE FROM/i);
  assert.match(route, /configured:\s*requirement\.configured\(environment\)/);
  assert.match(route, /state: "owner-approval-required"[\s\S]+active: false/);
  assert.doesNotMatch(route, /ACTIVATION_(?:ENABLED|READY)|EMPLOYEE_LOGIN_ENABLED/);
});

test("SET-24 collapses secret source alternatives into one logical presence row and never returns values", async () => {
  const [route, panel] = await Promise.all([
    read("app/api/v1/settings/employee-login-readiness/route.ts"),
    read("app/settings/components/TestingLaunchPanel.tsx"),
  ]);

  for (const name of REQUIREMENT_NAMES) {
    assert.ok(route.includes(name), `route must name ${name}`);
    assert.ok(panel.includes(name), `panel must whitelist ${name}`);
  }
  assert.equal(
    [...panel.matchAll(/"FCI_EMPLOYEE_OIDC_CLIENT_SECRET or FCI_EMPLOYEE_OIDC_CLIENT_SECRET_FILE"/g)].length,
    1,
  );
  assert.match(panel, /requirement\.name !== EMPLOYEE_LOGIN_REQUIREMENT_NAMES\[index\]/);
  assert.match(panel, /typeof requirement\.configured !== "boolean"/);
  assert.doesNotMatch(route, /\bvalue:\s*(?:workerEnvironment|environment|process\.env|runtimeEnvironment)/);
  assert.doesNotMatch(route, /\bsource:\s*["'](?:env|file)/);
  assert.doesNotMatch(route, /clientSecretSource|CLIENT_SECRET_FILE.*path/i);
});

test("SET-24 reads invitations from the existing access projection and distinguishes unavailable from zero", async () => {
  const panel = await read("app/settings/components/TestingLaunchPanel.tsx");

  assert.match(panel, /readAdminAccessOverview\(true\)/);
  assert.match(panel, /overview\.summary\.pendingInvitationCount/);
  assert.match(panel, /useState<PendingInvitationState>\("loading"\)/);
  assert.match(panel, /setPendingInvitationState\("ready"\)/);
  assert.match(panel, /setPendingInvitationState\("unavailable"\)/);
  assert.match(panel, /count === 1 \? "1 open invitation" : `\$\{count\} open invitations`/);
  assert.match(panel, /Unavailable until the secure People & Access projection is active\./);
  assert.doesNotMatch(panel, /SELECT\s+.+\s+FROM|FROM\s+invitations|COUNT\s*\(\s*\*\s*\)/i);
});

test("SET-24 keeps readiness loading, error, and configured treatments internally consistent", async () => {
  const panel = await read("app/settings/components/TestingLaunchPanel.tsx");

  assert.match(panel, /readinessFailed\s*\?\s*"Unavailable"\s*:\s*!readiness\s*\?\s*"Checking"/);
  assert.match(panel, /readinessFailed \? "Unavailable" : "Checking presence…"/);
  assert.match(panel, /if \(failed\) return "Employee-login configuration is unavailable"/);
  assert.match(panel, /if \(!readiness\) return "Checking employee-login configuration…"/);
  assert.match(panel, /configuration\.state === "ready"/);
  assert.match(panel, /configuration\.state === "partial"/);
  assert.match(panel, /return "Employee login is not configured"/);
});

test("SET-24 renders the fixed role and session policies without controls", async () => {
  const panel = await read("app/settings/components/TestingLaunchPanel.tsx");

  for (const text of [
    "What each role can do",
    "Administrator",
    "Office Operations",
    "Project Manager",
    "Field link",
    "30-minute idle limit",
    "8-hour absolute limit",
    "Fixed policy",
  ]) assert.match(panel, new RegExp(text));
  assert.match(panel, /ROLE_POLICY_REASON/);
  assert.match(panel, /SESSION_POLICY_REASON/);
  assert.doesNotMatch(panel, /<form|<input|<select|<textarea/);
  assert.doesNotMatch(panel, /onClick=\{onGoogleSetup\}/);
});

test("SET-24 updates the ledger and both guide sections", async () => {
  const [plan, guide] = await Promise.all([
    read("docs/agent-plan-architecture-workspace-and-setup.md"),
    read("docs/settings-guide.md"),
  ]);
  const packet = plan.slice(plan.indexOf("### SET-24"), plan.indexOf("### SET-25"));

  assert.match(
    packet,
    /\*\*Status:\*\* In review — PR #158, July 24, 2026\. Source-only and undeployed;/,
  );
  assert.match(guide, /### 8\. Testing & launch[\s\S]+Employee-login readiness/);
  assert.match(guide, /## Users and access[\s\S]+A real zero invitations is shown as zero; an unavailable projection is shown as unavailable/);
  assert.match(guide, /30-minute idle limit and an eight-hour absolute limit/);
});
