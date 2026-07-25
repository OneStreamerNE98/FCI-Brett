import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@cherryhillfci.com";
const OFFICE_EMAIL = "office@cherryhillfci.com";
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-set08-launch-checklist", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24766 } },
});

const [route, workspaceRoute, domain] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/settings/launch-checklist/route.ts"),
  vite.ssrLoadModule("/app/api/v1/settings/workspace/route.ts"),
  vite.ssrLoadModule("/app/domain/launch-checklist.ts"),
]);

after(async () => {
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function workspaceRow(settings) {
  return {
    id: "workspace",
    shared_drive_id: "drive-saved",
    client_directory_sheet_id: "sheet-saved",
    intake_mailbox: "operations@example.test",
    settings_json: JSON.stringify(settings),
    updated_by: ADMIN_EMAIL,
    updated_at: 1,
  };
}

function fakeDatabase(initialRows = {}) {
  const rows = new Map(Object.entries(initialRows));
  const queries = [];
  return {
    rows,
    queries,
    readSettings(id = "workspace") {
      const row = rows.get(id);
      return row ? JSON.parse(row.settings_json) : null;
    },
    prepare(sql) {
      const query = { sql, values: [], operation: "prepared" };
      queries.push(query);
      const statement = {
        bind(...values) {
          query.values = values;
          return statement;
        },
        async first() {
          query.operation = "first";
          if (/FROM workspace_settings WHERE id = \?/u.test(sql)) {
            return rows.get(query.values[0]) ?? null;
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          query.operation = "run";
          if (!/^INSERT INTO workspace_settings/u.test(sql)) {
            throw new Error(`Unexpected run query: ${sql}`);
          }
          const current = rows.get(query.values[0]) ?? {};
          const currentSettings = current.settings_json
            ? JSON.parse(current.settings_json)
            : {};
          const settingsPatch = JSON.parse(query.values[1]);
          rows.set(query.values[0], {
            ...current,
            id: query.values[0],
            settings_json: JSON.stringify({
              ...currentSettings,
              ...settingsPatch,
            }),
            updated_by: query.values[2],
            updated_at: query.values[3],
          });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

function setEnvironment(database) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "test",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    DB: database,
  });
}

function routeRequest(email, method = "GET", body) {
  const url = new URL("https://fci.example.test/api/v1/settings/launch-checklist");
  const request = new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : {
        origin: url.origin,
        "content-type": "application/json",
      }),
      ...(email ? { "oai-authenticated-user-email": email } : {}),
    },
    ...(body === undefined ? {} : {
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function workspaceRequest(body) {
  const url = new URL("https://fci.example.test/api/v1/settings/workspace");
  const request = new Request(url, {
    method: "PATCH",
    headers: {
      origin: url.origin,
      "content-type": "application/json",
      "oai-authenticated-user-email": ADMIN_EMAIL,
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

test("SET-08 GET widens the closed catalog and is office-readable but read-only for non-admins", async () => {
  const database = fakeDatabase({
    workspace: workspaceRow({
      launchChecklist: {
        "test-records-only": {
          checked: true,
          actorEmail: ADMIN_EMAIL,
          checkedAt: 1_722_000_000_000,
        },
        "future-item": {
          checked: true,
          actorEmail: "future@example.test",
          checkedAt: 1_722_000_000_001,
        },
      },
    }),
  });
  setEnvironment(database);

  const officeResponse = await route.GET(routeRequest(OFFICE_EMAIL));
  const office = await officeResponse.json();
  assert.equal(officeResponse.status, 200);
  assert.equal(officeResponse.headers.get("cache-control"), "no-store");
  assert.equal(office.canAttest, false);
  assert.deepEqual(Object.keys(office.launchChecklist), domain.LAUNCH_CHECKLIST_ITEMS.map(({ itemId }) => itemId));
  assert.deepEqual(office.launchChecklist["test-records-only"], {
    checked: true,
    actorEmail: ADMIN_EMAIL,
    checkedAt: 1_722_000_000_000,
  });
  assert.deepEqual(office.launchChecklist["records-survive-reload"], {
    checked: false,
    actorEmail: null,
    checkedAt: null,
  });
  assert.equal("future-item" in office.launchChecklist, false);

  const adminResponse = await route.GET(routeRequest(ADMIN_EMAIL));
  assert.equal((await adminResponse.json()).canAttest, true);
});

test("SET-08 PATCH server-stamps actor and time, round-trips, and preserves sibling and future settings", async () => {
  const originalAiFeatures = JSON.stringify({
    orgQa: false,
    futureFeature: "keep",
  });
  const originalChatRouting = JSON.stringify({
    routes: [{ eventType: "lead.created", enabled: true }],
  });
  const database = fakeDatabase({
    workspace: workspaceRow({
      timezone: "America/Chicago",
      aiFeatures: JSON.parse(originalAiFeatures),
      futureWorkspaceSetting: { retained: true },
      launchChecklist: {
        "future-item": {
          checked: true,
          actorEmail: "future@example.test",
          checkedAt: 1_722_000_000_001,
        },
      },
    }),
    "google-chat-routing": {
      id: "google-chat-routing",
      settings_json: originalChatRouting,
      updated_by: ADMIN_EMAIL,
      updated_at: 2,
    },
  });
  setEnvironment(database);
  const before = Date.now();
  const response = await route.PATCH(routeRequest(
    ADMIN_EMAIL,
    "PATCH",
    { itemId: "gmail-review-first", checked: true },
  ));
  const after = Date.now();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.canAttest, true);
  assert.equal(body.launchChecklist["gmail-review-first"].checked, true);
  assert.equal(body.launchChecklist["gmail-review-first"].actorEmail, ADMIN_EMAIL);
  assert.ok(body.launchChecklist["gmail-review-first"].checkedAt >= before);
  assert.ok(body.launchChecklist["gmail-review-first"].checkedAt <= after);

  const stored = database.readSettings();
  assert.equal(stored.timezone, "America/Chicago");
  assert.equal(JSON.stringify(stored.aiFeatures), originalAiFeatures);
  assert.deepEqual(stored.futureWorkspaceSetting, { retained: true });
  assert.equal(stored.launchChecklist["future-item"].actorEmail, "future@example.test");
  assert.deepEqual(
    database.rows.get("google-chat-routing").settings_json,
    originalChatRouting,
  );

  const reloadedResponse = await route.GET(routeRequest(OFFICE_EMAIL));
  const reloaded = await reloadedResponse.json();
  assert.deepEqual(
    reloaded.launchChecklist["gmail-review-first"],
    body.launchChecklist["gmail-review-first"],
  );

  const workspaceSave = await workspaceRoute.PATCH(workspaceRequest({
    timezone: "America/New_York",
    appointmentReminderHours: 48,
  }));
  assert.equal(workspaceSave.status, 200);
  const afterWorkspaceSave = database.readSettings();
  assert.deepEqual(
    afterWorkspaceSave.launchChecklist,
    stored.launchChecklist,
    "the existing Workspace settings save must preserve the SET-08 sibling document",
  );
  assert.deepEqual(afterWorkspaceSave.aiFeatures, stored.aiFeatures);
  assert.deepEqual(afterWorkspaceSave.futureWorkspaceSetting, stored.futureWorkspaceSetting);
});

test("SET-08 rejects unknown item ids and caller-forged audit metadata without writing", async (t) => {
  const invalidBodies = [
    { itemId: "not-in-the-closed-catalog", checked: true },
    {
      itemId: "test-records-only",
      checked: true,
      actorEmail: "forged@example.test",
    },
    {
      itemId: "test-records-only",
      checked: true,
      checkedAt: 1,
    },
    { itemId: "test-records-only", checked: "true" },
    { itemId: "test-records-only" },
  ];

  for (const [index, body] of invalidBodies.entries()) {
    await t.test(String(index), async () => {
      const database = fakeDatabase();
      setEnvironment(database);
      const response = await route.PATCH(routeRequest(ADMIN_EMAIL, "PATCH", body));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: "Send one valid launch-checklist update.",
      });
      assert.equal(
        database.queries.some((query) => query.operation === "run"),
        false,
      );
    });
  }
});

test("SET-08 PATCH is same-origin, Administrator-only, and bounded", async () => {
  const database = fakeDatabase();
  setEnvironment(database);
  const office = await route.PATCH(routeRequest(
    OFFICE_EMAIL,
    "PATCH",
    { itemId: "test-records-only", checked: true },
  ));
  const crossOriginRequest = routeRequest(
    ADMIN_EMAIL,
    "PATCH",
    { itemId: "test-records-only", checked: true },
  );
  crossOriginRequest.headers.set("origin", "https://evil.example.test");
  const crossOrigin = await route.PATCH(crossOriginRequest);
  const oversized = await route.PATCH(routeRequest(
    ADMIN_EMAIL,
    "PATCH",
    JSON.stringify({
      itemId: "test-records-only",
      checked: true,
      padding: "x".repeat(4_100),
    }),
  ));

  assert.equal(office.status, 403);
  assert.equal(office.headers.get("cache-control"), "no-store");
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get("cache-control"), "no-store");
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store");
  assert.deepEqual(await oversized.json(), {
    error: "Launch-checklist update is too large.",
  });
  assert.equal(
    database.queries.some((query) => query.operation === "run"),
    false,
  );
});

test("SET-08 unchecking removes only the selected stored attestation", async () => {
  const database = fakeDatabase({
    workspace: workspaceRow({
      launchChecklist: {
        "test-records-only": {
          checked: true,
          actorEmail: ADMIN_EMAIL,
          checkedAt: 1_722_000_000_000,
        },
        "records-survive-reload": {
          checked: true,
          actorEmail: ADMIN_EMAIL,
          checkedAt: 1_722_000_000_001,
        },
      },
    }),
  });
  setEnvironment(database);

  const response = await route.PATCH(routeRequest(
    ADMIN_EMAIL,
    "PATCH",
    { itemId: "test-records-only", checked: false },
  ));
  const body = await response.json();
  assert.equal(body.launchChecklist["test-records-only"].checked, false);
  assert.equal(body.launchChecklist["records-survive-reload"].checked, true);
  assert.equal("test-records-only" in database.readSettings().launchChecklist, false);
});

test("SET-08 keeps persisted attestations outside simulation reset ownership", async () => {
  const resetRoute = await read("app/api/v1/integrations/google/simulation/reset/route.ts");
  const resetHandler = resetRoute.slice(resetRoute.indexOf("export async function POST"));

  assert.match(resetHandler, /DELETE FROM google_sheet_sync_state WHERE connection_key = \?/u);
  assert.match(resetHandler, /DELETE FROM workspace_resources WHERE connection_key = \?/u);
  assert.doesNotMatch(resetHandler, /workspace_settings|launchChecklist/u);
});

test("SET-08 renders computed VERIFIED rows without checkboxes and persisted ATTESTED rows with audit metadata", async () => {
  const [card, panel, routeSource] = await Promise.all([
    read("app/settings/components/LaunchChecklistCard.tsx"),
    read("app/settings/components/TestingLaunchPanel.tsx"),
    read("app/api/v1/settings/launch-checklist/route.ts"),
  ]);
  const verifiedBlock = card.slice(
    card.indexOf("<h3>Verified from live status</h3>"),
    card.indexOf("<h3>Administrator attestations</h3>"),
  );
  const attestedBlock = card.slice(card.indexOf("<h3>Administrator attestations</h3>"));
  const attestationCheckbox = card.slice(
    card.indexOf("function AttestationCheckbox"),
    card.indexOf("function LiveVerificationRow"),
  );

  assert.doesNotMatch(verifiedBlock, /type="checkbox"/u);
  assert.match(attestationCheckbox, /type="checkbox"/u);
  assert.match(attestedBlock, /<AttestationCheckbox/u);
  assert.match(card, /data-checklist-kind="verified"/u);
  assert.match(card, /data-checklist-kind="attested"/u);
  assert.match(card, /Checked by \{attestation\.actorEmail\} on \{checkedAtLabel\(attestation\.checkedAt\)\}/u);
  assert.match(card, /This is the development checklist\. Production acceptance stays in checklist 05 and is not completed in this app\./u);
  assert.match(panel, /<LaunchChecklistCard \/>/u);
  assert.doesNotMatch(panel, /<input/u);
  assert.match(routeSource, /requireSameOrigin\(request\)/u);
  assert.match(routeSource, /requireOfficeUser\(request, \{ admin: true \}\)/u);
  assert.match(routeSource, /parseBoundedJsonObject/u);
  assert.match(routeSource, /auth\.user\.email[\s\S]+Date\.now\(\)/u);
});

test("SET-08 labels the local simulation honestly instead of a live Google connection", async () => {
  const card = await read("app/settings/components/LaunchChecklistCard.tsx");
  // Strict detection: only an explicit boolean true is simulation, so callers
  // that omit the field keep their live Verified/Needs-verification behavior.
  assert.match(card, /simulation: value\.workspace\.simulation === true/u);
  // Simulation is app-global: all three live rows (mirror included) flip together.
  assert.match(
    card,
    /SIMULATED_VERIFICATIONS[\s\S]*workspace: "simulated"[\s\S]*calendar: "simulated"[\s\S]*mirror: "simulated"/u,
  );
  assert.match(card, /if \(state === "simulated"\) return "Simulated";/u);
  // The summary must not count simulated rows as verified.
  assert.match(card, /simulatedEnvironment \? "Simulated" : `\$\{verifiedCount\} of 3 verified`/u);
  assert.match(
    card,
    /Simulated environment — live verification runs against a real Workspace connection\./u,
  );
});
