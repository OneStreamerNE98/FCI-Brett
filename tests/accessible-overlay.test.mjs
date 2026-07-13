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
  const [overlay, app, css] = await Promise.all([
    read("app/components/AccessibleOverlay.tsx"),
    read("app/FloorOpsApp.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-label=\{ariaLabel\}/);
  assert.match(overlay, /aria-modal="true"/);
  assert.match(overlay, /data-overlay-initial-focus/);
  assert.match(overlay, /event\.key === "Escape"/);
  assert.match(overlay, /event\.key !== "Tab"/);
  assert.match(overlay, /overlayStack\[overlayStack\.length - 1\] !== token/);
  assert.match(overlay, /document\.body\.style\.overflow = "hidden"/);
  assert.match(overlay, /previouslyFocused\?\.isConnected/);
  assert.match(overlay, /event\.target !== event\.currentTarget/);
  assert.match(overlay, /!closeOnBackdropRef\.current \|\| busyRef\.current/);

  assert.equal(app.match(/<AccessibleOverlay\b/g)?.length, 10);
  assert.doesNotMatch(app, /<div className="modal-backdrop"/);
  assert.doesNotMatch(app, /<div className="drawer-backdrop"/);
  assert.match(app, /variant="drawer"/);
  assert.match(app, /busy=\{loading \|\| submitting\}/);
  assert.match(app, /busy=\{saving\}/);
  assert.equal(app.match(/aria-label="Close" disabled=\{saving\}/g)?.length, 5);
  assert.equal(app.match(/onClick=\{onClose\} disabled=\{saving\}>Cancel/g)?.length, 6);
  assert.match(app, /aria-label="Close project" disabled=\{provisioning\}/);
  assert.match(css, /\.accessible-overlay-backdrop,\.accessible-overlay-panel\{overscroll-behavior:contain\}/);
});
