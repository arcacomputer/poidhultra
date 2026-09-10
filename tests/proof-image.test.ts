import test from "node:test";
import assert from "node:assert/strict";
import {
  cardMedia,
  mediaURL,
  cachedImage,
} from "../apps/web/src/utils/proofImage";

test("card images preserve public HTTPS/IPFS sources and remove Markdown image syntax", () => {
  assert.equal(
    mediaURL("ipfs://ipfs/bafyexample/proof.png"),
    "https://ipfs.io/ipfs/bafyexample/proof.png"
  );
  assert.equal(
    mediaURL("https://images.example/proof.jpg?width=500"),
    "https://images.example/proof.jpg?width=500"
  );
  for (const source of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "http://images.example/a",
    "https://user:secret@images.example/a",
    "not a URI",
    "ipfs://../private",
  ])
    assert.equal(mediaURL(source), null);
  const description =
    '![The view](<https://images.example/view.jpg> "Summer")\nRun for a good cause.';
  assert.deepEqual(cardMedia(description), {
    image: "https://images.example/view.jpg",
    description: "Run for a good cause.",
  });
  assert.equal(
    cardMedia(description, "https://images.example/explicit.png").image,
    "https://images.example/explicit.png"
  );
  const start = performance.now();
  cardMedia("![".repeat(100_000));
  assert.ok(
    performance.now() - start < 1000,
    "Untrusted descriptions must have a bounded image scan"
  );
});

test("browser image resolution only accepts same-origin immutable cache URLs", async () => {
  const hash = "a".repeat(64);
  const result = await cachedImage(
    "claim",
    "8453:contract:1",
    undefined,
    async (url, init) => {
      assert.equal(url, "/api/media/claim/8453%3Acontract%3A1");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      return Response.json({ url: "/media/remote/sha256/" + hash });
    }
  );
  assert.equal(result, "/media/remote/sha256/" + hash);
  await assert.rejects(
    cachedImage("bounty", "1", undefined, async () =>
      Response.json({ url: "https://origin.example/image.png" })
    ),
    /Invalid/
  );
  assert.equal(
    await cachedImage(
      "claim",
      "1",
      undefined,
      async () => new Response(null, { status: 422 })
    ),
    null
  );
  await assert.rejects(
    cachedImage(
      "claim",
      "1",
      undefined,
      async () => new Response(null, { status: 503 })
    ),
    /unavailable/
  );
});
