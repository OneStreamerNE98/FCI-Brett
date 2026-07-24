import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: "work/vite-tests/workspace-settings-concurrency",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24769 } },
});

const workspaceSettingsModule = await vite.ssrLoadModule(
  "/app/adapters/d1/workspace-settings-repository.ts",
);

class SqliteD1Statement {
  constructor(statement) {
    this.statement = statement;
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
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.preparedSql = [];
    this.database.exec(`
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY,
        shared_drive_id TEXT,
        client_directory_sheet_id TEXT,
        intake_mailbox TEXT,
        settings_json TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  prepare(sql) {
    this.preparedSql.push(sql);
    return new SqliteD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  close() {
    this.database.close();
  }
}

after(async () => {
  await vite.close();
});

test("D1 atomically preserves both racing top-level settings saves and unknown siblings", async () => {
  const database = new SqliteD1Database();
  try {
    database.database.prepare(`
      INSERT INTO workspace_settings (
        id, shared_drive_id, client_directory_sheet_id, intake_mailbox,
        settings_json, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "workspace",
      "shared-drive-1",
      "directory-sheet-1",
      "operations@example.test",
      JSON.stringify({
        timezone: "America/New_York",
        futureWorkspaceSetting: { retained: true },
      }),
      "seed@example.test",
      1,
    );
    const repository =
      workspaceSettingsModule.createD1WorkspaceSettingsRepository(database);

    await Promise.all([
      repository.mergeSettings({
        id: "workspace",
        settings: {
          aiFeatures: {
            orgQa: false,
            futureFeature: "preserved",
          },
        },
        updatedBy: "assistant-admin@example.test",
        updatedAt: 2,
      }),
      repository.mergeSettings({
        id: "workspace",
        settings: {
          launchChecklist: {
            "test-records-only": {
              checked: true,
              actorEmail: "launch-admin@example.test",
              checkedAt: 3,
            },
          },
        },
        updatedBy: "launch-admin@example.test",
        updatedAt: 3,
      }),
    ]);

    const stored = await repository.findById("workspace");
    assert.deepEqual(stored.settings, {
      timezone: "America/New_York",
      futureWorkspaceSetting: { retained: true },
      aiFeatures: {
        orgQa: false,
        futureFeature: "preserved",
      },
      launchChecklist: {
        "test-records-only": {
          checked: true,
          actorEmail: "launch-admin@example.test",
          checkedAt: 3,
        },
      },
    });
    assert.equal(stored.sharedDriveId, "shared-drive-1");
    assert.equal(stored.clientDirectorySheetId, "directory-sheet-1");
    assert.equal(stored.intakeMailbox, "operations@example.test");

    const writeSql = database.preparedSql.filter((sql) =>
      /^INSERT INTO workspace_settings/u.test(sql)
    );
    assert.equal(writeSql.length, 2);
    for (const sql of writeSql) {
      assert.match(sql, /settings_json = json_patch\(/u);
      assert.match(sql, /json_remove\(/u);
      assert.doesNotMatch(sql, /settings_json = excluded\.settings_json/u);
    }
  } finally {
    database.close();
  }
});

test("every workspace_settings writer uses the shared merge port", async () => {
  const writers = await Promise.all([
    read("app/api/v1/settings/workspace/route.ts"),
    read("app/lib/assistant-config-sites.ts"),
    read("app/lib/launch-checklist-sites.ts"),
    read("app/adapters/d1/google-chat-routing.ts"),
  ]);
  for (const source of writers) {
    assert.match(source, /\.mergeSettings\(\{/u);
    assert.doesNotMatch(source, /\.upsert\(\{/u);
  }

  const port = await read("app/ports/workspace-settings-repository.ts");
  const d1 = await read("app/adapters/d1/workspace-settings-repository.ts");
  const postgres = await read(
    "app/adapters/postgres/workspace-settings-repository.ts",
  );
  assert.match(port, /mergeSettings\(input: WorkspaceSettingsMerge\)/u);
  assert.doesNotMatch(port, /\bupsert\(/u);
  assert.match(d1, /settings_json = json_patch\(/u);
  assert.match(
    postgres,
    /workspace_settings\.settings_json - \$5::text\[\][\s\S]*\|\| EXCLUDED\.settings_json/u,
  );
  assert.doesNotMatch(
    `${d1}\n${postgres}`,
    /settings_json = (?:excluded|EXCLUDED)\.settings_json/u,
  );
});
