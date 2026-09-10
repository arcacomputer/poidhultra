import assert from "node:assert/strict";
import { realpathSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { png } from "./fixtures/media.ts";
const require = createRequire(
  realpathSync("apps/web/node_modules/wrangler/package.json")
);
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const { build } = require("esbuild");
const bundle = await build({
  stdin: {
    contents: `
import {MediaMirror, serveImage} from './packages/storage/src/mirror.ts';
import {r2} from './packages/storage/src/objects.ts';
let mirror;
export default {async fetch(request, env) {
 const storage = r2(env.MEDIA);
 mirror ??= new MediaMirror({storage});
 const path = new URL(request.url).pathname;
 if (path === '/capture') return Response.json(await mirror.capture('https://proofs.example/metadata', true));
 return serveImage(request, path.slice(1), storage, caches.default);
}};`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
const directory = mkdtempSync(join(tmpdir(), "poidh-media-runtime-"));
let calls = 0,
  offline = false;
const options = convertV4MiniflareOptions({
  modules: true,
  script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-09-10",
  compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
  r2Buckets: ["MEDIA"],
  resourcePersistencePath: directory,
  outboundService: (request) => {
    calls++;
    if (offline) throw new Error("Origin offline");
    for (const key of ["cookie", "authorization", "x-poidh-proxy-key"])
      assert.equal(request.headers.get(key), null);
    return new URL(request.url).pathname === "/metadata"
      ? Response.json({ image: "https://proofs.example/image.png" })
      : new Response(png, { headers: { "Content-Type": "image/png" } });
  },
});
let worker = new Miniflare(options);
try {
  const response = await worker.dispatchFetch("https://ultra.example/capture", {
    headers: { Cookie: "visitor-secret", Authorization: "visitor-secret" },
  });
  assert.equal(response.status, 200);
  const capture = await response.json();
  assert.match(capture.sha256, /^[a-f0-9]{64}$/);
  assert.equal(calls, 2);
  const bucket = await worker.getR2Bucket("MEDIA");
  assert.ok(
    await bucket.get("remote/v1/images/" + capture.sha256),
    "real R2 binding contains image bytes"
  );
  assert.ok(await bucket.get("remote/v1/metadata/" + capture.metadataSha256));
  await worker.dispose();
  offline = true;
  worker = new Miniflare(options);
  const restarted = await worker.dispatchFetch("https://ultra.example/capture");
  assert.equal(restarted.status, 200, await restarted.clone().text());
  assert.deepEqual(await restarted.json(), capture);
  assert.equal(
    calls,
    2,
    "persistent R2 survives Worker restart without origin fetch"
  );
  const url = "https://ultra.example/" + capture.sha256;
  const first = await worker.dispatchFetch(url);
  assert.equal(first.headers.get("x-poidh-media-cache"), "STORE");
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), png);
  const cached = await worker.dispatchFetch(url);
  assert.equal(cached.headers.get("x-poidh-media-cache"), "HIT");
  assert.deepEqual(Buffer.from(await cached.arrayBuffer()), png);
  const conditional = await worker.dispatchFetch(url, {
    headers: { "If-None-Match": '"' + capture.sha256 + '"' },
  });
  assert.equal(conditional.status, 304);
  assert.equal(calls, 2);
  console.log(
    "Cloudflare R2 persistence, restart recovery, native fetch, edge cache HIT, and conditional GET passed"
  );
} finally {
  await worker.dispose();
  rmSync(directory, { recursive: true, force: true });
}
