import assert from "node:assert/strict";
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
            const [id, connectionKey, operationKey, projectId, leaseExpiresAt, actor, createdAt, updatedAt, now] = statement.values;
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
