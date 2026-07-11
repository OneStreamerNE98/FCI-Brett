import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ships the Groundwork product instead of starter content", async () => {
  const [page, layout, app, css, packageJson] = await Promise.all([
    read("app/page.tsx"), read("app/layout.tsx"), read("app/FloorOpsApp.tsx"),
    read("app/globals.css"), read("package.json"),
  ]);
  assert.match(page, /FloorOpsApp/);
  assert.match(layout, /Groundwork \| Commercial Flooring Operations/);
  assert.match(app, /Leads & opportunities/);
  assert.match(app, /Schedule & crews/);
  assert.match(app, /Smart inbox/);
  assert.match(app, /Ask Groundwork/);
  assert.match(css, /@media \(max-width:560px\)/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("declares durable records, uploads, and guarded integration endpoints", async () => {
  const [hosting, schema, recordsApi, uploadsApi, assistantApi] = await Promise.all([
    read(".openai/hosting.json"), read("db/schema.ts"), read("app/api/v1/records/route.ts"),
    read("app/api/v1/uploads/route.ts"), read("app/api/v1/assistant/route.ts"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "FILES"/);
  assert.match(schema, /activityEvents/);
  assert.match(schema, /webhookReceipts/);
  assert.match(recordsApi, /activity_events/);
  assert.match(recordsApi, /type and payload are required/);
  assert.match(uploadsApi, /20 \* 1024 \* 1024/);
  assert.match(uploadsApi, /file type is not allowed/);
  assert.match(assistantApi, /permission-aware commercial flooring project assistant/);
  assert.match(assistantApi, /OPENAI_API_KEY/);
});

test("includes migration and branded social preview", async () => {
  await Promise.all([
    access(new URL("drizzle/0000_glossy_nekra.sql", root)),
    access(new URL("public/og.png", root)),
  ]);
});
