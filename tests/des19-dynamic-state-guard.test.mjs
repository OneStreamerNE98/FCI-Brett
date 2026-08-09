import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyActionGroupLayout,
  collectLayoutFacts,
  findClippingEscapes,
  findLabelDrift,
  findScrollOwnerViolations,
  findUnauthorizedWraps,
  findUnsanctionedActionGroups,
} from "./helpers/dynamic-state-guard.ts";

const rect = (top, left, width, height) => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const fact = (overrides) => ({
  id: "control",
  rect: rect(0, 0, 100, 44),
  lines: 1,
  noWrap: false,
  clip: null,
  ...overrides,
});

// The packet's accept criterion: the guard must FAIL on a deliberately broken
// variant of each assertion class. Each class gets a passing fixture and a
// broken one here, so the failure is proven without a browser.

test("DES-19 clipping-escape assertion passes a contained element and fails an escaped one", () => {
  const clip = { id: "panel", rect: rect(0, 0, 200, 200), allowed: false, kind: "hidden/hidden" };
  assert.deepEqual(findClippingEscapes([fact({ rect: rect(10, 10, 100, 44), clip })]), []);

  const escaped = findClippingEscapes([fact({ rect: rect(10, 150, 100, 44), clip })]);
  assert.equal(escaped.length, 1);
  assert.equal(escaped[0].assertion, "nearest-clipping-ancestor");
  assert.match(escaped[0].message, /clipped and unreachable/u);

  // The same escape inside an allow-listed scroller is sanctioned.
  assert.deepEqual(findClippingEscapes([fact({ rect: rect(10, 150, 100, 44), clip: { ...clip, allowed: true } })]), []);
});

test("DES-19 action-group assertion sanctions row, grid, and stack — and fails the ragged wrap", () => {
  // The audit's P1 photograph: three controls share a baseline, the fourth
  // wraps underneath at a different width — the unsanctioned arrangement.
  const ragged = classifyActionGroupLayout([
    rect(0, 0, 80, 44), rect(0, 84, 80, 44), rect(0, 168, 80, 44), rect(48, 0, 120, 44),
  ]);
  assert.equal(ragged.layout, "unsanctioned");

  assert.equal(classifyActionGroupLayout([rect(0, 0, 80, 44), rect(0, 84, 80, 44)]).layout, "row");
  assert.equal(
    classifyActionGroupLayout([rect(0, 0, 150, 44), rect(0, 154, 150, 44), rect(48, 0, 150, 44), rect(48, 154, 150, 44)]).layout,
    "grid",
  );
  assert.equal(
    classifyActionGroupLayout([rect(0, 0, 300, 44), rect(48, 0, 300, 44)]).layout,
    "stack",
  );
  assert.equal(classifyActionGroupLayout([rect(0, 0, 80, 44)]).layout, "single");

  const violations = findUnsanctionedActionGroups([{ id: "section controls", rects: [rect(0, 0, 80, 44), rect(0, 84, 80, 44), rect(0, 168, 80, 44), rect(48, 0, 120, 44)] }]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].assertion, "action-group-layout");
});

test("DES-19 no-wrap assertion passes a single-line title and fails a wrapped one", () => {
  assert.deepEqual(findUnauthorizedWraps([fact({ noWrap: true, lines: 1 })]), []);

  const wrapped = findUnauthorizedWraps([fact({ id: "Lead pipeline", noWrap: true, lines: 2 })]);
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].assertion, "no-unauthorized-wrap");
  assert.match(wrapped[0].message, /Lead pipeline/u);

  // An element without the contract may wrap freely.
  assert.deepEqual(findUnauthorizedWraps([fact({ noWrap: false, lines: 3 })]), []);
});

test("DES-19 one-scroll-owner assertion passes a single owner and fails a split stack", () => {
  assert.deepEqual(findScrollOwnerViolations([
    { id: "drawer", top: false, scrollableRegions: [] },
    { id: "modal", top: true, scrollableRegions: ["modal panel"] },
  ]), []);

  // The audit's P2 photograph: drawer and edit modal both own scrollable regions.
  const split = findScrollOwnerViolations([
    { id: "drawer", top: false, scrollableRegions: ["drawer body"] },
    { id: "modal", top: true, scrollableRegions: ["modal panel"] },
  ]);
  assert.ok(split.length >= 1);
  assert.ok(split.every((violation) => violation.assertion === "one-scroll-owner"));
  assert.match(split[0].message, /drawer/u);
});

test("DES-19 stable-label assertion passes untouched chrome and fails a renamed control", () => {
  assert.deepEqual(findLabelDrift(["Overview", "Leads", "Projects"], ["Overview", "Leads", "Projects"], []), []);

  // The audit's P2 shared-busy photograph: an uninvoked control renamed itself.
  const drift = findLabelDrift(["View upcoming events", "Create test event"], ["Loading…", "Creating…"], ["View upcoming events"]);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].assertion, "stable-labels");
  assert.match(drift[0].message, /Create test event/u);

  // The invoked control may relabel; that is the initiating action's feedback.
  assert.deepEqual(findLabelDrift(["Save"], ["Saving…"], ["Save"]), []);
});

test("DES-19 collector stays self-contained for page.evaluate serialization", () => {
  const source = collectLayoutFacts.toString();
  // The collector runs inside the browser: any free variable beyond its own
  // helpers would serialize into a ReferenceError in the page.
  assert.doesNotMatch(source, /findClippingEscapes|classifyActionGroupLayout|require\(|import\s/u);
  assert.match(source, /data-action-group/u);
  assert.match(source, /accessible-overlay-panel/u);
});

test("DES-19 e2e spec declares both named states and the audit's viewports", async () => {
  const spec = await readFile(new URL("./e2e/des19-dynamic-state-guard.spec.ts", import.meta.url), "utf8");
  assert.match(spec, /Overview edit/u, "the guard must run on the Overview-edit state");
  assert.match(spec, /drawer.*edit|edit.*drawer/iu, "the guard must run on the project-drawer-edit state");
  for (const width of [390, 820, 834, 1181, 1280]) {
    assert.match(spec, new RegExp(`\\b${width}\\b`, "u"), `viewport ${width} missing`);
  }
  for (const assertion of [
    "findClippingEscapes",
    "findUnsanctionedActionGroups",
    "findUnauthorizedWraps",
    "findScrollOwnerViolations",
    "findLabelDrift",
  ]) {
    assert.match(spec, new RegExp(assertion, "u"), `${assertion} not exercised by the spec`);
  }
  assert.match(spec, /screenshot/u, "the audit's screenshot record is part of the matrix");
});
