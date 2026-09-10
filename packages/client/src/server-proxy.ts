export type ProxyOptions = {
  origin: string;
  apiURL: string;
  proxyKey: string;
  readOnly?: boolean;
  service?: { fetch(request: Request): Promise<Response> };
};

// Server-only entry point. Keep proxyKey in the hosting environment, never in
// NEXT_PUBLIC variables or the browser's CommunityClient configuration.
export function createCommunityProxy(options: ProxyOptions) {
  return async (request: Request, path: string) => {
    if (
      !(
        path === "/api/v1" ||
        path.startsWith("/api/v1/") ||
        path.startsWith("/api/v1?") ||
        /^\/media\/sha256\/[a-f0-9]{64}$/.test(path)
      )
    )
      return Response.json({ error: "Unknown proxy path" }, { status: 404 });
    const write = !["GET", "HEAD"].includes(request.method);
    if (options.readOnly && write)
      return Response.json(
        {
          error:
            "This preview is read-only while shared community launch checks are completed.",
        },
        { status: 503 }
      );
    if (write && request.headers.get("origin") !== options.origin)
      return Response.json({ error: "Origin mismatch" }, { status: 403 });
    const headers = new Headers();
    for (const name of [
      "content-type",
      "cookie",
      "idempotency-key",
      "if-none-match",
    ]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("x-poidh-origin", options.origin);
    headers.set("x-poidh-proxy-key", options.proxyKey);
    if (write) headers.set("origin", options.origin);
    const url = new URL(path, options.apiURL);
    if (
      !(
        url.pathname === "/api/v1" ||
        url.pathname.startsWith("/api/v1/") ||
        /^\/media\/sha256\/[a-f0-9]{64}$/.test(url.pathname)
      )
    )
      return Response.json({ error: "Unknown proxy path" }, { status: 404 });
    if (!url.search) url.search = new URL(request.url).search;
    const forwarded = new Request(url, {
      method: request.method,
      headers,
      body: write ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    try {
      const response = options.service
        ? await options.service.fetch(forwarded)
        : await fetch(forwarded);
      const outgoing = new Headers();
      for (const name of [
        "content-type",
        "set-cookie",
        "cache-control",
        "etag",
        "content-security-policy",
        "x-content-type-options",
      ]) {
        const value = response.headers.get(name);
        if (value) outgoing.set(name, value);
      }
      if (!path.startsWith("/media/"))
        outgoing.set("cache-control", "no-store");
      return new Response(response.body, {
        status: response.status,
        headers: outgoing,
      });
    } catch {
      return Response.json(
        {
          error:
            "The community service is unavailable. Please try again shortly.",
        },
        { status: 503 }
      );
    }
  };
}
