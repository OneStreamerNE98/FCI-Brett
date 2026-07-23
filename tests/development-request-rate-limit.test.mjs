import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createDevelopmentRequestRateLimiter,
  DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS,
  DEVELOPMENT_RATE_LIMIT_SCOPES,
  DEVELOPMENT_RATE_LIMIT_WINDOW_MS,
} from "../app/lib/development-request-rate-limit.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiRoot = join(root, "app", "api", "v1");

const limitedRoutes = [
  {
    path: "app/api/v1/assistant/route.ts",
    scope: "assistant",
    firstWork: "await parseBoundedJsonObject(request",
  },
  {
    path: "app/api/v1/uploads/route.ts",
    scope: "uploads",
    firstWork: 'const contentType = request.headers.get("content-type")',
  },
  {
    path: "app/api/v1/integrations/google/sheets/sync/route.ts",
    scope: "google-sheets-sync",
    firstWork: "await ensureWorkspaceSchema()",
  },
  {
    path: "app/api/v1/projects/[projectId]/drive/route.ts",
    scope: "project-drive-provisioning",
    firstWork: "await ensureWorkspaceSchema()",
  },
  {
    path: "app/api/v1/tasks/route.ts",
    scope: "tasks",
    firstWork: "await parseBoundedJsonObject(request",
  },
  {
    path: "app/api/v1/tasks/[taskId]/route.ts",
    scope: "tasks",
    firstWork: "await parseBoundedJsonObject(request",
  },
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

test("development cost routes allow the threshold and return the shared 429 contract after it", async () => {
  let now = 1_000;
  const limiter = createDevelopmentRequestRateLimiter({ now: () => now });

  for (let request = 1; request <= DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS; request += 1) {
    assert.equal(limiter.check("assistant", "office@example.test"), null);
  }

  const denied = limiter.check("assistant", "office@example.test");
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("Cache-Control"), "no-store");
  assert.equal(denied.headers.get("Retry-After"), "59");
  assert.deepEqual(await denied.json(), {
    error: "Too many requests. Try again shortly.",
    code: "rate_limited",
  });

  now += 500;
  assert.equal(limiter.check("assistant", "office@example.test")?.headers.get("Retry-After"), "59");
});

test("development fixed windows reset at the next 60-second boundary", () => {
  let now = DEVELOPMENT_RATE_LIMIT_WINDOW_MS - 1;
  const limiter = createDevelopmentRequestRateLimiter({ now: () => now });

  for (let request = 1; request <= DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS; request += 1) {
    assert.equal(limiter.check("uploads", "office@example.test"), null);
  }
  assert.equal(limiter.check("uploads", "office@example.test")?.headers.get("Retry-After"), "1");

  now = DEVELOPMENT_RATE_LIMIT_WINDOW_MS;
  assert.equal(limiter.check("uploads", "office@example.test"), null);
});

test("development limits isolate office users across the closed route scopes", () => {
  const limiter = createDevelopmentRequestRateLimiter({ now: () => 1_000 });
  for (let request = 1; request <= DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS; request += 1) {
    assert.equal(limiter.check("assistant", "first@example.test"), null);
  }
  assert.equal(limiter.check("assistant", "first@example.test")?.status, 429);

  assert.equal(limiter.check("assistant", "second@example.test"), null);
  for (const scope of DEVELOPMENT_RATE_LIMIT_SCOPES.filter((scope) => scope !== "assistant")) {
    assert.equal(limiter.check(scope, "first@example.test"), null, `${scope} must have an isolated window`);
  }
});

test("development limits normalize the authenticated office-user email", () => {
  const limiter = createDevelopmentRequestRateLimiter({ now: () => 1_000 });
  for (let request = 1; request < DEVELOPMENT_RATE_LIMIT_MAX_REQUESTS; request += 1) {
    assert.equal(limiter.check("assistant", "Office.User@Example.Test"), null);
  }
  assert.equal(limiter.check("assistant", " office.user@example.test "), null);
  assert.equal(limiter.check("assistant", "OFFICE.USER@EXAMPLE.TEST")?.status, 429);
});

test("every limited mutation route checks its closed scope after office authorization and before work", async () => {
  assert.deepEqual(
    [...DEVELOPMENT_RATE_LIMIT_SCOPES],
    [...new Set(limitedRoutes.map((route) => route.scope))],
  );

  const limitingRoutePaths = [];
  for (const file of await sourceFiles(apiRoot)) {
    const source = await readFile(file, "utf8");
    if (source.includes("enforceDevelopmentRequestRateLimit")) {
      limitingRoutePaths.push(relative(root, file).replaceAll("\\", "/"));
    }
  }
  assert.deepEqual(limitingRoutePaths.sort(), limitedRoutes.map((route) => route.path).sort());

  for (const route of limitedRoutes) {
    const source = await readFile(join(root, route.path), "utf8");
    const authorization = source.indexOf('if ("response" in auth) return auth.response');
    const limiter = source.indexOf(
      `enforceDevelopmentRequestRateLimit("${route.scope}", auth.user.email)`,
    );
    const firstWork = source.indexOf(route.firstWork);

    assert.ok(authorization >= 0, `${route.path} must retain its office-user authorization response`);
    assert.ok(limiter > authorization, `${route.path} must limit only after successful authorization`);
    assert.ok(firstWork > limiter, `${route.path} must limit before body, schema, or provider work`);
  }
});
