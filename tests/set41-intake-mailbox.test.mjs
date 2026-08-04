import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admin@example.test";
const OFFICE_EMAIL = "office@example.test";
const PRIMARY_MAILBOX = "operations@example.test";
/** The masked form GET /api/v1/google-workspace already uses for `connection.account`. */
const PRIMARY_MAILBOX_MASKED = "op•••@example.test";
const SECONDARY_MAILBOX = "dispatch@example.test";
const workerEnvironment = {};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/set41-intake-mailbox",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24793 } },
});

const [settingsRoute, oauthSites, workspaceSettingsDomain, defaultsRequest] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/settings/workspace/route.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
  vite.ssrLoadModule("/app/domain/workspace-settings.ts"),
  vite.ssrLoadModule("/app/settings/components/workspace-defaults-request.ts"),
]);

/**
 * The body a Workspace defaults panel actually PATCHes, built by the panel's own request
 * builder rather than a hand-copied key list — so these tests exercise the route's
 * absent-key branch with the panel's real body shape, and start failing if the panel ever
 * begins echoing the mailbox again.
 */
function defaultsPanelSave(overrides = {}) {
  return defaultsRequest.buildWorkspaceDefaultsPatchBody({
    ...workspaceSettingsDomain.DEFAULT_WORKSPACE_PREFERENCES,
    ...overrides,
  });
}

class D1Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
    this.statement = owner.database.prepare(sql);
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    this.owner.writes.push({ sql: this.sql, values: [...this.values] });
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class TestDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.writes = [];
    this.database.exec(`
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY,
        shared_drive_id TEXT,
        client_directory_sheet_id TEXT,
        intake_mailbox TEXT,
        settings_json TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_resources (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        external_id TEXT NOT NULL,
        parent_external_id TEXT,
        external_url TEXT,
        origin TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE google_connections (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL UNIQUE,
        google_subject TEXT NOT NULL,
        google_email TEXT NOT NULL,
        refresh_token_ciphertext TEXT NOT NULL,
        key_version TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    this.database.prepare(`INSERT INTO workspace_settings (
      id, shared_drive_id, client_directory_sheet_id, intake_mailbox,
      settings_json, updated_by, updated_at
    ) VALUES ('workspace', NULL, NULL, 'legacy-column@example.test', ?, 'seed@example.test', 1)`)
      .run(JSON.stringify({ timezone: "America/Chicago", siblingOwner: { preserve: true } }));
    this.database.prepare(`INSERT INTO google_connections (
      id, connection_key, google_subject, google_email, refresh_token_ciphertext,
      key_version, scopes_json, status
    ) VALUES ('connection', 'google-workspace', 'subject', ?, 'ciphertext', '1', '[]', 'connected')`)
      .run(PRIMARY_MAILBOX);
  }

  prepare(sql) {
    return new D1Statement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  close() {
    this.database.close();
  }
}

function configure(database, overrides = {}) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: `${ADMIN_EMAIL},${OFFICE_EMAIL}`,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "shared-drive-identifier",
    GOOGLE_WORKSPACE_CLIENT_ID: "client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "FCI TEST client secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 0x41).toString("base64url"),
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "example.test",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: `${PRIMARY_MAILBOX},${SECONDARY_MAILBOX}`,
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: PRIMARY_MAILBOX,
    DB: database,
    ...overrides,
  });
}

function request(method = "GET", body, options = {}) {
  const url = new URL("https://fci.example.test/api/v1/settings/workspace");
  const headers = new Headers({
    "oai-authenticated-user-email": options.email ?? ADMIN_EMAIL,
  });
  if (method !== "GET") {
    headers.set("origin", options.origin ?? url.origin);
    headers.set("content-type", "application/json");
  }
  const result = new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(result, "nextUrl", { value: url });
  return result;
}

after(async () => {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

test("Settings exposes authorized mailbox choices and atomically saves a selected address", async () => {
  const database = new TestDatabase();
  try {
    configure(database);
    const listed = await settingsRoute.GET(request("GET", undefined, { email: ADMIN_EMAIL }));
    const listedBody = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("cache-control"), "no-store");
    assert.deepEqual(listedBody.intakeMailboxOptions, [PRIMARY_MAILBOX, SECONDARY_MAILBOX]);
    assert.equal(JSON.stringify(listedBody).includes("FCI TEST client secret"), false);

    const saved = await settingsRoute.PATCH(request("PATCH", {
      intakeMailbox: SECONDARY_MAILBOX.toUpperCase(),
    }));
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedBody.settings.intakeMailbox, SECONDARY_MAILBOX);
    assert.equal(savedBody.settings.timezone, "America/Chicago",
      "a mailbox-only save returns the preserved merged preferences");
    assert.deepEqual(savedBody.intakeMailboxOptions, [PRIMARY_MAILBOX, SECONDARY_MAILBOX]);

    const row = database.database.prepare(
      "SELECT intake_mailbox, settings_json FROM workspace_settings WHERE id = 'workspace'",
    ).get();
    assert.equal(row.intake_mailbox, "legacy-column@example.test", "the dead scalar column stays untouched");
    assert.deepEqual(JSON.parse(row.settings_json), {
      timezone: "America/Chicago",
      siblingOwner: { preserve: true },
      intakeMailbox: SECONDARY_MAILBOX,
    });

    const effective = await oauthSites.getEffectiveGoogleRuntimeConfig();
    assert.equal(effective.intakeMailbox, SECONDARY_MAILBOX);
    assert.equal(effective.effectiveSources.intakeMailbox, "app");
    assert.equal(effective.oauthReady, false);
    assert.equal(effective.connectReady, true);
    // The connected address is masked: this label travels in `missing`/`missingDetails`,
    // which GET /api/v1/google-workspace returns to every office user, not just admins.
    assert.equal(effective.missingDetails.at(-1).label,
      `Google Workspace intake mailbox ${SECONDARY_MAILBOX} matching connected account ${PRIMARY_MAILBOX_MASKED}`);
    assert.equal(JSON.stringify(effective.missingDetails).includes(PRIMARY_MAILBOX), false,
      "the unmasked connected account must not appear anywhere in the readiness details");
    assert.equal(effective.missing.join(" ").includes(PRIMARY_MAILBOX), false,
      "nor in the flattened `missing` list built from those labels");

    const authorizeSource = await read("app/api/v1/integrations/google/authorize/route.ts");
    assert.match(authorizeSource, /if \(!config\.connectReady\)/u);
    assert.doesNotMatch(authorizeSource, /if \(!config\.oauthReady\)/u);
  } finally {
    database.close();
  }
});

test("Settings rejects non-member and disallowed-domain mailboxes without writing", async (t) => {
  for (const fixture of [
    {
      name: "not a member",
      value: "unknown@example.test",
      overrides: {},
      reason: /AUTHORIZED_ACCOUNTS/u,
    },
    {
      name: "outside allowed domain",
      value: "authorized@outside.test",
      overrides: {
        GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS:
          `${PRIMARY_MAILBOX},${SECONDARY_MAILBOX},authorized@outside.test`,
      },
      reason: /ALLOWED_DOMAINS/u,
    },
    {
      name: "invalid address",
      value: "not-an-email",
      overrides: {},
      reason: /valid Google Workspace intake mailbox/u,
    },
  ]) {
    await t.test(fixture.name, async () => {
      const database = new TestDatabase();
      try {
        configure(database, fixture.overrides);
        const writesBefore = database.writes.length;
        const response = await settingsRoute.PATCH(request("PATCH", {
          intakeMailbox: fixture.value,
        }));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, fixture.reason);
        assert.equal(database.writes.length, writesBefore);
      } finally {
        database.close();
      }
    });
  }
});

test("the authorized-account allowlist is admin-only; the saved mailbox stays readable", async () => {
  const database = new TestDatabase();
  try {
    configure(database);
    assert.equal((await settingsRoute.PATCH(request("PATCH", { intakeMailbox: SECONDARY_MAILBOX }))).status, 200);

    // The option list is the hosted GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS allowlist. Its only
    // consumer is the mailbox selector inside GoogleWorkspacePanel's `{isAdmin && ...}` region,
    // so a plain office user has no use for it and must not receive it.
    const office = await settingsRoute.GET(request("GET", undefined, { email: OFFICE_EMAIL }));
    const officeText = await office.text();
    const officeBody = JSON.parse(officeText);
    assert.equal(office.status, 200, "office users still read their Workspace defaults");
    assert.equal(Object.hasOwn(officeBody, "intakeMailboxOptions"), false,
      "no allowlist field reaches a non-admin office user");
    for (const address of [PRIMARY_MAILBOX, "legacy-column@example.test"]) {
      assert.equal(officeText.includes(address), false, `non-admin payload disclosed ${address}`);
    }
    // Unchanged by this gate: the saved selection itself is still readable, and the rest of
    // the payload still works for a non-admin caller.
    assert.equal(officeBody.settings.intakeMailbox, SECONDARY_MAILBOX);
    assert.equal(officeBody.settings.timezone, "America/Chicago");

    const admin = await settingsRoute.GET(request("GET", undefined, { email: ADMIN_EMAIL }));
    const adminBody = await admin.json();
    assert.deepEqual(adminBody.intakeMailboxOptions, [PRIMARY_MAILBOX, SECONDARY_MAILBOX],
      "the administrator response is unchanged");
    assert.equal(adminBody.settings.intakeMailbox, SECONDARY_MAILBOX);
  } finally {
    database.close();
  }
});

test("a full-form defaults save never carries the mailbox, so a newer selection survives", async () => {
  const database = new TestDatabase();
  try {
    configure(database);
    // GoogleWorkspacePanel — the only mailbox writer — selects the connected account.
    const selected = await settingsRoute.PATCH(request("PATCH", { intakeMailbox: PRIMARY_MAILBOX }));
    assert.equal(selected.status, 200);
    const ready = await oauthSites.getEffectiveGoogleRuntimeConfig();
    assert.equal(ready.intakeMailbox, PRIMARY_MAILBOX);
    assert.equal(ready.oauthReady, true, "precondition: readiness is green before the defaults save");

    // A defaults tab still holding the older mailbox saves an unrelated reminder change.
    const body = defaultsPanelSave({
      intakeMailbox: SECONDARY_MAILBOX,
      appointmentReminderHours: 48,
    });
    assert.equal(Object.hasOwn(body, "intakeMailbox"), false,
      "the defaults panel must not send intakeMailbox at all — an empty string would clear it");

    const saved = await settingsRoute.PATCH(request("PATCH", body));
    const savedBody = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(savedBody.settings.intakeMailbox, PRIMARY_MAILBOX,
      "the newer stored mailbox survives an unrelated defaults save");
    assert.equal(savedBody.settings.appointmentReminderHours, 48, "the intended change still lands");

    const after = await oauthSites.getEffectiveGoogleRuntimeConfig();
    assert.equal(after.intakeMailbox, PRIMARY_MAILBOX);
    assert.equal(after.oauthReady, true, "readiness is not flipped by an unrelated defaults save");
    assert.deepEqual(JSON.parse(database.database.prepare(
      "SELECT settings_json FROM workspace_settings WHERE id = 'workspace'",
    ).get().settings_json).siblingOwner, { preserve: true }, "unowned sibling keys stay merged");
  } finally {
    database.close();
  }
});

test("the defaults panel routes its save through the mailbox-stripping request builder", async () => {
  // The behavioral tests above call the builder directly, so this is what ties them to the
  // panel: it fails if the panel goes back to PATCHing its whole state object.
  const panel = await read("app/settings/components/WorkspaceDefaultsPanel.tsx");
  assert.match(panel, /body: JSON\.stringify\(buildWorkspaceDefaultsPatchBody\(settings\)\)/u);
  assert.doesNotMatch(panel, /body: JSON\.stringify\(settings\)/u,
    "the panel must never PATCH its raw state — that echoes the intake mailbox");
  assert.match(panel, /import \{ buildWorkspaceDefaultsPatchBody \} from "\.\/workspace-defaults-request"/u);
});

test("a defaults save still succeeds once the stored mailbox drops off the allowlist", async () => {
  const database = new TestDatabase();
  try {
    configure(database);
    assert.equal((await settingsRoute.PATCH(request("PATCH", { intakeMailbox: SECONDARY_MAILBOX }))).status, 200);

    // The hosted allowlist is narrowed and no longer contains the saved address. The defaults
    // panels have no mailbox control, so a 400 here would leave them permanently unsaveable.
    configure(database, { GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: PRIMARY_MAILBOX });

    const saved = await settingsRoute.PATCH(request("PATCH", defaultsPanelSave({
      appointmentReminderHours: 48,
    })));
    const savedBody = await saved.json();
    assert.equal(saved.status, 200, "an unrelated defaults save is not blocked by mailbox validation");
    assert.equal(savedBody.settings.appointmentReminderHours, 48);
    assert.equal(savedBody.settings.intakeMailbox, SECONDARY_MAILBOX,
      "the now-unauthorized stored value is preserved untouched, not cleared or rewritten");
  } finally {
    database.close();
  }
});

test("the Gmail intake row names its effective source like every other App-managed row", async () => {
  const panel = await read("app/settings/components/GoogleWorkspacePanel.tsx");
  const rowStart = panel.indexOf(`htmlFor="workspace-intake-mailbox"`);
  assert.notEqual(rowStart, -1, "the intake mailbox row must remain identifiable");
  // Scoped to this row: the unscoped pattern already passes on the sibling rows, so an
  // assertion against the whole file would not notice this row losing its label again.
  assert.match(
    panel.slice(rowStart, rowStart + 400),
    /Source: \{effectiveConfigurationSourceLabel\(workspace\?\.intakeMailboxSource\)\}/u,
  );
  const route = await read("app/api/v1/google-workspace/route.ts");
  assert.match(route, /intakeMailboxSource: google\.effectiveSources\.intakeMailbox,/u,
    "the source travels on the same GET as its sibling provisioningSource");
});

test("a failed or stalled settings read cannot delay the Stage 3 resource surface", async () => {
  const panel = await read("app/settings/components/GoogleWorkspacePanel.tsx");
  const loaderStart = panel.indexOf("const loadWorkspaceResources = useCallback");
  assert.notEqual(loaderStart, -1);
  const loader = panel.slice(loaderStart, panel.indexOf("}, [isAdmin, loadIntakeMailboxSettings]);", loaderStart));

  // The defect first shared one try/catch and then used Promise.allSettled. Both forms await
  // the settings read, so a request that never settles still leaves the resource surface loading.
  assert.match(loader, /void loadIntakeMailboxSettings\(force, isCurrent\)/u);
  assert.doesNotMatch(loader, /Promise\.all/u, "the two reads must not share a settlement boundary");
  // The stage is settled from the resources result alone, with its own error path.
  assert.match(loader, /const resources = await cachedGetJson<WorkspaceSetupResourcesPayload>[\s\S]*setWorkspaceResources\(resources\)[\s\S]*setWorkspaceResourcesState\("ready"\)/u);
  assert.match(loader, /catch[\s\S]*setWorkspaceResourcesState\("error"\)/u);
  assert.doesNotMatch(loader, /setIntakeMailbox(?:Options)?\(/u,
    "the mailbox setters belong to the selector's own loader");

  // The selector owns an error state and its own retry, and does not touch stage state.
  const selectorLoaderStart = panel.indexOf("const loadIntakeMailboxSettings = useCallback");
  assert.notEqual(selectorLoaderStart, -1);
  const selectorLoader = panel.slice(selectorLoaderStart, selectorLoaderStart + 900);
  assert.match(selectorLoader, /setIntakeMailboxError\(/u);
  assert.doesNotMatch(selectorLoader, /setWorkspaceResources(?:State|Error)?\(/u,
    "a settings failure must never settle the resource surface");
  assert.match(panel, /intakeMailboxError && <div className="workspace-connection-health-error"[\s\S]{0,260}loadIntakeMailboxSettings\(true\)[\s\S]{0,40}Retry mailbox/u);
  // Degrading must not create a way to clear the stored mailbox: with the read failed the
  // selector holds the empty "use hosted mailbox" option, so saving is blocked too.
  const saveButton = panel.indexOf("void saveIntakeMailbox()");
  assert.match(panel.slice(saveButton - 400, saveButton), /disabled=\{[^}]*intakeMailboxError !== null[^}]*\}/u);
});

test("mailbox selection stays same-origin and Administrator-only", async () => {
  const database = new TestDatabase();
  try {
    configure(database);
    const office = await settingsRoute.PATCH(request("PATCH", {
      intakeMailbox: SECONDARY_MAILBOX,
    }, { email: OFFICE_EMAIL }));
    const crossOrigin = await settingsRoute.PATCH(request("PATCH", {
      intakeMailbox: SECONDARY_MAILBOX,
    }, { origin: "https://evil.example.test" }));
    assert.equal(office.status, 403);
    assert.equal(crossOrigin.status, 403);
    assert.equal(database.writes.length, 0);
  } finally {
    database.close();
  }
});
