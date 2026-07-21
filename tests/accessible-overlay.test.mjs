import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tabBoundaryTarget } from "../app/components/overlay-focus.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("wraps focus at both overlay boundaries and recovers focus from outside", () => {
  const first = { id: "first" };
  const middle = { id: "middle" };
  const last = { id: "last" };
  const focusable = [first, middle, last];

  assert.equal(tabBoundaryTarget(first, focusable, true, true), last);
  assert.equal(tabBoundaryTarget(last, focusable, false, true), first);
  assert.equal(tabBoundaryTarget(middle, focusable, false, true), null);
  assert.equal(tabBoundaryTarget(null, focusable, false, false), first);
  assert.equal(tabBoundaryTarget(null, focusable, true, false), last);
  assert.equal(tabBoundaryTarget(null, [], false, false), null);
});

test("provides one nested-overlay-aware accessible interaction foundation", async () => {
  const [overlay, app, inboxRules, googleWorkspace, css] = await Promise.all([
    read("app/components/AccessibleOverlay.tsx"),
    read("app/FloorOpsApp.tsx"),
    read("app/settings/components/InboxRulesPanel.tsx"),
    read("app/settings/components/GoogleWorkspacePanel.tsx"),
    read("app/globals.css"),
  ]);
  const overlayConsumers = [app, inboxRules, googleWorkspace].join("\n");

  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-label=\{ariaLabel\}/);
  assert.match(overlay, /aria-modal="true"/);
  assert.match(overlay, /data-overlay-initial-focus/);
  assert.match(overlay, /event\.key === "Escape"/);
  assert.match(overlay, /event\.key !== "Tab"/);
  assert.match(overlay, /overlayStack\[overlayStack\.length - 1\] !== token/);
  assert.match(overlay, /document\.body\.style\.overflow = "hidden"/);
  assert.match(overlay, /inertOutsideState = new Map/);
  assert.match(overlay, /const restoreOutsideInteraction = inertOutside\(backdrop\)/);
  assert.match(overlay, /restoreOutsideInteraction\(\)/);
  assert.match(overlay, /preferredReturnTarget\?\.isConnected/);
  assert.match(overlay, /returnFocusRef\?: RefObject<HTMLElement \| null>/);
  assert.match(overlay, /fallbackFocusRef\?: RefObject<HTMLElement \| null>/);
  assert.match(overlay, /fallbackReturnTarget\?\.isConnected/);
  assert.match(overlay, /previouslyFocused\?\.isConnected[\s\S]*fallbackReturnTarget\?\.isConnected/);
  assert.match(overlay, /event\.target !== event\.currentTarget/);
  assert.match(overlay, /!closeOnBackdropRef\.current \|\| busyRef\.current/);

  assert.equal(overlayConsumers.match(/<AccessibleOverlay\b/g)?.length, 13);
  assert.doesNotMatch(overlayConsumers, /<div className="modal-backdrop"/);
  assert.doesNotMatch(overlayConsumers, /<div className="drawer-backdrop"/);
  assert.match(overlayConsumers, /variant="drawer"/);
  assert.match(overlayConsumers, /busy=\{loading \|\| submitting\}/);
  assert.match(overlayConsumers, /busy=\{saving\}/);
  assert.equal(overlayConsumers.match(/aria-label="Close" disabled=\{saving\}/g)?.length, 7);
  assert.equal(overlayConsumers.match(/onClick=\{onClose\} disabled=\{saving\}>Cancel/g)?.length, 8);
  assert.match(overlayConsumers, /ariaLabel=\{`Record installation dates for \$\{project\.number\}`\}/);
  assert.match(overlayConsumers, /ariaLabel=\{`Record follow-up result for \$\{project\.number\}`\}/);
  assert.match(overlayConsumers, /aria-label="Close project" disabled=\{busy\}/);
  assert.match(css, /\.accessible-overlay-backdrop,\.accessible-overlay-panel\{overscroll-behavior:contain\}/);
});

test("keeps mobile navigation and workspace search keyboard-operable", async () => {
  const [app, css] = await Promise.all([
    read("app/FloorOpsApp.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(app, /window\.matchMedia\("\(max-width: 820px\)"\)/);
  assert.match(app, /aria-controls="application-navigation"/);
  assert.match(app, /aria-expanded=\{mobileNavActive\}/);
  assert.match(app, /aria-hidden=\{mobileNavViewport && !mobileNav \? true : undefined\}/);
  assert.match(app, /inert=\{mobileNavViewport && !mobileNav \? true : undefined\}/);
  assert.match(app, /<main className="main-area" inert=\{mobileNavActive \? true : undefined\}>/);
  assert.match(app, /document\.addEventListener\("keydown", handleMobileNavigationKeyDown, true\)/);
  assert.match(app, /mobileNavigationCloseRef\.current\?\.focus\(\)/);
  assert.match(app, /navigationTrigger\.focus\(\)/);
  assert.match(app, /<div className="sidebar-scrim" role="presentation" aria-hidden="true"/);
  assert.doesNotMatch(app, /<button className="sidebar-scrim"/);

  assert.match(app, /role="combobox"/);
  assert.match(app, /aria-autocomplete="list"/);
  assert.match(app, /aria-activedescendant=/);
  assert.match(app, /event\.key === "ArrowDown"/);
  assert.match(app, /event\.key === "ArrowUp"/);
  assert.match(app, /tabIndex=\{-1\}/);
  assert.match(app, /openProject\(project, workspaceSearchRef\.current\)/);
  assert.match(app, /openClient\(client, workspaceSearchRef\.current\)/);
  assert.match(app, /returnFocusRef=\{projectDrawerReturnFocusRef\}/);
  assert.match(app, /returnFocusRef=\{clientDrawerReturnFocusRef\}/);
  assert.match(app, /returnFocusRef=\{leadDrawerReturnFocusRef\}/);

  assert.match(css, /visibility:hidden;pointer-events:none/);
  assert.match(css, /\.sidebar\.open\{transform:translateX\(0\);visibility:visible;pointer-events:auto\}/);
  assert.match(css, /button\[aria-selected="true"\]/);
});
