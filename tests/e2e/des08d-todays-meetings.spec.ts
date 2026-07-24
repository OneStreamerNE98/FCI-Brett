import { expect, test, type Page } from "@playwright/test";

const project = {
  id: "des08d-project-001",
  project_number: "CF-2026-E2E00001",
  client_id: "des08d-client-001",
  client_name: "FCI TEST — DO NOT USE",
  name: "Today's meeting project",
  status: "mobilizing",
  site: "100 Test Lane, Cherry Hill, NJ",
  project_manager_id: "e2e-admin@example.test",
  estimated_value: 25_000,
  flooring_category: "luxury-vinyl",
  square_feet: 1_200,
  contract_value: 27_000,
  installation_started_at: null,
  installation_completed_at: null,
  had_callback: 0,
  callback_note: null,
  created_at: Date.UTC(2026, 6, 24, 12),
  updated_at: Date.UTC(2026, 6, 24, 12),
};

function dashboard(meetingCount = 8) {
  return {
    generatedAt: Date.UTC(2026, 6, 24, 12),
    metrics: {
      activeLeads: 0,
      estimatedPipelineValue: 0,
      activeProjects: 1,
      clientCount: 1,
      meetingCount,
      filedEmailCount: 0,
    },
    projectsByStatus: [{ status: "mobilizing", count: 1 }],
    recentActivity: [],
    todayMeetings: {
      items: Array.from({ length: Math.min(meetingCount, 5) }, (_, index) => ({
        id: `des08d-meeting-${index + 1}`,
        projectId: project.id,
        title: `Project check-in ${index + 1}`,
        meetingAt: Date.UTC(2026, 6, 24 + index, 14),
        projectNumber: project.project_number,
        projectName: project.name,
      })),
      total: meetingCount,
    },
    readiness: {
      scheduleDataAvailable: false,
      scheduleReason: "Scheduling is not available.",
      reportsUseLiveProjectLeadTotals: true,
    },
  };
}

async function mockOverview(page: Page, dashboardState: { value: ReturnType<typeof dashboard> }) {
  await page.route("**/api/v1/settings/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        isAdmin: true,
        preferences: {
          displayTimezone: "America/New_York",
          replySignature: "",
          notificationPreferences: {
            "lead.created": false,
            "gmail.filing_review_needed": false,
            "calendar.schedule_changed": false,
            "project.warranty_follow_up_due": false,
          },
          pageLayouts: {
            overview: {
              order: ["metrics", "todays-meetings", "lead-pipeline", "scheduling", "active-projects", "gmail-project-inbox"],
              hidden: [],
            },
            reports: {
              order: ["summary-metrics", "business-kpis", "pipeline-by-stage", "projects-by-status", "clients-by-industry", "future-reports"],
              hidden: [],
            },
          },
        },
      }),
    });
  });
  await page.route("**/api/v1/leads", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ leads: [] }) }));
  await page.route("**/api/v1/clients", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      clients: [{
        id: project.client_id,
        client_code: "DES08D",
        name: project.client_name,
        status: "active",
        industry: "Commercial",
        primary_contact_name: "Test contact",
        primary_contact_email: "contact@example.test",
      }],
    }),
  }));
  await page.route("**/api/v1/projects", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [project] }) }));
  await page.route("**/api/v1/dashboard", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardState.value) }));
  await page.route("**/api/v1/filing-rules", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [] }) }));
  await page.route("**/api/v1/integrations/google/sheets/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ mirror: null }) }));
}

test("Today's meetings is bounded, opens its project drawer, reports overflow, and has an honest empty state", async ({ page }) => {
  const dashboardState = { value: dashboard() };
  await mockOverview(page, dashboardState);
  await page.goto("/");

  const section = page.getByRole("heading", { name: "Today's meetings" }).locator("xpath=ancestor::section[1]");
  await expect(section.getByRole("link")).toHaveCount(5);
  await expect(section.getByText("and 3 more…", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const meetingLinks = section.getByRole("link");
  expect(await meetingLinks.evaluateAll((links) => links.every((link) => link.getBoundingClientRect().height <= 46))).toBe(true);
  expect(await meetingLinks.locator(".client-cell-copy > strong, .client-cell-copy > span").evaluateAll((cells) => cells.every((cell) => {
    const style = window.getComputedStyle(cell);
    return style.whiteSpace === "nowrap" && cell.scrollHeight <= cell.clientHeight;
  }))).toBe(true);
  const firstMeeting = section.getByRole("link", { name: "Open project CF-2026-E2E00001 for Project check-in 1" });
  await firstMeeting.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "CF-2026-E2E00001 Today's meeting project" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(firstMeeting).toBeFocused();

  dashboardState.value = dashboard(0);
  await page.reload();
  const emptySection = page.getByRole("heading", { name: "Today's meetings" }).locator("xpath=ancestor::section[1]");
  await expect(emptySection.getByRole("link")).toHaveCount(0);
  await expect(emptySection.getByText("No today or upcoming project meetings are saved.", { exact: true })).toBeVisible();
});

test("Today's meetings distinguishes loading from unavailable live records", async ({ page }) => {
  const dashboardState = { value: dashboard(1) };
  await mockOverview(page, dashboardState);
  let releaseDashboard!: () => void;
  const dashboardGate = new Promise<void>((resolve) => {
    releaseDashboard = resolve;
  });
  await page.route("**/api/v1/dashboard", async (route) => {
    await dashboardGate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardState.value) });
  });

  await page.goto("/");
  const section = page.getByRole("heading", { name: "Today's meetings" }).locator("xpath=ancestor::section[1]");
  await expect(section.getByText("Loading today's meetings…", { exact: true })).toBeVisible();
  await expect(section.getByText("Today's meetings are unavailable until live records load.", { exact: true })).toHaveCount(0);
  releaseDashboard();
  await expect(section.getByRole("link")).toHaveCount(1);

  await page.unroute("**/api/v1/dashboard");
  await page.route("**/api/v1/dashboard", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Dashboard unavailable" }),
  }));
  await page.reload();
  const unavailableSection = page.getByRole("heading", { name: "Today's meetings" }).locator("xpath=ancestor::section[1]");
  await expect(unavailableSection.getByText("Today's meetings are unavailable until live records load.", { exact: true })).toBeVisible();
  await expect(unavailableSection.getByText("Loading today's meetings…", { exact: true })).toHaveCount(0);
});
