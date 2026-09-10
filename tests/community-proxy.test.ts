import test from "node:test";
import assert from "node:assert/strict";
import { createCommunityProxy } from "../packages/client/src/server-proxy";
test("portable same-origin proxy enforces origin, replaces spoofed credentials and preserves sessions", async () => {
  let calls = 0;
  const proxy = createCommunityProxy({
    origin: "https://poidh.xyz",
    apiURL: "https://community.test",
    proxyKey: "server-only",
    service: {
      async fetch(request) {
        calls++;
        assert.equal(
          request.url,
          "https://community.test/api/v1/records?kind=comment"
        );
        assert.equal(request.headers.get("x-poidh-proxy-key"), "server-only");
        assert.equal(
          request.headers.get("x-poidh-origin"),
          "https://poidh.xyz"
        );
        assert.equal(request.headers.get("cookie"), "poidh_session=test-only");
        assert.equal(request.headers.get("authorization"), null);
        return Response.json(
          { ok: true },
          {
            headers: {
              "set-cookie": "poidh_session=new-test; HttpOnly",
              "cache-control": "public,max-age=60",
            },
          }
        );
      },
    },
  });
  const request = new Request("https://poidh.xyz/api/v1/records?kind=comment", {
    headers: {
      "x-poidh-proxy-key": "spoofed",
      "x-poidh-origin": "https://attacker.test",
      authorization: "private-unrelated-header",
      cookie: "poidh_session=test-only",
    },
  });
  const response = await proxy(request, "/api/v1/records");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("set-cookie"),
    "poidh_session=new-test; HttpOnly"
  );
  assert.equal(
    (
      await proxy(
        new Request(request, {
          method: "POST",
          headers: { origin: "https://attacker.test" },
          body: "{}",
        }),
        "/api/v1/records"
      )
    ).status,
    403
  );
  assert.equal(
    (await proxy(request, "https://attacker.test/api/v1/records")).status,
    404
  );
  assert.equal((await proxy(request, "/api/v1/../../ready")).status, 404);
  assert.equal(calls, 1);
  const readOnly = createCommunityProxy({
    origin: "https://poidh.xyz",
    apiURL: "https://community.test",
    proxyKey: "unused",
    readOnly: true,
  });
  assert.equal(
    (
      await readOnly(
        new Request("https://poidh.xyz/api/v1/records", {
          method: "POST",
          headers: { origin: "https://poidh.xyz" },
          body: "{}",
        }),
        "/api/v1/records"
      )
    ).status,
    503
  );
});
