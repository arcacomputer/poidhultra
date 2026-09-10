import test from "node:test";
import assert from "node:assert/strict";
import {
  MediaMirror,
  digest,
  imageKey,
  sourceKey,
  publicMediaURL,
  serveImage,
  IMAGE_LIMIT,
  REFRESH_MS,
} from "../packages/storage/src/mirror";
import { resolveRecordImage } from "../packages/storage/src/media-handler";
import { publicIPv4, nodeMediaFetch } from "../packages/storage/src/node-fetch";
import { memoryStore, png } from "./fixtures/media";
import {
  verifyObject,
  verifyReferences,
} from "../packages/storage/src/portable";

test("remote images and metadata persist before publication and survive a fresh process/origin outage", async () => {
  const { storage, objects } = memoryStore();
  let calls = 0,
    now = Date.now();
  const source = "https://proofs.example/metadata";
  const mirror = new MediaMirror({
    storage,
    now: () => now,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "manual");
      const headers = new Headers(options?.headers);
      for (const key of ["Cookie", "Authorization", "X-Poidh-Proxy-Key"])
        assert.equal(headers.get(key), null);
      return String(url) === source
        ? Response.json({ image: "ipfs://bafytest/image.png" })
        : new Response(png, { headers: { "Content-Type": "image/png" } });
    },
  });
  const [first, duplicate] = await Promise.all([
    mirror.capture(source, true),
    mirror.capture(source, true),
  ]);
  assert.deepEqual(first, duplicate);
  assert.equal(
    calls,
    2,
    "one metadata read and one image download for concurrent readers"
  );
  assert.equal(first.sha256, await digest(png));
  assert.ok(objects.has(imageKey(first.sha256)));
  assert.ok(objects.has("remote/v1/metadata/" + first.metadataSha256));
  assert.ok(objects.has(await sourceKey(source, true)));
  assert.ok(
    [...objects.keys()].some((key) => key.startsWith("remote/v1/manifests/"))
  );
  const keys = new Set(objects.keys());
  for (const [key, object] of objects) {
    await verifyObject(key, object.body);
    verifyReferences(key, object.body, keys);
  }
  const pointer = objects.get(await sourceKey(source, true))!;
  assert.throws(
    () =>
      verifyReferences(
        "remote/v1/sources/" + "a".repeat(64),
        pointer.body,
        new Set()
      ),
    /missing/
  );
  const restarted = new MediaMirror({
    storage,
    now: () => now,
    fetcher: async () => {
      calls++;
      throw new Error("Origin offline");
    },
  });
  assert.deepEqual(await restarted.capture(source, true), first);
  assert.equal(calls, 2, "new process reads R2/S3 without contacting origin");
  now += REFRESH_MS + 1;
  assert.deepEqual(
    await restarted.capture(source, true),
    first,
    "stale stored copy survives origin outage"
  );
  assert.deepEqual(await restarted.capture(source, true), first);
  assert.equal(calls, 3, "failed refresh has a bounded backoff");
  const request = new Request(
    "https://ultra.example/media/remote/sha256/" + first.sha256
  );
  const response = await serveImage(request, first.sha256, storage);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control")!, /immutable/);
  assert.equal(
    await digest(new Uint8Array(await response.arrayBuffer())),
    first.sha256
  );
  const conditional = await serveImage(
    new Request(request, {
      headers: { "If-None-Match": '"' + first.sha256 + '"' },
    }),
    first.sha256,
    storage
  );
  assert.equal(conditional.status, 304);
});

test("mutable sources get new immutable objects; previous capture and original uploads remain readable", async () => {
  const { storage, objects } = memoryStore();
  let now = Date.now();
  let bytes: Uint8Array = png;
  const mirror = new MediaMirror({
    storage,
    now: () => now,
    fetcher: async () => new Response(bytes as BodyInit),
  });
  const first = await mirror.capture("https://proofs.example/cover");
  bytes = Uint8Array.from([...png, 0]);
  now += REFRESH_MS + 1;
  const next = await mirror.capture("https://proofs.example/cover");
  assert.notEqual(first.sha256, next.sha256);
  assert.ok(
    objects.has(imageKey(first.sha256)) && objects.has(imageKey(next.sha256))
  );
  const hash = await digest(png);
  await storage.put("sha256/" + hash, png, "image/png");
  const metadata = new TextEncoder().encode(
    JSON.stringify({ image: "http://localhost:3000/media/sha256/" + hash })
  );
  const metadataHash = await digest(metadata);
  await storage.put("sha256/" + metadataHash, metadata, "application/json");
  const local = new MediaMirror({
    storage,
    localOrigin: "http://localhost:3000",
    fetcher: async () => {
      throw new Error("Must read local storage");
    },
  });
  assert.equal(
    (
      await local.capture(
        "http://localhost:3000/media/sha256/" + metadataHash,
        true
      )
    ).sha256,
    hash
  );
});

test("untrusted media cannot fetch private/credential URLs or redirects, HTML/SVG, or oversized content", async () => {
  const { storage, objects } = memoryStore();
  for (const source of [
    "https://127.1/x",
    "https://[::1]/x",
    "https://2130706433/",
    "https://metadata.google.internal/",
    "https://localhost/",
    "http://example.org/",
    "https://user:pass@example.org/x",
    "https://example.org:8443/x",
  ])
    assert.throws(() => publicMediaURL(source));
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "172.31.1.1",
    "198.18.0.1",
    "224.0.0.1",
  ])
    assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4("93.184.216.34"), true);
  // Local DNS resolves a private A record: the Node socket must reject it.
  await assert.rejects(
    nodeMediaFetch("https://localhost.localdomain/image", {
      signal: AbortSignal.timeout(3000),
    })
  );
  let calls = 0;
  const redirect = new MediaMirror({
    storage,
    fetcher: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { Location: "https://169.254.169.254/credentials" },
      });
    },
  });
  await assert.rejects(redirect.capture("https://images.example/redirect"));
  assert.equal(calls, 1);
  for (const body of [
    "<html>not an image</html>",
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  ]) {
    const mirror = new MediaMirror({
      storage,
      fetcher: async () =>
        new Response(body, { headers: { "Content-Type": "image/png" } }),
    });
    await assert.rejects(mirror.capture("https://images.example/image"));
  }
  let cancelled = false;
  const huge = new MediaMirror({
    storage,
    fetcher: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Length": String(IMAGE_LIMIT + 1) } }
      ),
  });
  await assert.rejects(huge.capture("https://images.example/huge"), /large/);
  assert.equal(cancelled, true);
  assert.equal(objects.size, 0);
});

test("image resolution is bound to actual public records including profile moderation", async () => {
  const id = "8453:0x5555fa783936c260f77385b4e153b9725fef1719:0";
  const { storage } = memoryStore();
  let calls = 0;
  const mirror = new MediaMirror({
    storage,
    fetcher: async () => {
      calls++;
      return new Response(png);
    },
  });
  const invalid = await resolveRecordImage(
    "url",
    "https://example.com/a.png",
    async () => {
      throw new Error("must not read");
    },
    mirror
  );
  assert.equal(invalid.status, 404);
  const response = await resolveRecordImage(
    "bounty",
    id,
    async (path) => {
      assert.equal(path, "/api/v1/bounties/" + encodeURIComponent(id));
      return Response.json({
        id,
        description: "![cover](https://images.example/cover)",
      });
    },
    mirror
  );
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).url,
    "/media/remote/sha256/" + (await digest(png))
  );
  const author = "0x" + "1".repeat(40);
  const hidden = await resolveRecordImage(
    "profile",
    author,
    async () =>
      Response.json({
        items: [
          {
            kind: "profile",
            author,
            moderated: true,
            data: { image: "https://example.com/hidden.png" },
          },
        ],
      }),
    mirror
  );
  assert.equal(hidden.status, 404);
  assert.equal(calls, 1);
});
