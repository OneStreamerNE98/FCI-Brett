import type { Page, test as PlaywrightTest } from "@playwright/test";

// Shared recovery for the ONE simulation workspace every e2e spec shares.
//
// playwright.config.ts runs a single worker against one web server and one
// database, and POST /api/v1/integrations/google/simulation/reset deletes the
// whole workspace_resources partition for the "workspace-simulation" connection
// (plus drive_folder_mappings and workspace_blueprints). resetWorkspaceSimulation()
// only re-seeds the Gmail/calendar blob — it never re-provisions the registry, and
// tests/e2e/fixtures/seed.sql runs once at server start, not between specs. So any
// spec that drives the REAL reset destroys state that later specs read as a
// precondition, and the damage leaks forward for the rest of the run.
//
// That is not hypothetical: it broke PR #206 once (recorded in
// docs/full-review-2026-07-24-findings.md) and again on 2026-07-28, where a full
// local run failed four workspace-setup-stepper tests and one accessibility test
// that all pass in isolation, while CI on the same commit failed a different spec.
//
// Every real reset must therefore be paired with recovery, and that recovery must be
// registered through registerSimulationResetRecovery below — NOT written as an in-test
// `finally`. A `finally` shares the test's own timeout budget, so a test that times out is
// abandoned before it runs, which is the one case where the registry most needs restoring.

// Exactly the three steps PR #206 landed and that specs downstream of a reset are
// known to tolerate. Deliberately NOT drive/templates/ensure: the seed baseline
// (tests/e2e/fixtures/seed.sql) provisions no templates, so ensuring them here
// would leave the registry MORE provisioned than any spec's precondition expects
// — a spec asserting a template reads "Not configured" would then see "Created".
// Restore the baseline; do not improve on it.
const RESTORE_STEPS = [
  // Order matters: both steps below need the Shared Drive adopted first.
  "/api/v1/integrations/google/drive/shared-drive/adopt",
  "/api/v1/integrations/google/drive/folders/ensure-roots",
  "/api/v1/integrations/google/sheets/ensure",
] as const;

/**
 * Re-provisions the simulation registry through the same real endpoints the
 * stepper creation journey uses, then verifies the app-managed client-directory
 * row is actually back. Throws rather than returning a value to check, so a
 * caller cannot forget to assert it.
 */
export async function restoreSimulationWorkspace(page: Page) {
  await page.evaluate(async (steps: readonly string[]) => {
    for (const url of steps) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        throw new Error(
          `simulation restore step ${url} failed: ${response.status} ${await response.text()}`,
        );
      }
    }
    const verify = await fetch("/api/v1/integrations/google/setup/resources");
    if (!verify.ok) {
      throw new Error(`simulation restore verification failed: ${verify.status}`);
    }
    const payload = await verify.json() as {
      resources: Array<{
        key: string;
        resourceType: string;
        source: string;
        origin?: string;
      }>;
    };
    const directory = payload.resources.find((resource) =>
      resource.resourceType === "sheets.spreadsheet"
      && resource.key === "client-directory"
    );
    if (!directory || directory.source !== "app" || directory.origin !== "created") {
      throw new Error(
        `simulation restore left the client-directory row unusable: ${JSON.stringify(directory ?? null)}`,
      );
    }
  }, RESTORE_STEPS);
}

/**
 * Registers teardown recovery for a spec file that drives the REAL reset.
 *
 * Recovery must NOT live in an in-test `finally`: that runs on the test's own
 * timeout budget (45s in playwright.config.ts), so a test that times out is
 * abandoned mid-body and the restore never happens — leaving the very wiped
 * registry this module exists to prevent. An `afterEach` hook gets a separate
 * teardown budget, so it still runs after a timeout.
 *
 * Call `markResetAttempted()` immediately BEFORE triggering a reset, so recovery
 * runs even if the click or a later assertion never returns, and so specs that
 * never reset pay nothing.
 */
export function registerSimulationResetRecovery(testApi: typeof PlaywrightTest) {
  let attempted = false;
  testApi.afterEach(async ({ page }) => {
    if (!attempted) return;
    attempted = false;
    await restoreSimulationWorkspace(page);
  });
  return { markResetAttempted: () => { attempted = true; } };
}

/** Reset to a known-empty simulation workspace, then re-provision it. */
export async function resetAndRestoreSimulationWorkspace(page: Page) {
  await page.evaluate(async () => {
    const response = await fetch("/api/v1/integrations/google/simulation/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) {
      throw new Error(
        `simulation reset failed: ${response.status} ${await response.text()}`,
      );
    }
  });
  await restoreSimulationWorkspace(page);
}
