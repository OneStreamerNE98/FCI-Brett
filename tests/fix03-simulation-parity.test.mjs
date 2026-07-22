import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const ADMIN_EMAIL = "admincrm@cherryhillfci.com";
const SIMULATION_CONNECTION = "workspace-simulation";
const LIVE_CONNECTION = "google-workspace";
const PROJECT_ID = "project-1";
const MESSAGE_ID = "sim-msg-westport";
const OPERATION_KEY = `${SIMULATION_CONNECTION}:file-gmail:${MESSAGE_ID}`;
const originalNodeEnvironment = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = "test";

function recordIntegrationEvent(state, values) {
  state.integrationEvents.push({
    id: values[0],
    connection_key: values[1],
    event_type: values[2],
    actor: values[3],
    entity_type: values[4],
    entity_id: values[5],
    detail: values[6],
    created_at: values[7],
  });
}

function createBehaviorDatabase() {
  const state = {
    activities: [],
    archives: [],
    artifacts: [],
    batchCount: 0,
    blueprints: [],
    connection: null,
    integrationEvents: [],
    loseLeaseBeforeBatch: null,
    mappings: [{
      id: "simulation-project-root",
      connection_key: SIMULATION_CONNECTION,
      entity_type: "project",
      entity_id: PROJECT_ID,
      folder_key: "project-root",
      drive_file_id: `sim-project-${PROJECT_ID}`,
      drive_url: `https://fci.example.test/?workspace-simulation=project&project=${PROJECT_ID}`,
    }],
    operations: [],
    projects: [{
      id: PROJECT_ID,
      project_number: "FCI2026-001",
      name: "FCI TEST — DO NOT USE project",
      client_name: "FCI TEST — DO NOT USE client",
    }],
    queries: [],
    resources: [],
    sheetStates: [],
    simulationState: null,
    throwBeforeBatch: null,
  };

  function changes(count) {
    return { meta: { changes: count } };
  }

  function statement(sql) {
    const query = { sql, values: [], kind: "prepared" };
    state.queries.push(query);
    const prepared = {
      bind(...values) {
        query.values = values;
        return prepared;
      },
      async all() {
        query.kind = "all";
        if (/FROM workspace_resources WHERE connection_key = \?/u.test(sql)) {
          return {
            results: state.resources
              .filter((row) => row.connection_key === query.values[0])
              .map((row) => structuredClone(row)),
          };
        }
        return { results: [] };
      },
      async first() {
        query.kind = "first";
        if (/FROM workspace_blueprints WHERE connection_key = \?/u.test(sql)) {
          return structuredClone(state.blueprints.find((row) => row.connection_key === query.values[0]) ?? null);
        }
        if (/FROM google_connections WHERE connection_key = \?/u.test(sql)) {
          return structuredClone(state.connection);
        }
        if (/FROM workspace_simulation_state WHERE id = \?/u.test(sql)) {
          return state.simulationState?.id === query.values[0]
            ? { state_json: state.simulationState.state_json }
            : null;
        }
        if (/FROM projects p JOIN clients c/u.test(sql)) {
          return structuredClone(state.projects.find((row) => row.id === query.values[0]) ?? null);
        }
        if (/FROM drive_folder_mappings/u.test(sql)) {
          const [connectionKey, entityId] = query.values;
          const row = state.mappings.find((candidate) => (
            candidate.connection_key === connectionKey
            && candidate.entity_type === "project"
            && candidate.entity_id === entityId
            && candidate.folder_key === "project-root"
          ));
          return row ? { drive_file_id: row.drive_file_id, drive_url: row.drive_url } : null;
        }
        if (/FROM gmail_file_archives WHERE connection_key = \? AND gmail_message_id = \?/u.test(sql)) {
          const [connectionKey, messageId] = query.values;
          return structuredClone(state.archives.find((row) => (
            row.connection_key === connectionKey && row.gmail_message_id === messageId
          )) ?? null);
        }
        return null;
      },
      async run() {
        query.kind = "run";
        const values = query.values;

        const conditionalLease = "EXISTS (SELECT 1 FROM google_drive_operations WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ?)";
        if (sql.includes(conditionalLease)) {
          const [operationKey, expectedLease] = values.slice(-2);
          const operation = state.operations.find((row) => (
            row.operation_key === operationKey
            && row.status === "in-progress"
            && row.lease_expires_at === expectedLease
          ));
          if (!operation) return changes(0);
        }

        if (/^INSERT INTO workspace_simulation_state/u.test(sql)) {
          state.simulationState = { id: values[0], state_json: values[1], updated_at: values[2] };
          return changes(1);
        }

        if (/^INSERT INTO google_integration_events/u.test(sql)) {
          recordIntegrationEvent(state, values);
          return changes(1);
        }

        if (/^INSERT INTO google_drive_operations/u.test(sql)) {
          const operationKey = values[2];
          const existing = state.operations.find((row) => row.operation_key === operationKey);
          const retryFence = values[8];
          if (existing && existing.status === "in-progress" && existing.lease_expires_at >= retryFence) {
            return changes(0);
          }
          if (existing) {
            existing.status = "in-progress";
            existing.lease_expires_at = values[4];
            existing.last_error_code = null;
            existing.created_by = values[5];
            existing.updated_at = values[7];
          } else {
            state.operations.push({
              id: values[0],
              connection_key: values[1],
              operation_key: operationKey,
              project_id: values[3],
              status: "in-progress",
              lease_expires_at: values[4],
              last_error_code: null,
              created_by: values[5],
              created_at: values[6],
              updated_at: values[7],
            });
          }
          return changes(1);
        }

        if (/^UPDATE google_drive_operations SET status = 'completed'/u.test(sql)) {
          const [updatedAt, operationKey, expectedLease] = values;
          const operation = state.operations.find((row) => (
            row.operation_key === operationKey
            && row.status === "in-progress"
            && row.lease_expires_at === expectedLease
          ));
          if (!operation) return changes(0);
          operation.status = "completed";
          operation.lease_expires_at = null;
          operation.last_error_code = null;
          operation.updated_at = updatedAt;
          return changes(1);
        }

        if (/^UPDATE google_drive_operations SET updated_at = \?/u.test(sql)) {
          const [updatedAt, operationKey, expectedLease] = values;
          const operation = state.operations.find((row) => (
            row.operation_key === operationKey
            && row.status === "in-progress"
            && row.lease_expires_at === expectedLease
          ));
          if (!operation) return changes(0);
          operation.updated_at = updatedAt;
          return changes(1);
        }

        if (/^UPDATE google_drive_operations SET status = 'failed'/u.test(sql)) {
          const [errorCode, updatedAt, operationKey, expectedLease] = values;
          const operation = state.operations.find((row) => (
            row.operation_key === operationKey
            && row.status === "in-progress"
            && row.lease_expires_at === expectedLease
          ));
          if (!operation) return changes(0);
          operation.status = "failed";
          operation.lease_expires_at = null;
          operation.last_error_code = errorCode;
          operation.updated_at = updatedAt;
          return changes(1);
        }

        if (/^INSERT INTO gmail_file_archives/u.test(sql)) {
          const existing = state.archives.find((row) => (
            row.connection_key === values[1] && row.gmail_message_id === values[2]
          ));
          const archive = existing ?? {};
          Object.assign(archive, {
            id: existing?.id ?? values[0],
            connection_key: values[1],
            gmail_message_id: values[2],
            gmail_thread_id: values[3],
            project_id: values[4],
            project_drive_folder_id: values[5],
            email_archive_folder_id: values[6],
            attachment_folder_id: values[7],
            status: "filing",
            approval_actor: values[8],
            approved_at: values[9],
            email_drive_file_id: null,
            email_drive_url: null,
            attachment_count: 0,
            last_error_code: null,
            filed_at: null,
            created_at: existing?.created_at ?? values[10],
            updated_at: values[11],
          });
          if (!existing) state.archives.push(archive);
          return changes(1);
        }

        if (/^INSERT INTO gmail_file_archive_artifacts/u.test(sql)) {
          const isOriginal = /'original-eml', 'email'/u.test(sql);
          const artifactKey = isOriginal ? "original-eml" : values[2];
          const existing = state.artifacts.find((row) => row.archive_id === values[1] && row.artifact_key === artifactKey);
          const artifact = existing ?? {};
          if (isOriginal) {
            Object.assign(artifact, {
              id: existing?.id ?? values[0],
              archive_id: values[1],
              artifact_key: artifactKey,
              kind: "email",
              gmail_attachment_id: null,
              original_filename: null,
              mime_type: "message/rfc822",
              byte_size: values[2],
              sha256: null,
              drive_file_id: values[3],
              drive_url: values[4],
              created_at: existing?.created_at ?? values[5],
              updated_at: values[6],
            });
          } else {
            Object.assign(artifact, {
              id: existing?.id ?? values[0],
              archive_id: values[1],
              artifact_key: artifactKey,
              kind: "attachment",
              gmail_attachment_id: values[3],
              original_filename: values[4],
              mime_type: values[5],
              byte_size: values[6],
              sha256: values[7],
              drive_file_id: values[8],
              drive_url: values[9],
              created_at: existing?.created_at ?? values[10],
              updated_at: values[11],
            });
          }
          if (!existing) state.artifacts.push(artifact);
          return changes(1);
        }

        if (/^UPDATE gmail_file_archives SET status = 'drive-complete'/u.test(sql)) {
          const archive = state.archives.find((row) => row.id === values[4]);
          if (!archive) return changes(0);
          Object.assign(archive, {
            status: "drive-complete",
            email_drive_file_id: values[0],
            email_drive_url: values[1],
            attachment_count: values[2],
            last_error_code: null,
            updated_at: values[3],
          });
          return changes(1);
        }

        if (/^UPDATE gmail_file_archives SET status = 'filed'/u.test(sql)) {
          const archive = state.archives.find((row) => row.id === values[2]);
          if (!archive) return changes(0);
          Object.assign(archive, {
            status: "filed",
            filed_at: values[0],
            last_error_code: null,
            updated_at: values[1],
          });
          return changes(1);
        }

        if (/^UPDATE gmail_file_archives SET status = 'failed'/u.test(sql)) {
          const archive = state.archives.find((row) => row.id === values[2]);
          if (!archive) return changes(0);
          Object.assign(archive, {
            status: "failed",
            last_error_code: values[0],
            updated_at: values[1],
          });
          return changes(1);
        }

        if (/^INSERT INTO activity_events/u.test(sql)) {
          const literalAction = sql.match(/VALUES \(\?, \?, '([^']+)'/u)?.[1];
          const action = literalAction ?? values[2];
          const actorIndex = literalAction ? 2 : 3;
          state.activities.push({
            id: values[0],
            record_id: values[1],
            action,
            actor: values[actorIndex],
            detail: values[actorIndex + 1],
            created_at: values[actorIndex + 2],
          });
          return changes(1);
        }

        if (/^DELETE FROM activity_events WHERE action GLOB/u.test(sql)) {
          const before = state.activities.length;
          state.activities = state.activities.filter((row) => !row.action.startsWith("workspace_simulation."));
          return changes(before - state.activities.length);
        }

        if (/^DELETE FROM gmail_file_archive_artifacts/u.test(sql)) {
          const archiveIds = new Set(state.archives
            .filter((row) => row.connection_key === values[0])
            .map((row) => row.id));
          const before = state.artifacts.length;
          state.artifacts = state.artifacts.filter((row) => !archiveIds.has(row.archive_id));
          return changes(before - state.artifacts.length);
        }

        const scopedDeletes = [
          ["gmail_file_archives", "archives"],
          ["drive_folder_mappings", "mappings"],
          ["google_drive_operations", "operations"],
          ["google_sheet_sync_state", "sheetStates"],
          ["google_integration_events", "integrationEvents"],
          ["workspace_resources", "resources"],
          ["workspace_blueprints", "blueprints"],
        ];
        for (const [table, collection] of scopedDeletes) {
          if (new RegExp(`^DELETE FROM ${table} WHERE connection_key = \\?`, "u").test(sql)) {
            const before = state[collection].length;
            state[collection] = state[collection].filter((row) => row.connection_key !== values[0]);
            return changes(before - state[collection].length);
          }
        }

        return changes(1);
      },
    };
    return prepared;
  }

  const database = {
    state,
    prepare: statement,
    async batch(statements) {
      state.batchCount += 1;
      if (state.throwBeforeBatch === state.batchCount) {
        state.throwBeforeBatch = null;
        throw new Error("FCI TEST simulated archive copy failure");
      }
      if (state.loseLeaseBeforeBatch === state.batchCount) {
        for (const operation of state.operations) {
          if (operation.status === "in-progress") operation.lease_expires_at += 1;
        }
      }
      const results = [];
      for (const prepared of statements) results.push(await prepared.run());
      return results;
    },
  };
  return database;
}

const database = createBehaviorDatabase();
const workerEnvironment = {
  NODE_ENV: "development",
  FCI_OFFICE_EMAILS: ADMIN_EMAIL,
  FCI_ADMIN_EMAILS: ADMIN_EMAIL,
  GOOGLE_INTEGRATION_MODE: "simulation",
  DB: database,
};
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/fix03-simulation-parity",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false },
});

const [gmailFileRoute, calendarEventsRoute, calendarHoldRoute, resetRoute, sheets, oauthSites, simulation, integrationEvents] = await Promise.all([
  vite.ssrLoadModule("/app/api/v1/integrations/google/gmail/messages/[messageId]/file/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/events/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/calendar/test-hold/route.ts"),
  vite.ssrLoadModule("/app/api/v1/integrations/google/simulation/reset/route.ts"),
  vite.ssrLoadModule("/app/lib/google-sheets.ts"),
  vite.ssrLoadModule("/app/lib/google-oauth-sites.ts"),
  vite.ssrLoadModule("/app/lib/workspace-simulation.ts"),
  vite.ssrLoadModule("/app/lib/google-integration-events.ts"),
]);

let providerCalls = 0;
const simulationFetch = async () => {
  providerCalls += 1;
  throw new Error("Local Workspace simulation must never call a Google provider.");
};
globalThis.fetch = simulationFetch;

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

function routeRequest(path, method = "GET", body) {
  const url = new URL(path, "https://fci.example.test");
  const request = new Request(url, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: url.origin }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "oai-authenticated-user-email": ADMIN_EMAIL,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request;
}

function integrationProjection(row) {
  return {
    connectionKey: row.connection_key,
    eventType: row.event_type,
    actor: row.actor,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail,
  };
}

function configureSimulation(databaseFixture) {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "development",
    FCI_OFFICE_EMAILS: ADMIN_EMAIL,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "simulation",
    DB: databaseFixture,
  });
  globalThis.fetch = simulationFetch;
}

async function configureLive(databaseFixture) {
  const encryptionKey = Buffer.alloc(32, 0x46).toString("base64url");
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
  Object.assign(workerEnvironment, {
    NODE_ENV: "production",
    FCI_OFFICE_EMAILS: ADMIN_EMAIL,
    FCI_ADMIN_EMAILS: ADMIN_EMAIL,
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "drive,gmail",
    GOOGLE_WORKSPACE_CLIENT_ID: "fix03-client-id",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "FCI_TEST_CLIENT_SECRET",
    GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI: "https://fci.example.test/api/v1/integrations/google/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    GOOGLE_WORKSPACE_ALLOWED_DOMAINS: "cherryhillfci.com",
    GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_INTAKE_MAILBOX: "operations@cherryhillfci.com",
    GOOGLE_WORKSPACE_SHARED_DRIVE_ID: "live-drive-root",
    DB: databaseFixture,
  });
  const config = oauthSites.getGoogleRuntimeConfig();
  databaseFixture.state.connection = {
    id: "live-connection",
    google_email: "operations@cherryhillfci.com",
    refresh_token_ciphertext: await oauthSites.encryptGoogleSecret(
      "FCI_TEST_REFRESH_TOKEN",
      encryptionKey,
      `google-connection:${config.connectionKey}:refresh`,
    ),
    key_version: config.tokenEncryptionKeyVersion,
    scopes_json: JSON.stringify(config.enabledServices.map((service) => config.serviceScopes[service])),
    status: "connected",
  };
}

function installLiveFilingProvider(messageId) {
  const gmailRaw = Buffer.from("From: client@example.test\r\nTo: operations@cherryhillfci.com\r\nSubject: FCI TEST\r\n\r\nTest body").toString("base64url");
  const liveAttachmentBytes = Buffer.from("FCI TEST attachment");
  const folderById = {
    "live-project-root": {
      id: "live-project-root",
      name: "FCI2026-001 — FCI TEST — DO NOT USE project",
      parents: ["live-drive-root"],
      appProperties: { fciProjectId: PROJECT_ID, fciFolderKind: "project" },
    },
    "live-correspondence": {
      id: "live-correspondence",
      name: "05_Correspondence",
      parents: ["live-project-root"],
      appProperties: { fciProjectId: PROJECT_ID, fciFolderKind: "project-child" },
    },
    "live-email-archive": {
      id: "live-email-archive",
      name: "Email Archive",
      parents: ["live-correspondence"],
      appProperties: { fciProjectId: PROJECT_ID, fciFolderKind: "project-child" },
    },
    "live-email-attachments": {
      id: "live-email-attachments",
      name: "Email Attachments",
      parents: ["live-correspondence"],
      appProperties: { fciProjectId: PROJECT_ID, fciFolderKind: "project-child" },
    },
  };
  const folderForName = {
    "05_Correspondence": folderById["live-correspondence"],
    "Email Archive": folderById["live-email-archive"],
    "Email Attachments": folderById["live-email-attachments"],
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "FCI_TEST_ACCESS_TOKEN", expires_in: 3600 });
    }
    if (url.hostname === "gmail.googleapis.com") {
      if (url.pathname.endsWith(`/messages/${messageId}`) && url.searchParams.get("format") === "raw") {
        return Response.json({ id: messageId, threadId: "live-thread", raw: gmailRaw });
      }
      if (url.pathname.endsWith(`/messages/${messageId}`) && url.searchParams.get("format") === "full") {
        return Response.json({
          id: messageId,
          threadId: "live-thread",
          labelIds: ["INBOX"],
          snippet: "FCI TEST body",
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: "Client <client@example.test>" },
              { name: "To", value: "operations@cherryhillfci.com" },
              { name: "Subject", value: "FCI TEST — DO NOT USE" },
              { name: "Date", value: "Wed, 22 Jul 2026 10:00:00 -0400" },
            ],
            body: { size: 0 },
            parts: [
              {
                partId: "0",
                mimeType: "text/plain",
                body: { data: Buffer.from("FCI TEST body").toString("base64url"), size: 13 },
              },
              {
                partId: "1",
                filename: "FCI-Test-Attachment.pdf",
                mimeType: "application/pdf",
                headers: [{ name: "Content-Disposition", value: "attachment; filename=FCI-Test-Attachment.pdf" }],
                body: { data: liveAttachmentBytes.toString("base64url"), size: liveAttachmentBytes.byteLength },
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/labels") && method === "GET") {
        return Response.json({ labels: [
          { id: "FCI_ROOT", name: "FCI" },
          { id: "FCI_INTAKE", name: "FCI/Intake" },
          { id: "FCI_REVIEW", name: "FCI/Needs Review" },
          { id: "FCI_FILED", name: "FCI/Filed" },
        ] });
      }
      if (url.pathname.endsWith(`/messages/${messageId}/modify`) && method === "POST") {
        return Response.json({ id: messageId, threadId: "live-thread", labelIds: ["INBOX", "FCI_FILED"] });
      }
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/drive/v3/files/")) {
      const folderId = decodeURIComponent(url.pathname.slice("/drive/v3/files/".length));
      const folder = folderById[folderId];
      if (folder) {
        return Response.json({
          ...folder,
          mimeType: "application/vnd.google-apps.folder",
          trashed: false,
          webViewLink: `https://drive.google.test/${folder.id}`,
        });
      }
    }
    if (url.hostname === "www.googleapis.com" && url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const name = query.match(/name = '([^']+)'/u)?.[1];
      const folder = name ? folderForName[name] : null;
      return Response.json({ files: folder ? [{
        ...folder,
        mimeType: "application/vnd.google-apps.folder",
        trashed: false,
        webViewLink: `https://drive.google.test/${folder.id}`,
      }] : [] });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files" && method === "POST") {
      const multipart = await init.body.text();
      const metadataJson = multipart.match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{[^\r]+\})\r\n--/u)?.[1];
      if (!metadataJson) throw new Error("Live filing fixture could not read Drive upload metadata.");
      const metadata = JSON.parse(metadataJson);
      const isAttachment = metadata.appProperties?.fciArchiveKind === "attachment";
      return Response.json({
        id: isAttachment ? "live-attachment-file" : "live-email-file",
        name: metadata.name,
        mimeType: metadata.mimeType,
        parents: metadata.parents,
        trashed: false,
        webViewLink: isAttachment
          ? "https://drive.google.test/live-attachment-file"
          : "https://drive.google.test/live-email-file",
        appProperties: metadata.appProperties,
        size: String(isAttachment ? liveAttachmentBytes.byteLength : 95),
      });
    }
    throw new Error(`Unexpected live filing provider request: ${method} ${url}`);
  };
}

function filingEventShape(row) {
  return {
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detailKeys: row.detail.split(";").map((part) => part.split("=", 1)[0]).sort(),
  };
}

function nestedKeyShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, nestedKeyShape(value[key])]),
  );
}

function liveResidue() {
  return {
    activity: {
      id: "live-activity",
      record_id: PROJECT_ID,
      action: "gmail.archive_filed",
      actor: ADMIN_EMAIL,
      detail: "Live row must survive local simulation reset",
      created_at: 1,
    },
    archive: {
      id: "live-archive",
      connection_key: LIVE_CONNECTION,
      gmail_message_id: "live-message",
      project_id: PROJECT_ID,
      status: "filed",
    },
    artifact: {
      id: "live-artifact",
      archive_id: "live-archive",
      artifact_key: "original-eml",
      kind: "email",
    },
    blueprint: {
      id: "live-blueprint",
      connection_key: LIVE_CONNECTION,
      version: 1,
      blueprint_json: "{}",
    },
    event: {
      id: "live-event",
      connection_key: LIVE_CONNECTION,
      event_type: "gmail.archive_filed",
      actor: ADMIN_EMAIL,
      entity_type: "project",
      entity_id: PROJECT_ID,
      detail: "mode=workspace;attachment_count=1;inbox_retained=true",
      created_at: 1,
    },
    mapping: {
      id: "live-mapping",
      connection_key: LIVE_CONNECTION,
      entity_type: "project",
      entity_id: PROJECT_ID,
      folder_key: "project-root",
      drive_file_id: "live-project-root",
      drive_url: "https://drive.google.com/drive/folders/live-project-root",
    },
    operation: {
      id: "live-operation",
      connection_key: LIVE_CONNECTION,
      operation_key: "google-workspace:file-gmail:live-message",
      project_id: PROJECT_ID,
      status: "completed",
      lease_expires_at: null,
    },
    resource: {
      id: "live-resource",
      connection_key: LIVE_CONNECTION,
      resource_type: "drive.shared-drive",
      resource_key: "primary",
      external_id: "live-shared-drive",
      parent_external_id: null,
      external_url: "https://drive.google.com/drive/folders/live-shared-drive",
      origin: "adopted",
      metadata_json: "{}",
      created_by: ADMIN_EMAIL,
      created_at: 1,
      updated_at: 1,
    },
    sheetState: {
      connection_key: LIVE_CONNECTION,
      entity_type: "clients",
      status: "synced",
    },
  };
}

function normalizeMode(detail) {
  return detail.replace(/mode=(?:workspace|simulation)/u, "mode=<mode>");
}

test("shared integration contracts keep live and simulation event-row shapes equivalent", () => {
  const liveApproved = integrationEvents.gmailArchiveApprovedIntegrationEvent("workspace", PROJECT_ID);
  const simulatedApproved = integrationEvents.gmailArchiveApprovedIntegrationEvent("simulation", PROJECT_ID);
  assert.deepEqual(
    { ...simulatedApproved, detail: normalizeMode(simulatedApproved.detail) },
    { ...liveApproved, detail: normalizeMode(liveApproved.detail) },
  );

  const liveFiled = integrationEvents.gmailArchiveFiledIntegrationEvent("workspace", PROJECT_ID, 1);
  const simulatedFiled = integrationEvents.gmailArchiveFiledIntegrationEvent("simulation", PROJECT_ID, 1);
  assert.deepEqual(
    { ...simulatedFiled, detail: normalizeMode(simulatedFiled.detail) },
    { ...liveFiled, detail: normalizeMode(liveFiled.detail) },
  );
  assert.deepEqual(
    [liveApproved.eventType, liveFiled.eventType],
    ["gmail.archive_approved", "gmail.archive_filed"],
  );

  const calendarWindow = { start: "2026-07-22T12:00:00.000Z", end: "2026-07-29T12:00:00.000Z" };
  assert.deepEqual(
    integrationEvents.calendarEventsListedIntegrationEvent("appointments-calendar", calendarWindow, 2),
    {
      eventType: "calendar.workspace_events_listed",
      entityType: "calendar",
      entityId: "appointments-calendar",
      detail: `window=${calendarWindow.start}/${calendarWindow.end};count=2`,
    },
  );
  assert.deepEqual(
    integrationEvents.calendarHoldCreatedIntegrationEvent({
      id: "calendar-event",
      start: "2026-07-22T13:00:00.000Z",
      end: "2026-07-22T13:30:00.000Z",
    }),
    {
      eventType: "calendar.workspace_hold_created",
      entityType: "calendar_event",
      entityId: "calendar-event",
      detail: "start=2026-07-22T13:00:00.000Z;end=2026-07-22T13:30:00.000Z;visibility=private;attendees=none;notifications=none",
    },
  );

  const liveSheet = integrationEvents.sheetsDirectorySyncedIntegrationEvent("live-directory-sheet", { clients: 1, projects: 2 });
  const simulatedSheet = integrationEvents.sheetsDirectorySyncedIntegrationEvent("workspace-simulation-directory-sheet", { clients: 1, projects: 2 });
  assert.deepEqual(
    { eventType: simulatedSheet.eventType, entityType: simulatedSheet.entityType, detail: simulatedSheet.detail },
    { eventType: liveSheet.eventType, entityType: liveSheet.entityType, detail: liveSheet.detail },
  );
});

test("live and simulation Gmail filing emit the same durable event-row shape", async () => {
  const simulationDatabase = createBehaviorDatabase();
  const liveDatabase = createBehaviorDatabase();
  const liveMessageId = "live-msg-parity";
  liveDatabase.state.mappings = [{
    id: "live-project-mapping",
    connection_key: LIVE_CONNECTION,
    entity_type: "project",
    entity_id: PROJECT_ID,
    folder_key: "project-root",
    drive_file_id: "live-project-root",
    drive_url: "https://drive.google.test/live-project-root",
  }];

  try {
    configureSimulation(simulationDatabase);
    await simulation.getSimulationState();
    const simulationResponse = await gmailFileRoute.POST(
      routeRequest(`/api/v1/integrations/google/gmail/messages/${MESSAGE_ID}/file`, "POST", { projectId: PROJECT_ID }),
      { params: Promise.resolve({ messageId: MESSAGE_ID }) },
    );
    assert.equal(simulationResponse.status, 200, JSON.stringify(await simulationResponse.clone().json()));
    const simulationBody = await simulationResponse.json();

    await configureLive(liveDatabase);
    installLiveFilingProvider(liveMessageId);
    const liveResponse = await gmailFileRoute.POST(
      routeRequest(`/api/v1/integrations/google/gmail/messages/${liveMessageId}/file`, "POST", { projectId: PROJECT_ID }),
      { params: Promise.resolve({ messageId: liveMessageId }) },
    );
    assert.equal(liveResponse.status, 200, JSON.stringify(await liveResponse.clone().json()));
    const liveBody = await liveResponse.json();

    const simulationAttachmentShapes = simulationBody.archive.attachments.map(nestedKeyShape);
    const liveAttachmentShapes = liveBody.archive.attachments.map(nestedKeyShape);
    assert.deepEqual(simulationAttachmentShapes, liveAttachmentShapes);
    assert.deepEqual(liveAttachmentShapes, [{
      byteSize: null,
      driveUrl: null,
      filename: null,
      mimeType: null,
    }]);

    assert.deepEqual(
      simulationDatabase.state.integrationEvents.map(filingEventShape),
      liveDatabase.state.integrationEvents.map(filingEventShape),
    );
    assert.deepEqual(
      liveDatabase.state.integrationEvents.map((event) => event.event_type),
      ["gmail.archive_approved", "gmail.archive_filed"],
    );
    assert.ok(liveDatabase.state.integrationEvents.every((event) => event.connection_key === LIVE_CONNECTION));
    assert.ok(simulationDatabase.state.integrationEvents.every((event) => event.connection_key === SIMULATION_CONNECTION));
  } finally {
    configureSimulation(database);
  }
});

test("simulated Gmail filing failure emits activity and integration audit rows", async () => {
  const failureDatabase = createBehaviorDatabase();
  try {
    configureSimulation(failureDatabase);
    await simulation.getSimulationState();
    failureDatabase.state.throwBeforeBatch = failureDatabase.state.batchCount + 2;

    const response = await gmailFileRoute.POST(
      routeRequest(`/api/v1/integrations/google/gmail/messages/${MESSAGE_ID}/file`, "POST", { projectId: PROJECT_ID }),
      { params: Promise.resolve({ messageId: MESSAGE_ID }) },
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "The Workspace Gmail integration could not complete that request.",
    });

    assert.deepEqual(
      failureDatabase.state.activities.map((row) => row.action),
      ["workspace_simulation.gmail_approved", "workspace_simulation.gmail_failed"],
    );
    const failureActivity = failureDatabase.state.activities.at(-1);
    assert.deepEqual({
      recordId: failureActivity.record_id,
      action: failureActivity.action,
      actor: failureActivity.actor,
      detail: failureActivity.detail,
    }, {
      recordId: PROJECT_ID,
      action: "workspace_simulation.gmail_failed",
      actor: ADMIN_EMAIL,
      detail: "Review-approved Gmail archive stopped; code=gmail_file_archive_failed; no Inbox label was removed",
    });
    assert.deepEqual(
      failureDatabase.state.integrationEvents.map(integrationProjection),
      [
        {
          connectionKey: SIMULATION_CONNECTION,
          eventType: "gmail.archive_approved",
          actor: ADMIN_EMAIL,
          entityType: "project",
          entityId: PROJECT_ID,
          detail: "mode=simulation;inbox_retained=true",
        },
        {
          connectionKey: SIMULATION_CONNECTION,
          eventType: "gmail.archive_failed",
          actor: ADMIN_EMAIL,
          entityType: "project",
          entityId: PROJECT_ID,
          detail: "mode=simulation;code=gmail_file_archive_failed",
        },
      ],
    );
    assert.deepEqual({
      status: failureDatabase.state.archives[0].status,
      lastErrorCode: failureDatabase.state.archives[0].last_error_code,
    }, {
      status: "failed",
      lastErrorCode: "gmail_file_archive_failed",
    });
    assert.deepEqual({
      status: failureDatabase.state.operations[0].status,
      leaseExpiresAt: failureDatabase.state.operations[0].lease_expires_at,
      lastErrorCode: failureDatabase.state.operations[0].last_error_code,
    }, {
      status: "failed",
      leaseExpiresAt: null,
      lastErrorCode: "gmail_file_archive_failed",
    });
    assert.equal(failureDatabase.state.artifacts.length, 0);
    const failureState = JSON.parse(failureDatabase.state.simulationState.state_json);
    assert.equal(failureState.messages[0].labelIds.includes("FCI_FILED"), false);
  } finally {
    configureSimulation(database);
  }
});

test("live and simulation Sheets sync emit the same success event-row shape", async () => {
  const simulationConfig = oauthSites.getGoogleRuntimeConfig({
    NODE_ENV: "development",
    GOOGLE_INTEGRATION_MODE: "simulation",
  });
  const liveConfig = oauthSites.getGoogleRuntimeConfig({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_WORKSPACE_ENABLED_SERVICES: "sheets",
    GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID: "live-directory-sheet",
  });
  const persistence = {
    async loadClientRows() { return []; },
    async loadProjectRows() { return []; },
    async updateSyncState() {},
    async getSyncStates() { return []; },
  };
  const simulationEvents = [];
  const liveEvents = [];
  const eventWriter = (target) => async (config, eventType, actor, entityType, entityId, detail) => {
    target.push({ connectionKey: config.connectionKey, eventType, actor, entityType, entityId, detail });
  };

  await sheets.syncGoogleDirectory(simulationConfig, ADMIN_EMAIL, {
    persistence,
    async getAccessToken() { throw new Error("Simulation must not request a Sheets token."); },
    async writeIntegrationEvent(...args) { return eventWriter(simulationEvents)(...args); },
    async fetch() { throw new Error("Simulation must not call Sheets."); },
    now: () => 1_790_000_000_000,
  });
  await sheets.syncGoogleDirectory(liveConfig, ADMIN_EMAIL, {
    persistence,
    async getAccessToken() { return "FCI_TEST_ACCESS_TOKEN"; },
    async writeIntegrationEvent(...args) { return eventWriter(liveEvents)(...args); },
    async fetch(input, init = {}) {
      const url = new URL(String(input));
      if ((init.method ?? "GET") === "GET" && !url.pathname.includes("/values/")) {
        return Response.json({
          sheets: [
            { properties: { sheetId: 1, title: "Client Directory", gridProperties: { rowCount: 1000, columnCount: 11 } } },
            { properties: { sheetId: 2, title: "Project Register", gridProperties: { rowCount: 1000, columnCount: 12 } } },
          ],
        });
      }
      if ((init.method ?? "GET") === "GET") return Response.json({ values: [] });
      return Response.json({});
    },
    now: () => 1_790_000_000_000,
  });

  assert.deepEqual(
    simulationEvents.map(({ eventType, entityType, detail }) => ({ eventType, entityType, detail })),
    liveEvents.map(({ eventType, entityType, detail }) => ({ eventType, entityType, detail })),
  );
  assert.equal(simulationEvents[0].entityId, "workspace-simulation-directory-sheet");
  assert.equal(liveEvents[0].entityId, "live-directory-sheet");
});

test("a simulated Gmail worker cannot commit after its exact lease is replaced", async () => {
  const staleDatabase = createBehaviorDatabase();
  workerEnvironment.DB = staleDatabase;
  try {
    await simulation.getSimulationState();
    staleDatabase.state.loseLeaseBeforeBatch = 2;

    const response = await gmailFileRoute.POST(
      routeRequest(`/api/v1/integrations/google/gmail/messages/${MESSAGE_ID}/file`, "POST", { projectId: PROJECT_ID }),
      { params: Promise.resolve({ messageId: MESSAGE_ID }) },
    );
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "gmail_file_lease_lost");
    assert.equal(staleDatabase.state.artifacts.length, 0);
    assert.equal(staleDatabase.state.archives.length, 1);
    assert.equal(staleDatabase.state.archives[0].status, "filing");
    assert.deepEqual(
      staleDatabase.state.integrationEvents.map((event) => event.event_type),
      ["gmail.archive_approved"],
    );
    assert.deepEqual(
      staleDatabase.state.activities.map((event) => event.action),
      ["workspace_simulation.gmail_approved"],
    );
    assert.equal(staleDatabase.state.operations[0].status, "in-progress");
    const simulationState = JSON.parse(staleDatabase.state.simulationState.state_json);
    assert.equal(simulationState.messages[0].labelIds.includes("FCI_FILED"), false);
  } finally {
    workerEnvironment.DB = database;
  }
});

test("one message lease serializes cross-project Gmail filing contenders", async () => {
  const contenderDatabase = createBehaviorDatabase();
  const secondProjectId = "project-2";
  contenderDatabase.state.projects.push({
    id: secondProjectId,
    project_number: "FCI2026-002",
    name: "FCI TEST — DO NOT USE second project",
    client_name: "FCI TEST — DO NOT USE client",
  });
  contenderDatabase.state.mappings.push({
    id: "simulation-project-root-2",
    connection_key: SIMULATION_CONNECTION,
    entity_type: "project",
    entity_id: secondProjectId,
    folder_key: "project-root",
    drive_file_id: `sim-project-${secondProjectId}`,
    drive_url: `https://fci.example.test/?workspace-simulation=project&project=${secondProjectId}`,
  });
  contenderDatabase.state.operations.push({
    id: "first-project-contender",
    connection_key: SIMULATION_CONNECTION,
    operation_key: OPERATION_KEY,
    project_id: PROJECT_ID,
    status: "in-progress",
    lease_expires_at: Date.now() + 60_000,
    last_error_code: null,
    created_by: ADMIN_EMAIL,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  workerEnvironment.DB = contenderDatabase;
  try {
    await simulation.getSimulationState();
    const response = await gmailFileRoute.POST(
      routeRequest(`/api/v1/integrations/google/gmail/messages/${MESSAGE_ID}/file`, "POST", { projectId: secondProjectId }),
      { params: Promise.resolve({ messageId: MESSAGE_ID }) },
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "gmail_file_in_progress");
    assert.equal(contenderDatabase.state.archives.length, 0);
    assert.equal(contenderDatabase.state.artifacts.length, 0);
    assert.equal(contenderDatabase.state.activities.length, 0);
    assert.equal(contenderDatabase.state.integrationEvents.length, 0);
  } finally {
    workerEnvironment.DB = database;
  }
});

test("simulation double-submit reuses one calendar test hold", async () => {
  const fixture = createBehaviorDatabase();
  try {
    configureSimulation(fixture);
    const requestedStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const requestBody = { start: requestedStart };
    const [firstResponse, secondResponse] = await Promise.all([
      calendarHoldRoute.POST(routeRequest(
        "/api/v1/integrations/google/calendar/test-hold",
        "POST",
        requestBody,
      )),
      calendarHoldRoute.POST(routeRequest(
        "/api/v1/integrations/google/calendar/test-hold",
        "POST",
        requestBody,
      )),
    ]);
    const [first, second] = await Promise.all([firstResponse.json(), secondResponse.json()]);
    const responses = [
      { response: firstResponse, body: first },
      { response: secondResponse, body: second },
    ];
    const created = responses.find(({ response }) => response.status === 201);
    const blocked = responses.find(({ response }) => response.status === 409);

    assert.deepEqual(responses.map(({ response }) => response.status).sort(), [201, 409]);
    assert.equal(blocked.body.code, "calendar_test_hold_in_progress");
    assert.equal("extendedProperties" in created.body.event, false);

    const replayResponse = await calendarHoldRoute.POST(routeRequest(
      "/api/v1/integrations/google/calendar/test-hold",
      "POST",
      requestBody,
    ));
    const replay = await replayResponse.json();
    const stored = JSON.parse(fixture.state.simulationState.state_json);
    const listed = await simulation.listSimulationCalendarEvents();
    const listedHold = listed.events.find((event) => event.id === created.body.event.id);

    assert.equal(replayResponse.status, 201);
    assert.equal(replay.event.id, created.body.event.id);
    assert.equal("extendedProperties" in replay.event, false);
    assert.deepEqual(Object.keys(listedHold).sort(), ["end", "id", "start", "title"]);
    assert.equal(stored.calendarEvents.filter((event) => event.start === requestedStart).length, 1);
    assert.equal(fixture.state.integrationEvents.filter((event) => (
      event.event_type === "calendar.workspace_hold_created"
    )).length, 1);
  } finally {
    configureSimulation(database);
  }
});

test("FIX-03 local simulation matches durable integration contracts and resets only simulation residue", async () => {
  const state = database.state;
  await simulation.getSimulationState();

  const activeLease = Date.now() + 60_000;
  state.operations.push({
    id: "active-file-lease",
    connection_key: SIMULATION_CONNECTION,
    operation_key: OPERATION_KEY,
    project_id: PROJECT_ID,
    status: "in-progress",
    lease_expires_at: activeLease,
    last_error_code: null,
    created_by: ADMIN_EMAIL,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  const beforeConflict = structuredClone({
    activities: state.activities,
    archives: state.archives,
    artifacts: state.artifacts,
    integrationEvents: state.integrationEvents,
    operations: state.operations,
  });

  const conflictResponse = await gmailFileRoute.POST(
    routeRequest(`/api/v1/integrations/google/gmail/messages/${MESSAGE_ID}/file`, "POST", { projectId: PROJECT_ID }),
    { params: Promise.resolve({ messageId: MESSAGE_ID }) },
  );
  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).code, "gmail_file_in_progress");
  assert.deepEqual({
    activities: state.activities,
    archives: state.archives,
    artifacts: state.artifacts,
    integrationEvents: state.integrationEvents,
    operations: state.operations,
  }, beforeConflict, "an active lease must reject without audit, archive, artifact, event, or lease mutation");

  state.operations[0].lease_expires_at = Date.now() - 1;
  const retryResponse = await gmailFileRoute.POST(
    routeRequest(`/api/v1/integrations/google/gmail/messages/${MESSAGE_ID}/file`, "POST", { projectId: PROJECT_ID }),
    { params: Promise.resolve({ messageId: MESSAGE_ID }) },
  );
  const retryBody = await retryResponse.json();
  assert.equal(retryResponse.status, 200);
  assert.equal(retryBody.filed, true);
  assert.equal(retryBody.alreadyFiled, false);
  assert.equal(retryBody.simulated, true);
  assert.equal(retryBody.inboxRetained, true);
  assert.deepEqual(
    state.integrationEvents.map(integrationProjection),
    [
      {
        connectionKey: SIMULATION_CONNECTION,
        eventType: "gmail.archive_approved",
        actor: ADMIN_EMAIL,
        entityType: "project",
        entityId: PROJECT_ID,
        detail: "mode=simulation;inbox_retained=true",
      },
      {
        connectionKey: SIMULATION_CONNECTION,
        eventType: "gmail.archive_filed",
        actor: ADMIN_EMAIL,
        entityType: "project",
        entityId: PROJECT_ID,
        detail: "mode=simulation;attachment_count=1;inbox_retained=true",
      },
    ],
  );
  assert.equal(state.operations.length, 1);
  assert.equal(state.operations[0].status, "completed");
  assert.equal(state.operations[0].lease_expires_at, null);
  assert.equal(state.archives.length, 1);
  assert.equal(state.archives[0].status, "filed");
  assert.equal(state.archives[0].attachment_count, 1);
  assert.deepEqual(state.artifacts.map((row) => row.kind).sort(), ["attachment", "email"]);
  assert.deepEqual(
    state.activities.map((row) => row.action),
    ["workspace_simulation.gmail_approved", "workspace_simulation.gmail_filed"],
  );
  const filedSimulationState = JSON.parse(state.simulationState.state_json);
  assert.ok(filedSimulationState.messages[0].labelIds.includes("INBOX"));
  assert.ok(filedSimulationState.messages[0].labelIds.includes("FCI_FILED"));

  const listResponse = await calendarEventsRoute.GET(routeRequest("/api/v1/integrations/google/calendar/events"));
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.simulated, true);
  assert.equal(listBody.events.length, 2);

  const requestedStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const holdResponse = await calendarHoldRoute.POST(routeRequest(
    "/api/v1/integrations/google/calendar/test-hold",
    "POST",
    { start: requestedStart },
  ));
  const holdBody = await holdResponse.json();
  assert.equal(holdResponse.status, 201);
  assert.equal(holdBody.simulated, true);
  assert.equal(holdBody.event.start, requestedStart);

  const calendarEvents = state.integrationEvents
    .filter((row) => row.event_type.startsWith("calendar."))
    .map(integrationProjection);
  assert.deepEqual(calendarEvents, [
    {
      connectionKey: SIMULATION_CONNECTION,
      eventType: "calendar.workspace_events_listed",
      actor: ADMIN_EMAIL,
      entityType: "calendar",
      entityId: "simulation-client-appointments",
      detail: `window=${listBody.window.start}/${listBody.window.end};count=2`,
    },
    {
      connectionKey: SIMULATION_CONNECTION,
      eventType: "calendar.workspace_hold_created",
      actor: ADMIN_EMAIL,
      entityType: "calendar_event",
      entityId: holdBody.event.id,
      detail: `start=${holdBody.event.start};end=${holdBody.event.end};visibility=private;attendees=none;notifications=none`,
    },
  ]);

  const sheetEvents = [];
  const syncStateWrites = [];
  let sheetProviderCalls = 0;
  const config = oauthSites.getGoogleRuntimeConfig();
  const syncResult = await sheets.syncGoogleDirectory(config, ADMIN_EMAIL, {
    persistence: {
      async loadClientRows() { return [{ id: "client-1" }]; },
      async loadProjectRows() { return [{ id: "project-1" }, { id: "project-2" }]; },
      async updateSyncState(input) { syncStateWrites.push(input); },
      async getSyncStates() { return []; },
    },
    async getAccessToken() {
      sheetProviderCalls += 1;
      throw new Error("Simulation sync must not request a Google token.");
    },
    async writeIntegrationEvent(...args) { sheetEvents.push(args); },
    async fetch() {
      sheetProviderCalls += 1;
      throw new Error("Simulation sync must not call Google Sheets.");
    },
    now: () => 1_790_000_000_000,
  });
  assert.equal(config.simulation, true);
  assert.equal(sheetProviderCalls, 0);
  assert.equal(syncStateWrites.length, 4);
  assert.deepEqual(syncResult.clients, { inserted: 0, updated: 1, total: 1 });
  assert.deepEqual(syncResult.projects, { total: 2 });
  assert.deepEqual(
    sheetEvents.map(([, eventType, actor, entityType, entityId, detail]) => ({
      eventType,
      actor,
      entityType,
      entityId,
      detail,
    })),
    [{
      eventType: "sheets.directory.synced",
      actor: ADMIN_EMAIL,
      entityType: "google-sheet",
      entityId: "workspace-simulation-directory-sheet",
      detail: "{\"clients\":1,\"projects\":2}",
    }],
  );
  assert.equal(providerCalls, 0);

  state.sheetStates.push(
    { connection_key: SIMULATION_CONNECTION, entity_type: "clients", status: "synced" },
  );
  state.resources.push({
    id: "simulation-resource",
    connection_key: SIMULATION_CONNECTION,
    resource_type: "drive.shared-drive",
    resource_key: "primary",
    external_id: "simulation-shared-drive",
    parent_external_id: null,
    external_url: null,
    origin: "created",
    metadata_json: "{}",
    created_by: ADMIN_EMAIL,
    created_at: 1,
    updated_at: 1,
  });
  state.blueprints.push({
    id: "simulation-blueprint",
    connection_key: SIMULATION_CONNECTION,
    version: 1,
    blueprint_json: "{}",
  });

  const live = liveResidue();
  state.activities.push(live.activity);
  state.archives.push(live.archive);
  state.artifacts.push(live.artifact);
  state.blueprints.push(live.blueprint);
  state.integrationEvents.push(live.event);
  state.mappings.push(live.mapping);
  state.operations.push(live.operation);
  state.resources.push(live.resource);
  state.sheetStates.push(live.sheetState);

  const resetResponse = await resetRoute.POST(routeRequest(
    "/api/v1/integrations/google/simulation/reset",
    "POST",
  ));
  assert.equal(resetResponse.status, 200);
  assert.deepEqual(await resetResponse.json(), { reset: true, messages: 3, events: 2 });

  assert.equal(state.activities.some((row) => row.action.startsWith("workspace_simulation.")), false);
  for (const collection of [
    state.archives,
    state.blueprints,
    state.integrationEvents,
    state.mappings,
    state.operations,
    state.resources,
    state.sheetStates,
  ]) {
    assert.equal(collection.some((row) => row.connection_key === SIMULATION_CONNECTION), false);
  }
  assert.deepEqual(state.activities, [live.activity]);
  assert.deepEqual(state.archives, [live.archive]);
  assert.deepEqual(state.artifacts, [live.artifact]);
  assert.deepEqual(state.blueprints, [live.blueprint]);
  assert.deepEqual(state.integrationEvents, [live.event]);
  assert.deepEqual(state.mappings, [live.mapping]);
  assert.deepEqual(state.operations, [live.operation]);
  assert.deepEqual(state.resources, [live.resource]);
  assert.deepEqual(state.sheetStates, [live.sheetState]);

  const resetState = JSON.parse(state.simulationState.state_json);
  assert.equal(resetState.messages.length, 3);
  assert.equal(resetState.calendarEvents.length, 2);
  assert.deepEqual(resetState.drafts, []);
  assert.equal(resetState.messages.some((message) => message.labelIds.includes("FCI_FILED")), false);
  assert.deepEqual(
    resetState.calendarEvents.map((event) => event.id),
    ["sim-event-site-walk", "sim-event-scope-review"],
  );

  const leaseInsert = state.queries.find((query) => query.sql.startsWith("INSERT INTO google_drive_operations"));
  assert.match(
    leaseInsert.sql,
    /ON CONFLICT\(operation_key\) DO UPDATE[\s\S]+WHERE google_drive_operations\.status != 'in-progress' OR google_drive_operations\.lease_expires_at < \?$/u,
  );
  assert.deepEqual(
    state.queries.filter((query) => query.sql.startsWith("DELETE FROM ")).map((query) => query.sql),
    [
      "DELETE FROM activity_events WHERE action GLOB 'workspace_simulation.*'",
      "DELETE FROM gmail_file_archive_artifacts WHERE archive_id IN (SELECT id FROM gmail_file_archives WHERE connection_key = ?)",
      "DELETE FROM gmail_file_archives WHERE connection_key = ?",
      "DELETE FROM drive_folder_mappings WHERE connection_key = ?",
      "DELETE FROM google_drive_operations WHERE connection_key = ?",
      "DELETE FROM google_sheet_sync_state WHERE connection_key = ?",
      "DELETE FROM google_integration_events WHERE connection_key = ?",
      "DELETE FROM workspace_resources WHERE connection_key = ?",
      "DELETE FROM workspace_blueprints WHERE connection_key = ?",
    ],
  );
  for (const query of state.queries.filter((candidate) => (
    /^(?:INSERT INTO gmail_file_|UPDATE gmail_file_|INSERT INTO activity_events)/u.test(candidate.sql)
    || (candidate.sql.startsWith("INSERT INTO google_integration_events")
      && String(candidate.values[2]).startsWith("gmail.archive_"))
  ))) {
    assert.match(
      query.sql,
      /EXISTS \(SELECT 1 FROM google_drive_operations WHERE operation_key = \? AND status = 'in-progress' AND lease_expires_at = \?\)/u,
      `filing mutation must be fenced: ${query.sql}`,
    );
  }
  assert.equal(providerCalls, 0);
});
