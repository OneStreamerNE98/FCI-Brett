import { expect, test } from "@playwright/test";

test("forced retry-only pass is rejected by the reporter", async ({}, testInfo) => {
  expect(testInfo.retry, "the fixture deliberately fails its first attempt").toBe(1);
});
