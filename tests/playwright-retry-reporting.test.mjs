import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const playwrightCli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const fixtureConfig = fileURLToPath(
  new URL("./fixtures/playwright-retry-only-pass/playwright.config.mjs", import.meta.url),
);

test("a spec that passes only on retry fails the Playwright run and is named in diagnostics", () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "fci-playwright-retry-"));

  try {
    const result = spawnSync(
      process.execPath,
      [playwrightCli, "test", "--config", fixtureConfig],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "",
          FCI_RETRY_REPORTER_FIXTURE_OUTPUT: outputDirectory,
        },
        timeout: 30_000,
      },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    assert.equal(result.signal, null, output);
    assert.equal(result.status, 1, output);
    assert.match(output, /forced retry-only pass is rejected by the reporter/);
    assert.match(output, /passed on retry 1; treating the run as failed/);
    assert.match(output, /1 retry-only pass surfaced/);
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
});
