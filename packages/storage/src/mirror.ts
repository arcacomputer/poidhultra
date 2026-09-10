import { detectImage, type ObjectStore } from "./objects";
import { mediaURL } from "./media-source";

export const IMAGE_LIMIT = 20 * 1024 * 1024;
export const METADATA_LIMIT = 1024 * 1024;
export const REFRESH_MS = 24 * 3600_000;
const encoder = new TextEncoder();
export const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource)
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
export const imageKey = (hash: string) => "remote/v1/images/" + hash;
export const sourceKey = async (source: string, metadata: boolean) =>
  "remote/v1/sources/" +
  (await digest(encoder.encode((metadata ? "metadata:" : "image:") + source)));

export function publicMediaURL(value: unknown): string {
  const source = mediaURL(value);
  if (!source) throw new Error("Unsupported image URL");
  const url = new URL(source);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // No literal IPs, credentials, alternate ports, or local network names.
  // Node additionally pins a public DNS result; Workers use public-only fetch.
  if (
    url.port ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|arpa)$/.test(host)
  )
    throw new Error("Image host must be public HTTPS");
  url.hash = "";
  return url.href;
}

export async function readBounded(
  response: Response,
  limit: number
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty image response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > limit)
      throw new Error("Media is too large");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Media is too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export type Capture = {
  version: 1;
  source: string;
  resolvedSource: string;
  imageSource: string;
  sha256: string;
  metadataSha256?: string;
  contentType: string;
  size: number;
  capturedAt: string;
};

/** Durable source lookup plus immutable content. Only callers that have checked
 * a public bounty/claim/profile may ask for a capture; this is not a URL proxy. */
export class MediaMirror {
  private pending = new Map<string, Promise<Capture>>();
  private failures = new Map<string, number>();
  private active = 0;
  private queue: (() => void)[] = [];
  private fetcher: typeof fetch;
  private now: () => number;
  constructor(
    private options: {
      storage: ObjectStore;
      fetcher?: typeof fetch;
      now?: () => number;
      blockedHosts?: string[];
      localOrigin?: string;
    }
  ) {
    this.fetcher = options.fetcher ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
  }
  private localKey(source: string) {
    try {
      const url = new URL(source);
      if (url.origin !== this.options.localOrigin || url.search || url.hash)
        return null;
      const hash = url.pathname.match(
        /^\/media\/(remote\/)?sha256\/([a-f0-9]{64})$/
      );
      return hash ? (hash[1] ? imageKey(hash[2]) : "sha256/" + hash[2]) : null;
    } catch {
      return null;
    }
  }
  private sourceURL(source: unknown) {
    return typeof source === "string" && this.localKey(source)
      ? source
      : publicMediaURL(source);
  }
  private async fetchSource(source: string) {
    let url = source;
    const signal = AbortSignal.timeout(20_000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const localKey = this.localKey(url);
      if (localKey) {
        const object = await this.options.storage.get(localKey);
        if (!object) throw new Error("Stored media unavailable");
        return {
          url,
          response: new Response(object.body as BodyInit, {
            headers: { "Content-Type": object.type },
          }),
        };
      }
      url = publicMediaURL(url);
      if (this.options.blockedHosts?.includes(new URL(url).hostname))
        throw new Error("Recursive image source");
      const response = await this.fetcher(url, {
        method: "GET",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "manual",
        signal,
        headers: {
          Accept: "image/*, application/json;q=0.9",
          "Accept-Encoding": "identity",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("Invalid media redirect");
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Image source unavailable");
      }
      return { response, url };
    }
    throw new Error("Too many media redirects");
  }
  async capture(value: string, metadata = false): Promise<Capture> {
    const source = this.sourceURL(value);
    const key = await sourceKey(source, metadata);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 128)
      throw new Error("Image cache busy; retry shortly");
    const promise = this.captureSource(source, key, metadata);
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }
  private async captureSource(
    source: string,
    key: string,
    metadata: boolean
  ): Promise<Capture> {
    const stored = await this.options.storage.get(key);
    const previous: Capture | null = stored
      ? JSON.parse(
          new TextDecoder().decode(
            await readBounded(new Response(stored.body as BodyInit), 32_768)
          )
        )
      : null;
    if (previous && Date.parse(previous.capturedAt) > this.now() - REFRESH_MS)
      return previous;
    if ((this.failures.get(key) ?? 0) > this.now()) {
      if (previous) return previous;
      throw new Error("Image source temporarily unavailable");
    }
    if (this.active >= 2)
      await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      const fetched = await this.fetchSource(source);
      const advertisedImage = fetched.response.headers
        .get("content-type")
        ?.startsWith("image/");
      let bytes = await readBounded(
        fetched.response,
        metadata && !advertisedImage ? METADATA_LIMIT : IMAGE_LIMIT
      );
      let type = detectImage(bytes);
      let imageSource = fetched.url;
      let metadataSha256: string | undefined;
      if (!type && metadata) {
        if (bytes.length > METADATA_LIMIT)
          throw new Error("Metadata is too large");
        const data = JSON.parse(new TextDecoder().decode(bytes));
        imageSource = this.sourceURL(data?.image);
        const image = await this.fetchSource(imageSource);
        const imageBytes = await readBounded(image.response, IMAGE_LIMIT);
        type = detectImage(imageBytes);
        if (!type) throw new Error("Unsupported image content");
        metadataSha256 = await digest(bytes);
        await this.options.storage.put(
          "remote/v1/metadata/" + metadataSha256,
          bytes,
          "application/json"
        );
        bytes = imageBytes;
        imageSource = image.url;
      }
      if (!type) throw new Error("Unsupported image content");
      const sha256 = await digest(bytes);
      // Objects with identical bytes share one key even across distinct sources.
      await this.options.storage.put(imageKey(sha256), bytes, type);
      const capture: Capture = {
        version: 1,
        source,
        resolvedSource: fetched.url,
        imageSource,
        sha256,
        ...(metadataSha256 ? { metadataSha256 } : {}),
        contentType: type,
        size: bytes.length,
        capturedAt: new Date(this.now()).toISOString(),
      };
      const manifest = encoder.encode(JSON.stringify(capture));
      await this.options.storage.put(
        "remote/v1/manifests/" + (await digest(manifest)),
        manifest,
        "application/json"
      );
      // Publish the pointer last: a returned URL always names persisted bytes.
      await this.options.storage.put(key, manifest, "application/json");
      this.failures.delete(key);
      return capture;
    } catch (error) {
      if (this.failures.size >= 256)
        this.failures.delete(this.failures.keys().next().value!);
      this.failures.set(key, this.now() + 60_000);
      if (previous) return previous;
      throw error;
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export async function serveImage(
  request: Request,
  hash: string,
  storage: ObjectStore,
  cache?: Cache
) {
  if (!/^[a-f0-9]{64}$/.test(hash))
    return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  url.search = "";
  const cacheKey = new Request(url, { method: "GET" });
  const cached = await cache?.match(cacheKey);
  const headers = new Headers(
    cached?.headers ?? {
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: '"' + hash + '"',
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    }
  );
  headers.set("X-Poidh-Media-Cache", cached ? "HIT" : "STORE");
  if (cached) {
    if (request.headers.get("if-none-match") === headers.get("etag")) {
      await cached.body?.cancel();
      return new Response(null, { status: 304, headers });
    }
    return new Response(cached.body, { headers });
  }
  const object = await storage.get(imageKey(hash));
  if (!object)
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  headers.set("Content-Type", object.type);
  if (request.headers.get("if-none-match") === headers.get("etag")) {
    if (object.body instanceof ReadableStream) await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  const response = new Response(object.body as BodyInit, { headers });
  // Await the bounded cache write: cache population must survive request exit.
  await cache?.put(cacheKey, response.clone()).catch(() => {});
  return response;
}
