import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "node --import tsx tests/e2e/server.ts",
      port: 8787,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm --filter @poidh/web start",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        COMMUNITY_API_URL: "http://localhost:8787",
        COMMUNITY_PROXY_KEY: "local-browser-test",
      },
    },
  ],
});
