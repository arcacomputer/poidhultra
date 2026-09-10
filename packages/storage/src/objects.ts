export interface ObjectStore {
  put(key: string, body: Uint8Array, type: string): Promise<void>;
  get(
    key: string
  ): Promise<{ body: ReadableStream | Uint8Array; type: string } | null>;
}
export function r2(bucket: {
  put: (key: string, value: Uint8Array, options: unknown) => Promise<unknown>;
  get: (key: string) => Promise<any>;
}): ObjectStore {
  return {
    put: async (key, body, type) => {
      await bucket.put(key, body, {
        httpMetadata: {
          contentType: type,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    },
    get: async (key) => {
      const value = await bucket.get(key);
      return value
        ? {
            body: value.body,
            type: value.httpMetadata?.contentType ?? "application/octet-stream",
          }
        : null;
    },
  };
}
export function detectImage(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  const text = new TextDecoder().decode(bytes.subarray(0, 12));
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a"))
    return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8) === "WEBP") return "image/webp";
  if (
    text.slice(4, 8) === "ftyp" &&
    ["avif", "avis"].includes(text.slice(8, 12))
  )
    return "image/avif";
  return null;
}
export function portableURI(uri: string): string {
  const url = new URL(uri);
  if (!["https:", "ipfs:"].includes(url.protocol))
    throw new Error("Proof URL must be HTTPS or IPFS");
  return uri;
}
