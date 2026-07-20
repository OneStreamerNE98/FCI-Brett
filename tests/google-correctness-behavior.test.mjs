import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import { gmailAttachmentArtifactKey } from "../app/lib/google-gmail-artifacts.ts";
import { GoogleIntegrationError, mapGoogleIntegrationError } from "../app/lib/google-integration-error.ts";

const originalFetch = globalThis.fetch;
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = {};

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  configFile: false,
  appType: "custom",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false },
});

const [oauthModule, calendarModule] = await Promise.all([
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
  vite.ssrLoadModule("/app/lib/google-calendar-client.ts"),
]);

after(async () => {
  globalThis.fetch = originalFetch;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function connectionDatabase(connection) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async first() {
          queries.push({ kind: "first", sql, values: statement.values });
          return connection;
        },
        async run() {
          queries.push({ kind: "run", sql, values: statement.values });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

function workspaceConfigInput(encryptionKey, overrides = {}) {
  return {
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "shared-drive-test",
    GOOGLE_WORKSPACE_CLIENT_ID: "client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "client-secret",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://app.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive",
    ...overrides,
  };
}

async function accessTokenFixture() {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  const config = oauthModule.getGoogleRuntimeConfig(workspaceConfigInput(encryptionKey));
  const refreshTokenCiphertext = await oauthModule.encryptGoogleSecret(
    "refresh-token",
    encryptionKey,
    `google-connection:${config.connectionKey}:refresh`,
  );
  const connection = {
    id: "connection-1",
    google_email: "operations@cherryhillfci.com",
    refresh_token_ciphertext: refreshTokenCiphertext,
    key_version: config.tokenEncryptionKeyVersion,
    scopes_json: JSON.stringify([config.serviceScopes.drive]),
    status: "connected",
  };
  return { config, connection };
}

test("standard Google integration errors preserve the typed status and code", () => {
  const mapped = mapGoogleIntegrationError(
    new GoogleIntegrationError("drive_not_found", "The configured drive was not found.", 404),
    "Fallback",
  );
  assert.deepEqual(mapped, {
    body: { error: "The configured drive was not found.", code: "drive_not_found" },
    status: 404,
  });
  assert.deepEqual(mapGoogleIntegrationError(new Error("private detail"), "Safe fallback"), {
    body: { error: "Safe fallback" },
    status: 503,
  });
});

test("Gmail readiness requires the intake mailbox to be the single approved connection account", () => {
  const encryptionKey = Buffer.alloc(32, 9).toString("base64url");
  const matching = oauthModule.getGoogleRuntimeConfig(workspaceConfigInput(encryptionKey, {
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail",
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: "operations@cherryhillfci.com",
  }));
  assert.equal(matching.oauthReady, true);

  const mismatched = oauthModule.getGoogleRuntimeConfig(workspaceConfigInput(encryptionKey, {
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail",
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: "intake@cherryhillfci.com",
  }));
  assert.equal(mismatched.oauthReady, false);
  assert.ok(mismatched.missing.includes("Google Workspace intake mailbox matching the single approved connection account"));

  const multipleApprovedAccounts = oauthModule.getGoogleRuntimeConfig(workspaceConfigInput(encryptionKey, {
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com,admincrm@cherryhillfci.com",
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: "operations@cherryhillfci.com",
  }));
  assert.equal(multipleApprovedAccounts.oauthReady, false);
  assert.ok(multipleApprovedAccounts.missing.includes("Google Workspace intake mailbox matching the single approved connection account"));
  assert.deepEqual(
    multipleApprovedAccounts.missingDetails.find((detail) => detail.label === "Google Workspace intake mailbox matching the single approved connection account"),
    {
      label: "Google Workspace intake mailbox matching the single approved connection account",
      envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS",
      secret: false,
    },
  );
});

test("Workspace readiness describes missing hosted values without returning their values", () => {
  const configuredSecret = "configured-secret-must-not-appear";
  const missing = oauthModule.getGoogleRuntimeConfig({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail,calendar",
    GOOGLE_WORKSPACE_CLIENT_SECRET: configuredSecret,
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: "intake@cherryhillfci.com",
  });

  const byLabel = new Map(missing.missingDetails.map((detail) => [detail.label, detail]));
  assert.deepEqual(byLabel.get("Google OAuth client ID"), {
    label: "Google OAuth client ID",
    envVar: "GOOGLE_WORKSPACE_CLIENT_ID",
    secret: false,
  });
  assert.deepEqual(byLabel.get("32-byte Google token encryption key"), {
    label: "32-byte Google token encryption key",
    envVar: "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY",
    secret: true,
  });
  assert.deepEqual(byLabel.get("client appointments calendar ID"), {
    label: "client appointments calendar ID",
    envVar: "GOOGLE_WORKSPACE_CLIENT_APPOINTMENTS_CALENDAR_ID",
    secret: false,
  });
  assert.deepEqual(byLabel.get("field schedule calendar ID"), {
    label: "field schedule calendar ID",
    envVar: "GOOGLE_WORKSPACE_FIELD_SCHEDULE_CALENDAR_ID",
    secret: false,
  });
  assert.deepEqual(byLabel.get("Google Workspace intake mailbox matching the single approved connection account"), {
    label: "Google Workspace intake mailbox matching the single approved connection account",
    envVar: "GOOGLE_WORKSPACE_INTAKE_MAILBOX ↔ GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS",
    secret: false,
  });
  assert.deepEqual(missing.missing, missing.missingDetails.map((detail) => detail.label));
  assert.equal(JSON.stringify(missing.missingDetails).includes(configuredSecret), false);
  assert.ok(missing.missingDetails.every((detail) => Object.keys(detail).sort().join(",") === "envVar,label,secret"));
});

test("the Sites simulation status does not require production encryption configuration", async () => {
  const config = oauthModule.getGoogleRuntimeConfig({ NODE_ENV: "development" });
  assert.equal(config.simulation, true);
  assert.deepEqual(await oauthModule.getGoogleConnectionStatus(config), {
    connected: true,
    status: "connected",
    account: "Local Workspace simulation",
    services: { drive: true, gmail: true, calendar: true, sheets: true },
    requiresReauthorization: false,
  });
});

test("transient refresh failures keep the Google connection usable", async () => {
  const { config, connection } = await accessTokenFixture();
  const database = connectionDatabase(connection);
  globalThis.__FCI_TEST_CLOUDFLARE_ENV__.DB = database;
  globalThis.fetch = async () => {
    throw new TypeError("simulated network failure");
  };

  await assert.rejects(
    oauthModule.getGoogleAccessToken(config, "drive"),
    (error) => error.code === "token_service_unavailable" && error.status === 503,
  );
  const updates = database.queries.filter((query) => query.kind === "run");
  assert.equal(updates.length, 1);
  assert.doesNotMatch(updates[0].sql, /SET status = 'reauthorization-required'/);
  assert.match(updates[0].sql, /SET last_error_code = \?/);
  assert.equal(updates[0].values[0], "token_service_unavailable");
});

test("only a definitive invalid_grant refresh rejection requires reauthorization", async () => {
  const { config, connection } = await accessTokenFixture();
  const database = connectionDatabase(connection);
  globalThis.__FCI_TEST_CLOUDFLARE_ENV__.DB = database;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_grant" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    oauthModule.getGoogleAccessToken(config, "drive"),
    (error) => error.code === "refresh_token_rejected" && error.status === 409,
  );
  const updates = database.queries.filter((query) => query.kind === "run");
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /SET status = 'reauthorization-required'/);
  assert.equal(updates[0].values[0], "refresh_token_rejected");
});

test("Calendar requires the configured company calendar and never falls back to primary", async () => {
  const configured = {
    enabledServices: ["drive", "calendar"],
    clientAppointmentsCalendarId: "appointments@group.calendar.google.com",
    oauthReady: true,
  };
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const client = new calendarModule.GoogleCalendarClient("access-token", configured);
  await client.listUpcomingEvents(new Date("2026-07-13T12:00:00.000Z"));
  assert.match(requestedUrl, /calendars\/appointments%40group\.calendar\.google\.com\/events/);
  assert.doesNotMatch(requestedUrl, /calendars\/primary\/events/);

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not run for incomplete configuration");
  };
  const incomplete = new calendarModule.GoogleCalendarClient("access-token", {
    ...configured,
    clientAppointmentsCalendarId: undefined,
    oauthReady: false,
  });
  await assert.rejects(
    incomplete.listUpcomingEvents(new Date("2026-07-13T12:00:00.000Z")),
    (error) => error.code === "calendar_configuration_required" && error.status === 409,
  );
  assert.equal(fetchCalls, 0);
});

test("Gmail attachment artifact identity ignores unstable attachment IDs and order", () => {
  const firstHash = "A".repeat(43);
  const secondHash = "B".repeat(43);
  assert.equal(gmailAttachmentArtifactKey("2.1", firstHash), "attachment-part-2.1");
  assert.equal(gmailAttachmentArtifactKey("2.1", secondHash), "attachment-part-2.1");
  assert.equal(gmailAttachmentArtifactKey(null, firstHash), `attachment-sha256-${firstHash}`);
  assert.notEqual(gmailAttachmentArtifactKey("2.1", firstHash), gmailAttachmentArtifactKey("2.2", firstHash));
});
