import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const noStoreRoutes = [
  "app/api/v1/assistant/config/route.ts",
  "app/api/v1/assistant/extract-tasks/route.ts",
  "app/api/v1/assistant/triage/route.ts",
  "app/api/v1/assistant/route.ts",
  "app/api/v1/clients/route.ts",
  "app/api/v1/dashboard/route.ts",
  "app/api/v1/filing-rules/[ruleId]/route.ts",
  "app/api/v1/filing-rules/route.ts",
  "app/api/v1/google-workspace/route.ts",
  "app/api/v1/integrations/google/calendar/events/route.ts",
  "app/api/v1/integrations/google/calendar/test-hold/route.ts",
  "app/api/v1/integrations/google/chat/config/route.ts",
  "app/api/v1/integrations/google/connection/route.ts",
  "app/api/v1/integrations/google/drive/folders/ensure-roots/route.ts",
  "app/api/v1/integrations/google/drive/folders/rename/route.ts",
  "app/api/v1/integrations/google/drive/shared-drive/adopt/route.ts",
  "app/api/v1/integrations/google/drive/templates/ensure/route.ts",
  "app/api/v1/integrations/google/drive/verify/route.ts",
  "app/api/v1/integrations/google/setup/blueprint/route.ts",
  "app/api/v1/integrations/google/sheets/ensure/route.ts",
  "app/api/v1/leads/[leadId]/route.ts",
  "app/api/v1/projects/[projectId]/drive/route.ts",
  "app/api/v1/projects/[projectId]/drive/files/route.ts",
  "app/api/v1/settings/launch-checklist/route.ts",
  "app/api/v1/tasks/[taskId]/route.ts",
  "app/api/v1/tasks/route.ts",
  "app/api/v1/uploads/route.ts",
];

const googleErrorRoutes = [
  "app/api/v1/integrations/google/drive/folders/ensure-roots/route.ts",
  "app/api/v1/integrations/google/drive/folders/rename/route.ts",
  "app/api/v1/integrations/google/drive/shared-drive/adopt/route.ts",
  "app/api/v1/integrations/google/drive/templates/ensure/route.ts",
  "app/api/v1/integrations/google/drive/verify/route.ts",
  "app/api/v1/integrations/google/gmail/messages/[messageId]/file/route.ts",
  "app/api/v1/integrations/google/sheets/ensure/route.ts",
  "app/api/v1/projects/[projectId]/drive/route.ts",
  "app/api/v1/projects/[projectId]/drive/files/route.ts",
];

test("NFIX-03 routes share one no-store JSON implementation", async () => {
  const helper = await read("app/lib/no-store-json.ts");
  assert.match(helper, /export function noStoreJson\(/);
  assert.match(helper, /NextResponse\.json\(/);
  assert.match(helper, /response\.headers\.set\("Cache-Control", "no-store"\)/);
  assert.match(helper, /typeof init === "number" \? \{ status: init \} : init/);

  for (const path of noStoreRoutes) {
    const source = await read(path);
    assert.match(source, /from ["'][^"']*lib\/no-store-json["']/, path);
    assert.doesNotMatch(source, /function noStore\(body: unknown/, path);
    assert.doesNotMatch(source, /const (?:NO_STORE_HEADERS|RESPONSE_HEADERS) = \{ "Cache-Control": "no-store" \}/, path);
  }
});

test("Google error routes use the shared response builder without changing cache policy", async () => {
  for (const path of googleErrorRoutes) {
    const source = await read(path);
    assert.match(source, /\bgoogleIntegrationErrorResponse\(/, path);
    assert.doesNotMatch(source, /function errorResponse\(error: unknown\)/, path);
    assert.doesNotMatch(source, /mapGoogleIntegrationError\(error,/, path);
    if (path.includes("/gmail/")) {
      assert.doesNotMatch(source, /noStoreResponse\(googleIntegrationErrorResponse/, path);
    } else {
      assert.match(source, /noStoreResponse\(googleIntegrationErrorResponse/, path);
    }
  }
});

test("USD formatting has one shared zero-decimal formatter", async () => {
  const [helper, app, reports] = await Promise.all([
    read("app/lib/format-usd.ts"),
    read("app/FloorOpsApp.tsx"),
    read("app/features/reports/BusinessKpisPanel.tsx"),
  ]);
  assert.match(helper, /const usdFormatter = new Intl\.NumberFormat\("en-US"/);
  assert.match(helper, /maximumFractionDigits: 0/);
  assert.match(app, /import \{ formatUsd \} from "\.\/lib\/format-usd"/);
  assert.match(reports, /import \{ formatUsd \} from "\.\.\/\.\.\/lib\/format-usd"/);
  assert.doesNotMatch(`${app}\n${reports}`, /maximumFractionDigits: 0/);
});

test("the eight zero-reference exports stay deleted", async () => {
  const sources = await Promise.all([
    "app/adapters/postgres/postgres-values.ts",
    "app/domain/user-preferences.ts",
    "app/lib/google-workspace.ts",
    "app/lib/workspace-simulation.ts",
    "app/platform/google-cloud/foundation-server.ts",
  ].map(read));
  const combined = sources.join("\n");
  for (const symbol of [
    "parsePostgresSchemaName",
    "parsePostgresSafeWholeNumber",
    "parseNullablePostgresSafeWholeNumber",
    "parsePostgresTimestampMs",
    "chooseEmailDestination",
    "WORKSPACE_SIMULATION_ACCOUNT",
    "CLOUD_RUN_DEFAULT_PORT",
    "isUserPreferenceUpdate",
  ]) {
    assert.doesNotMatch(combined, new RegExp(`\\b${symbol}\\b`), symbol);
  }
});
