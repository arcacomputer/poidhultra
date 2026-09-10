import test from "node:test";
import assert from "node:assert/strict";
import {
  cardMedia,
  mediaURL,
  proofImage,
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

test("proof metadata handles JSON and direct images without forwarding credentials", async () => {
  let calls = 0;
  const image = await proofImage(
    "https://proofs.example/metadata",
    undefined,
    async (_url, options) => {
      calls++;
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.referrerPolicy, "no-referrer");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.headers, undefined);
      return Response.json({ image: "ipfs://bafyexample/photo.jpg" });
    }
  );
  assert.equal(image, "https://ipfs.io/ipfs/bafyexample/photo.jpg");
  let cancelled = false;
  assert.equal(
    await proofImage(
      "https://proofs.example/image",
      undefined,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "image/png" } }
        )
    ),
    "https://proofs.example/image"
  );
  assert.equal(cancelled, true);
  assert.equal(
    await proofImage("javascript:alert(1)", undefined, async () => {
      calls++;
      throw new Error("Must not fetch");
    }),
    null
  );
  assert.equal(calls, 1);
  assert.equal(
    await proofImage("https://proofs.example/unsafe", undefined, async () =>
      Response.json({ image: "javascript:alert(1)" })
    ),
    null
  );
  await assert.rejects(
    proofImage(
      "https://proofs.example/huge",
      undefined,
      async () => new Response(" ".repeat(1024 * 1024 + 1))
    ),
    /too large/
  );
  await assert.rejects(
    proofImage(
      "https://proofs.example/missing",
      undefined,
      async () => new Response(null, { status: 404 })
    ),
    /unavailable/
  );
});
