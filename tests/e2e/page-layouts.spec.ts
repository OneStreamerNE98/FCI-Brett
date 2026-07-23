import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

// Pre-SET-35 section markup captured from origin/main with the deterministic
// record fixtures below, so earlier specs cannot change these signatures.
const OVERVIEW_LEGACY_SECTIONS_SHA256 = "4b986d4991865fb3be4192888bf8dd44e64ef6c4aa7f43ec0f8b2028a7e1fa13";
const REPORTS_LEGACY_SECTIONS_SHA256 = "f82508fa7313a8521acef8bfa0c8466256fe761bc6ee58158d6431acecb8d78e";

const legacyRecordFixtures = {
  leads: { leads: [] },
  clients: {
    clients: [{
      id: "e2e-client-001",
      client_code: "E2E-CLIENT",
      name: "E2E Regression Client",
      status: "active",
      industry: "Commercial",
      primary_contact_name: "E2E Primary Contact",
      primary_contact_email: "contact@example.test",
    }],
  },
  projects: {
    projects: [{
      id: "e2e-project-001",
      project_number: "CF-2026-E2E00001",
      client_id: "e2e-client-001",
      client_name: "E2E Regression Client",
      name: "E2E Mobile Metadata Project",
      status: "mobilizing",
      site: "201 E2E Test Ave, Cherry Hill, NJ",
      project_manager_id: "e2e-admin@example.test",
      estimated_value: 125_000,
      flooring_category: "luxury-vinyl",
      square_feet: 5_000,
      contract_value: 132_500,
      installation_started_at: null,
      installation_completed_at: null,
      had_callback: 0,
      callback_note: null,
      created_at: 1_783_900_800_000,
      updated_at: 1_783_900_800_000,
    }],
  },
  dashboard: {
    generatedAt: 1_783_900_800_000,
    metrics: { activeLeads: 0, estimatedPipelineValue: 0, activeProjects: 1, clientCount: 1, meetingCount: 0, filedEmailCount: 0 },
    projectsByStatus: [{ status: "mobilizing", count: 1 }],
    recentActivity: [],
    readiness: { scheduleDataAvailable: false, reportsUseLiveProjectLeadTotals: true },
  },
} as const;

type StoredPreferences = {
  displayTimezone: string;
  replySignature: string;
  notificationPreferences: Record<string, boolean>;
  pageLayouts: {
    overview: { order: string[]; hidden: string[] };
    reports: { order: string[]; hidden: string[] };
  };
};

async function mockLegacySectionRecords(page: Page) {
  for (const [resource, body] of Object.entries(legacyRecordFixtures)) {
    await page.route(`**/api/v1/${resource}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
  }
}

async function readStoredPreferences(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/settings/me", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Could not read page layouts (${response.status}).`);
    return (await response.json() as { preferences: StoredPreferences }).preferences;
  });
}

async function restoreStoredPreferences(page: Page, preferences: StoredPreferences) {
  await page.evaluate(async (savedPreferences) => {
    const response = await fetch("/api/v1/settings/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(savedPreferences),
    });
    if (!response.ok) throw new Error(`Could not restore page layouts (${response.status}).`);
  }, preferences);
}

async function arrangedSectionOrder(page: Page) {
  return page.locator("[data-page-layout-section]").evaluateAll((sections) => sections.map((section) => section.getAttribute("data-page-layout-section")));
}

async function overviewLegacyMarkup(page: Page) {
  return page.evaluate(() => {
    const sections = [document.querySelector(".metrics-grid"), ...document.querySelectorAll(".dashboard-grid")];
    if (sections.some((section) => !section)) throw new Error("The legacy Overview section structure is incomplete.");
    return sections.map((section) => section?.outerHTML).join("");
  });
}

async function reportsLegacyMarkup(page: Page) {
  return page.evaluate(() => {
    const futureReports = [...document.querySelectorAll(".client-directory-banner")]
      .find((section) => section.textContent?.includes("More reports will appear"));
    const sections = [
      document.querySelector(".metrics-grid"),
      document.querySelector(".business-kpis"),
      document.querySelector(".reports-grid"),
      futureReports,
    ];
    if (sections.some((section) => !section)) throw new Error("The legacy Reports section structure is incomplete.");
    return sections.map((section) => section?.outerHTML).join("");
  });
}

function legacyDigest(markup: string) {
  return createHash("sha256").update(markup).digest("hex");
}

async function waitForLiveRecords(page: Page) {
  await expect(page.getByText("Loading live records", { exact: true })).toHaveCount(0);
}

test("keyboard-only Overview reorder and hide persist, while Reset restores byte-identical default sections", async ({ page }) => {
  test.skip(process.env.FCI_E2E_EXTERNAL_SERVER === "true", "Persistence requires the isolated local simulation database.");
  await mockLegacySectionRecords(page);
  await page.goto("/");
  const editLayout = page.getByRole("button", { name: "Edit Overview layout" });
  await expect(editLayout).toBeEnabled();
  await expect(editLayout).toHaveAttribute("title", "Edit Overview layout");
  await expect(editLayout).toHaveText("");
  const originalPreferences = await readStoredPreferences(page);

  try {
    await restoreStoredPreferences(page, {
      ...originalPreferences,
      pageLayouts: {
        ...originalPreferences.pageLayouts,
        overview: { order: ["metrics", "lead-pipeline", "scheduling", "active-projects", "gmail-project-inbox"], hidden: [] },
      },
    });
    await page.reload();
    await expect(editLayout).toBeEnabled();
    await waitForLiveRecords(page);
    const defaultMarkup = await overviewLegacyMarkup(page);
    expect(legacyDigest(defaultMarkup)).toBe(OVERVIEW_LEGACY_SECTIONS_SHA256);

    await editLayout.focus();
    await expect(editLayout).toBeFocused();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("region", { name: "Overview layout editor" });
    await expect(editor).toBeVisible();
    await expect(editor.locator('[data-layout-add-section="true"]')).toHaveCount(0);
    await expect(editor.getByText("Hidden sections", { exact: true })).toHaveCount(0);
    await expect(editor.getByText("Add section", { exact: true })).toHaveCount(0);

    const moveSchedulingUp = page.getByRole("button", { name: "Move Scheduling up" });
    await moveSchedulingUp.focus();
    await expect(moveSchedulingUp).toBeFocused();
    await page.keyboard.press("Enter");
    const hideInbox = page.getByRole("button", { name: "Hide Gmail project inbox" });
    await hideInbox.focus();
    await page.keyboard.press("Enter");
    const addInbox = editor.locator('[data-layout-add-section="true"]').getByRole("button", { name: /Gmail project inbox/u });
    await expect(addInbox).toBeVisible();
    await expect(addInbox).toBeFocused();
    await expect(editor.getByText("Hidden sections", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(addInbox).toHaveCount(0);
    await expect(editor.getByText("Hidden sections", { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-layout-section="gmail-project-inbox"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide Gmail project inbox" })).toBeFocused();
    await page.keyboard.press("Enter");

    const done = editor.getByRole("button", { name: "Done" });
    await done.focus();
    await page.keyboard.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(editLayout).toBeFocused();
    await expect.poll(() => arrangedSectionOrder(page)).toEqual(["metrics", "scheduling", "lead-pipeline", "active-projects"]);

    await page.reload();
    await expect(editLayout).toBeEnabled();
    await expect.poll(() => arrangedSectionOrder(page)).toEqual(["metrics", "scheduling", "lead-pipeline", "active-projects"]);

    await editLayout.focus();
    await page.keyboard.press("Enter");
    const resetEditor = page.getByRole("region", { name: "Overview layout editor" });
    const reset = resetEditor.getByRole("button", { name: "Reset to default" });
    await reset.focus();
    await page.keyboard.press("Enter");
    const resetDone = resetEditor.getByRole("button", { name: "Done" });
    await resetDone.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator(".page-layout-grid-overview")).toHaveCount(0);
    await expect(page.locator(".dashboard-grid")).toHaveCount(2);
    expect(await overviewLegacyMarkup(page)).toBe(defaultMarkup);
    await expect(editLayout).toBeFocused();
  } finally {
    await restoreStoredPreferences(page, originalPreferences).catch(() => undefined);
  }
});

test("Reports supports native drag, hide persistence, and reset to its legacy default grouping", async ({ page }) => {
  test.skip(process.env.FCI_E2E_EXTERNAL_SERVER === "true", "Persistence requires the isolated local simulation database.");
  await mockLegacySectionRecords(page);
  await page.goto("/reports");
  const editLayout = page.getByRole("button", { name: "Edit Reports layout" });
  await expect(editLayout).toBeEnabled();
  const originalPreferences = await readStoredPreferences(page);

  try {
    await restoreStoredPreferences(page, {
      ...originalPreferences,
      pageLayouts: {
        ...originalPreferences.pageLayouts,
        reports: { order: ["summary-metrics", "business-kpis", "pipeline-by-stage", "projects-by-status", "future-reports"], hidden: [] },
      },
    });
    await page.reload();
    await expect(editLayout).toBeEnabled();
    await waitForLiveRecords(page);
    const monthInput = page.getByLabel("Reporting month");
    await monthInput.fill("2026-07");
    const defaultMarkup = await reportsLegacyMarkup(page);
    expect(legacyDigest(defaultMarkup)).toBe(REPORTS_LEGACY_SECTIONS_SHA256);
    await monthInput.fill("2025-12");

    await editLayout.click();
    const editor = page.getByRole("region", { name: "Reports layout editor" });
    await expect(editor).toBeVisible();
    await expect(monthInput).toHaveValue("2025-12");
    await page.locator('[data-layout-drag-handle="projects-by-status"]').dragTo(page.locator('[data-layout-section="pipeline-by-stage"]'));
    // Chromium's pointer helper cannot keep a drag alive while auto-scrolling
    // this tall KPI page, so dispatch the same native HTML5 event sequence to
    // mutation-pin the explicit trailing drop target.
    await page.evaluate(() => {
      const source = document.querySelector<HTMLElement>('[data-layout-drag-handle="summary-metrics"]');
      const target = document.querySelector<HTMLElement>('[data-layout-drop-end="reports"]');
      if (!source || !target) throw new Error("The Reports drag endpoints are missing.");
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    });
    await expect.poll(() => arrangedSectionOrder(page)).toEqual(["business-kpis", "projects-by-status", "pipeline-by-stage", "future-reports", "summary-metrics"]);
    await page.getByRole("button", { name: "Hide Future reports" }).click();
    await editor.getByRole("button", { name: "Done" }).click();
    await expect(editLayout).toBeFocused();
    await expect(monthInput).toHaveValue("2025-12");
    await expect.poll(() => arrangedSectionOrder(page)).toEqual(["business-kpis", "projects-by-status", "pipeline-by-stage", "summary-metrics"]);

    await page.evaluate(() => window.history.replaceState({ ...(window.history.state ?? {}), fciReportsReturnFocusId: "report-project-mobilizing" }, "", window.location.href));
    await page.reload();
    await expect(editLayout).toBeEnabled();
    await expect.poll(() => arrangedSectionOrder(page)).toEqual(["business-kpis", "projects-by-status", "pipeline-by-stage", "summary-metrics"]);
    await expect(page.getByRole("link", { name: /View Mobilizing projects/u })).toBeFocused();
    await editLayout.click();
    const resetEditor = page.getByRole("region", { name: "Reports layout editor" });
    await resetEditor.getByRole("button", { name: "Reset to default" }).click();
    await resetEditor.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".page-layout-grid-reports")).toHaveCount(0);
    await expect(page.locator(".reports-grid")).toHaveCount(1);
    // Compare fresh default renders so React hydration comment markers are present
    // on both sides of this byte-for-byte legacy-markup assertion.
    await page.reload();
    await expect(editLayout).toBeEnabled();
    await waitForLiveRecords(page);
    await page.getByLabel("Reporting month").fill("2026-07");
    expect(await reportsLegacyMarkup(page)).toBe(defaultMarkup);
  } finally {
    await restoreStoredPreferences(page, originalPreferences).catch(() => undefined);
  }
});

test("Office layout controls expose only viewable parent panels and remain accessible at desktop and mobile", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.goto("/reports");
  await waitForLiveRecords(page);
  await page.getByRole("button", { name: "Edit Reports layout" }).click();
  const editor = page.getByRole("region", { name: "Reports layout editor" });
  await expect(editor).toBeVisible();

  for (const financialChild of ["Pipeline value", "Booked value", "Average job value", "Revenue per sq ft", "Estimate accuracy"]) {
    await expect(page.getByRole("button", { name: new RegExp(`(?:Hide|Move|Add) ${financialChild}`, "iu") })).toHaveCount(0);
  }
  await expect(page.getByText("Administrator only", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Hide Business KPIs" }).click();
  const addBusinessKpis = editor.locator('[data-layout-add-section="true"]').getByRole("button", { name: /Business KPIs/u });
  await expect(addBusinessKpis).toBeVisible();
  await expect(addBusinessKpis).toBeFocused();
  await page.getByRole("button", { name: "Hide Pipeline by stage" }).click();
  await page.getByRole("button", { name: "Hide Projects by status" }).click();
  await page.getByRole("button", { name: "Hide Future reports" }).click();
  await expect(editor.locator('[data-layout-add-section="true"] button')).toHaveCount(4);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
});

test("Overview and Reports share the icon-only Edit placement at desktop and mobile", async ({ page }) => {
  await mockLegacySectionRecords(page);

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const overviewEdit = page.getByRole("button", { name: "Edit Overview layout" });
    await expect(overviewEdit).toBeEnabled();
    await expect(overviewEdit).toHaveAttribute("title", "Edit Overview layout");
    await expect(overviewEdit).toHaveText("");
    await expect(overviewEdit.locator("xpath=..")).toHaveClass(/title-actions/u);
    const overviewBox = await overviewEdit.boundingBox();
    expect(overviewBox).not.toBeNull();
    expect(overviewBox?.width).toBeGreaterThanOrEqual(44);
    expect(overviewBox?.height).toBeGreaterThanOrEqual(44);

    await page.goto("/reports");
    const reportsEdit = page.getByRole("button", { name: "Edit Reports layout" });
    await expect(reportsEdit).toBeEnabled();
    await expect(reportsEdit).toHaveAttribute("title", "Edit Reports layout");
    await expect(reportsEdit).toHaveText("");
    await expect(reportsEdit.locator("xpath=..")).toHaveClass(/title-actions/u);
    const reportsBox = await reportsEdit.boundingBox();
    expect(reportsBox).not.toBeNull();
    expect(reportsBox?.width).toBeGreaterThanOrEqual(44);
    expect(reportsBox?.height).toBeGreaterThanOrEqual(44);

    const overviewRightEdge = (overviewBox?.x ?? 0) + (overviewBox?.width ?? 0);
    const reportsRightEdge = (reportsBox?.x ?? 0) + (reportsBox?.width ?? 0);
    expect(Math.abs(overviewRightEdge - reportsRightEdge)).toBeLessThanOrEqual(1);
  }
});

test("a failed settings read offers an explicit retry before layout editing", async ({ page }) => {
  let settingsReads = 0;
  await page.route("**/api/v1/settings/me", async (requestRoute) => {
    if (requestRoute.request().method() === "GET" && settingsReads++ === 0) {
      await requestRoute.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary" }) });
      return;
    }
    await requestRoute.continue();
  });
  await page.goto("/");
  const retry = page.getByRole("button", { name: "Retry Overview layout" });
  await expect(retry).toBeVisible();
  await expect(retry).toContainText("Retry layout");
  await retry.click();
  await expect(page.getByRole("button", { name: "Edit Overview layout" })).toBeEnabled();
});
