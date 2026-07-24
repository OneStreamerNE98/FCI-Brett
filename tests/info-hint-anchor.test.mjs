import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveInfoHintAnchor } from "../app/components/info-hint-anchor.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("InfoHint anchoring preserves explicit left and right directions", () => {
  const bounds = { left: 24, right: 58 };

  assert.equal(resolveInfoHintAnchor("left", bounds, 390), "left");
  assert.equal(resolveInfoHintAnchor("right", bounds, 390), "right");
});

test("InfoHint auto anchoring grows toward the side with more viewport room", () => {
  assert.equal(
    resolveInfoHintAnchor("auto", { left: 24, right: 58 }, 390),
    "left",
    "a left-column trigger pins the tooltip's left edge so it grows right",
  );
  assert.equal(
    resolveInfoHintAnchor("auto", { left: 332, right: 366 }, 390),
    "right",
    "a right-column trigger keeps the legacy right-edge pin so it grows left",
  );
});

test("InfoHint auto anchoring fails safely to the legacy right anchor without layout data", () => {
  assert.equal(resolveInfoHintAnchor("auto"), "right");
});

test("InfoHint shared styles preserve the legacy default and mobile geometry", async () => {
  const [styles, component, panel, actions, checklist] = await Promise.all([
    read("app/globals.css"),
    read("app/components/WorkspaceInfoHint.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/settings/components/WorkspaceDriveResourceActions.tsx"),
    read("app/settings/components/workspace-domain-checklist/WorkspaceDomainChecklistCard.tsx"),
  ]);

  assert.match(styles, /\.info-hint-tooltip\{[^}]*right:0;bottom:calc\(100% \+ 6px\)/);
  assert.match(styles, /@media \(min-width:561px\)\{\s+\.info-hint\.info-hint-anchor-left \.info-hint-tooltip\{right:auto;left:0\}/);
  assert.match(styles, /@media \(max-width:560px\)[\s\S]+\.info-hint-tooltip\{top:calc\(100% \+ 4px\);right:0;bottom:auto;left:auto\}/);
  assert.match(styles, /\.info-hint\.info-hint-anchor-left \.info-hint-tooltip\{right:auto;left:0\}/);
  assert.match(styles, /\.workspace-setup-stage \.info-hint\{position:static\}/);
  assert.match(styles, /\.workspace-setup-stage \.info-hint-tooltip,[\s\S]+\.workspace-setup-stage \.info-hint\.info-hint-anchor-left \.info-hint-tooltip\{right:12px;left:12px;width:auto\}/);
  assert.doesNotMatch(styles, /@media \(max-width:560px\)\{[\s\S]*?\n\s+\.info-hint\{position:static\}/);
  assert.match(component, /anchor = "right"/);
  assert.doesNotMatch(component, /data-info-hint/);
  assert.doesNotMatch(styles, /\.workspace-info-hint/);

  for (const source of [panel, actions, checklist]) {
    assert.match(source, /components\/WorkspaceInfoHint/);
    assert.doesNotMatch(source, /workspace-setup-shell\/WorkspaceInfoHint/);
  }
});
