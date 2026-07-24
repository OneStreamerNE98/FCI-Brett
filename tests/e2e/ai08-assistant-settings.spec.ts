import { expect, test, type Page, type Route } from "@playwright/test";

test.use({ hasTouch: true });

const secretSentinel = "sk-AI08-SECRET-MUST-NEVER-RENDER";
const configuredFeatures = {
  orgQa: true,
  triage: true,
  replyDrafts: false,
  taskExtraction: true,
};
const configuredConfig = {
  provider: "openai" as const,
  keyState: "Configured" as const,
  model: "gpt-5.4",
  features: configuredFeatures,
  unsafeSecret: secretSentinel,
};
const missingKeyCopy = "Add OPENAI_API_KEY to the hosting environment to enable AI features. Everything else keeps working without it.";
const footerCopy = "The assistant reads saved records and drafts text. It never sends email, never files messages, and never creates records without your confirmation.";
const introCopy = "Answers come only from saved records and Drive files. Every answer cites its sources. The assistant never sends anything.";
const exampleQuestions = [
  "Which projects have open callbacks?",
  "What did we decide in the last Hendricks meeting?",
  "What tasks are overdue?",
  "Show installation dates for active commercial projects.",
  "Find the change order document for project 2026-014.",
] as const;
const limitsCopy = "Email bodies live in Drive as filed copies — file an email first if you want it searchable. Phone calls are saved as meetings.";

function assistantCard(page: Page) {
  return page.getByRole("heading", { level: 2, name: "AI assistant" }).locator("xpath=ancestor::section[1]");
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockOfficeIdentity(page: Page) {
  await page.setExtraHTTPHeaders({
    "oai-authenticated-user-email": "e2e-office@example.test",
    "oai-authenticated-user-full-name": encodeURIComponent("E2E Office"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
  await page.route("**/api/v1/settings/me", async (route) => {
    await fulfillJson(route, {
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
          overview: { order: [], hidden: [] },
          reports: { order: [], hidden: [] },
        },
      },
      updatedAt: null,
      isAdmin: false,
    });
  });
}

test("Administrator sees four controls and saves only the closed AI feature payload", async ({ page }) => {
  let patchBody: unknown;
  await page.route("**/api/v1/assistant/config", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, configuredConfig);
      return;
    }
    if (route.request().method() === "PATCH") {
      patchBody = route.request().postDataJSON();
      const body = patchBody as { features: typeof configuredFeatures };
      await fulfillJson(route, { ...configuredConfig, features: body.features });
      return;
    }
    await route.continue();
  });

  await page.goto("/settings?section=workflow-notifications");
  const card = assistantCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole("checkbox")).toHaveCount(4);
  for (const label of [
    "Organization-wide answers",
    "Inbox filing suggestions",
    "Reply drafting",
    "Task extraction from meetings",
  ]) {
    await expect(card.getByRole("checkbox", { name: label })).toBeVisible();
  }
  await expect(card.getByText("In development", { exact: true })).toHaveCount(1);
  await expect(card.getByText("Planned", { exact: true })).toHaveCount(3);
  await expect(card.getByText(footerCopy, { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secretSentinel);

  await card.getByRole("checkbox", { name: "Inbox filing suggestions" }).uncheck();
  await card.getByRole("checkbox", { name: "Reply drafting" }).check();
  await card.getByRole("button", { name: "Save AI settings" }).click();
  await expect.poll(() => patchBody).toEqual({
    features: {
      orgQa: true,
      triage: false,
      replyDrafts: true,
      taskExtraction: true,
    },
  });
  expect(JSON.stringify(patchBody)).not.toContain(secretSentinel);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Office identity is redirected to My settings and receives read-only AI states", async ({ page }) => {
  await mockOfficeIdentity(page);
  let getRequests = 0;
  let patchRequests = 0;
  await page.route("**/api/v1/assistant/config", async (route) => {
    if (route.request().method() === "GET") getRequests += 1;
    if (route.request().method() === "PATCH") patchRequests += 1;
    await fulfillJson(route, configuredConfig);
  });

  await page.goto("/settings?section=workflow-notifications");
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByRole("heading", { level: 2, name: "My settings" })).toBeVisible();
  const navigation = page.locator(".settings-nav");
  await expect(navigation.getByRole("button")).toHaveCount(1);
  await expect(navigation.getByRole("button", { name: "My settings", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("button", { name: "AI assistant", exact: true })).toHaveCount(0);

  const card = assistantCard(page);
  await expect(card).toBeVisible();
  await expect.poll(() => getRequests).toBe(1);
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Save AI settings" })).toHaveCount(0);
  const states = card.getByLabel("AI feature states").locator("strong");
  await expect(states).toHaveCount(4);
  await expect(states).toHaveText(["On", "On", "Off", "On"]);
  await expect(card.getByText("In development", { exact: true })).toHaveCount(1);
  await expect(card.getByText("Planned", { exact: true })).toHaveCount(3);
  await expect(card.getByText(footerCopy, { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secretSentinel);
  expect(patchRequests).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  expect(patchRequests).toBe(0);
});

test("Missing-key state uses the canonical honest copy and disables every control", async ({ page }) => {
  await page.route("**/api/v1/assistant/config", async (route) => {
    await fulfillJson(route, {
      provider: "openai",
      keyState: "Missing",
      model: "gpt-5.4",
      features: {
        orgQa: false,
        triage: false,
        replyDrafts: false,
        taskExtraction: false,
      },
      unsafeSecret: secretSentinel,
    });
  });

  await page.goto("/settings?section=workflow-notifications");
  const card = assistantCard(page);
  await expect(card.getByText(missingKeyCopy, { exact: true })).toBeVisible();
  await expect(card.getByRole("checkbox")).toHaveCount(4);
  for (const checkbox of await card.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();
  await expect(card.getByRole("button", { name: "Save AI settings" })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(secretSentinel);
});

test("What you can ask is a keyboard and touch-native collapsed disclosure", async ({ page }) => {
  await page.goto("/assistant");
  await expect(page.getByLabel("Ask FCI Assistant")).toBeEnabled();
  const help = page.getByRole("region", { name: "Assistant help" });
  const details = help.locator("details");
  const summary = help.locator("summary");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(help.getByText(introCopy, { exact: true })).toBeHidden();

  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(help.getByText(introCopy, { exact: true })).toBeVisible();
  for (const question of exampleQuestions) {
    await expect(help.getByText(question, { exact: true })).toBeVisible();
  }
  await expect(help.getByText(limitsCopy, { exact: true })).toBeVisible();

  await summary.press("Enter");
  await expect(details).not.toHaveAttribute("open", "");
  await page.setViewportSize({ width: 390, height: 844 });
  await summary.tap();
  await expect(details).toHaveAttribute("open", "");
  await expectNoHorizontalOverflow(page);
});
