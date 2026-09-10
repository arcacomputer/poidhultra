import test from "node:test";
import assert from "node:assert/strict";
import gateway from "../apps/community-api/src/gateway";
test("external frontend gateway forwards the versioned API without exposing operational endpoints", async () => {
  let calls = 0;
  const request = new Request("https://gateway.test/api/v1/records", {
    method: "POST",
    headers: {
      origin: "https://poidh.xyz",
      "x-poidh-origin": "https://poidh.xyz",
      "x-poidh-proxy-key": "test-only",
      cookie: "poidh_session=test-only",
    },
    body: "{}",
  });
  const env = {
    COMMUNITY: {
      async fetch(incoming: Request) {
        calls++;
        assert.equal(incoming, request);
        return new Response(null, { status: 401 });
      },
    },
  };
  assert.equal((await gateway.fetch(request, env)).status, 401);
  for (const path of [
    "/ready",
    "/health",
    "/admin",
    "/api/v10",
    "/media/../../private",
  ])
    assert.equal(
      (await gateway.fetch(new Request("https://gateway.test" + path), env))
        .status,
      404
    );
  assert.equal(calls, 1);
});
