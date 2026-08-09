/**
 * DES-19 — the dynamic-state guard.
 *
 * The reusable state-matrix assertion vocabulary the August 4 responsive-layout
 * audit specifies (docs/design-reviews/2026-08-04-responsive-layout-audit.md,
 * P3 "tests weak on state transitions"). A state declaration is
 * `{ route, trigger, stableState, viewports }`; the guard measures the stable
 * state in a browser and runs these pure functions over the measured facts.
 *
 * The assertion FUNCTIONS live here (not in the Playwright spec) so the unit
 * suite (tests/des19-dynamic-state-guard.test.mjs) can prove — without a
 * browser — that every class fails on a deliberately broken variant. The
 * Playwright spec (tests/e2e/des19-dynamic-state-guard.spec.ts) only collects
 * facts and calls these.
 *
 * This file is imported by both node:test (via --experimental-strip-types) and
 * the Playwright spec. Keep it free of runtime dependencies and of
 * non-erasable TypeScript syntax.
 */

export type Rect = Readonly<{ top: number; right: number; bottom: number; left: number; width: number; height: number }>;

/** One measured element. Collected in the browser; consumed by the assertions. */
export type ElementFact = Readonly<{
  /** Human-readable identifier for failure messages (aria-label, text, or selector). */
  id: string;
  rect: Rect;
  /** Distinct line tops across the element's text — 1 means single-line. */
  lines: number;
  /** True when the element carries the no-wrap contract (data-no-wrap or an action label). */
  noWrap: boolean;
  /**
   * The nearest clipping ancestor (overflow hidden/clip/scroll/auto in either
   * axis), if any. `allowed` is true only for the allow-listed scrollers named
   * in the state declaration. `kind` is the computed overflow pair.
   */
  clip: Readonly<{ id: string; rect: Rect; allowed: boolean; kind: string }> | null;
}>;

export type OverlayFact = Readonly<{
  id: string;
  top: boolean;
  /** Scroll containers inside this overlay that show a layout scrollbar. */
  visibleScrollbars: ReadonlyArray<string>;
}>;

export type Violation = Readonly<{ assertion: string; message: string }>;

const CLIP_TOLERANCE_PX = 1;
const ROW_TOLERANCE_PX = 2;

/** Assertion class 1 — no element escapes its nearest clipping ancestor. */
export function findClippingEscapes(facts: ReadonlyArray<ElementFact>): Violation[] {
  const violations: Violation[] = [];
  for (const fact of facts) {
    if (!fact.clip || fact.clip.allowed) continue;
    const overflowRight = fact.rect.right - (fact.clip.rect.right + CLIP_TOLERANCE_PX);
    const overflowBottom = fact.rect.bottom - (fact.clip.rect.bottom + CLIP_TOLERANCE_PX);
    const overflowLeft = fact.clip.rect.left - CLIP_TOLERANCE_PX - fact.rect.left;
    const overflowTop = fact.clip.rect.top - CLIP_TOLERANCE_PX - fact.rect.top;
    const overflow = Math.max(overflowRight, overflowBottom, overflowLeft, overflowTop);
    if (overflow > 0) {
      violations.push({
        assertion: "nearest-clipping-ancestor",
        message: `${fact.id} escapes ${fact.clip.id} (${fact.clip.kind}) by ${Math.round(overflow)}px — clipped and unreachable`,
      });
    }
  }
  return violations;
}

export type ActionGroupLayout = "single" | "row" | "grid" | "stack" | "unsanctioned";

/**
 * Assertion class 2 — action groups use one of the sanctioned layouts.
 * Sanctioned: a single shared-baseline row; a stable two-per-row grid; a
 * single-column full-width stack. Anything else (three ragged rows, wrapped
 * odd-one-out, mismatched baselines) is the failure the audit photographed.
 */
export function classifyActionGroupLayout(rects: ReadonlyArray<Rect>): { layout: ActionGroupLayout; reason: string } {
  if (rects.length <= 1) return { layout: "single", reason: "zero or one control" };

  const rows = groupIntoRows(rects);
  if (rows.length === 1) return { layout: "row", reason: "all controls share one baseline" };

  const uniformWidth = rects.every((rect) => Math.abs(rect.width - rects[0]!.width) <= ROW_TOLERANCE_PX);
  const uniformLeft = rects.every((rect) => Math.abs(rect.left - rects[0]!.left) <= ROW_TOLERANCE_PX);

  if (uniformWidth && uniformLeft && rows.every((row) => row.length === 1)) {
    return { layout: "stack", reason: "one full-width column" };
  }

  if (uniformWidth && rows.length <= 2 && rows.every((row) => row.length <= 2)) {
    return { layout: "grid", reason: "stable two-per-row grid" };
  }

  return {
    layout: "unsanctioned",
    reason: `${rows.length} ragged rows over ${rects.length} controls (widths uniform: ${uniformWidth})`,
  };
}

function groupIntoRows(rects: ReadonlyArray<Rect>): Rect[][] {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: Rect[][] = [];
  for (const rect of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate[0]!.top - rect.top) <= ROW_TOLERANCE_PX);
    if (row) row.push(rect);
    else rows.push([rect]);
  }
  return rows;
}

export function findUnsanctionedActionGroups(groups: ReadonlyArray<{ id: string; rects: ReadonlyArray<Rect> }>): Violation[] {
  const violations: Violation[] = [];
  for (const group of groups) {
    const { layout, reason } = classifyActionGroupLayout(group.rects);
    if (layout === "unsanctioned") {
      violations.push({ assertion: "action-group-layout", message: `${group.id}: ${reason}` });
    }
  }
  return violations;
}

/** Assertion class 3 — titles/buttons do not wrap unless the variant allows it. */
export function findUnauthorizedWraps(facts: ReadonlyArray<ElementFact>): Violation[] {
  return facts
    .filter((fact) => fact.noWrap && fact.lines > 1)
    .map((fact) => ({
      assertion: "no-unauthorized-wrap",
      message: `${fact.id} wraps onto ${fact.lines} lines despite the no-wrap contract`,
    }));
}

/** Assertion class 4 — one visible scroll owner per overlay stack. */
export function findScrollOwnerViolations(overlays: ReadonlyArray<OverlayFact>): Violation[] {
  const violations: Violation[] = [];
  const owners = overlays.filter((overlay) => overlay.visibleScrollbars.length > 0);
  if (owners.length > 1) {
    violations.push({
      assertion: "one-scroll-owner",
      message: `${owners.length} overlays show scrollbars at once: ${owners.map((owner) => owner.id).join(", ")}`,
    });
  }
  for (const overlay of overlays) {
    if (overlay.visibleScrollbars.length > 1) {
      violations.push({
        assertion: "one-scroll-owner",
        message: `${overlay.id} shows ${overlay.visibleScrollbars.length} scrollbars: ${overlay.visibleScrollbars.join(", ")}`,
      });
    }
  }
  const hiddenOwner = owners.find((owner) => !owner.top);
  if (hiddenOwner) {
    violations.push({
      assertion: "one-scroll-owner",
      message: `${hiddenOwner.id} is not the top overlay but still owns a visible scrollbar`,
    });
  }
  return violations;
}

/**
 * Assertion class 5 — controls retain stable labels unless they initiated the
 * action. Multiset comparison: a label present before the trigger and absent
 * (or less present) after means a control was renamed or removed without being
 * invoked. `invokedLabels` names the control(s) the trigger itself fired —
 * they may relabel or retire.
 */
export function findLabelDrift(before: ReadonlyArray<string>, after: ReadonlyArray<string>, invokedLabels: ReadonlyArray<string>): Violation[] {
  const violations: Violation[] = [];
  const remaining = [...after];
  for (const label of before) {
    const index = remaining.indexOf(label);
    if (index >= 0) {
      remaining.splice(index, 1);
      continue;
    }
    if (invokedLabels.includes(label)) continue;
    violations.push({
      assertion: "stable-labels",
      message: `"${label}" disappeared or was relabeled without being invoked`,
    });
  }
  return violations;
}

/**
 * Browser-side collector. Playwright serializes this function into the page,
 * so it must stay self-contained: no imports, no closures over module state.
 *
 * Collects, within `scopeSelector`:
 * - every interactive element and heading, its rect, its text line count, its
 *   no-wrap contract, and its nearest clipping ancestor (allowed scrollers are
 *   named by `allowedScrollerSelectors`);
 * - every `[data-action-group]` with its controls' rects;
 * - every mounted overlay panel with its visible-scrollbar scroll containers.
 */
export function collectLayoutFacts(args: {
  scopeSelector: string;
  allowedScrollerSelectors: string[];
  labelSelector: string;
}) {
  function describe(element: Element): string {
    const aria = element.getAttribute("aria-label");
    if (aria) return aria;
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (text) return `"${text}"`;
    return element.tagName.toLowerCase() + (element.id ? `#${element.id}` : "");
  }

  function lineCount(element: Element): number {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops: number[] = [];
    for (const rect of range.getClientRects()) {
      if (rect.height > 0) tops.push(Math.round(rect.top));
    }
    range.detach();
    // An inline icon and its text sit a few px apart on the same line; a real
    // wrap lands a full line-height below (>= 16px on the type scale). Count
    // line tops with a tolerance between the two.
    const LINE_TOP_TOLERANCE_PX = 6;
    tops.sort((a, b) => a - b);
    let lines = 0;
    let lastTop = -Infinity;
    for (const top of tops) {
      if (top - lastTop > LINE_TOP_TOLERANCE_PX) {
        lines += 1;
        lastTop = top;
      }
    }
    return Math.max(lines, 1);
  }

  function clippingAncestor(element: Element): { id: string; rect: DOMRect; allowed: boolean; kind: string } | null {
    let node = element.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      const clipsX = /^(hidden|clip|scroll|auto)$/u.test(style.overflowX);
      const clipsY = /^(hidden|clip|scroll|auto)$/u.test(style.overflowY);
      if (clipsX || clipsY) {
        const allowed = args.allowedScrollerSelectors.some((selector) => node!.closest(selector) === node || node!.matches(selector));
        return {
          id: describe(node),
          rect: node.getBoundingClientRect(),
          allowed,
          kind: `${style.overflowX}/${style.overflowY}`,
        };
      }
      node = node.parentElement;
    }
    return null;
  }

  function isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  const scope = document.querySelector(args.scopeSelector) ?? document.body;

  const elements = [];
  const interactive = scope.querySelectorAll("button, a[href], [role='button'], input, h1, h2, h3, [data-no-wrap]");
  for (const element of interactive) {
    if (!isVisible(element)) continue;
    const style = getComputedStyle(element);
    elements.push({
      id: describe(element),
      rect: element.getBoundingClientRect().toJSON(),
      lines: lineCount(element),
      noWrap: element.hasAttribute("data-no-wrap") || style.whiteSpace === "nowrap",
      clip: (() => {
        const clip = clippingAncestor(element);
        return clip ? { id: clip.id, rect: clip.rect.toJSON(), allowed: clip.allowed, kind: clip.kind } : null;
      })(),
    });
  }

  const actionGroups = [];
  for (const group of scope.querySelectorAll("[data-action-group]")) {
    if (!isVisible(group)) continue;
    const rects = [];
    for (const control of group.querySelectorAll("button, a[href], [role='button']")) {
      if (isVisible(control)) rects.push(control.getBoundingClientRect().toJSON());
    }
    actionGroups.push({ id: describe(group), rects });
  }

  const overlays = [];
  const panels = [...document.querySelectorAll(".accessible-overlay-panel")];
  const topPanel = panels.at(-1) ?? null;
  for (const panel of panels) {
    const visibleScrollbars: string[] = [];
    for (const candidate of [panel, ...panel.querySelectorAll("*")]) {
      const style = getComputedStyle(candidate);
      const scrollable = /^(scroll|auto)$/u.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 1;
      if (!scrollable) continue;
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const scrollbarVisible = candidate.offsetHeight - candidate.clientHeight - borders > 2;
      if (scrollbarVisible) visibleScrollbars.push(describe(candidate));
    }
    overlays.push({ id: describe(panel), top: panel === topPanel, visibleScrollbars });
  }

  const labels: string[] = [];
  for (const element of document.querySelectorAll(args.labelSelector)) {
    if (!isVisible(element)) continue;
    labels.push((element.getAttribute("aria-label") ?? (element.textContent ?? "").trim().replace(/\s+/g, " ")).slice(0, 80));
  }

  return { elements, actionGroups, overlays, labels };
}
