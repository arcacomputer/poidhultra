import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { publicResponse } from "./fixtures/public-api.ts";

const require = createRequire(
  realpathSync("apps/web/node_modules/wrangler/package.json")
);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const { build } = require("esbuild");
const bundle = await build({
  stdin: {
    contents: `import {UpstreamPublicAPI} from './packages/client/src/upstream.ts';
const api = new UpstreamPublicAPI({url:'https://indexer.example'});
export default {fetch(request) { return api.handle(request); }};`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
let calls = 0;
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-09-10",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://indexer.example");
      assert.equal(request.method, "GET");
      for (const name of ["cookie", "authorization", "x-poidh-proxy-key"])
        assert.equal(request.headers.get(name), null);
      calls++;
      if (url.pathname === "/api/v1/bounties/8453/988")
        return new Response(null, {
          status: 302,
          headers: { Location: "https://unexpected.example/private" },
        });
      return publicResponse(url);
    },
  })
);
try {
  const read = async (path) => {
    const response = await worker.dispatchFetch(
      "http://localhost/api/v1" + path,
      {
        headers: {
          Cookie: "poidh_session=test-only",
          Authorization: "test-only",
        },
      }
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(response.headers.get("x-poidh-data-source"), "upstream-api");
    return body;
  };
  const lists = await Promise.all([
    read("/bounties?limit=12"),
    read("/bounties?limit=12"),
  ]);
  for (const list of lists) {
    assert.equal(list.items.length, 12);
    assert.equal(list.items[0].title, "Public mission 120");
    assert.equal(list.source.url, "https://indexer.example");
  }
  const afterScan = calls;
  await read("/bounties?limit=12");
  assert.equal(
    calls,
    afterScan,
    "settled responses are reusable across request contexts"
  );
  const id = "8453:0x5555fa783936c260f77385b4e153b9725fef1719:0";
  assert.equal((await read("/bounties/" + id)).title, "Public mission 0");
  assert.equal((await read("/bounties/" + id + "/claims")).items.length, 30);
  assert.equal((await read("/leaderboard")).items.length, 2);
  assert.equal((await read("/activity")).items.length, 1);
  const beforeRedirect = calls;
  const redirect = await worker.dispatchFetch(
    "http://localhost/api/v1/bounties/" + id.slice(0, -1) + "2"
  );
  assert.equal(redirect.status, 503);
  assert.equal(
    calls,
    beforeRedirect + 1,
    "redirect destinations are never fetched"
  );
  console.log(
    "Compiled public adapter passed native Cloudflare fetch, caching, and credential isolation checks"
  );
} finally {
  await worker.dispose();
}
