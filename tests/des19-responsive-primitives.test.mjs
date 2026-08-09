import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-level pins for the DES-19 primitives: the component contract
// (exports, data attributes the guard collector reads) and the stylesheet
// contract (container queries, target-min ownership, density variant). The
// geometry itself is proven in the browser by the e2e fixture harness.

const components = await readFile(new URL("../app/components/responsive-primitives.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/responsive-primitives.css", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("DES-19 primitives module exports the five named contracts", () => {
  for (const name of ["ResponsiveActionGroup", "PageHeader", "PanelHeader", "ModalFooter", "DisclosureHeader"]) {
    assert.match(components, new RegExp(`export function ${name}\\b`, "u"), `${name} export missing`);
  }
});

test("DES-19 primitives carry the data attributes the guard collector reads", () => {
  assert.match(components, /data-action-group/u, "the collector keys action groups off data-action-group");
  assert.match(components, /data-density/u, "density is a data attribute so the stylesheet owns sizing");
  assert.match(components, /data-no-wrap/u, "the no-wrap contract must be measurable by the collector");
});

test("DES-19 primitives are client components and ship unused by pinned pages", () => {
  assert.match(components, /^"use client"/u);
  assert.match(components, /ship UNUSED by pinned pages until the\s+DES-21 migration/u, "the unused-until-DES-21 contract must stay stated");
});

test("DES-19 stylesheet sizes by container query, never by viewport breakpoint", () => {
  assert.match(styles, /container:\s*rp-action-group \/ inline-size/u);
  assert.match(styles, /@container rp-action-group \(max-width: 479px\)/u);
  assert.match(styles, /@container rp-action-group \(max-width: 279px\)/u);
  assert.match(styles, /@container rp-page-header \(max-width: 559px\)/u);
  assert.match(styles, /@container rp-panel-header \(max-width: 479px\)/u);
  assert.match(styles, /@container rp-modal-footer \(max-width: 479px\)/u);
  assert.doesNotMatch(styles, /@media[^{]*(max|min)-width/u, "viewport width media queries are the anti-pattern this packet retires");
});

test("DES-19 stylesheet owns the 44px target and the documented dense variant", () => {
  assert.match(styles, /min-height:\s*var\(--target-min\)/u);
  assert.match(styles, /\[data-density="dense"\][^{]*\{[^}]*min-height:\s*var\(--control-compact\)/u, "dense must be an explicit, documented variant");
  // The coarse-pointer guard restores 44px so dense can never under-size touch.
  const coarseBlocks = styles.match(/@media \(pointer: coarse\)/gu) ?? [];
  assert.ok(coarseBlocks.length >= 2, "every dense rule needs a coarse-pointer 44px restore");
});

test("DES-19 stylesheet enforces the no-wrap contract mechanically", () => {
  assert.match(styles, /\[data-no-wrap\][^{]*\{[^}]*white-space:\s*nowrap/u);
  assert.match(styles, /text-overflow:\s*ellipsis/u);
});

test("DES-19 modal footer stacks primary-on-top without changing DOM order", () => {
  assert.match(styles, /flex-direction:\s*column-reverse/u, "column-reverse puts the primary action on top in the stacked layout");
});

test("DES-19 globals.css imports the primitives stylesheet after tailwind", () => {
  const tailwind = globals.indexOf('@import "tailwindcss";');
  const primitives = globals.indexOf('@import "./responsive-primitives.css";');
  assert.ok(tailwind >= 0, "tailwind import pin moved — check tests/des13-design-token-drift.test.mjs");
  assert.ok(primitives > tailwind, "responsive-primitives.css must be imported after tailwind");
});

test("DES-19 stylesheet class namespace is rp- (no collisions with legacy classes)", () => {
  const code = styles.replace(/\/\*[\s\S]*?\*\//gu, "");
  const selectors = code.match(/\.[a-z][a-z0-9-]+/gu) ?? [];
  for (const selector of selectors) {
    assert.ok(selector.startsWith(".rp-"), `${selector} escapes the rp- namespace`);
  }
});
