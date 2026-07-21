import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-workspace-blueprint-adapter", import.meta.url)),
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: { port: 24739 } },
});
const [adapter, blueprintModule] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/d1/workspace-blueprints.ts"),
  vite.ssrLoadModule("/app/lib/workspace-blueprint.ts"),
]);

after(async () => {
  await vite.close();
});

test("a committed blueprint save returns without a fallible post-commit read", async () => {
  let committed = false;
  let firstCalls = 0;
  const database = {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async first() {
          firstCalls += 1;
          if (committed) throw new Error("A post-commit read must not occur.");
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO workspace_blueprints")) return { meta: { changes: 1 } };
          if (sql.startsWith("INSERT INTO google_integration_events")) return { meta: { changes: 1 } };
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
      return statement;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      committed = true;
      return results;
    },
  };

  const blueprint = blueprintModule.seedWorkspaceBlueprint();
  const result = await adapter.saveWorkspaceBlueprint(database, {
    id: "blueprint-1",
    connectionKey: "workspace-simulation",
    expectedVersion: 0,
    blueprint,
    actor: "admin@example.test",
    now: 1_790_000_000_000,
    auditEvent: {
      id: "event-1",
      eventType: "setup.folder_renamed",
      entityType: "drive.folder",
      entityId: "folder-1",
      detail: "key=client-accounts",
    },
  });

  assert.equal(result.saved, true);
  assert.equal(result.record.version, 1);
  assert.equal(result.record.blueprint, blueprint);
  assert.equal(committed, true);
  assert.equal(firstCalls, 1);
});
