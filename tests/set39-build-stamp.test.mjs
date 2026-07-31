import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { readBuildInformation } from "../build/build-information.mjs";

const rootUrl = new URL("../", import.meta.url);
const componentPath = "app/settings/components/DataSecurityPanel.tsx";

async function applicationTypeScriptFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) return applicationTypeScriptFiles(entryUrl);
    return /\.[cm]?tsx?$/u.test(entry.name) ? [entryUrl] : [];
  }));
  return nestedFiles.flat();
}

test("SET-39 accepts complete build metadata and bakes only the short lowercase commit identity", () => {
  const buildInformation = readBuildInformation({
    FCI_BUILD_COMMIT_SHA: "A".repeat(40),
    FCI_BUILD_TIMESTAMP: "2026-07-30T23:43:07Z",
  });

  assert.deepEqual(buildInformation, {
    commitSha: "aaaaaaa",
    builtAt: "2026-07-30T23:43:07Z",
  });
});

test("SET-39 treats an entirely absent build identity as unavailable", () => {
  assert.equal(readBuildInformation({}), null);
  assert.equal(readBuildInformation({
    FCI_BUILD_COMMIT_SHA: " ",
    FCI_BUILD_TIMESTAMP: "",
  }), null);
});

test("SET-39 rejects partial or malformed build identities instead of printing authoritative-looking values", () => {
  assert.throws(
    () => readBuildInformation({ FCI_BUILD_COMMIT_SHA: "A".repeat(40) }),
    /FCI_BUILD_COMMIT_SHA and FCI_BUILD_TIMESTAMP must be supplied together/u,
  );
  assert.throws(
    () => readBuildInformation({
      FCI_BUILD_COMMIT_SHA: "not-a-commit",
      FCI_BUILD_TIMESTAMP: "2026-07-30T23:43:07Z",
    }),
    /must be a 7-to-40 character hexadecimal Git commit SHA/u,
  );
  assert.throws(
    () => readBuildInformation({
      FCI_BUILD_COMMIT_SHA: "A".repeat(40),
      FCI_BUILD_TIMESTAMP: "2026-02-31T23:43:07Z",
    }),
    /must be an ISO 8601 UTC timestamp/u,
  );
});

test("SET-39 source pins the compile-time boundary, honest unavailable copy, and copy affordance", async () => {
  const [viteConfig, buildContract, clientBoundary, component] = await Promise.all([
    readFile(new URL("vite.config.ts", rootUrl), "utf8"),
    readFile(new URL("build/build-information.mjs", rootUrl), "utf8"),
    readFile(new URL("app/lib/build-information.ts", rootUrl), "utf8"),
    readFile(new URL(componentPath, rootUrl), "utf8"),
  ]);

  assert.match(
    buildContract,
    /const BUILD_COMMIT_ENVIRONMENT_NAME = "FCI_BUILD_COMMIT_SHA";/u,
  );
  assert.match(
    buildContract,
    /const BUILD_TIMESTAMP_ENVIRONMENT_NAME = "FCI_BUILD_TIMESTAMP";/u,
  );
  assert.match(viteConfig, /const buildInformation = readBuildInformation\(process\.env\);/u);
  assert.match(
    viteConfig,
    /__FCI_BUILD_INFORMATION__: JSON\.stringify\(buildInformation\)/u,
  );
  assert.match(
    clientBoundary,
    /typeof __FCI_BUILD_INFORMATION__ === "undefined"\s*\?\s*null\s*:\s*__FCI_BUILD_INFORMATION__/u,
  );
  assert.match(component, /<strong>Build identifier unavailable<\/strong>/u);
  assert.match(component, /navigator\.clipboard\.writeText\(/u);
  assert.match(component, /Commit: \$\{BUILD_INFORMATION\.commitSha\}\\nBuild time: \$\{BUILD_INFORMATION\.builtAt\}/u);
  assert.match(component, /<time dateTime=\{BUILD_INFORMATION\.builtAt\}>\{BUILD_INFORMATION\.builtAt\}<\/time>/u);
  assert.equal([...component.matchAll(/id="build-information-heading"/gu)].length, 1);
  assert.doesNotMatch(
    `${viteConfig}\n${buildContract}\n${clientBoundary}\n${component}`,
    /["'`][0-9a-f]{7,40}["'`]/iu,
  );

  const buildCardSource = component.slice(
    component.indexOf("function BuildInformationCard"),
    component.indexOf("function WhoHasAccessCard"),
  );
  assert.doesNotMatch(
    buildCardSource,
    /\bfetch\(|update check|new version available|telemetry|https?:\/\//iu,
  );
});

test("SET-39 renders its label in exactly one application source file and does not move it into global chrome", async () => {
  const typeScriptFiles = await applicationTypeScriptFiles(new URL("app/", rootUrl));
  const matches = [];

  for (const fileUrl of typeScriptFiles) {
    const source = await readFile(fileUrl, "utf8");
    if (source.includes("Build identifier unavailable")) {
      matches.push(fileUrl.pathname.replace(rootUrl.pathname, ""));
    }
  }

  assert.deepEqual(matches, [componentPath]);
});
