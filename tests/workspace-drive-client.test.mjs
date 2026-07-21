import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-drive-client", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24736 } },
});
const { GoogleDriveClient } = await vite.ssrLoadModule("/app/lib/google-drive.ts");

after(async () => {
  await vite.close();
});

function config(rootFolderId = "shared-drive-root") {
  return {
    drive: { mode: "shared-drive", rootFolderId },
  };
}

test("Drive client gets and exhaustively finds Shared Drives with restriction flags", async () => {
  const calls = [];
  let listPage = 0;
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith("/drives/shared-drive-root")) {
      return Response.json({
        id: "shared-drive-root",
        name: "FCI Operations",
        restrictions: { domainUsersOnly: true, driveMembersOnly: true },
      });
    }
    if (url.pathname.endsWith("/drives")) {
      listPage += 1;
      if (listPage === 1) {
        return Response.json({
          nextPageToken: "next-page",
          drives: [{ id: "drive-one", name: "FCI Operations", restrictions: { domainUsersOnly: true } }],
        });
      }
      assert.equal(url.searchParams.get("pageToken"), "next-page");
      return Response.json({
        drives: [{ id: "drive-two", name: "FCI Operations", restrictions: { domainUsersOnly: false } }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const exact = await client.getSharedDrive("shared-drive-root");
  assert.equal(exact.id, "shared-drive-root");
  assert.equal(exact.restrictions.domainUsersOnly, true);
  assert.equal(exact.restrictions.copyRequiresWriterPermission, null);

  const matches = await client.findSharedDriveByName("FCI Operations");
  assert.deepEqual(matches.map((drive) => drive.id), ["drive-one", "drive-two"]);
  const listCalls = calls.filter((call) => call.url.pathname.endsWith("/drives"));
  assert.equal(listCalls.length, 2);
  assert.equal(listCalls[0].url.searchParams.get("pageSize"), "100");
  assert.equal(listCalls[0].url.searchParams.get("q"), "name = 'FCI Operations'");
  assert.ok(calls.every((call) => (call.init.method ?? "GET") !== "DELETE"));
});

test("blueprint folder ensure looks up identity before name, adopts and stamps once, then is idempotent", async () => {
  const calls = [];
  let stamped = false;
  const folder = () => ({
    id: "manual-company-admin",
    name: "00_Company Admin",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
    webViewLink: "https://drive.google.test/manual-company-admin",
    appProperties: stamped ? { fciRootKey: "company-admin" } : {},
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, init, method });
    if (url.pathname.endsWith("/files") && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("appProperties has")) return Response.json({ files: stamped ? [folder()] : [] });
      if (query.includes("name = '00_Company Admin'")) return Response.json({ files: [folder()] });
    }
    if (url.pathname.endsWith("/files/manual-company-admin") && method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body, { appProperties: { fciRootKey: "company-admin" } });
      stamped = true;
      return Response.json(folder());
    }
    if (url.pathname.endsWith("/files/manual-company-admin") && method === "GET") return Response.json(folder());
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const first = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "company-admin",
    name: "00_Company Admin",
    reuseByName: true,
  });
  assert.equal(first.outcome, "adopted");
  assert.equal(stamped, true);

  const callsAfterFirst = calls.length;
  const second = await client.ensureBlueprintFolder({
    parentId: "shared-drive-root",
    key: "company-admin",
    name: "00_Company Admin",
    reuseByName: true,
  });
  assert.equal(second.outcome, "found");
  const secondCalls = calls.slice(callsAfterFirst);
  assert.equal(secondCalls.length, 1);
  assert.match(secondCalls[0].url.searchParams.get("q"), /appProperties has/u);
  assert.doesNotMatch(secondCalls[0].url.searchParams.get("q"), /name =/u);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.ok(calls.every((call) => call.method !== "DELETE"));
});

test("folder rename is contained, bounded to PATCH metadata, and confirms the provider response", async () => {
  const calls = [];
  let name = "01_Client Accounts";
  const folder = () => ({
    id: "client-accounts-id",
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
    appProperties: { fciRootKey: "client-accounts" },
  });
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, init, method });
    if (url.pathname.endsWith("/files/client-accounts-id") && method === "GET") return Response.json(folder());
    if (url.pathname.endsWith("/files/client-accounts-id") && method === "PATCH") {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body, { name: "01_Custom Clients" });
      name = body.name;
      return Response.json(folder());
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  const renamed = await client.renameFolder("client-accounts-id", "01_Custom Clients");
  assert.equal(renamed.previousName, "01_Client Accounts");
  assert.equal(renamed.folder.name, "01_Custom Clients");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.ok(calls.every((call) => call.url.searchParams.get("supportsAllDrives") === "true"));
  assert.ok(calls.every((call) => call.method !== "DELETE"));
});

test("same-name reuse never steals a different blueprint folder identity", async () => {
  const calls = [];
  const conflicting = {
    id: "already-managed-folder",
    name: "03_Duplicate Name",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["shared-drive-root"],
    trashed: false,
    appProperties: { fciRootKey: "first-sibling" },
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.pathname.endsWith("/files") && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("appProperties has")) return Response.json({ files: [] });
      if (query.includes("name = '03_Duplicate Name'")) return Response.json({ files: [conflicting] });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const client = new GoogleDriveClient("test-token", config(), fetcher);

  await assert.rejects(
    client.ensureBlueprintFolder({
      parentId: "shared-drive-root",
      key: "second-sibling",
      name: "03_Duplicate Name",
      reuseByName: true,
    }),
    (error) => error.code === "drive_folder_identity_conflict" && error.status === 409,
  );
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  assert.equal(calls.some((call) => call.method === "DELETE"), false);
});
