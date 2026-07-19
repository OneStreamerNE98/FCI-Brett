import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
