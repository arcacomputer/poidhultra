import test from "node:test";
import assert from "node:assert/strict";
import { isVideoSource } from "../apps/web/src/utils/mediaSource";

test("media classification ignores query strings and handles adversarial long URLs", () => {
  assert.equal(
    isVideoSource("https://example.com/proof.MP4?download=1#t=2"),
    true
  );
  assert.equal(
    isVideoSource("https://example.com/proof.png?redirect=movie.mp4"),
    false
  );
  assert.equal(isVideoSource("https://example.com/proof.webm#t=1"), true);
  const longSource =
    "https://example.com/" + ".mp4?".repeat(40_000) + "\nno-video";
  const start = performance.now();
  assert.equal(isVideoSource(longSource), true);
  assert.ok(
    performance.now() - start < 1000,
    "Classification must not backtrack over the query string"
  );
});
