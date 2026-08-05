import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const applicationRoot = join(repositoryRoot, "app");
const globalsPath = join(applicationRoot, "globals.css");
const designAuthorityPath = join(repositoryRoot, "docs/dashboard-design-spec.md");
const allowlist = JSON.parse(
  await readFile(join(repositoryRoot, "tests/fixtures/des13-design-token-allowlist.json"), "utf8"),
);

async function collectCssFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      paths.push(...await collectCssFiles(path));
    } else if (path.endsWith(".css") && !path.endsWith(".css.d.ts")) {
      paths.push(path);
    }
  }
  return paths;
}

async function collectTsxFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      paths.push(...await collectTsxFiles(path));
    } else if (path.endsWith(".tsx")) {
      paths.push(path);
    }
  }
  return paths;
}

// The CSS walk above only sees .css files, so styling smuggled into a .tsx inline
// <style> block used to be invisible to every rule in this file.
function inlineStyleBlocks(source) {
  return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gu)].map((match) => match[1]);
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//gu, "");
}

function declarations(css) {
  return [...stripComments(css).matchAll(/([\w-]+)\s*:\s*([^;{}]+)/gu)].map((match) => ({
    property: match[1].toLowerCase(),
    value: match[2].trim(),
  }));
}

function rawHexViolations(css, { allowSemanticRoot = false } = {}) {
  let source = stripComments(css);
  if (allowSemanticRoot) {
    const root = source.match(/:root\s*\{[\s\S]*?\}/u)?.[0] ?? "";
    const maskedRoot = root.replace(/--color-[\w-]+\s*:\s*[^;]+;/gu, "");
    source = source.replace(root, maskedRoot);
  }
  return [...source.matchAll(/#[0-9a-f]{3,8}\b/giu)].map((match) => match[0]);
}

function tokenValue(root, name) {
  const match = root.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`, "u"));
  assert.ok(match, `missing --${name}`);
  return match[1].trim();
}

function parseHex(hex) {
  const compact = hex.slice(1);
  const expanded = compact.length === 3
    ? compact.split("").map((character) => character + character).join("")
    : compact;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance(hex) {
  const channels = parseHex(hex).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const cssFiles = await collectCssFiles(applicationRoot);
const cssSources = await Promise.all(cssFiles.map(async (path) => ({
  path,
  source: await readFile(path, "utf8"),
})));
const globals = await readFile(globalsPath, "utf8");
const designAuthority = await readFile(designAuthorityPath, "utf8");
const root = globals.match(/:root\s*\{([\s\S]*?)\}/u)?.[1] ?? "";

test("DES-13 retains and records Tailwind Preflight as the load-bearing reset", () => {
  assert.match(globals, /^@import "tailwindcss";\r?\n/u);
  assert.match(designAuthority,
    /`@import "tailwindcss"` is deliberately retained at `app\/globals\.css:1` as the app's\s+load-bearing Preflight reset layer\./u);
  assert.match(designAuthority,
    /A future removal must provide an equivalent\s+minimal reset in the same change and re-run the complete visual regression gate/u);
});

test("DES-13 semantic colors are the only raw app-CSS hex values and stay within budget", () => {
  const semanticTokens = [...root.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/gu)];
  assert.equal(semanticTokens.length, allowlist.semanticColorTokenLimit);

  const violations = cssSources.flatMap(({ path, source }) => rawHexViolations(source, {
    allowSemanticRoot: path === globalsPath,
  }).map((value) => `${relative(repositoryRoot, path)}:${value}`));
  assert.deepEqual(violations, []);

  const distinctHexValues = new Set(
    cssSources.flatMap(({ source }) => [...stripComments(source).matchAll(/#[0-9a-f]{3,8}\b/giu)]
      .map((match) => match[0].toLowerCase())),
  );
  assert.ok(distinctHexValues.size <= allowlist.semanticColorTokenLimit);
});

test("DES-13 negative fixture proves a new raw hex fails the drift rule", async () => {
  const fixture = await readFile(join(repositoryRoot, "tests/fixtures/des13-raw-hex.css"), "utf8");
  assert.deepEqual(rawHexViolations(fixture), ["#123456"]);
});

test("DES-13 type scale and weight diet are exact", () => {
  const expectedSizes = {
    caption: "12px",
    body: "13px",
    label: "14px",
    "heading-sm": "16px",
    "heading-md": "20px",
    "heading-lg": "24px",
    display: "28px",
  };
  for (const [name, value] of Object.entries(expectedSizes)) {
    assert.equal(tokenValue(root, `font-size-${name}`), value);
  }

  const allowedSize = /^var\(--font-size-(?:caption|body|label|heading-sm|heading-md|heading-lg|display)\)(?:!important)?$/u;
  const allowedWeight = /^var\(--font-weight-(?:regular|medium|semibold|bold)\)(?:!important)?$/u;
  for (const { path, source } of cssSources) {
    for (const { property, value } of declarations(source)) {
      if (property === "font-size") {
        assert.match(value, allowedSize, `${relative(repositoryRoot, path)} uses off-scale font-size ${value}`);
      }
      if (property === "font-weight") {
        assert.match(value, allowedWeight, `${relative(repositoryRoot, path)} uses off-scale font-weight ${value}`);
      }
      if (property === "font") {
        assert.doesNotMatch(value, /(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem)\b/iu,
          `${relative(repositoryRoot, path)} uses an off-scale font shorthand ${value}`);
        assert.doesNotMatch(value, /\b(?:7[1-9]\d|[89]\d\d)\b/u,
          `${relative(repositoryRoot, path)} uses display-only weight as a working weight`);
      }
    }
  }
});

test("DES-13 line-height uses the line-height scale or a documented exception", () => {
  const expectedLineHeights = { caption: "1.35", body: "1.45", heading: "1.2" };
  for (const [name, value] of Object.entries(expectedLineHeights)) {
    assert.equal(tokenValue(root, `line-height-${name}`), value);
  }

  // The three tokens must actually be consumed, not merely declared.
  const tokenUses = cssSources.reduce((total, { source }) => (
    total + (stripComments(source).match(/line-height:\s*var\(--line-height-/gu) ?? []).length
  ), 0);
  assert.ok(tokenUses >= 60, `--line-height-* must be in real use, found ${tokenUses}`);

  const allowedLineHeight = /^var\(--line-height-(?:caption|body|heading)\)(?:!important)?$/u;
  for (const { path, source } of cssSources) {
    for (const { property, value } of declarations(source)) {
      if (property !== "line-height") continue;
      if (allowedLineHeight.test(value)) continue;
      assert.ok(allowlist.lineHeightExceptions.includes(value),
        `${relative(repositoryRoot, path)} uses an off-scale line-height ${value}`);
    }
  }
});

test("DES-13 drift detection reaches inline <style> blocks in .tsx components", async () => {
  const tsxFiles = await collectTsxFiles(applicationRoot);
  const deferrals = allowlist.inlineStyleDeferrals ?? {};
  const violations = [];
  const seenDeferrals = new Set();

  for (const path of tsxFiles) {
    const source = await readFile(path, "utf8");
    const blocks = inlineStyleBlocks(source);
    if (blocks.length === 0) continue;
    const relativePath = relative(repositoryRoot, path).replaceAll("\\", "/");
    const hexes = blocks.flatMap((block) => rawHexViolations(block));
    if (relativePath in deferrals) {
      seenDeferrals.add(relativePath);
      // Self-cleaning: once the deferred migration lands, drop the allowlist entry.
      assert.ok(hexes.length > 0,
        `${relativePath} is allowlisted for inline-style drift but is now clean - remove its deferral`);
      continue;
    }
    violations.push(...hexes.map((value) => `${relativePath}:${value}`));
  }

  assert.deepEqual(violations, []);
  assert.deepEqual([...seenDeferrals].sort(), Object.keys(deferrals).sort(),
    "every inline-style deferral must name a file that still exists and still has an inline <style>");
});

test("DES-13 negative fixture proves a new inline-style raw hex fails the drift rule", async () => {
  // Stored with a .txt suffix so this CSS-values-only change adds no .tsx to the diff.
  const fixture = await readFile(join(repositoryRoot, "tests/fixtures/des13-inline-style-hex.tsx.txt"), "utf8");
  const blocks = inlineStyleBlocks(fixture);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks.flatMap((block) => rawHexViolations(block)), ["#123456"]);
});

test("DES-13 gap and padding values use only the 4-point spacing scale", () => {
  const expectedSpace = ["4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px"];
  for (const [index, value] of expectedSpace.entries()) {
    assert.equal(tokenValue(root, `space-${index + 1}`), value);
  }

  for (const { path, source } of cssSources) {
    for (const { property, value } of declarations(source)) {
      if (!/^(?:gap|row-gap|column-gap|padding(?:-(?:block|inline|top|right|bottom|left)(?:-start|-end)?)?)$/u.test(property)) {
        continue;
      }
      assert.doesNotMatch(value, /(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem)\b/iu,
        `${relative(repositoryRoot, path)} uses an off-scale ${property}: ${value}`);
      for (const variable of value.matchAll(/var\((--[\w-]+)/gu)) {
        assert.match(variable[1], /^--space-[1-8]$/u,
          `${relative(repositoryRoot, path)} uses a non-spacing token in ${property}: ${value}`);
      }
    }
  }
});

test("DES-13 radii use the radius scale plus the documented exceptions", () => {
  assert.deepEqual(allowlist.lengthExceptions, ["0", "50%", "999px"]);
  const allowedRadiusVariable = /^--radius-(?:chip|control|card|pill)$/u;
  for (const { path, source } of cssSources) {
    for (const { property, value } of declarations(source)) {
      if (!/^border(?:-(?:top|right|bottom|left))?(?:-(?:left|right))?-radius$/u.test(property)) continue;
      for (const rawLength of value.matchAll(/(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem|%)\b/giu)) {
        assert.ok(allowlist.lengthExceptions.includes(rawLength[0]),
          `${relative(repositoryRoot, path)} uses an off-scale ${property}: ${value}`);
      }
      for (const variable of value.matchAll(/var\((--[\w-]+)/gu)) {
        assert.match(variable[1], allowedRadiusVariable,
          `${relative(repositoryRoot, path)} uses a non-radius token in ${property}: ${value}`);
      }
    }
  }
});

test("DES-13 motion declarations use two durations and one easing token", () => {
  assert.equal(tokenValue(root, "motion-duration-fast"), "120ms");
  assert.equal(tokenValue(root, "motion-duration-standard"), "180ms");
  assert.equal(tokenValue(root, "motion-ease"), "cubic-bezier(.2,.8,.2,1)");

  for (const { path, source } of cssSources) {
    for (const { property, value } of declarations(source)) {
      if (!/^transition(?:-(?:duration|timing-function))?$/u.test(property)) continue;
      const withoutInstantException = value.replace(/0ms(?=!important)/gu, "");
      assert.doesNotMatch(withoutInstantException, /(?:\.\d+|\d+(?:\.\d+)?)(?:ms|s)\b/iu,
        `${relative(repositoryRoot, path)} uses an ad-hoc transition duration: ${value}`);
      assert.doesNotMatch(value, /(?:^|[\s,])ease(?:$|[\s,])/iu,
        `${relative(repositoryRoot, path)} uses an ad-hoc transition easing: ${value}`);
    }
  }

  assert.match(globals,
    /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{[^}]*animation-duration:\.01ms!important;[^}]*transition-duration:0ms!important\}/u);
});

test("DES-13 modal and Gmail filing focus rings use a visible semantic color", () => {
  assert.match(globals,
    /\.modal input:focus,\.modal select:focus,\.modal textarea:focus\{[^}]*box-shadow:0 0 0 3px var\(--color-accent\)\}/u);
  assert.match(globals,
    /\.filing-project-select select:focus\{[^}]*box-shadow:0 0 0 3px var\(--color-accent\)\}/u);
  assert.doesNotMatch(globals,
    /(?:focus|focus-visible)[^{]*\{[^}]*box-shadow:[^;}]*var\(--color-overlay-soft\)/u);
});

test("DES-13 foreground and surface pairs meet WCAG AA", () => {
  const pairs = [
    ["color-ink", "color-surface"],
    ["color-ink-muted", "color-surface"],
    ["color-ink-subtle", "color-surface"],
    ["color-ink-subtle", "color-surface-muted"],
    ["color-ink-subtle", "color-canvas"],
    ["color-ink-subtle", "color-surface-sunken"],
    ["color-ink-subtle", "color-accent-soft"],
    ["color-ink-subtle", "color-warning-soft"],
    ["color-ink-subtle", "color-danger-soft"],
    ["color-ink-inverse", "color-accent"],
    ["color-accent", "color-surface"],
    ["color-accent", "color-accent-soft"],
    ["color-success", "color-success-soft"],
    ["color-warning", "color-warning-soft"],
    ["color-danger", "color-danger-soft"],
    ["color-info", "color-info-soft"],
    ["color-violet", "color-violet-soft"],
  ];
  for (const [foregroundName, backgroundName] of pairs) {
    const foreground = tokenValue(root, foregroundName);
    const background = tokenValue(root, backgroundName);
    assert.ok(contrastRatio(foreground, background) >= 4.5,
      `${foregroundName} on ${backgroundName} must meet WCAG AA`);
  }
});
