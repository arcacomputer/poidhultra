import community from "../../apps/community-api/src/index";

// Only deployed to disposable rehearsal resources. The extra token keeps all
// synthetic community records and storage administration private.
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    if (
      !env.REHEARSAL_TOKEN ||
      request.headers.get("authorization") !== `Bearer ${env.REHEARSAL_TOKEN}`
    )
      return new Response("Not found", { status: 404 });
    const path = new URL(request.url).pathname;
    if (path === "/ops/objects" && request.method === "GET") {
      const cursor =
        new URL(request.url).searchParams.get("cursor") ?? undefined;
      const page = await env.PROOFS.list({
        prefix: "sha256/",
        cursor,
        include: ["httpMetadata"],
      });
      return Response.json({
        items: page.objects.map((o: any) => ({
          key: o.key,
          size: o.size,
          type: o.httpMetadata?.contentType,
        })),
        cursor: page.truncated ? page.cursor : null,
      });
    }
    const match = path.match(/^\/ops\/objects\/(sha256\/[a-f0-9]{64})$/);
    if (match && request.method === "PUT") {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 10 * 1024 * 1024)
        return new Response("Too large", { status: 413 });
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0")
      ).join("");
      if (match[1] !== "sha256/" + hash)
        return new Response("Digest mismatch", { status: 400 });
      await env.PROOFS.put(match[1], bytes, {
        httpMetadata: {
          contentType:
            request.headers.get("content-type") ?? "application/octet-stream",
          cacheControl: "public,max-age=31536000,immutable",
        },
      });
      return new Response(null, { status: 204 });
    }
    const response = await community.fetch(request, env, ctx);
    response.headers.set("x-rehearsal-revision", env.REHEARSAL_REVISION);
    return response;
  },
};
