import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "upstream.spec.ts",
  testIgnore: [],
  webServer: [
    { command: "node --import tsx tests/e2e/upstream-server.ts", port: 8788 },
    {
      command: "pnpm --filter @poidh/web start",
      port: 3000,
      env: {
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        COMMUNITY_API_URL: "http://localhost:8788",
        COMMUNITY_PROXY_KEY: "local-browser-test",
        PREVIEW_MODE: "true",
        UPSTREAM_INDEXER_URL: "http://localhost:8788",
      },
    },
  ],
});
