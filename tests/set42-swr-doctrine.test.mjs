import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { posix as path } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const appRoot = new URL("../app/", import.meta.url);
const rootPath = fileURLToPath(root).replaceAll("\\", "/");
const read = (path) => readFile(new URL(path, root), "utf8");

async function nestedFiles(directory, suffixes) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await nestedFiles(child, suffixes));
    else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) files.push(child);
  }
  return files;
}

function sourcePath(file) {
  return fileURLToPath(file).replaceAll("\\", "/").slice(rootPath.length);
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return "";
}

function enclosingFunctionName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) return current.parent.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return propertyName(current.name);
  }
  return "anonymous";
}

function rawFetchSites(source, label) {
  const sourceFile = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    label.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  assert.equal(sourceFile.parseDiagnostics.length, 0, `${label} must remain parseable`);
  const sites = [];
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "fetch"
    ) {
      const init = node.arguments[1];
      if (!init) {
        sites.push({ label, functionName: enclosingFunctionName(node), kind: "implicit-get" });
      } else if (!ts.isObjectLiteralExpression(init)) {
        sites.push({ label, functionName: enclosingFunctionName(node), kind: "reviewed-helper" });
      } else {
        const method = init.properties.find((property) => propertyName(property.name) === "method");
        if (!method) {
          sites.push({ label, functionName: enclosingFunctionName(node), kind: "implicit-get" });
        } else if (ts.isShorthandPropertyAssignment(method)) {
          sites.push({ label, functionName: enclosingFunctionName(node), kind: "reviewed-helper" });
        } else if (
          ts.isPropertyAssignment(method)
          && ts.isStringLiteral(method.initializer)
          && method.initializer.text.toUpperCase() === "GET"
        ) {
          sites.push({ label, functionName: enclosingFunctionName(node), kind: "implicit-get" });
        } else if (
          ts.isPropertyAssignment(method)
          && !ts.isStringLiteral(method.initializer)
        ) {
          sites.push({ label, functionName: enclosingFunctionName(node), kind: "reviewed-helper" });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return sites;
}

function clientModuleSpecifiers(source, label) {
  const sourceFile = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    label.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement)
      && !statement.importClause?.isTypeOnly
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) specifiers.push(statement.moduleSpecifier.text);
    if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) specifiers.push(statement.moduleSpecifier.text);
  }
  return specifiers.filter((specifier) => specifier.startsWith("."));
}

function hasUseClientDirective(source, label) {
  const sourceFile = ts.createSourceFile(
    label,
    source,
    ts.ScriptTarget.Latest,
    true,
    label.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function resolveClientImport(label, specifier, sourceByLabel) {
  const base = path.normalize(path.join(path.dirname(label), specifier));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((candidate) => sourceByLabel.has(candidate));
}

function clientReachableSources(sources) {
  const sourceByLabel = new Map(sources.map((source) => [source.label, source]));
  const queue = sources
    .filter(({ source, label }) => hasUseClientDirective(source, label))
    .map(({ label }) => label);
  const reachable = new Set();
  while (queue.length > 0) {
    const label = queue.shift();
    if (!label || reachable.has(label)) continue;
    reachable.add(label);
    const current = sourceByLabel.get(label);
    if (!current) continue;
    for (const specifier of clientModuleSpecifiers(current.source, label)) {
      const dependency = resolveClientImport(label, specifier, sourceByLabel);
      if (dependency && !reachable.has(dependency)) queue.push(dependency);
    }
  }
  return [...reachable].map((label) => sourceByLabel.get(label)).filter(Boolean);
}

test("client GET census covers TS and TSX modules reachable from client components", async () => {
  // Follow the client import graph instead of trusting an exact byte-zero
  // `"use client";` header on every file. Moving a browser transport into a
  // client-used .ts helper cannot evade the guard, while server-only routes do
  // not become accidental browser-policy pins.
  const files = await nestedFiles(appRoot, [".ts", ".tsx"]);
  const sources = await Promise.all(files.map(async (file) => ({
    file,
    label: sourcePath(file),
    source: await readFile(file, "utf8"),
  })));
  const rawSites = clientReachableSources(sources)
    .flatMap(({ source, label }) => rawFetchSites(source, label))
    .sort((left, right) => (
      left.label.localeCompare(right.label)
      || left.functionName.localeCompare(right.functionName)
      || left.kind.localeCompare(right.kind)
    ));

  assert.deepEqual(
    rawSites,
    [
      { label: "app/inbox/components/InboxView.tsx", functionName: "loadMessages", kind: "implicit-get" },
      { label: "app/inbox/components/InboxView.tsx", functionName: "previewGmailFiling", kind: "implicit-get" },
      { label: "app/lib/client-get-cache.ts", functionName: "startJsonGet", kind: "implicit-get" },
      { label: "app/settings/components/AiAssistantSettingsCard.tsx", functionName: "mutateLabel", kind: "reviewed-helper" },
      { label: "app/settings/components/GoogleWorkspacePanel.tsx", functionName: "runWorkspaceMutation", kind: "reviewed-helper" },
      { label: "app/settings/components/workspace-reconcile/WorkspaceReconcileCard.tsx", functionName: "readJson", kind: "reviewed-helper" },
    ],
    "new browser GETs must use cachedGetJson; only its central transport, two exact Gmail reads, and method-constrained mutation helpers are reviewed raw-fetch sites",
  );

  const inbox = await read("app/inbox/components/InboxView.tsx");
  const workspace = await read("app/settings/components/GoogleWorkspacePanel.tsx");
  const reconcile = await read("app/settings/components/workspace-reconcile/WorkspaceReconcileCard.tsx");
  assert.equal((inbox.match(/SET42_ACTION_GATED_GMAIL_GET/gu) ?? []).length, 2);
  assert.match(inbox, /fetch\(`\/api\/v1\/integrations\/google\/gmail\/messages\?\$\{parameters\.toString\(\)\}`\)/u);
  assert.match(inbox, /fetch\(`\/api\/v1\/integrations\/google\/gmail\/messages\/\$\{encodeURIComponent\(filingMessage\.id\)\}\/file\?projectId=/u);
  assert.equal((workspace.match(/await readActionGatedGmail</gu) ?? []).length, 2);
  assert.match(workspace, /function readActionGatedGmail<[\s\S]+cachedGetJson<T>\(url, \{ force: true \}\)/u);
  assert.match(workspace, /if \(!init\.method \|\| init\.method\.toUpperCase\(\) === "GET"\)/u);
  assert.match(reconcile, /if \(method === "GET"\) \{\s*return cachedGetJson<T>\(url, \{ force: true \}\)/u);
  const aiSettings = await read("app/settings/components/AiAssistantSettingsCard.tsx");
  assert.match(aiSettings, /method: "POST" \| "PATCH" \| "DELETE"/u);
});

test("the refresh-control census is closed while action and failure controls remain", async () => {
  const [inbox, google, directory, operations] = await Promise.all([
    read("app/inbox/components/InboxView.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx"),
  ]);
  const retired = `${inbox}\n${google}\n${directory}\n${operations}`;
  for (const label of [
    "Check connection",
    "Refresh queue",
    "Check readiness",
    "Refresh mirror status",
    "Refresh status",
    "Refresh operations",
  ]) assert.doesNotMatch(retired, new RegExp(`>\\s*${label}\\s*<`, "u"));
  assert.doesNotMatch(inbox, /<RefreshCw size=\{15\} \/> Refresh/u);

  assert.match(inbox, /Load messages/u);
  assert.match(inbox, /Retry connection/u);
  assert.match(google, /Sync now/u);
  assert.match(google, /Prepare FCI labels/u);
  assert.match(directory, /Check for new form responses/u);
  assert.match(operations, /SettingsDataNotice/u);
});

test("one loader hook replaces the six FIX-12 clones and lifecycle reads stay timer-free", async () => {
  const clonePaths = [
    "app/settings/components/AiAssistantSettingsCard.tsx",
    "app/settings/components/ChatNotificationSettingsCard.tsx",
    "app/settings/components/MySettingsPanel.tsx",
    "app/settings/components/WorkspaceDefaultsPanel.tsx",
    "app/settings/components/DataSecurityPanel.tsx",
    "app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx",
  ];
  const cloneSources = await Promise.all(clonePaths.map(read));
  for (const [index, source] of cloneSources.entries()) {
    assert.match(source, /useClientLoadState/u, `${clonePaths[index]} must use the shared loader`);
    assert.doesNotMatch(source, /\bloadRequestRef\b|\brequestSequence\b/u);
  }

  const [cache, hooks, boundary] = await Promise.all([
    read("app/lib/client-get-cache.ts"),
    read("app/lib/client-get-hooks.ts"),
    read("app/components/ClientDataFreshnessBoundary.tsx"),
  ]);
  const freshness = `${cache}\n${hooks}\n${boundary}`;
  assert.doesNotMatch(freshness, /setInterval|setTimeout/u);
  assert.match(hooks, /window\.addEventListener\("focus", revalidate\)/u);
  assert.match(hooks, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/u);
  assert.match(hooks, /previousRouteKey\.current !== routeKey/u);
  assert.match(cache, /if \(!options\.force && existing\.hasValue\) return Promise\.resolve/u);
});

test("assistant config and Sheets status use the one cached transport", async () => {
  const files = await nestedFiles(appRoot, [".tsx"]);
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /fetch\([^)]*["'`]\/api\/v1\/assistant\/config/u);
  assert.doesNotMatch(joined, /fetch\([^)]*["'`]\/api\/v1\/integrations\/google\/sheets\/status/u);
  assert.match(joined, /cachedGetJson[^;]+\/api\/v1\/assistant\/config/u);
  assert.match(joined, /cachedGetJson[^;]+\/api\/v1\/integrations\/google\/sheets\/status/u);
});

test("dirty settings drafts stay mounted while their readers remain in the lifecycle census", async () => {
  const [ai, chat, personal, defaults, blueprint, google] = await Promise.all([
    read("app/settings/components/AiAssistantSettingsCard.tsx"),
    read("app/settings/components/ChatNotificationSettingsCard.tsx"),
    read("app/settings/components/MySettingsPanel.tsx"),
    read("app/settings/components/WorkspaceDefaultsPanel.tsx"),
    read("app/settings/components/WorkspaceBlueprintEditor.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
  ]);

  assert.match(ai, /loadConfig\(false, true, configDraftDirty \|\| saving\)/u);
  assert.match(ai, /loadLabels\(false, true, labelDraftDirty \|\| labelSaving !== null\)/u);
  assert.match(chat, /loadConfig\(false, true, draftDirty \|\| saving\)/u);
  assert.match(personal, /loadMySettings\(false, true, draftDirty \|\| saving\)/u);
  assert.match(defaults, /draftDirty \|\| saving \|\| verifyingCalendar !== null/u);
  assert.match(blueprint, /loadBlueprint\(false, true, dirty \|\| saving\)/u);
  assert.match(google, /runtimeConfigurationDraftDirty \|\| runtimeConfigurationWorking !== null/u);

  const joined = [ai, chat, personal, defaults, blueprint, google].join("\n");
  assert.doesNotMatch(
    joined,
    /!configDraftDirty && !saving|!labelDraftDirty|!draftDirty && !saving|!dirty && !saving|!runtimeConfigurationDraftDirty/u,
    "unsaved drafts may change callback behavior but must not unregister mounted readers",
  );
  assert.ok((joined.match(/if \(preserveDraft\) return;/gu) ?? []).length >= 4);
});

test("terminal authorization failures clear every custom materialized privileged surface", async () => {
  const [directory, tasks, reply, importCard, projectFiles, checklist, assistant, app, inbox, activity] = await Promise.all([
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/assistant/components/TaskManagementPanel.tsx"),
    read("app/inbox/components/GmailReplyModal.tsx"),
    read("app/import/components/FirstRunImportCard.tsx"),
    read("app/projects/components/ProjectFilesPanel.tsx"),
    read("app/settings/components/LaunchChecklistCard.tsx"),
    read("app/assistant/components/AssistantView.tsx"),
    read("app/FloorOpsApp.tsx"),
    read("app/inbox/components/InboxView.tsx"),
    read("app/management/access/AdminActivityPanel.tsx"),
  ]);

  assert.match(directory, /isTerminalCachedGetError\(caught\)[\s\S]{0,160}setIntake\(null\)/u);
  assert.match(tasks, /isTerminalCachedGetError\(error\)[\s\S]{0,160}setTasks\(\[\]\)[\s\S]{0,160}setEditor\(null\)/u);
  assert.match(reply, /isTerminalCachedGetError\(error\)\) setConfiguration\(null\)/u);
  assert.match(importCard, /isTerminalCachedGetError\(caught\)[\s\S]{0,160}setStatus\(null\)[\s\S]{0,100}setSpreadsheetKey\(""\)/u);
  assert.match(projectFiles, /isTerminalCachedGetError\(error\)[\s\S]{0,160}files: \[\][\s\S]{0,100}setModalProjectId\(null\)/u);
  assert.match(checklist, /isTerminalCachedGetError\(checklistResult\.reason\)[\s\S]{0,160}setLaunchChecklist\(null\)[\s\S]{0,100}setCanAttest\(false\)/u);
  assert.match(assistant, /isTerminalCachedGetError\(error\)[\s\S]{0,160}setMeetings\(\[\]\)[\s\S]{0,100}setMeetingId\(""\)/u);
  assert.match(app, /isTerminalCachedGetError\(error\)[\s\S]{0,500}setSelectedLeadId\(null\)[\s\S]{0,240}setProjectOpen\(false\)/u);
  assert.match(app, /isTerminalCachedGetError\(error\)[\s\S]{0,180}failClosedCurrentUserSettings\(\)/u);
  assert.match(inbox, /isTerminalCachedGetError\(connectionError\)[\s\S]{0,480}setMessages\(\[\]\)[\s\S]{0,320}setReplyMessage\(null\)/u);
  assert.match(activity, /error\.status === 403[\s\S]{0,160}setActivityPage\(null\)[\s\S]{0,100}setAppliedRequest\(null\)/u);
});

test("mutation invalidations refresh dependent projections and explicit retries bypass cached failures", async () => {
  const [cache, app, directory, inbox, google, driveActions, reconcile, tasks, today, importCard, blueprint, access, activity] = await Promise.all([
    read("app/lib/client-get-cache.ts"),
    read("app/FloorOpsApp.tsx"),
    read("app/settings/components/DirectorySyncPanel.tsx"),
    read("app/inbox/components/InboxView.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/WorkspaceDriveResourceActions.tsx"),
    read("app/settings/components/workspace-reconcile/WorkspaceReconcileCard.tsx"),
    read("app/assistant/components/TaskManagementPanel.tsx"),
    read("app/assistant/components/TodayPanel.tsx"),
    read("app/import/components/FirstRunImportCard.tsx"),
    read("app/settings/components/WorkspaceBlueprintEditor.tsx"),
    read("app/management/access/AdminAccessPage.tsx"),
    read("app/management/access/AdminActivityPanel.tsx"),
  ]);

  assert.match(app, /invalidateCachedGet\(`\/api\/v1\/projects\/\$\{encodeURIComponent\(project\.id\)\}\/drive\/files`\)/u);
  assert.match(directory, /invalidateCachedGet\(FORM_LEAD_PATH\)[\s\S]{0,180}invalidateCachedGet\("\/api\/v1\/leads"\)[\s\S]{0,180}invalidateCachedGet\("\/api\/v1\/dashboard"\)/u);
  assert.match(inbox, /invalidateTaskReadCaches\(\)/u);
  assert.match(tasks, /loadTasks\(appliedFilters, true, true\)/u);
  assert.match(today, /load\(\{ force: true \}\)/u);
  assert.match(importCard, /loadStatus\(undefined, false, true\)/u);
  assert.match(app, /refreshDirectoryData\(false, true\)/u);
  assert.match(app, /loadMeetings\(false, true\)/u);
  assert.match(blueprint, /loadBlueprint\(true\) : saveBlueprint\(\)/u);
  assert.match(
    blueprint,
    /invalidateCachedGet\("\/api\/v1\/integrations\/google\/setup\/blueprint"\);\s*invalidateCachedGet\("\/api\/v1\/integrations\/google\/setup\/resources"\);\s*const saved = cloneBlueprint\(payload\.blueprint\);/u,
    "a successful blueprint save must invalidate both the edited blueprint and its derived resource projection",
  );
  assert.match(access, /invalidateCachedGet\("\/api\/v1\/admin\/access", \{ notify: false \}\)/u);
  assert.match(activity, /invalidateCachedGetPrefix\("\/api\/v1\/admin\/audit\?", \{ notify: false \}\)/u);

  assert.match(cache, /function invalidateWorkspaceOperationsReadCache\(\) \{\s*invalidateCachedGet\("\/api\/v1\/integrations\/google\/operations"\);\s*\}/u);
  assert.match(cache, /function invalidateGmailFilingReadCaches\([^)]+\) \{\s*invalidateCachedGet\("\/api\/v1\/dashboard"\);\s*invalidateCachedGet\("\/api\/v1\/inbox-analysis"\);\s*if \(options\.includeOperations !== false\) invalidateWorkspaceOperationsReadCache\(\);\s*\}/u);
  assert.equal((`${inbox}\n${google}`.match(/invalidateGmailFilingReadCaches\(\{ includeOperations: false \}\)/gu) ?? []).length, 2);

  const simulationResetInvalidations = cache.slice(
    cache.indexOf("export function invalidateWorkspaceSimulationResetReadCaches"),
    cache.indexOf("export function invalidateWorkspaceTenantResetReadCaches"),
  );
  for (const endpoint of [
    "/api/v1/dashboard",
    "/api/v1/inbox-analysis",
    "/api/v1/integrations/google/forms/leads",
    "/api/v1/admin/audit",
    "/api/v1/integrations/google/setup/blueprint",
  ]) assert.match(simulationResetInvalidations, new RegExp(endpoint.replaceAll("/", "\\/"), "u"));
  assert.match(simulationResetInvalidations, /if \(options\.includeOperations !== false\) invalidateWorkspaceOperationsReadCache\(\)/u);

  const tenantResetInvalidations = cache.slice(cache.indexOf("export function invalidateWorkspaceTenantResetReadCaches"));
  assert.match(tenantResetInvalidations, /invalidateWorkspaceSimulationResetReadCaches\(options\)/u);
  assert.match(tenantResetInvalidations, /invalidateCachedGetPrefix\("\/api\/v1\/clients"\)/u);
  assert.match(tenantResetInvalidations, /invalidateCachedGetPrefix\("\/api\/v1\/projects"\)/u);
  assert.match(tenantResetInvalidations, /invalidateTaskReadCaches\(\)/u);
  assert.match(tenantResetInvalidations, /invalidateCachedGet\("\/api\/v1\/settings\/workspace"\)/u);
  assert.match(google, /resetSimulation\(\)[\s\S]*invalidateWorkspaceSimulationResetReadCaches\(\{ includeOperations: false \}\)/u);
  assert.match(google, /resetWorkspaceTenant\(\)[\s\S]*invalidateWorkspaceTenantResetReadCaches\(\{ includeOperations: false \}\)/u);

  // The Operations health card is co-mounted with every Workspace mutation
  // transport. Finally blocks cover persisted failure/event rows as well as success.
  assert.match(google, /async function runWorkspaceMutation<[\s\S]{0,700}finally \{\s*invalidateWorkspaceOperationsReadCache\(\)/u);
  assert.match(google, /async function disconnectGoogleDrive\([\s\S]{0,2200}finally \{\s*invalidateWorkspaceOperationsReadCache\(\)/u);
  assert.match(google, /async function verifyGoogleDrive\([\s\S]{0,900}finally \{\s*invalidateWorkspaceOperationsReadCache\(\)/u);
  assert.match(google, /async function refreshTestCalendar\([\s\S]{0,900}finally \{[\s\S]{0,120}invalidateWorkspaceOperationsReadCache\(\)/u);
  assert.match(blueprint, /async function saveBlueprint\([\s\S]{0,1800}finally \{\s*invalidateWorkspaceOperationsReadCache\(\)/u);
  assert.match(driveActions, /async function postJson<[\s\S]{0,700}finally \{\s*invalidateWorkspaceOperationsReadCache\(\)/u);
  assert.match(reconcile, /if \(method === "GET"\)[\s\S]{0,900}finally \{\s*invalidateWorkspaceOperationsReadCache\(\)/u);
  assert.match(inbox, /async function confirmGmailFiling\([\s\S]{0,1800}finally \{[\s\S]{0,120}invalidateWorkspaceOperationsReadCache\(\)/u);
});

test("sliding audit windows, stage verification readers, and editor snapshots stay explicit", async () => {
  const [activity, google, app] = await Promise.all([
    read("app/management/access/AdminActivityPanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/FloorOpsApp.tsx"),
  ]);
  assert.match(activity, /useClientLifecycleRefresh\([\s\S]{0,500}requestFor\(appliedFilters\)[\s\S]{0,300}loadPage\(nextRequest/u);
  assert.match(google, /\/gmail\/messages\?label=needs-review&verification=status/u);
  assert.match(google, /\/calendar\/events\?verification=status/u);
  assert.match(app, /editingSnapshot && <ProjectEditModal project=\{editingSnapshot\}/u);
  assert.match(app, /editingClientSnapshot && <ClientEditModal client=\{editingClientSnapshot\}/u);
  assert.match(app, /editingContactSnapshot && <ContactEditModal client=\{editingContactSnapshot\}/u);
});

test("failure-recovery reads converge on the shared notice primitive", async () => {
  const recoverySurfaces = [
    { name: "settings reader wrapper", path: "app/settings/components/SettingsDataNotice.tsx", pattern: /<ClientDataNotice\b/u },
    { name: "first-run import", path: "app/import/components/FirstRunImportCard.tsx", pattern: /<ClientDataNotice\b/u },
    { name: "Today", path: "app/assistant/components/TodayPanel.tsx", pattern: /<ClientDataNotice\b/u },
    { name: "task management", path: "app/assistant/components/TaskManagementPanel.tsx", pattern: /<ClientDataNotice\b/u },
    { name: "project files", path: "app/projects/components/ProjectFilesPanel.tsx", pattern: /<ClientDataNotice\b/u },
    { name: "People & Access", path: "app/management/access/AdminAccessPage.tsx", pattern: /<ClientDataNotice\b/u },
    { name: "security activity", path: "app/management/access/AdminActivityPanel.tsx", pattern: /<ClientDataNotice\b/u },
    { name: "Google Sheets status", path: "app/settings/components/GoogleWorkspacePanel.tsx", pattern: /sheetsStatusError[\s\S]{0,220}<ClientDataNotice\b/u },
    { name: "Workspace resources", path: "app/settings/components/WorkspaceDriveResourceActions.tsx", pattern: /resourcesError && <ClientDataNotice\b/u },
    { name: "live directory", path: "app/FloorOpsApp.tsx", pattern: /function LiveDataBanner[\s\S]{0,500}return <ClientDataNotice\b/u },
    { name: "project meetings", path: "app/FloorOpsApp.tsx", pattern: /function ProjectMeetings[\s\S]{0,3000}error \? <ClientDataNotice\b/u },
    { name: "Inbox connection", path: "app/inbox/components/InboxView.tsx", pattern: /error && <ClientDataNotice[\s\S]{0,500}retryLabel="Retry connection"/u },
  ];
  assert.equal(recoverySurfaces.length, 12, "the original twelve recovery surfaces must stay explicit");
  const sourceByPath = new Map(await Promise.all(
    [...new Set(recoverySurfaces.map(({ path }) => path))]
      .map(async (path) => [path, await read(path)]),
  ));
  for (const { name, path, pattern } of recoverySurfaces) {
    assert.match(sourceByPath.get(path) ?? "", pattern, `${name} must render the shared failure notice`);
  }

  const app = sourceByPath.get("app/FloorOpsApp.tsx") ?? "";
  const inbox = sourceByPath.get("app/inbox/components/InboxView.tsx") ?? "";
  assert.doesNotMatch(app, /function LiveDataBanner[\s\S]{0,500}<section[\s\S]{0,300}>Try again</u);
  assert.doesNotMatch(app, /error \? <OperationsEmptyState[^>]+tone="error"[\s\S]{0,300}>Try again</u);
  assert.doesNotMatch(inbox, /error && <button[\s\S]{0,220}Retry connection/u);
  assert.doesNotMatch(inbox, /error && <p className="workspace-missing">\{error\}<\/p>/u);

  const primitive = await read("app/components/ClientDataNotice.tsx");
  assert.match(primitive, /state: ClientDataNoticeState/u);
  assert.match(primitive, /retryLabel = "Retry"/u);
});
