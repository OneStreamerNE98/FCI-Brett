import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-setup-leases", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24737 } },
});
const {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
} = await vite.ssrLoadModule("/app/adapters/d1/workspace-setup-leases.ts");

after(async () => {
  await vite.close();
});

function leaseDatabase() {
  let row = null;
  return {
    current: () => row && { ...row },
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async run() {
          if (sql.startsWith("INSERT INTO google_drive_operations")) {
            const [id, connectionKey, operationKey, projectId, leaseExpiresAt, actor, createdAt, updatedAt] = statement.values;
            const now = statement.values.at(-1);
            if (row && row.operationKey === operationKey && row.status === "in-progress" && row.leaseExpiresAt >= now) {
              return { meta: { changes: 0 } };
            }
            row = { id, connectionKey, operationKey, projectId, status: "in-progress", leaseExpiresAt, errorCode: null, actor, createdAt, updatedAt };
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE google_drive_operations SET status = 'completed'")) {
            const [updatedAt, operationKey, leaseExpiresAt] = statement.values;
            if (!row || row.operationKey !== operationKey || row.status !== "in-progress" || row.leaseExpiresAt !== leaseExpiresAt) {
              return { meta: { changes: 0 } };
            }
            row = { ...row, status: "completed", leaseExpiresAt: null, errorCode: null, updatedAt };
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE google_drive_operations SET status = 'failed'")) {
            const [errorCode, updatedAt, operationKey, leaseExpiresAt] = statement.values;
            if (!row || row.operationKey !== operationKey || row.status !== "in-progress" || row.leaseExpiresAt !== leaseExpiresAt) {
              return { meta: { changes: 0 } };
            }
            row = { ...row, status: "failed", leaseExpiresAt: null, errorCode, updatedAt };
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
      return statement;
    },
  };
}

class ExecutingLeaseStatement {
  constructor(database, sql) {
    this.statement = database.prepare(sql);
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class ExecutingLeaseDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(`
      CREATE TABLE google_connections (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL UNIQUE,
        google_email TEXT NOT NULL,
        refresh_token_ciphertext TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE google_drive_operations (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL,
        operation_key TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        lease_expires_at INTEGER,
        last_error_code TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  prepare(sql) {
    return new ExecutingLeaseStatement(this.database, sql);
  }
}

test("a stale setup request cannot complete or fail a reacquired successor lease", async () => {
  const database = leaseDatabase();
  const first = await acquireWorkspaceSetupLease(database, {
    id: "first",
    connectionKey: "google-workspace",
    action: "drive-roots",
    scopeKey: "drive-roots",
    actor: "admin@example.test",
    now: 1_000,
  });
  assert.ok(first);

  const second = await acquireWorkspaceSetupLease(database, {
    id: "second",
    connectionKey: "google-workspace",
    action: "drive-roots",
    scopeKey: "drive-roots",
    actor: "admin@example.test",
    now: first.leaseExpiresAt + 1,
  });
  assert.ok(second);
  assert.notEqual(second.leaseExpiresAt, first.leaseExpiresAt);

  await completeWorkspaceSetupLease(database, first, second.leaseExpiresAt + 10);
  assert.equal(database.current().status, "in-progress");
  await failWorkspaceSetupLease(database, first, "stale-failure", second.leaseExpiresAt + 20);
  assert.equal(database.current().status, "in-progress");
  assert.equal(database.current().errorCode, null);

  await completeWorkspaceSetupLease(database, second, second.leaseExpiresAt + 30);
  assert.equal(database.current().status, "completed");
});

test("Google-backed shared leases require the exact current credential generation while local leases remain available", async () => {
  const database = new ExecutingLeaseDatabase();
  const connectionFence = {
    simulation: false,
    connectionId: "connection-generation-1",
    connectionKey: "gmail_exact_mailbox",
    googleEmail: "operations@example.test",
    refreshTokenCiphertext: "ciphertext-generation-1",
  };
  const input = {
    connectionKey: "google-workspace",
    action: "drive-roots",
    scopeKey: "drive-roots",
    actor: "admin@example.test",
    now: 1_000,
    connectionFence,
  };

  assert.equal(await acquireWorkspaceSetupLease(database, { ...input, id: "before-connect" }), null);
  database.database.prepare(
    "INSERT INTO google_connections (id, connection_key, google_email, refresh_token_ciphertext, status) VALUES (?, ?, ?, ?, 'connected')",
  ).run(
    connectionFence.connectionId,
    connectionFence.connectionKey,
    connectionFence.googleEmail,
    connectionFence.refreshTokenCiphertext,
  );
  assert.ok(await acquireWorkspaceSetupLease(database, { ...input, id: "connected" }));

  database.database.prepare(
    "UPDATE google_connections SET refresh_token_ciphertext = ? WHERE id = ?",
  ).run("ciphertext-generation-2", connectionFence.connectionId);
  assert.equal(await acquireWorkspaceSetupLease(database, {
    ...input,
    id: "stale-after-reconnect",
    action: "calendar-events-list",
    now: 1_500,
  }), null);
  assert.ok(await acquireWorkspaceSetupLease(database, {
    ...input,
    id: "current-after-reconnect",
    action: "calendar-events-list",
    now: 1_600,
    connectionFence: {
      ...connectionFence,
      refreshTokenCiphertext: "ciphertext-generation-2",
    },
  }));

  database.database.prepare("DELETE FROM google_connections").run();
  assert.equal(await acquireWorkspaceSetupLease(database, {
    ...input,
    id: "after-reset",
    action: "templates",
    now: 2_000,
  }), null);
  assert.ok(await acquireWorkspaceSetupLease(database, {
    id: "local-import",
    connectionKey: "google-workspace",
    action: "first-run-import-confirm",
    scopeKey: "records",
    actor: "admin@example.test",
    now: 3_000,
  }));
});
