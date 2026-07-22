import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const retryOnlyPassReporter = fileURLToPath(
  new URL("../../playwright/retry-only-pass-reporter.mjs", import.meta.url),
);

export default defineConfig({
  testDir: ".",
  testMatch: "forced-flaky.spec.mjs",
  retries: 1,
  workers: 1,
  outputDir: process.env.FCI_RETRY_REPORTER_FIXTURE_OUTPUT,
  reporter: [["list"], [retryOnlyPassReporter]],
});
