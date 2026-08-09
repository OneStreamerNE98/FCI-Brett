import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("NFIX-24 moves cohesive cache-backed state ownership out of FloorOpsApp", async () => {
  const [app, directory, settings] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/application/use-directory-data.ts"),
    read("app/application/use-current-user-settings.ts"),
  ]);

  assert.equal((app.match(/\buseState(?:<[^;\n]+>)?\(/gu) ?? []).length, 21);
  assert.match(app, /useDirectoryData\(\{ displayTimezone, userEmail, userName, onTerminalFailure: closeRecordOverlays \}\)/u);
  assert.match(app, /useCurrentUserSettings\(accessLabel === "Admin"\)/u);
  assert.match(directory, /useCachedGetSubscription\(DIRECTORY_GET_URLS, \(\) => refreshDirectoryData\(true\)\)/u);
  assert.match(settings, /useCachedGetSubscription\(\["\/api\/v1\/settings\/me"\]/u);
  assert.doesNotMatch(app, /const \[(?:leads|clients|projectItems|dashboard|displayTimezone|isAdmin|pageLayouts),/u);
});

test("NFIX-24 emits route views as independent client chunks", async () => {
  const manifest = JSON.parse(await read("dist/client/.vite/manifest.json"));
  const shell = manifest["app/FloorOpsApp.tsx"];
  const expectedViews = [
    "app/assistant/components/AssistantView.tsx",
    "app/clients/components/ClientsView.tsx",
    "app/inbox/components/InboxView.tsx",
    "app/leads/components/LeadsView.tsx",
    "app/projects/components/ProjectsView.tsx",
    "app/schedule/components/ScheduleView.tsx",
  ];

  assert.ok(shell, "the client manifest must retain the FloorOpsApp entry");
  for (const sourcePath of expectedViews) {
    assert.ok(shell.dynamicImports.includes(sourcePath), `${sourcePath} must be lazy from the shell`);
    assert.equal(manifest[sourcePath]?.isDynamicEntry, true, `${sourcePath} must emit a dynamic entry`);
    assert.notEqual(manifest[sourcePath]?.file, shell.file, `${sourcePath} must have its own client chunk`);
  }

  const shellBytes = (await stat(new URL(`dist/client/${shell.file}`, root))).size;
  assert.ok(shellBytes < 400_000, `the 573,557-byte baseline shell chunk must materially fall; got ${shellBytes}`);
});

test("NFIX-24 route loading and failure behavior stays accessible and honest", async () => {
  const [app, boundary, notice] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/components/AppErrorBoundary.tsx"),
    read("app/components/ClientDataNotice.tsx"),
  ]);

  assert.match(app, /<AppErrorBoundary key=\{view\}>[\s\S]{0,800}<Suspense fallback=\{<MajorViewLoading view=\{view\} \/>\}>/u);
  assert.match(app, /loadingTitle=\{`Loading \$\{view\}`\}[\s\S]{0,120}loadingDetail="Preparing this workspace view\."/u);
  assert.match(app, /const MAJOR_VIEW_LOAD_TIMEOUT_MS = 15_000/u);
  assert.match(app, /loadMajorViewWithDeadline<T>\(view: OperationsView, importer: \(\) => Promise<T>\)/u);
  assert.match(app, /could not be loaded within 15 seconds\. Reload the page to try again\./u);
  assert.match(app, /if \(preload\) void preload\(\)\.catch\(\(\) => undefined\)/u);
  assert.match(notice, /role=\{failed \? "alert" : "status"\}/u);
  assert.match(notice, /aria-live=\{failed \? "assertive" : "polite"\}/u);
  assert.match(boundary, /return <AppFailureSurface onReload=\{\(\) => window\.location\.reload\(\)\} \/>/u);
  assert.match(app, /onMouseEnter=\{\(\) => preloadMajorView\(label\)\} onFocus=\{\(\) => preloadMajorView\(label\)\}/u);
});
