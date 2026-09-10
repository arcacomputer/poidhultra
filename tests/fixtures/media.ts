import { deflateSync } from "node:zlib";
import type { ObjectStore } from "../../packages/storage/src/objects";
// A deterministic large raster catches intrinsic-size grid overflow, unlike 1px fixtures.
function chunk(type: string, bytes: Buffer) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(2400);
header.writeUInt32BE(1600, 4);
header[8] = 8;
header[9] = 2;
const rows = Buffer.alloc((2400 * 3 + 1) * 1600, 145);
for (let row = 0; row < 1600; row++) rows[row * (2400 * 3 + 1)] = 0;
export const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(rows)),
  chunk("IEND", Buffer.alloc(0)),
]);
export function memoryStore() {
  const objects = new Map<string, { body: Uint8Array; type: string }>();
  const storage: ObjectStore = {
    async put(key, body, type) {
      objects.set(key, { body: Uint8Array.from(body), type });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
  };
  return { objects, storage };
}
export const fixtureMediaFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (["/broken.png", "/missing-metadata"].includes(url.pathname))
    return new Response(null, { status: 404 });
  if (url.pathname === "/good-metadata")
    return Response.json({ image: "ipfs://bafytest/preview.png" });
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
