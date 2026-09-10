import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
test("pending integrations cannot be silently merged as incorporated", () => {
  if (!existsSync("upstream/tasks")) return;
  for (const file of readdirSync("upstream/tasks").filter((f) =>
    f.endsWith(".json")
  )) {
    const task = JSON.parse(readFileSync("upstream/tasks/" + file));
    assert.notEqual(
      task.status,
      "pending",
      "Resolve and account for " + task.source + " before merging"
    );
    const lock = JSON.parse(
      readFileSync("upstream/incorporated/" + task.source + ".json")
    );
    assert.equal(lock.revision, task.revision);
    assert.ok(
      ["integrated", "adapted", "intentionally-different"].includes(
        lock.disposition
      )
    );
    assert.ok(lock.reason.length > 15);
    assert.ok(lock.review);
  }
});
test("active clients use injected wallets and the shared backend", () => {
  const wallet = readFileSync("apps/web/src/wagmiConfig.ts", "utf8");
  assert.match(wallet, /injected/);
  assert.doesNotMatch(wallet, /projectId|getDefaultConfig|privy/);
  const root = readFileSync("apps/web/src/app/layout.tsx", "utf8");
  assert.doesNotMatch(root, /@vercel|farcaster|neynar/);
  const handler = readFileSync(
    "apps/web/src/app/api/trpc/[trpc]/route.ts",
    "utf8"
  );
  assert.match(handler, /compatibilityRouter/);
  assert.doesNotMatch(handler, /appRouter/);
});
