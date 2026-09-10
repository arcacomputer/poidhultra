import { test, expect } from "@playwright/test";

test("homepage cards show cover and proof images with resilient fallbacks", async ({
  page,
}) => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64"
  );
  await page.route("https://proofs.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/broken.png" || path === "/missing-metadata")
      return route.fulfill({
        status: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (path === "/good-metadata")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ image: "ipfs://bafytest/preview.png" }),
      });
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: image,
    });
  });
  await page.route("https://ipfs.io/ipfs/bafytest/preview.png", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: image })
  );
  await page.goto("/#bounties");
  for (const [title, source] of [
    ["Public mission 120", "https://proofs.test/cover.png"],
    ["Public mission 119", "https://ipfs.io/ipfs/bafytest/preview.png"],
    ["Public mission 118", "https://proofs.test/fallback.png"],
  ]) {
    const card = page
      .locator(".bounty-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await card.scrollIntoViewIfNeeded();
    const img = card.locator(".bounty-thumbnail img");
    await expect(img).toHaveAttribute("src", source);
    await expect
      .poll(() => img.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBeGreaterThan(0);
    await expect(card.locator(".card-description")).not.toContainText("![");
  }
  const empty = page
    .locator(".bounty-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Public mission 117",
        exact: true,
      }),
    });
  await empty.scrollIntoViewIfNeeded();
  await expect(empty).toContainText("Awaiting the first proof");
  await expect(empty.locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: `test-results/homepage-images-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "View bounty: Public mission 120", exact: true })
    .click();
  await expect(page).toHaveURL(/\/base\/bounty\/1106$/);
});

test("public data discovery searches all pages and preserves preview safeguards", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("complementary", { name: "Preview status" })
  ).toContainText("poidh’s public API");
  await expect(page.locator(".bounty-card")).toHaveCount(12);
  await expect(page.locator(".bounty-card").first()).toContainText(
    "Public mission 120"
  );
  await expect(page.locator(".bounty-card").first()).not.toContainText(
    "0 proofs"
  );
  await page.getByRole("button", { name: "More missions" }).click();
  await expect(page.locator(".bounty-card")).toHaveCount(24);
  await page.getByRole("textbox", { name: "Search bounties" }).fill("Café 🌱");
  await expect(page.locator(".bounty-card")).toHaveCount(3);
  await page
    .getByRole("combobox", { name: "Filter by network" })
    .selectOption("1");
  await expect(page.locator(".bounty-card")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Filter by network" })
    .selectOption("8453");
  await expect(page.locator(".bounty-card")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  expect(
    (await page.request.post("/api/v1/auth/challenge", { data: {} })).status()
  ).toBe(503);
  expect(
    (await page.request.post("/api/v1/records", { data: {} })).status()
  ).toBe(503);
});

test("bounty proofs load with NFT ownership and without RPC or wallet actions", async ({
  page,
}) => {
  const rpcRequests: string[] = [];
  page.on("request", (request) => {
    if (/publicnode|mainnet\.base\.org|arb1\.arbitrum\.io/.test(request.url()))
      rpcRequests.push(request.url());
  });
  await page.route("https://proofs.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64"
      ),
    })
  );
  await page.goto("/base/bounty/986");
  await expect(
    page.getByRole("heading", { name: "Public mission 0", exact: true })
  ).toBeVisible();
  await expect(page.locator(".claim-card")).toHaveCount(30);
  await expect(
    page.getByRole("img", { name: "Proof: Public proof 1", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Accepted proof", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More proofs", exact: true }).click();
  await expect(page.locator(".claim-card")).toHaveCount(60);
  await expect(
    page.getByRole("link", { name: "Open on poidh.xyz" })
  ).toHaveAttribute("href", "https://poidh.xyz/base/bounty/986");
  await expect(
    page.getByRole("button", { name: "Submit your proof" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vote yes" })).toHaveCount(0);
  expect(rpcRequests).toEqual([]);
});

test("leaderboard estimates and historical activity are labeled accurately", async ({
  page,
}) => {
  await page.goto("/leaderboard");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(
    page.getByText(/Amounts and ranking are approximate/)
  ).toBeVisible();
  await expect(page.locator("tbody tr").first()).toContainText(
    "≈ 0.123457 ETH"
  );
  await page.goto("/feed");
  await expect(
    page.getByRole("heading", { name: "bounty created", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View bounty", exact: true })
  ).toHaveAttribute("href", "/base/bounty/986");
});
