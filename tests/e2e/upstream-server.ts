import { serve } from "../../apps/community-api/node_modules/@hono/node-server/dist/index.mjs";
import { publicResponse } from "../fixtures/public-api";

const server = serve({
  port: 8788,
  fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/auth/session") return Response.json(null);
    if (url.pathname === "/api/v1/records")
      return Response.json({ items: [], nextCursor: null });
    if (url.pathname === "/api/v1/reactions")
      return Response.json({ counts: {}, mine: [] });
    for (const name of ["cookie", "authorization", "x-poidh-proxy-key"])
      if (request.headers.has(name))
        return Response.json(
          { error: "Credential leaked upstream" },
          { status: 500 }
        );
    return publicResponse(url);
  },
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
