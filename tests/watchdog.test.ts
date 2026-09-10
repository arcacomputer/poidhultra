import test from "node:test";
import assert from "node:assert/strict";
import { overdue, validSignature } from "../apps/supervisor/src/github";
import { createHmac } from "node:crypto";
test("missed checks and forged webhooks are rejected", async () => {
  const now = Date.now();
  assert.equal(overdue({}, now), true);
  assert.equal(
    overdue(
      { lastSuccessfulCheck: new Date(now - 4 * 3600_000).toISOString() },
      now
    ),
    true
  );
  assert.equal(
    overdue({ lastSuccessfulCheck: new Date(now).toISOString() }, now),
    false
  );
  const body = new TextEncoder().encode('{"repository":{"id":123}}');
  const signature =
    "sha256=" + createHmac("sha256", "shared-key").update(body).digest("hex");
  assert.equal(
    await validSignature(body.buffer, signature, "shared-key"),
    true
  );
  assert.equal(
    await validSignature(body.buffer, signature, "wrong-key"),
    false
  );
  assert.equal(await validSignature(body.buffer, null, "shared-key"), false);
});
