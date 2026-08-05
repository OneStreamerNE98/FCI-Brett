import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const vite = await createServer({
  root: fileURLToPath(root),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-set42-workspace-operations", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24942 } },
});

const operations = await vite.ssrLoadModule(
  "/app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx",
);

after(async () => {
  await vite.close();
});

test("a base revalidation fences an overlapping cursor request and replays its requested depth", async () => {
  const coordinator = operations.createOperationsRequestCoordinator();
  const oldCursor = coordinator.beginCategory("events", "/operations?category=events&cursor=old");
  assert.ok(oldCursor);

  const base = coordinator.beginBase();
  assert.ok(base);
  assert.deepEqual(base.desiredDepths, { drive: 0, archive: 0, events: 1 });
  assert.deepEqual(base.canceledUrls, ["/operations?category=events&cursor=old"]);
  assert.equal(coordinator.isCurrentCategory(oldCursor), false);

  const replay = await operations.replayOperationsCategoryPages(
    { items: ["fresh-base"], hasMore: true, nextCursor: "fresh-cursor" },
    base.desiredDepths.events,
    async (cursor) => {
      assert.equal(cursor, "fresh-cursor");
      return { items: ["fresh-page-two"], hasMore: false };
    },
  );
  assert.deepEqual(replay.result.items, ["fresh-base", "fresh-page-two"]);
  assert.equal(replay.loadedExtraPages, 1);
  assert.equal(coordinator.settleCategory(oldCursor, true), false);
  assert.equal(coordinator.settleBase(base, { drive: 0, archive: 0, events: 1 }), true);

  const currentCursor = coordinator.beginCategory("events", "/operations?category=events&cursor=current");
  assert.ok(currentCursor);
  assert.equal(coordinator.settleCategory(oldCursor, true), false);
  assert.equal(
    coordinator.beginCategory("events", "/operations?category=events&cursor=duplicate"),
    null,
    "an obsolete request must not clear the current category ticket",
  );
  assert.equal(coordinator.settleCategory(currentCursor, true), true);
});

test("fail-closed invalidation cancels requests and forgets all privileged page depth", () => {
  const coordinator = operations.createOperationsRequestCoordinator();
  const first = coordinator.beginCategory("drive", "/operations?category=drive&cursor=one");
  assert.ok(first);
  assert.equal(coordinator.settleCategory(first, true), true);
  const pending = coordinator.beginCategory("archive", "/operations?category=archive&cursor=two");
  assert.ok(pending);

  const base = coordinator.beginBase();
  assert.ok(base);
  assert.deepEqual(base.desiredDepths, { drive: 1, archive: 1, events: 0 });
  assert.equal(coordinator.isCurrentBase(base), true);
  coordinator.failClosed();
  assert.equal(coordinator.isCurrentBase(base), false);

  const nextBase = coordinator.beginBase();
  assert.ok(nextBase);
  assert.deepEqual(nextBase.desiredDepths, { drive: 0, archive: 0, events: 0 });
});

test("an overlapping base refresh supersedes the replay generation and carries its depth forward", () => {
  const coordinator = operations.createOperationsRequestCoordinator();
  const firstPage = coordinator.beginCategory("events", "/operations?category=events&cursor=one");
  assert.ok(firstPage);
  assert.equal(coordinator.settleCategory(firstPage, true), true);

  const firstBase = coordinator.beginBase();
  assert.ok(firstBase);
  assert.deepEqual(firstBase.desiredDepths, { drive: 0, archive: 0, events: 1 });
  assert.equal(
    coordinator.registerBaseReplayUrl(firstBase, "/operations?category=events&cursor=stale"),
    true,
  );
  const trailingBase = coordinator.beginBase();
  assert.ok(trailingBase);
  assert.equal(coordinator.isCurrentBase(firstBase), false);
  assert.equal(coordinator.isCurrentBase(trailingBase), true);
  assert.deepEqual(
    trailingBase.desiredDepths,
    { drive: 0, archive: 0, events: 1 },
    "the trailing authority must replay every page the superseded generation owed",
  );
  assert.deepEqual(
    trailingBase.canceledUrls,
    ["/operations?category=events&cursor=stale"],
    "the trailing authority must detach the superseded replay transport",
  );
  assert.equal(
    coordinator.settleBase(firstBase, { drive: 0, archive: 0, events: 1 }),
    false,
    "the stale generation must never publish",
  );
});

test("a loader-suppressed notification fences the visible read and queues a trailing authority", () => {
  assert.equal(operations.shouldQueueOperationsBaseLoad(true, 1), true);
  assert.equal(operations.shouldQueueOperationsBaseLoad(true, 2), true);
  assert.equal(operations.shouldQueueOperationsBaseLoad(true, 0), false);
  assert.equal(operations.shouldQueueOperationsBaseLoad(false, 1), false);

  const coordinator = operations.createOperationsRequestCoordinator();
  const visible = coordinator.beginBase();
  assert.ok(visible);
  if (operations.shouldQueueOperationsBaseLoad(true, 1)) {
    assert.equal(coordinator.supersedeBase(), true);
  }
  assert.equal(coordinator.isCurrentBase(visible), false);
  const trailing = coordinator.beginBase();
  assert.ok(trailing);
  assert.equal(coordinator.isCurrentBase(trailing), true);
});

test("cursor replay follows the fresh response chain and stops at the requested page depth", async () => {
  const cursors = [];
  const replay = await operations.replayOperationsCategoryPages(
    { items: [1], hasMore: true, nextCursor: "page-2" },
    2,
    async (cursor) => {
      cursors.push(cursor);
      if (cursor === "page-2") return { items: [2], hasMore: true, nextCursor: "page-3" };
      return { items: [3], hasMore: true, nextCursor: "page-4" };
    },
  );
  assert.deepEqual(cursors, ["page-2", "page-3"]);
  assert.deepEqual(replay.result.items, [1, 2, 3]);
  assert.equal(replay.result.nextCursor, "page-4");
  assert.equal(replay.loadedExtraPages, 2);
});

test("the operations card wires terminal category failures to a complete privileged-state clear", async () => {
  const source = await read(
    "app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx",
  );
  assert.match(
    source,
    /catch \(loadError\) \{\s*if \(isTerminalCachedGetError\(loadError\)\) \{\s*await failClosedOperations\(loadError\);\s*return;/u,
  );
  assert.match(
    source,
    /const clearPrivilegedOperations = useCallback\(\(\) => \{[\s\S]*setSimulation\(null\);[\s\S]*setCheckedAt\(null\);[\s\S]*setLimits\(null\);[\s\S]*setDrive\(emptyAccumulator\(\)\);[\s\S]*setArchive\(emptyAccumulator\(\)\);[\s\S]*setEvents\(emptyAccumulator\(\)\);/u,
  );
  assert.match(
    source,
    /const failClosedOperations = useCallback\([\s\S]*invalidateCachedGet\(OPERATIONS_URL, \{ notify: false \}\);/u,
    "a category authorization failure must not leave an older privileged base payload restorable",
  );
  assert.match(
    source,
    /if \(requestCoordinator\.current\.cancelBase\(ticket\)\) \{\s*stopCategoryLoads\(\);\s*setReconciling\(false\);/u,
    "a failed lifecycle base read must release every superseded Load more control",
  );
  assert.match(source, /replayOperationsCategoryPages\([\s\S]*ticket\.desiredDepths\.drive/u);
  assert.match(source, /replayOperationsCategoryPages\([\s\S]*ticket\.desiredDepths\.archive/u);
  assert.match(source, /replayOperationsCategoryPages\([\s\S]*ticket\.desiredDepths\.events/u);
  assert.match(
    source,
    /if \(retryMode === "base"\) return load\(true\);/u,
    "a replay failure Retry must restart the full base reconciliation",
  );
  assert.match(
    source,
    /if \(shouldQueueOperationsBaseLoad\(silent, visibleBaseReadsInFlight\.current\)\) \{\s*trailingBaseLoadQueued\.current = true;\s*requestCoordinator\.current\.supersedeBase\(\);\s*return;\s*\}\s*const ticket = requestCoordinator\.current\.beginBase\(\);/u,
    "a loader-suppressed notification must fence the visible request and queue a trailing authority",
  );
  assert.match(
    source,
    /settleBase\(ticket,[\s\S]*setSimulation\(body\.simulation\);[\s\S]*setCheckedAt\(body\.checkedAt\);[\s\S]*setLimits\(body\.limits\);[\s\S]*setDrive\(\{ \.\.\.nextDrive\.result/u,
    "base metadata and rows must publish only after the full fresh generation settles",
  );
  assert.doesNotMatch(source, /Refresh operations/u);
});
