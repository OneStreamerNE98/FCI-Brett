import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";
import {
  PRODUCTION_SCHEMA_MIGRATIONS,
  runProductionSchemaMigrations,
} from "../app/platform/postgres/production-schema-migrations.ts";

const rootUrl = new URL("../", import.meta.url);
const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/postgres-settings-persistence-integration",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24742 } },
});

const [
  workspaceSettingsModule,
  userPreferencesModule,
  filingRuleModule,
  mailItemModule,
] = await Promise.all([
  vite.ssrLoadModule("/app/adapters/postgres/workspace-settings-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/user-preferences-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/filing-rule-repository.ts"),
  vite.ssrLoadModule("/app/adapters/postgres/mail-item-repository.ts"),
]);

after(async () => vite.close());

const { createPostgresWorkspaceSettingsRepository } = workspaceSettingsModule;
const { createPostgresUserPreferencesRepository } = userPreferencesModule;
const { createPostgresFilingRuleRepository } = filingRuleModule;
const { createPostgresMailItemRepository } = mailItemModule;

const postgresTestUrl = process.env.TEST_POSTGRES_URL?.trim();
const NOW = Date.UTC(2026, 6, 23, 15, 0, 0);

test(
  "PostgreSQL 16 settings persistence adapters preserve isolation, upserts, and references",
  {
    skip: postgresTestUrl ? false : "TEST_POSTGRES_URL is not configured",
    timeout: 30_000,
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: postgresTestUrl,
      max: 4,
      application_name: "fci_settings_persistence_integration",
    });
    const schema = `fci_settings_${randomUUID().replaceAll("-", "")}`;
    const clientId = randomUUID();
    const suggestedProjectId = randomUUID();
    const approvedProjectId = randomUUID();
    await pool.query(`CREATE SCHEMA ${schema}`);

    try {
      await runProductionSchemaMigrations(pool, PRODUCTION_SCHEMA_MIGRATIONS, { schema });
      await pool.query(
        `INSERT INTO ${schema}.clients (
           id, client_code, name, normalized_name_key, status,
           created_by, updated_by, created_at, updated_at, version
         ) VALUES ($1, 'CL-11111111', 'FCI TEST — DO NOT USE',
           'fci test — do not use', 'active', 'admin@example.test',
           'admin@example.test', $2, $2, 1)`,
        [clientId, new Date(NOW)],
      );
      await pool.query(
        `INSERT INTO ${schema}.projects (
           id, project_number, client_id, name, status, created_by, updated_by,
           created_at, updated_at, version
         ) VALUES
           ($1, 'CF-2026-22222222', $3, 'FCI TEST — DO NOT USE suggested',
             'planning', 'admin@example.test', 'admin@example.test', $4, $4, 1),
           ($2, 'CF-2026-33333333', $3, 'FCI TEST — DO NOT USE approved',
             'planning', 'admin@example.test', 'admin@example.test', $4, $4, 1)`,
        [suggestedProjectId, approvedProjectId, clientId, new Date(NOW)],
      );

      const options = { schema };
      const workspaceSettings = createPostgresWorkspaceSettingsRepository(pool, options);
      const userPreferences = createPostgresUserPreferencesRepository(pool, options);
      const filingRules = createPostgresFilingRuleRepository(pool, options);
      const mailItems = createPostgresMailItemRepository(pool, options);

      await pool.query(
        `INSERT INTO ${schema}.workspace_settings (
           id, shared_drive_id, client_directory_sheet_id, intake_mailbox,
           settings_json, updated_by, updated_at
         ) VALUES (
           'workspace', 'shared-drive-1', 'directory-sheet-1',
           'operations@example.test', '{}'::jsonb, 'admin@example.test', $1
         )`,
        [new Date(NOW)],
      );
      await workspaceSettings.upsert({
        id: "workspace",
        settings: {
          appointmentCalendarId: "calendar-1",
          fieldCalendarId: "calendar-2",
        },
        updatedBy: "admin@example.test",
        updatedAt: NOW + 1_000,
      });
      assert.deepEqual(await workspaceSettings.findById("workspace"), {
        id: "workspace",
        sharedDriveId: "shared-drive-1",
        clientDirectorySheetId: "directory-sheet-1",
        intakeMailbox: "operations@example.test",
        settings: {
          appointmentCalendarId: "calendar-1",
          fieldCalendarId: "calendar-2",
        },
        updatedBy: "admin@example.test",
        updatedAt: NOW + 1_000,
      });

      const firstPreferences = {
        userEmail: "first@example.test",
        displayTimezone: "America/New_York",
        replySignature: "First",
        notificationPreferencesJson: '{"lead.created":true}',
        pageLayoutsJson: '{"overview":{"order":["metrics"],"hidden":[]}}',
        updatedAt: NOW + 2_000,
      };
      const secondPreferences = {
        ...firstPreferences,
        userEmail: "second@example.test",
        replySignature: "Second",
        notificationPreferencesJson: '{"lead.created":false}',
        updatedAt: NOW + 3_000,
      };
      await userPreferences.upsert(firstPreferences);
      await userPreferences.upsert(secondPreferences);
      const firstStored = await userPreferences.findByEmail(firstPreferences.userEmail);
      const secondStored = await userPreferences.findByEmail(secondPreferences.userEmail);
      assert.equal(firstStored.replySignature, "First");
      assert.equal(secondStored.replySignature, "Second");
      assert.deepEqual(JSON.parse(firstStored.notificationPreferencesJson), {
        "lead.created": true,
      });
      assert.deepEqual(JSON.parse(secondStored.notificationPreferencesJson), {
        "lead.created": false,
      });

      await filingRules.create({
        id: "rule-1",
        values: {
          name: "Exact project",
          enabled: true,
          priority: 10,
          matchSummary: "Project number appears in the subject.",
          action: "suggest",
          targetCategory: "05_Correspondence / Email Archive",
          approvalRequired: true,
        },
        createdBy: "admin@example.test",
        createdAt: NOW + 4_000,
      });
      assert.equal(await filingRules.update({
        id: "rule-1",
        values: { enabled: false, priority: 20 },
        updatedAt: NOW + 5_000,
      }), true);
      const [storedRule] = await filingRules.list();
      assert.equal(storedRule.id, "rule-1");
      assert.equal(storedRule.enabled, false);
      assert.equal(storedRule.priority, 20);
      assert.equal(await filingRules.delete("rule-1"), true);
      assert.deepEqual(await filingRules.list(), []);

      const item = {
        id: "mail-1",
        gmailMessageId: "gmail-message-1",
        gmailThreadId: "gmail-thread-1",
        clientId,
        suggestedProjectId,
        approvedProjectId,
        status: "approved",
        matchReason: "Exact project number.",
        emailDriveFileId: "drive-file-1",
        createdAt: NOW + 6_000,
        updatedAt: NOW + 7_000,
      };
      assert.deepEqual(await mailItems.upsert(item), { outcome: "saved" });
      assert.deepEqual(await mailItems.findById(item.id), item);
      assert.deepEqual(await mailItems.listByStatus("approved", 10), [item]);

      const missingReferenceCases = [
        {
          id: "mail-orphan-client",
          property: "clientId",
          outcome: "client-not-found",
        },
        {
          id: "mail-orphan-suggested",
          property: "suggestedProjectId",
          outcome: "suggested-project-not-found",
        },
        {
          id: "mail-orphan-approved",
          property: "approvedProjectId",
          outcome: "approved-project-not-found",
        },
      ];
      for (const { id, property, outcome } of missingReferenceCases) {
        assert.deepEqual(await mailItems.upsert({
          ...item,
          id,
          [property]: randomUUID(),
        }), { outcome });
      }
      const orphanCount = await pool.query(
        `SELECT count(*)::integer AS count
         FROM ${schema}.mail_items
         WHERE id = ANY($1::text[])`,
        [missingReferenceCases.map(({ id }) => id)],
      );
      assert.equal(orphanCount.rows[0].count, 0);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  },
);
