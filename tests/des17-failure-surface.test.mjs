import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const appRoot = new URL("../app/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

async function applicationTsxFiles(directory = appRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await applicationTsxFiles(entryUrl));
    else if (entry.name.endsWith(".tsx")) files.push(entryUrl);
  }
  return files;
}

function propertyNames(object) {
  return new Set(object.properties.flatMap((property) => (
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
      ? [property.name.text]
      : ts.isShorthandPropertyAssignment(property)
        ? [property.name.text]
      : []
  )));
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

test("DES-17 mounts both shell and route recovery surfaces with plain-language reload copy", async () => {
  const [layout, shellBoundary, routeError, surface] = await Promise.all([
    source("../app/layout.tsx"),
    source("../app/components/AppErrorBoundary.tsx"),
    source("../app/error.tsx"),
    source("../app/components/AppFailureSurface.tsx"),
  ]);

  assert.match(layout, /<AppErrorBoundary>[\s\S]+<ClientDataFreshnessBoundary \/>[\s\S]+\{children\}[\s\S]+<\/AppErrorBoundary>/u);
  assert.match(shellBoundary, /static getDerivedStateFromError\(\)[\s\S]+failed: true/u);
  assert.match(shellBoundary, /componentDidCatch\([\s\S]+console\.error/u);
  assert.match(shellBoundary, /<AppFailureSurface onReload=\{\(\) => window\.location\.reload\(\)\} \/>/u);
  assert.match(routeError, /<AppFailureSurface onReload=\{\(\) => window\.location\.reload\(\)\} \/>/u);
  assert.match(surface, /This page could not be displayed/u);
  assert.match(surface, /If you just completed an action, check its current status before repeating it\./u);
  assert.match(surface, /> Reload page/u);
});

test("DES-17 removes overwrite suppression and renders a bounded multi-toast region", async () => {
  const [app, notifications] = await Promise.all([
    source("../app/FloorOpsApp.tsx"),
    source("../app/components/AppNotifications.tsx"),
  ]);
  assert.doesNotMatch(app, /SUCCESS_INFO_SUPPRESSION_MS|SUPPRESSIBLE_FOLLOW_UP_INFO|activeToastRef|toastTimerRef/u);
  assert.match(app, /useNotificationQueue\(\)/u);
  assert.match(app, /<AppNotifications notifications=\{notifications\} onDismiss=\{dismissNotification\} \/>/u);
  assert.match(notifications, /const MAX_NOTIFICATION_QUEUE = 4;/u);
  assert.match(notifications, /notifications\.map\(\(notification\) => <div/u);
  assert.match(notifications, /window\.setTimeout\(\(\) => dismissNotification\(notification\.id\), duration\)/u);
  assert.match(notifications, /if \(next\.length > MAX_NOTIFICATION_QUEUE\)/u);
  assert.match(notifications, /oldestOrdinaryIndex < 0 && notification\.kind !== "error"/u);
  assert.doesNotMatch(notifications, /setNotificationQueue\(\(current\)/u, "timer cleanup must not run inside a React state updater");
});

test("DES-17 error-toast census requires authored copy plus an action or individual reason", async () => {
  const directErrors = [];
  const governedErrors = [];
  for (const file of await applicationTsxFiles()) {
    const text = await readFile(file, "utf8");
    const parsed = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    visit(parsed, (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
      if (node.expression.text === "notify"
        && node.arguments[1]
        && ts.isStringLiteral(node.arguments[1])
        && node.arguments[1].text === "error") {
        directErrors.push(`${file.pathname}:${parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      if (node.expression.text !== "notifyError") return;
      const options = node.arguments[1];
      assert.ok(ts.isObjectLiteralExpression(options), `${file.pathname}: notifyError requires an options object`);
      const names = propertyNames(options);
      assert.ok(names.has("message"), `${file.pathname}: notifyError requires authored message`);
      assert.ok(names.has("cause"), `${file.pathname}: notifyError requires diagnostic cause`);
      assert.notEqual(names.has("action"), names.has("actionlessReason"), `${file.pathname}: exactly one recovery action or reason is required`);
      const message = options.properties.find((property) => (
        ts.isPropertyAssignment(property)
        && ts.isIdentifier(property.name)
        && property.name.text === "message"
      ));
      assert.ok(
        message
        && ts.isPropertyAssignment(message)
        && (ts.isStringLiteral(message.initializer)
          || ts.isNoSubstitutionTemplateLiteral(message.initializer)
          || ts.isTemplateExpression(message.initializer)
          || (ts.isConditionalExpression(message.initializer)
            && ts.isStringLiteral(message.initializer.whenTrue)
            && ts.isStringLiteral(message.initializer.whenFalse))),
        `${file.pathname}: user copy must be authored rather than copied from a caught error`,
      );
      assert.doesNotMatch(message.getText(parsed), /\.message\b/u, `${file.pathname}: raw error text must remain console-only`);
      governedErrors.push(`${file.pathname}:${parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    });
  }
  assert.deepEqual(directErrors, [], `direct error toasts bypass policy:\n${directErrors.join("\n")}`);
  assert.equal(governedErrors.length, 56, "the full fresh error-toast census must stay governed");

  const inbox = await source("../app/inbox/components/InboxView.tsx");
  assert.doesNotMatch(inbox, /Try filing again[\s\S]{0,160}confirmGmailFiling/u);
  assert.match(inbox, /label: "Review filing"[\s\S]+setFilingMessage\(reviewedMessage\)[\s\S]+setFilingProjectId\(reviewedProjectId\)[\s\S]+setFilingPreview\(null\)/u);

  const [driveActions, workspaceDefaults] = await Promise.all([
    source("../app/settings/components/WorkspaceDriveResourceActions.tsx"),
    source("../app/settings/components/WorkspaceDefaultsPanel.tsx"),
  ]);
  assert.doesNotMatch(driveActions, /label: "Try again"[\s\S]{0,120}adopt\(selectedId\)/u);
  assert.match(driveActions, /label: "Refresh status", run: \(\) => void onChanged\(\{\}\)/u);
  assert.doesNotMatch(workspaceDefaults, /label: "Try again"[\s\S]{0,160}verifyCalendar\(calendarKey, calendarId\)/u);
  assert.match(workspaceDefaults, /label: "Review calendar ID"[\s\S]+workspace-appointment-calendar-id[\s\S]+workspace-field-calendar-id/u);
});

test("DES-17 empty-state action slot covers every actionable dead end", async () => {
  const justifiedActionless = [
    { pattern: /Loading|Checking/u, reason: "transient request state" },
    { pattern: /Administrator review queue/u, reason: "permission boundary names who can act" },
    { pattern: /Choose a project/u, reason: "adjacent project selector is the control" },
    { pattern: /No task candidates were returned/u, reason: "terminal review result" },
    { pattern: /No verified sources were returned/u, reason: "terminal evidence result" },
    { pattern: /No leads in this stage/u, reason: "board columns share the page-level add control" },
    { pattern: /No active projects/u, reason: "panel header has View projects" },
    { pattern: /No active leads yet/u, reason: "Overview panel header has View all" },
    { pattern: /No today or upcoming project meetings/u, reason: "the same dashboard exposes View projects" },
    { pattern: /No active leads are available for this report/u, reason: "Reports summary metrics link to Leads" },
    { pattern: /No project status data is available yet/u, reason: "Reports summary metrics link to Projects" },
    { pattern: /clientIndustryReport\.emptyMessage/u, reason: "Reports summary metrics link to Clients" },
    { pattern: /No converted or lost leads are available/u, reason: "the KPI panel has Review lead outcomes" },
    { pattern: /no booked projects carry a flooring category/u, reason: "the KPI panel has View active projects" },
    { pattern: /Review every message before filing/u, reason: "adjacent inbox call to action" },
    { pattern: /No projects yet/u, reason: "drawer header has New project" },
    { pattern: /No messages loaded yet/u, reason: "adjacent action-gated Load messages control" },
    { pattern: /What the scheduling workspace will include/u, reason: "planned surface has an adjacent settings control" },
  ];
  let census = 0;
  const unexplained = [];
  for (const file of await applicationTsxFiles()) {
    const text = await readFile(file, "utf8");
    const parsed = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    visit(parsed, (node) => {
      const opening = ts.isJsxElement(node)
        ? node.openingElement
        : ts.isJsxSelfClosingElement(node)
          ? node
          : null;
      if (!opening || opening.tagName.getText(parsed) !== "OperationsEmptyState") return;
      census += 1;
      const hasAction = opening.attributes.properties.some((attribute) => (
        ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === "action"
      ));
      if (hasAction) return;
      const block = node.getText(parsed);
      if (!justifiedActionless.some(({ pattern }) => pattern.test(block))) {
        unexplained.push(`${file.pathname}:${parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${block.slice(0, 180)}`);
      }
    });
  }
  assert.equal(census, 34, "the current empty-state census must be reviewed when it changes");
  assert.deepEqual(unexplained, [], `actionless empty states lack a recorded reason:\n${unexplained.join("\n")}`);
  assert.ok(justifiedActionless.every(({ reason }) => reason.length > 0));
});

test("DES-17 leaves both golden digest constants byte-identical", async () => {
  const golden = await source("./e2e/page-layouts.spec.ts");
  assert.match(golden, /const OVERVIEW_LEGACY_SECTIONS_SHA256 = "4b2d9803d4d5d6e7d8fc7544ab7f862d87a076f4bfa0412ba498c66e8a12dd12";/u);
  assert.match(golden, /const REPORTS_LEGACY_SECTIONS_SHA256 = "4ba01e91ed4a31e0b6da7a0a6ec2334894145cddaacf63bc99e24efd30b999b6";/u);
});
