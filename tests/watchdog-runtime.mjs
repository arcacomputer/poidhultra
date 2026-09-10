import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";

// Use the same workerd/Miniflare version as the pinned Wrangler build tool.
const require = createRequire(
  realpathSync(
    new URL(
      "../apps/supervisor/node_modules/wrangler/package.json",
      import.meta.url
    )
  )
);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
let checks = 0;
const report = { lastSuccessfulCheck: new Date().toISOString() };
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: "apps/supervisor/dist/index.js",
    compatibilityDate: "2026-09-10",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      MAINTENANCE: { className: "Maintenance", useSQLite: true },
    },
    bindings: { GITHUB_REPOSITORY: "test/rehearsal", INDEXER_ENABLED: "false" },
    outboundService: async (request) => {
      assert.equal(
        request.url,
        "https://raw.githubusercontent.com/test/rehearsal/maintenance-state/status.json"
      );
      assert.equal(request.headers.get("authorization"), null);
      checks++;
      return Response.json(report);
    },
  })
);
try {
  const first = await (
    await worker.dispatchFetch("http://localhost/status")
  ).json();
  assert.equal(first.watchdogOverdue, true);
  assert.ok(first.nextCheckAt);
  let result;
  const deadline = Date.now() + 10_000;
  do {
    await setTimeout(100);
    result = await (
      await worker.dispatchFetch("http://localhost/status")
    ).json();
  } while (!result.checkedAt && Date.now() < deadline);
  assert.equal(result.overdue, false);
  assert.equal(result.watchdogOverdue, false);
  assert.equal(result.lastSuccessfulCheck, report.lastSuccessfulCheck);
  assert.equal(checks, 1);
  assert.ok(result.nextCheckAt > Date.now());
  console.log(
    "Compiled Cloudflare watchdog alarm ran without cron or production credentials"
  );
} finally {
  await worker.dispose();
}
