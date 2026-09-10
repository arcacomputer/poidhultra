import { test, expect } from "@playwright/test";
test("discovery, filters, mobile navigation and draft recovery", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Make it happen. Show the proof." })
  ).toBeVisible();
  await expect(page.locator(".bounty-card")).toHaveCount(6);
  await page.getByRole("textbox", { name: "Search bounties" }).fill("stranger");
  await expect(page.locator(".bounty-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "Make a stranger’s day a little brighter",
    })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page
    .getByRole("link", { name: "Create a bounty", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start something good." })
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Give your bounty a title" })
    .fill("A saved test mission");
  await page
    .getByRole("textbox", { name: "What does success look like?" })
    .fill("Proof should show the completed task.");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Give your bounty a title" })
  ).toHaveValue("A saved test mission");
});
test("service failure is visible and recoverable", async ({ page }) => {
  await page.route("**/api/v1/bounties?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary test failure" }),
    })
  );
  await page.goto("/");
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "Temporary test failure"
  );
  await page.unroute("**/api/v1/bounties?**");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".bounty-card")).toHaveCount(6);
});
test("keyboard access, landmarks, and page overflow", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" })
  ).toBeFocused();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.getByRole("link", { name: "poidh Ultra home" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");
  await expect(page.locator(".bounty-card")).toHaveCount(6);
  await page.screenshot({
    path: `test-results/home-${test.info().project.name}.png`,
    fullPage: true,
  });
});
