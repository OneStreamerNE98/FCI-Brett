import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const TEST_CLIENT = "FCI TEST — DO NOT USE — Imported Client";
const TEST_PROJECT = "FCI TEST — DO NOT USE — Imported Project";
const IMPORT_SOURCE_KEY = "first-run-import";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  });
}

async function routeDirectoryMirror(page: Page) {
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => fulfillJson(route, {
    mirror: {
      configured: true,
      enabled: true,
      connected: true,
      spreadsheetUrl: null,
      spreadsheetName: "Simulated Client Directory",
      clients: { status: "synced", lastSyncedAt: null, lastError: null },
      projects: { status: "synced", lastSyncedAt: null, lastError: null },
      lastSyncedAt: null,
      reason: null,
      source: "none",
    },
  }));
}

test("SET-25 simulation UI reviews clients before projects and confirms only selected fixture rows", async ({ page }) => {
  const previewBodies: unknown[] = [];
  const confirmBodies: unknown[] = [];
  let clientCount = 0;
  let projectCount = 0;

  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: clientCount, projects: projectCount },
    recordsExist: clientCount + projectCount > 0,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: IMPORT_SOURCE_KEY,
      name: "FCI TEST — DO NOT USE — First-run import",
      ready: true,
    }],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", async (route) => {
    const body = route.request().postDataJSON() as {
      entity: "clients" | "projects";
      source: { kind: "spreadsheet"; spreadsheetKey: string };
    };
    previewBodies.push(body);
    if (body.entity === "clients") {
      await fulfillJson(route, {
        entity: "clients",
        source: body.source,
        rows: [
          {
            rowKey: "clients:2",
            rowNumber: 2,
            state: "ready",
            reasons: [],
            values: {
              name: TEST_CLIENT,
              code: "SOURCE-CLIENT-1",
              codeDisposition: "import-alias",
              status: "active",
              industry: "Residential",
              primaryContact: "SET-25 Contact",
              email: "set25-client@example.test",
              phone: "856-555-0101",
              address: "25 FCI TEST — DO NOT USE Way",
            },
          },
          {
            rowKey: "clients:3",
            rowNumber: 3,
            state: "duplicate",
            reasons: ["Email matches a saved client."],
            values: {
              name: "FCI TEST — DO NOT USE — Existing Client",
              codeDisposition: "system-assigned",
              status: "active",
              email: "existing@example.test",
            },
          },
        ],
        summary: { total: 2, ready: 1, duplicates: 1 },
        clientOptions: [],
        clientOptionsTruncated: false,
      });
      return;
    }
    await fulfillJson(route, {
      entity: "projects",
      source: body.source,
      rows: [
        {
          rowKey: "projects:2",
          rowNumber: 2,
          state: "unmatched-client",
          reasons: ["No saved client matches the source code, name, or email."],
          values: {
            name: TEST_PROJECT,
            clientCode: "SOURCE-CLIENT-1",
            clientName: TEST_CLIENT,
            clientEmail: "set25-client@example.test",
            site: "25 FCI TEST — DO NOT USE Way",
            status: "closeout",
            estimatedValue: 25000,
            flooringCategory: "mixed",
            squareFeet: 1000,
            contractValue: 24000,
            segmentSource: "awaiting-client-match",
            projectManager: "confirming-administrator",
          },
        },
        {
          rowKey: "projects:3",
          rowNumber: 3,
          state: "duplicate",
          reasons: ["Project name, client, and site match a saved project."],
          values: {
            name: "FCI TEST — DO NOT USE — Existing Project",
            clientName: TEST_CLIENT,
            site: "25 FCI TEST — DO NOT USE Way",
            status: "planning",
            segment: "residential",
            segmentSource: "derived-client-industry",
          },
          clientId: "imported-client-id",
          matchedClient: {
            id: "imported-client-id",
            code: "CL-SET25001",
            name: TEST_CLIENT,
            email: "set25-client@example.test",
            defaultSegment: "residential",
          },
        },
      ],
      summary: { total: 2, unmatched: 1, duplicates: 1 },
      clientOptions: [{
        id: "imported-client-id",
        code: "CL-SET25001",
        name: TEST_CLIENT,
        email: "set25-client@example.test",
        defaultSegment: "residential",
      }],
      clientOptionsTruncated: false,
    });
  });
  await page.route("**/api/v1/settings/first-run-import/confirm", async (route) => {
    const body = route.request().postDataJSON() as {
      entity: "clients" | "projects";
      rows: Array<{ rowKey: string; clientId?: string }>;
    };
    confirmBodies.push(body);
    if (body.entity === "clients") clientCount = 1;
    else projectCount = 1;
    await fulfillJson(route, {
      entity: body.entity,
      created: 1,
      duplicates: 0,
      rejected: 0,
      results: [{ rowKey: body.rows[0]?.rowKey, outcome: "created" }],
    });
  });

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Development test data only", { exact: true })).toBeVisible();
  await expect(card.getByText(/Real client and project data stays blocked until the WS-11 production acceptance gate passes/u)).toBeVisible();
  await expect(card.getByText("Batch limit: 10 rows per confirmation.", {
    exact: true,
  })).toBeVisible();
  const projectsStep = card.getByRole("button", { name: /^2 · Projects/u });
  await expect(projectsStep).toBeDisabled();

  await card.getByRole("button", { name: "Preview clients" }).click();
  await expect(card.getByRole("heading", { name: "Review clients from Workspace import spreadsheet" })).toBeVisible();
  await expect(card.getByText(TEST_CLIENT, { exact: true })).toBeVisible();
  await expect(card.getByText(/Status: active · Industry: Residential · Primary contact: SET-25 Contact/u)).toBeVisible();
  await expect(card.getByText(/Address \(duplicate review; readable value not saved\): 25 FCI TEST/u)).toBeVisible();
  await expect(card.getByText("Duplicate", { exact: true })).toBeVisible();
  await expect(card.getByLabel(`Import ${TEST_CLIENT}`)).toBeEnabled();
  await expect(card.getByLabel("Import FCI TEST — DO NOT USE — Existing Client")).toBeDisabled();

  await card.getByRole("button", { name: "Select all ready" }).click();
  await expect(card.getByText("1 of 1 eligible rows selected", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Confirm selected clients", exact: true }).click();
  await expect(card.getByText("Client confirmation complete", { exact: true })).toBeVisible();
  await expect(projectsStep).toHaveAttribute("aria-current", "step");

  await card.getByRole("button", { name: "Preview projects" }).click();
  await expect(card.getByRole("heading", { name: "Review projects from Workspace import spreadsheet" })).toBeVisible();
  await expect(card.getByText(
    `Client references: code SOURCE-CLIENT-1 · name ${TEST_CLIENT} · email set25-client@example.test · Spreadsheet row 2`,
    { exact: true },
  )).toBeVisible();
  await expect(card.getByLabel(`Import ${TEST_PROJECT}`)).toBeDisabled();
  await card.getByLabel(`Match ${TEST_PROJECT} to saved client`).selectOption("imported-client-id");
  await expect(card.getByText(
    /No saved client matches the source code, name, or email\. Reviewed override:/u,
  )).toBeVisible();
  await expect(card.getByText(/Contract value: \$24,000 · Segment: residential \(derived from client industry\)/u)).toBeVisible();
  await expect(card.getByLabel(`Import ${TEST_PROJECT}`)).toBeEnabled();
  await card.getByLabel(`Import ${TEST_PROJECT}`).check();
  await card.getByRole("button", { name: "Confirm selected projects", exact: true }).click();
  await expect(card.getByText("Project confirmation complete", { exact: true })).toBeVisible();
  const confirmationStatus = card.locator('[role="status"]');
  await expect(confirmationStatus).toHaveCount(1);
  await expect(confirmationStatus).toHaveText("1 created, 0 duplicates, and 0 rejected.");
  await expect(card.getByRole("button", { name: "Reopen import tools" })).toBeFocused();
  await expect(card.getByRole("button", { name: "Preview projects" })).not.toBeVisible();

  expect(previewBodies).toEqual([
    {
      entity: "clients",
      source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
    },
    {
      entity: "projects",
      source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
    },
  ]);
  expect(confirmBodies).toEqual([
    {
      entity: "clients",
      source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
      rows: [{ rowKey: "clients:2" }],
    },
    {
      entity: "projects",
      source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
      rows: [{
        rowKey: "projects:2",
        clientId: "imported-client-id",
        effectiveSegment: "residential",
      }],
    },
  ]);
});

test("SET-25 refreshes imported records after confirmation even when the import card unmounts", async ({ page }) => {
  let confirmed = false;
  let clientReads = 0;
  let documentRequests = 0;
  let releaseInitialClientRead = () => {};
  let releaseConfirmation = () => {};
  let markConfirmationStarted = () => {};
  const initialClientReadGate = new Promise<void>((resolve) => {
    releaseInitialClientRead = resolve;
  });
  const confirmationGate = new Promise<void>((resolve) => {
    releaseConfirmation = resolve;
  });
  const confirmationStarted = new Promise<void>((resolve) => {
    markConfirmationStarted = resolve;
  });
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });

  await routeDirectoryMirror(page);
  await page.route("**/api/v1/leads", (route) => fulfillJson(route, { leads: [] }));
  await page.route("**/api/v1/projects", (route) => fulfillJson(route, { projects: [] }));
  await page.route("**/api/v1/dashboard", (route) => fulfillJson(route, {}));
  await page.route("**/api/v1/clients", async (route) => {
    clientReads += 1;
    if (clientReads === 1) await initialClientReadGate;
    await fulfillJson(route, {
      clients: confirmed
        ? [{
            id: "imported-client-id",
            client_code: "CL-SET25001",
            name: TEST_CLIENT,
            status: "active",
            industry: "Residential",
            primary_contact_name: "SET-25 Contact",
            primary_contact_email: "set25-client@example.test",
          }]
        : [],
    });
  });
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 0, projects: 0 },
    recordsExist: false,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: IMPORT_SOURCE_KEY,
      name: "FCI TEST — DO NOT USE — First-run import",
      ready: true,
    }],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", (route) => fulfillJson(route, {
    entity: "clients",
    source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
    rows: [{
      rowKey: "clients:2:refresh",
      rowNumber: 2,
      state: "ready",
      reasons: [],
      values: {
        name: TEST_CLIENT,
        codeDisposition: "system-assigned",
        status: "active",
        industry: "Residential",
      },
    }],
    summary: { total: 1, ready: 1 },
    clientOptions: [],
    clientOptionsTruncated: false,
  }));
  await page.route("**/api/v1/settings/first-run-import/confirm", async (route) => {
    markConfirmationStarted();
    await confirmationGate;
    confirmed = true;
    await fulfillJson(route, {
      entity: "clients",
      created: 1,
      duplicates: 0,
      rejected: 0,
      results: [{ rowKey: "clients:2:refresh", outcome: "created" }],
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  await card.getByRole("button", { name: "Preview clients" }).click();
  await card.getByLabel(`Import ${TEST_CLIENT}`).check();
  await card.getByRole("button", { name: "Confirm selected clients", exact: true }).click();
  await confirmationStarted;

  await page.getByRole("link", { name: /^Clients ·/u }).click();
  await expect(page).toHaveURL(/\/clients$/u);
  releaseConfirmation();
  await expect(page.getByText(TEST_CLIENT, { exact: true })).toBeVisible();
  expect(clientReads).toBeGreaterThanOrEqual(2);

  releaseInitialClientRead();
  await expect(page.getByText(TEST_CLIENT, { exact: true })).toBeVisible();
  expect(documentRequests).toBe(1);
});

test("SET-25 keeps Projects locked when a client confirmation creates only duplicates", async ({ page }) => {
  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 0, projects: 0 },
    recordsExist: false,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: IMPORT_SOURCE_KEY,
      name: "FCI TEST — DO NOT USE — First-run import",
      ready: true,
    }],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", (route) => fulfillJson(route, {
    entity: "clients",
    source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
    rows: [{
      rowKey: "clients:2:duplicate-race",
      rowNumber: 2,
      state: "ready",
      reasons: [],
      values: { name: TEST_CLIENT, code: "SOURCE-CLIENT-1" },
    }],
    summary: { total: 1, ready: 1 },
    clientOptions: [],
    clientOptionsTruncated: false,
  }));
  await page.route("**/api/v1/settings/first-run-import/confirm", (route) => fulfillJson(route, {
    entity: "clients",
    created: 0,
    duplicates: 1,
    rejected: 0,
    results: [{
      rowKey: "clients:2:duplicate-race",
      outcome: "duplicate",
    }],
  }));

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  const clientStep = card.getByRole("button", { name: /^1 · Clients/u });
  const projectsStep = card.getByRole("button", { name: /^2 · Projects/u });
  await card.getByRole("button", { name: "Preview clients" }).click();
  await card.getByRole("button", { name: "Select all ready" }).click();
  await card.getByRole("button", { name: "Confirm selected clients", exact: true }).click();

  await expect(card.getByText("Client confirmation complete", { exact: true })).toBeVisible();
  await expect(card.getByText("0 created · 1 duplicates skipped · 0 rejected", { exact: true })).toBeVisible();
  await expect(projectsStep).toBeDisabled();
  await expect(projectsStep).toContainText("Unlocks after at least one client is saved.");
  await expect(clientStep).toHaveAttribute("aria-current", "step");
});

test("SET-25 discards a delayed preview after its selected source is invalidated", async ({ page }) => {
  let releasePreview = () => {};
  let markPreviewStarted = () => {};
  const previewRelease = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  const previewStarted = new Promise<void>((resolve) => {
    markPreviewStarted = resolve;
  });

  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 0, projects: 0 },
    recordsExist: false,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: "first-import",
      name: "First import source",
      ready: true,
    }, {
      key: "second-import",
      name: "Second import source",
      ready: true,
    }],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", async (route) => {
    markPreviewStarted();
    await previewRelease;
    await fulfillJson(route, {
      entity: "clients",
      source: { kind: "spreadsheet", spreadsheetKey: "first-import" },
      rows: [{
        rowKey: "clients:2:stale",
        rowNumber: 2,
        state: "ready",
        reasons: [],
        values: { name: "FCI TEST — DO NOT USE — stale preview" },
      }],
      summary: { total: 1, ready: 1 },
      clientOptions: [],
      clientOptionsTruncated: false,
    });
  });

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  await card.getByRole("button", { name: "Preview clients" }).click();
  await previewStarted;

  const spreadsheetSelect = card.getByLabel("Import spreadsheet");
  // The UI intentionally locks source controls during a request. Removing only
  // the DOM attribute lets this test exercise the generation fence as if a
  // source change raced the response; React's real onChange path still runs.
  await spreadsheetSelect.evaluate((element) => element.removeAttribute("disabled"));
  await spreadsheetSelect.selectOption("second-import");
  releasePreview();

  await expect(card.getByText("Ready: Second import source.", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("heading", {
      name: "Review clients from Workspace import spreadsheet",
    }),
  ).not.toBeVisible();
  await expect(card.getByText("FCI TEST — DO NOT USE — stale preview", { exact: true })).not.toBeVisible();
  await expect(card.getByRole("button", { name: "Preview clients" })).toBeEnabled();
});

test("SET-25 clears a reviewed CSV before a slow, oversize, or unreadable replacement can reuse it", async ({ page }) => {
  let confirmCalls = 0;
  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 0, projects: 0 },
    recordsExist: false,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", async (route) => {
    const body = route.request().postDataJSON() as {
      entity: "clients";
      source: { kind: "csv"; fileName: string };
    };
    await fulfillJson(route, {
      entity: "clients",
      source: { kind: "csv", fileName: body.source.fileName },
      rows: [{
        rowKey: `clients:2:${body.source.fileName}`,
        rowNumber: 2,
        state: "ready",
        reasons: [],
        values: { name: TEST_CLIENT },
      }],
      summary: { total: 1, ready: 1 },
      clientOptions: [],
      clientOptionsTruncated: false,
    });
  });
  await page.route("**/api/v1/settings/first-run-import/confirm", (route) => {
    confirmCalls += 1;
    return fulfillJson(route, {
      entity: "clients",
      created: 1,
      duplicates: 0,
      rejected: 0,
      results: [],
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  await card.getByRole("radio", { name: /CSV file/u }).check();
  const csvInput = card.getByLabel("Clients CSV file");
  const originalCsv = {
    name: "reviewed-a.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Client Code,Client / Company\nA,FCI TEST — DO NOT USE — A"),
  };
  const prepareReviewedA = async () => {
    await csvInput.setInputFiles(originalCsv);
    await card.getByRole("button", { name: "Preview clients" }).click();
    await card.getByRole("button", { name: "Select all ready" }).click();
    await expect(
      card.getByRole("button", { name: "Confirm selected clients", exact: true }),
    ).toBeEnabled();
  };

  await prepareReviewedA();
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    let releaseSlow: (() => void) | null = null;
    File.prototype.text = function set25FileText() {
      if (this.name === "slow-b.csv") {
        return new Promise<string>((resolve) => {
          releaseSlow = () => resolve(
            "Client Code,Client / Company\nB,FCI TEST — DO NOT USE — B",
          );
        });
      }
      if (this.name === "unreadable-c.csv") {
        return Promise.reject(new Error("SET-25 unreadable fixture"));
      }
      return originalText.call(this);
    };
    Object.assign(window, {
      __releaseSet25SlowCsv: () => releaseSlow?.(),
    });
  });

  await csvInput.setInputFiles({
    name: "slow-b.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("slow fixture"),
  });
  await expect(card.getByText("Reading the selected file…", { exact: true })).toBeVisible();
  await expect(card.getByText(TEST_CLIENT, { exact: true })).not.toBeVisible();
  await expect(
    card.getByRole("button", { name: "Confirm selected clients", exact: true }),
  ).not.toBeVisible();
  expect(confirmCalls).toBe(0);
  await page.evaluate(() => {
    const release = (window as Window & {
      __releaseSet25SlowCsv?: () => void;
    }).__releaseSet25SlowCsv;
    release?.();
  });
  await expect(card.getByText("Selected: slow-b.csv", { exact: true })).toBeVisible();

  await prepareReviewedA();
  await csvInput.setInputFiles({
    name: "oversize-b.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(256_001, 65),
  });
  await expect(
    card.getByText("Choose a CSV file no larger than 256 KB.", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText(TEST_CLIENT, { exact: true })).not.toBeVisible();
  await expect(
    card.getByRole("button", { name: "Confirm selected clients", exact: true }),
  ).not.toBeVisible();
  expect(confirmCalls).toBe(0);

  await prepareReviewedA();
  await csvInput.setInputFiles({
    name: "unreadable-c.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("unreadable fixture"),
  });
  await expect(
    card.getByText("That CSV file could not be read. Choose the file again.", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText(TEST_CLIENT, { exact: true })).not.toBeVisible();
  await expect(
    card.getByRole("button", { name: "Confirm selected clients", exact: true }),
  ).not.toBeVisible();
  expect(confirmCalls).toBe(0);
});

test("SET-25 gives every unmatched project a uniquely described client-match control", async ({ page }) => {
  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 1, projects: 0 },
    recordsExist: false,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: IMPORT_SOURCE_KEY,
      name: "FCI TEST — DO NOT USE — First-run import",
      ready: true,
    }],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", (route) => fulfillJson(route, {
    entity: "projects",
    source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
    rows: [{
      rowKey: "projects:2:first",
      rowNumber: 2,
      state: "unmatched-client",
      reasons: ["First project needs a saved client."],
      values: { name: "FCI TEST — DO NOT USE — First unmatched project" },
    }, {
      rowKey: "projects:3:second",
      rowNumber: 3,
      state: "unmatched-client",
      reasons: ["Second project needs a saved client."],
      values: { name: "FCI TEST — DO NOT USE — Second unmatched project" },
    }],
    summary: { total: 2, unmatchedClients: 2 },
    clientOptions: [{
      id: "client-one",
      code: "CL-ONE",
      name: "FCI TEST — DO NOT USE — Saved client",
      defaultSegment: "commercial",
    }],
    clientOptionsTruncated: false,
  }));

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  await card.getByRole("button", { name: /^2 · Projects/u }).click();
  await card.getByRole("button", { name: "Preview projects" }).click();

  const first = card.getByRole("combobox", {
    name: "Match FCI TEST — DO NOT USE — First unmatched project to saved client",
  });
  const second = card.getByRole("combobox", {
    name: "Match FCI TEST — DO NOT USE — Second unmatched project to saved client",
  });
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  const firstDescription = await first.getAttribute("aria-describedby");
  const secondDescription = await second.getAttribute("aria-describedby");
  expect(firstDescription).toBeTruthy();
  expect(secondDescription).toBeTruthy();
  expect(firstDescription).not.toBe(secondDescription);
  await expect(card.locator(`#${firstDescription}`)).toContainText(
    "First project needs a saved client.",
  );
  await expect(card.locator(`#${secondDescription}`)).toContainText(
    "Second project needs a saved client.",
  );
});

test("SET-25 binds a naturally matched project to the reviewed client and segment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let confirmedRows: unknown[] = [];
  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 1, projects: 0 },
    recordsExist: true,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: IMPORT_SOURCE_KEY,
      name: "FCI TEST — DO NOT USE — First-run import",
      ready: true,
    }],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", (route) => fulfillJson(route, {
    entity: "projects",
    source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
    rows: [{
      rowKey: "projects:2:natural",
      rowNumber: 2,
      state: "ready",
      reasons: [],
      values: {
        name: TEST_PROJECT,
        clientCode: "CL-NATURAL",
        status: "planning",
        segment: "residential",
        segmentSource: "derived-client-industry",
        projectManager: "confirming-administrator",
      },
      clientId: "client-natural",
      matchedClient: {
        id: "client-natural",
        code: "CL-NATURAL",
        name: TEST_CLIENT,
        defaultSegment: "residential",
      },
    }],
    summary: { total: 1, ready: 1 },
    clientOptions: [{
      id: "client-natural",
      code: "CL-NATURAL",
      name: TEST_CLIENT,
      defaultSegment: "residential",
    }],
    clientOptionsTruncated: false,
  }));
  await page.route("**/api/v1/settings/first-run-import/confirm", async (route) => {
    const body = route.request().postDataJSON() as { rows: unknown[] };
    confirmedRows = body.rows;
    await fulfillJson(route, {
      entity: "projects",
      created: 1,
      duplicates: 0,
      rejected: 0,
      results: [{ rowKey: "projects:2:natural", outcome: "created" }],
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  const reopen = card.getByRole("button", { name: "Reopen import tools" });
  await reopen.focus();
  await page.keyboard.press("Enter");
  const projectsStep = card.getByRole("button", { name: /^2 · Projects/u });
  await projectsStep.focus();
  await page.keyboard.press("Enter");
  const previewProjects = card.getByRole("button", { name: "Preview projects" });
  await previewProjects.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByText(`CL-NATURAL · ${TEST_CLIENT}`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  const importHeadingId = await card.getByRole("heading", {
    name: "First-run data import",
  }).getAttribute("id");
  expect(importHeadingId).toBeTruthy();
  const violations = (await new AxeBuilder({ page })
    .include(`section[aria-labelledby="${importHeadingId}"]`)
    .analyze()).violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(violations).toEqual([]);
  const projectSelection = card.getByLabel(`Import ${TEST_PROJECT}`);
  await projectSelection.focus();
  await page.keyboard.press("Space");
  const confirmProjects = card.getByRole("button", {
    name: "Confirm selected projects",
    exact: true,
  });
  await confirmProjects.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("button", { name: "Reopen import tools" })).toBeFocused();

  expect(confirmedRows).toEqual([{
    rowKey: "projects:2:natural",
    clientId: "client-natural",
    effectiveSegment: "residential",
  }]);
});

test("SET-25 hides the first-run tools when records exist and reopens a compact card explicitly", async ({ page }) => {
  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 12, projects: 7 },
    recordsExist: true,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: IMPORT_SOURCE_KEY,
      name: "FCI TEST — DO NOT USE — First-run import",
      ready: true,
    }],
  }));

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  await expect(card.getByText("12 clients", { exact: true })).toBeVisible();
  await expect(card.getByText("7 projects", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Preview clients" })).not.toBeVisible();
  await expect(card).toHaveCSS("min-height", "0px");

  await card.getByRole("button", { name: "Reopen import tools" }).click();
  await expect(
    card.getByRole("heading", { name: "Choose the clients source" }).locator(".."),
  ).toBeFocused();
  await expect(card.getByRole("button", { name: "Preview clients" })).toBeVisible();
});

test("SET-25 bounded client search reaches a client beyond the initial list and preserves the reviewed target", async ({ page }) => {
  const searchedQueries: string[] = [];
  let confirmedRows: unknown[] = [];
  await routeDirectoryMirror(page);
  await page.route("**/api/v1/settings/first-run-import", (route) => fulfillJson(route, {
    counts: { clients: 120, projects: 0 },
    recordsExist: true,
    realDataAllowed: false,
    batchLimit: 10,
    simulation: true,
    sources: [{
      key: IMPORT_SOURCE_KEY,
      name: "FCI TEST — DO NOT USE — First-run import",
      ready: true,
    }],
  }));
  await page.route("**/api/v1/settings/first-run-import/preview", (route) => fulfillJson(route, {
    entity: "projects",
    source: { kind: "spreadsheet", spreadsheetKey: IMPORT_SOURCE_KEY },
    rows: [{
      rowKey: "projects:2:search-target",
      rowNumber: 2,
      state: "unmatched-client",
      reasons: ["No saved client matches every supplied reference."],
      values: {
        name: TEST_PROJECT,
        clientCode: "LEGACY-120",
        status: "planning",
        segmentSource: "awaiting-client-match",
        projectManager: "confirming-administrator",
      },
    }],
    summary: { total: 1, unmatchedClients: 1 },
    clientOptions: [{
      id: "initial-client",
      code: "CL-INITIAL",
      name: "Initial saved client",
      defaultSegment: "commercial",
    }],
    clientOptionsTruncated: true,
  }));
  await page.route("**/api/v1/settings/first-run-import/clients?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    searchedQueries.push(query);
    if (query === "needle@example.test") {
      await fulfillJson(route, {
        query,
        results: [{
          id: "client-120",
          code: "CL-00000120",
          name: "FCI TEST — DO NOT USE — Needle client",
          email: "needle@example.test",
          defaultSegment: "residential",
        }],
        more: false,
      });
      return;
    }
    await fulfillJson(route, {
      query,
      results: Array.from({ length: 20 }, (_, index) => ({
        id: `${query}-${index}`,
        code: `CL-${query}-${index}`,
        name: `${query} saved client ${index}`,
        defaultSegment: "commercial",
      })),
      more: true,
    });
  });
  await page.route("**/api/v1/settings/first-run-import/confirm", async (route) => {
    const body = route.request().postDataJSON() as { rows: unknown[] };
    confirmedRows = body.rows;
    await fulfillJson(route, {
      entity: "projects",
      created: 1,
      duplicates: 0,
      rejected: 0,
      results: [],
    }, 201);
  });

  await page.goto("/settings?section=client-directory");
  const card = page.getByRole("region", { name: "First-run data import" });
  await card.getByRole("button", { name: "Reopen import tools" }).click();
  await card.getByRole("button", { name: /^2 · Projects/u }).click();
  await card.getByRole("button", { name: "Preview projects" }).click();
  await expect(card.getByText(/Segment: Choose a client to derive/u)).toBeVisible();
  await card.getByRole("searchbox", { name: "Find another saved client" }).fill("needle@example.test");
  await card.getByRole("button", { name: "Search saved clients" }).click();
  await expect(card.getByText(/1 saved client added to the client-match choices/u)).toBeVisible();

  const clientMatch = card.getByLabel(`Match ${TEST_PROJECT} to saved client`);
  await clientMatch.selectOption("client-120");
  await expect(card.getByText(/Will import under CL-00000120 · FCI TEST — DO NOT USE — Needle client/u)).toBeVisible();
  await expect(card.getByText(/Segment: residential \(derived from client industry\)/u)).toBeVisible();

  for (let batch = 0; batch < 6; batch += 1) {
    const query = `batch-${batch}`;
    await card.getByRole("searchbox", { name: "Find another saved client" }).fill(query);
    await card.getByRole("button", { name: "Search saved clients" }).click();
    await expect(card.getByText(/20 saved clients added to the client-match choices/u)).toBeVisible();
  }
  await expect(clientMatch.locator('option[value="client-120"]')).toHaveCount(1);
  await expect(clientMatch).toHaveValue("client-120");

  await card.getByLabel(`Import ${TEST_PROJECT}`).check();
  await card.getByRole("button", { name: "Confirm selected projects", exact: true }).click();
  expect(confirmedRows).toEqual([{
    rowKey: "projects:2:search-target",
    clientId: "client-120",
    effectiveSegment: "residential",
  }]);
  expect(searchedQueries).toEqual([
    "needle@example.test",
    "batch-0",
    "batch-1",
    "batch-2",
    "batch-3",
    "batch-4",
    "batch-5",
  ]);
});
