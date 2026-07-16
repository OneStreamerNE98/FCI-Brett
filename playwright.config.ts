import { defineConfig, devices } from "@playwright/test";

const testUserEmail = "e2e-admin@example.test";
const browserUserEmail = process.env.FCI_LOCAL_DEV_USER_EMAIL ?? testUserEmail;
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "work/playwright-results",
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "work/playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "work/playwright-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    extraHTTPHeaders: {
      "oai-authenticated-user-email": browserUserEmail,
      "oai-authenticated-user-full-name": encodeURIComponent("E2E Admin"),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:4173/manifest.webmanifest",
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...inheritedEnvironment,
      FCI_E2E: "true",
      FCI_LOCAL_DEV_USER_EMAIL: process.env.FCI_LOCAL_DEV_USER_EMAIL ?? testUserEmail,
      FCI_OFFICE_EMAILS: process.env.FCI_OFFICE_EMAILS ?? `${testUserEmail},e2e-office@example.test`,
      FCI_ADMIN_EMAILS: process.env.FCI_ADMIN_EMAILS ?? testUserEmail,
      GOOGLE_INTEGRATION_MODE: "simulation",
      WRANGLER_LOG_PATH: ".wrangler/playwright.log",
    },
  },
});
