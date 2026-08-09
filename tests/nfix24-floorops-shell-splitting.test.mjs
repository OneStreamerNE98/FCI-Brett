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

  assert.match(app, /import dynamic from "next\/dynamic"/u);
  assert.match(app, /<AppErrorBoundary key=\{view\}>/u);
  assert.match(app, /loadingTitle=\{`Loading \$\{view\}`\}[\s\S]{0,120}loadingDetail="Preparing this workspace view\."/u);
  assert.match(app, /type MajorViewDynamicLoadingProps = Readonly<\{\s*error\?: Error \| null;\s*isLoading\?: boolean;\s*retry\?: \(\) => void;/u);
  assert.match(app, /function createMajorViewLoading\(view: OperationsView\)[\s\S]{0,300}\{ error, isLoading, retry \}: MajorViewDynamicLoadingProps[\s\S]{0,200}<MajorViewLoading view=\{view\} error=\{error\} isLoading=\{isLoading\} retry=\{retry\} \/>/u);
  assert.deepEqual(
    [...app.matchAll(/loading: createMajorViewLoading\("([^"]+)"\)/gu)].map((match) => match[1]),
    ["AI Assistant", "Clients", "Inbox", "Leads", "Projects", "Schedule"],
    "all six route chunks must share the dynamic loading/error callback",
  );
  assert.match(app, /function MajorViewLoading\(\{ view, error, isLoading = true, retry \}[\s\S]{0,180}if \(error \|\| isLoading === false\) \{[\s\S]{0,300}state="error"[\s\S]{0,300}onRetry=\{retry \?\? \(\(\) => window\.location\.reload\(\)\)\}[\s\S]{0,300}retryLabel="Try again"/u);
  assert.doesNotMatch(app, /\b(?:lazy|Suspense|loadMajorViewWithDeadline)\b/u);
  assert.doesNotMatch(app, /majorView[\s\S]{0,80}(?:setTimeout|setInterval)/iu);
  assert.match(app, /if \(preload\) void preload\(\)\.catch\(\(\) => undefined\)/u);
  assert.match(notice, /role=\{failed \? "alert" : "status"\}/u);
  assert.match(notice, /aria-live=\{failed \? "assertive" : "polite"\}/u);
  assert.match(boundary, /return <AppFailureSurface onReload=\{\(\) => window\.location\.reload\(\)\} \/>/u);
  assert.match(app, /onMouseEnter=\{\(\) => preloadMajorView\(label\)\} onFocus=\{\(\) => preloadMajorView\(label\)\}/u);
});
