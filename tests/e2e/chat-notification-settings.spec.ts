import { expect, test, type Page } from "@playwright/test";

const forbiddenWebhookSentinel = "FCI_TEST_WEBHOOK_URL_VALUE_DO_NOT_RENDER";
const forbiddenTokenSentinel = "FCI_TEST_WEBHOOK_TOKEN_VALUE_DO_NOT_RENDER";

type ChatEventType = "lead.created" | "gmail.filing_review_needed" | "calendar.schedule_changed" | "project.warranty_follow_up_due";
type ChatEventConfig = { type: ChatEventType; label: string; description: string; enabled: boolean; spaceKey: string };
type ChatConfig = {
  canEdit: boolean;
  mode: "disabled" | "simulation" | "webhook";
  featureEnabled: boolean;
  events: ChatEventConfig[];
  spaces: Array<{ key: string; label: string; secretEnvVar: string; configured: boolean }>;
  missingDetails: Array<{ label: string; envVar: string; secret: boolean }>;
  updatedAt: string;
  unsafeWebhookUrl?: string;
  unsafeToken?: string;
};

const chatConfigFixture: ChatConfig = {
  canEdit: true,
  mode: "simulation",
  featureEnabled: true,
  events: [
    { type: "lead.created", label: "New lead", description: "A new lead is ready for office review.", enabled: false, spaceKey: "sales" },
    { type: "gmail.filing_review_needed", label: "Filing review needed", description: "A Gmail thread needs a project filing decision.", enabled: true, spaceKey: "office-ops" },
    { type: "calendar.schedule_changed", label: "Schedule change", description: "A shared field schedule item changed.", enabled: false, spaceKey: "field" },
    { type: "project.warranty_follow_up_due", label: "Warranty follow-up due", description: "A closeout project needs warranty follow-up.", enabled: true, spaceKey: "service" },
  ],
  spaces: [
    { key: "sales", label: "Sales & intake", secretEnvVar: "GOOGLE_CHAT_SALES_WEBHOOK_URL", configured: true },
    { key: "office-ops", label: "Office operations", secretEnvVar: "GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL", configured: false },
    { key: "field", label: "Field operations", secretEnvVar: "GOOGLE_CHAT_FIELD_WEBHOOK_URL", configured: true },
    { key: "service", label: "Warranty & service", secretEnvVar: "GOOGLE_CHAT_SERVICE_WEBHOOK_URL", configured: false },
  ],
  missingDetails: [
    { label: "Office operations Chat space", envVar: "GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL", secret: true },
    { label: "Warranty and service Chat space", envVar: "GOOGLE_CHAT_SERVICE_WEBHOOK_URL", secret: true },
  ],
  updatedAt: "2026-07-21T12:00:00.000Z",
  unsafeWebhookUrl: forbiddenWebhookSentinel,
  unsafeToken: forbiddenTokenSentinel,
};

function monitorBrowserIssues(page: Page, options: { allowExpectedServiceUnavailable?: boolean } = {}) {
  const issues: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const localVinextFontWarning = /^Not allowed to load local resource: file:\/\/\/.*\/\.vinext\/fonts\//u.test(text);
    const expectedServiceUnavailable = options.allowExpectedServiceUnavailable === true
      && text === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";
    if (!localVinextFontWarning && !expectedServiceUnavailable) issues.push(`console.error: ${text}`);
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.stack ?? error.message}`));
  return issues;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("Administrator can save closed Google Chat event routing without receiving secret values", async ({ page }) => {
  const browserIssues = monitorBrowserIssues(page);
  let patchBody: { events: Array<{ type: ChatEventType; enabled: boolean; spaceKey: string }> } | undefined;

  await page.route("**/api/v1/integrations/google/chat/config", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(chatConfigFixture) });
      return;
    }
    if (route.request().method() === "PATCH") {
      patchBody = route.request().postDataJSON() as typeof patchBody;
      const savedEvents = chatConfigFixture.events.map((event) => {
        const update = patchBody?.events.find((candidate) => candidate.type === event.type);
        return update ? { ...event, enabled: update.enabled, spaceKey: update.spaceKey } : event;
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...chatConfigFixture, events: savedEvents }) });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/settings?section=workflow-notifications");
  const card = page.locator(".chat-notification-settings");
  await expect(card.getByRole("heading", { level: 2, name: "Google Chat notifications" })).toBeVisible();
  await expect(card.getByRole("status")).toContainText("Simulation log only");
  await expect(card).toContainText("GOOGLE_CHAT_SALES_WEBHOOK_URL");
  await expect(card).toContainText("GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL");
  await expect(card).toContainText("GOOGLE_CHAT_FIELD_WEBHOOK_URL");
  await expect(card).toContainText("GOOGLE_CHAT_SERVICE_WEBHOOK_URL");
  await expect(page.locator("body")).not.toContainText(forbiddenWebhookSentinel);
  await expect(page.locator("body")).not.toContainText(forbiddenTokenSentinel);

  await card.getByRole("checkbox", { name: /New lead/ }).check();
  await card.getByLabel("Chat space for New lead").selectOption("office-ops");
  await card.getByRole("button", { name: "Save Chat routing" }).click();
  await expect.poll(() => patchBody).toEqual({
    events: [
      { type: "lead.created", enabled: true, spaceKey: "office-ops" },
      { type: "gmail.filing_review_needed", enabled: true, spaceKey: "office-ops" },
      { type: "calendar.schedule_changed", enabled: false, spaceKey: "field" },
      { type: "project.warranty_follow_up_due", enabled: true, spaceKey: "service" },
    ],
  });
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(browserIssues, browserIssues.join("\n\n")).toEqual([]);
});

test("office user cannot render or request Administrator Google Chat configuration", async ({ page }) => {
  const browserIssues = monitorBrowserIssues(page);
  let getRequests = 0;
  let patchRequests = 0;
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.route("**/api/v1/integrations/google/chat/config", async (route) => {
    if (route.request().method() === "GET") getRequests += 1;
    if (route.request().method() === "PATCH") patchRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...chatConfigFixture, canEdit: false }) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings?section=workflow-notifications");
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByRole("heading", { level: 2, name: "My settings" })).toBeVisible();
  await expect(page.locator(".chat-notification-settings")).toHaveCount(0);
  await expect(page.locator(".settings-nav").getByText("Workspace & company setup", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(forbiddenWebhookSentinel);
  await expect(page.locator("body")).not.toContainText(forbiddenTokenSentinel);
  expect(getRequests).toBe(0);
  expect(patchRequests).toBe(0);
  await expectNoHorizontalOverflow(page);
  expect(browserIssues, browserIssues.join("\n\n")).toEqual([]);
});

test("Google Chat config retries independently while unrelated workflow defaults remain failed", async ({ page }) => {
  const browserIssues = monitorBrowserIssues(page, { allowExpectedServiceUnavailable: true });
  let chatGetAttempts = 0;
  await page.route("**/api/v1/settings/workspace", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "FCI TEST workspace settings unavailable" }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/integrations/google/chat/config", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    chatGetAttempts += 1;
    if (chatGetAttempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "FCI TEST Chat config unavailable" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(chatConfigFixture) });
  });

  await page.goto("/settings?section=workflow-notifications");
  const stack = page.locator(".settings-panel-stack");
  const defaultsPanel = stack.locator(".settings-form-panel").first();
  const card = stack.locator(".chat-notification-settings");
  const cardError = card.getByRole("alert");
  await expect(defaultsPanel.getByRole("alert")).toBeVisible();
  await expect(cardError).toBeVisible();

  await cardError.getByRole("button", { name: "Retry" }).click();
  await expect(card.getByRole("status")).toContainText("Simulation log only");
  await expect.poll(() => chatGetAttempts).toBe(2);
  await expect(defaultsPanel.getByRole("alert")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(browserIssues, browserIssues.join("\n\n")).toEqual([]);
});
