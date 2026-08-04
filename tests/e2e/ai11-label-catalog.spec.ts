import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

type Label = {
  slug: string;
  description: string;
  retired: boolean;
  createdAt: number;
  updatedAt: number;
};

const seedLabels: Label[] = [
  { slug: "lead", description: "A new sales opportunity or request for an estimate.", retired: false, createdAt: 0, updatedAt: 0 },
  { slug: "project-update", description: "Information or a requested change concerning existing project work.", retired: false, createdAt: 0, updatedAt: 0 },
  { slug: "schedule", description: "A request or change involving an appointment, installation, or project timing.", retired: false, createdAt: 0, updatedAt: 0 },
  { slug: "warranty", description: "A callback, repair, service, or warranty concern.", retired: false, createdAt: 0, updatedAt: 0 },
];

test("AI label editor round-trips generated labels and preserves used labels as retired", async ({ page }) => {
  let labels = structuredClone(seedLabels);
  const generatedSlugs = [
    "label_11111111111111111111111111111111",
    "label_22222222222222222222222222222222",
  ] as const;
  let generatedSlugIndex = 0;
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/v1/assistant/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        provider: "openai",
        keyState: "Configured",
        model: "gpt-test",
        modelSource: "app",
        savedModel: "gpt-test",
        features: {
          orgQa: true,
          triage: true,
          inboxAnalysis: true,
          replyDrafts: true,
          taskExtraction: true,
        },
      }),
    });
  });
  await page.route("**/api/v1/inbox-analysis/labels", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ labels, maximumLabels: 20, maximumRows: 100 }),
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push({ method, body });
    if (method === "POST") {
      const label: Label = {
        slug: generatedSlugs[generatedSlugIndex++],
        description: String(body.description),
        retired: false,
        createdAt: 10,
        updatedAt: 10,
      };
      labels.push(label);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ label }) });
      return;
    }
    if (method === "PATCH") {
      labels = labels.map((label) => label.slug === body.slug
        ? { ...label, description: String(body.description), updatedAt: 20 }
        : label);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    if (method === "DELETE" && body.slug === generatedSlugs[1]) {
      labels = labels.map((label) => label.slug === body.slug ? { ...label, retired: true, updatedAt: 30 } : label);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ slug: body.slug, outcome: "retired" }) });
      return;
    }
    labels = labels.filter(({ slug }) => slug !== body.slug);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ slug: body.slug, outcome: "deleted" }) });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings?section=ai-assistant");
  await expect(page.getByRole("heading", { level: 3, name: "Inbox analysis labels" })).toBeVisible();
  await expect(page.getByText("4/20", { exact: true })).toBeVisible();

  const lead = page.locator("article").filter({ hasText: /^lead/u });
  await expect(lead.getByText("Built-in", { exact: true })).toBeVisible();
  await expect(lead.getByRole("button", { name: "Remove label" })).toHaveCount(0);
  await lead.getByLabel("Description").fill("An edited built-in lead description.");
  await lead.getByRole("button", { name: "Save description" }).click();
  await expect(lead.getByLabel("Description")).toHaveValue("An edited built-in lead description.");

  await page.getByLabel("New label description").fill("FCI TEST custom intent.");
  await page.getByRole("button", { name: "Add label" }).click();
  await expect(page.getByText(generatedSlugs[0], { exact: true })).toBeVisible();
  expect(writes).toContainEqual({
    method: "POST",
    body: { description: "FCI TEST custom intent." },
  });

  const custom = page.locator("article").filter({ hasText: generatedSlugs[0] });
  await custom.getByLabel("Description").fill("FCI TEST edited intent.");
  await custom.getByRole("button", { name: "Save description" }).click();
  await expect(custom.getByLabel("Description")).toHaveValue("FCI TEST edited intent.");
  await custom.getByRole("button", { name: "Remove label" }).click();
  await expect(custom).toHaveCount(0);

  await page.getByLabel("New label description").fill("FCI TEST used intent.");
  await page.getByRole("button", { name: "Add label" }).click();
  const used = page.locator("article").filter({ hasText: generatedSlugs[1] });
  await expect(used).toBeVisible();
  await used.getByRole("button", { name: "Remove label" }).click();
  await expect(used.getByText("Retired", { exact: true })).toBeVisible();
  await expect(used.getByRole("button", { name: "Remove label" })).toHaveCount(0);
  await used.getByLabel("Description").fill("An edited historical custom description.");
  await used.getByRole("button", { name: "Save description" }).click();
  await expect(used.getByLabel("Description")).toHaveValue("An edited historical custom description.");

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const results = await new AxeBuilder({ page }).include("[aria-labelledby='assistant-label-catalog-title']").analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
