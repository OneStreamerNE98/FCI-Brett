import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("enforces the office allowlist before rendering the operational app shell", async () => {
  const [page, auth, app] = await Promise.all([
    read("app/page.tsx"),
    read("app/lib/workspace-auth.ts"),
    read("app/FloorOpsApp.tsx"),
  ]);

  assert.match(auth, /export function officeIdentityForEmail/);
  assert.match(page, /officeIdentityForEmail\(user\.email\)/);
  assert.match(page, /Access not authorized/);
  assert.match(auth, /const user = officeIdentityForEmail\(email\)/);
  assert.match(page, /const officeUser = officeIdentityForEmail\(user\.email\)/);
  assert.match(page, /officeUser\.isAdmin \? "Admin" : "Office"/);
  assert.match(page, /accessLabel=\{accessLabel\}/);
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
  const oauth = await read("app/lib/google-oauth.ts");

  assert.match(oauth, /approved Google Workspace connection account/);
  assert.match(oauth, /googleAccountIsAllowed\(config, connection\.google_email\)/);
  assert.match(oauth, /account_no_longer_allowed/);
  assert.match(oauth, /status = 'reauthorization-required'/);
});

test("scopes dashboard Gmail archive totals to the active Google connection", async () => {
  const dashboard = await read("app/api/v1/dashboard/route.ts");

  assert.match(dashboard, /getGoogleRuntimeConfig/);
  assert.match(dashboard, /gmail_file_archives WHERE connection_key = \? AND status = 'filed'/);
  assert.match(dashboard, /bind\(google\.connectionKey\)/);
});
