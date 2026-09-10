import { serve } from "../../apps/community-api/node_modules/@hono/node-server/dist/index.mjs";
import {
  publicResponse,
  publicBounties,
  publicClaims,
} from "../fixtures/public-api";

const bounties = publicBounties.map((bounty) => ({
  ...bounty,
  description:
    bounty.onChainId === 120
      ? '![Garden cover](https://proofs.test/cover.png "The garden") A public API test bounty'
      : bounty.onChainId === 118
      ? "![Missing cover](https://proofs.test/broken.png) A public API test bounty"
      : bounty.description,
}));
const claims = [
  ...publicClaims,
  ...[
    { bountyId: 1105, url: "This proof has a malformed URI" },
    { bountyId: 1105, url: "https://proofs.test/missing-metadata" },
    { bountyId: 1105, url: "https://proofs.test/good-metadata" },
    { bountyId: 1104, url: "https://proofs.test/fallback.png" },
  ].map((claim, index) => ({
    ...publicClaims[0],
    ...claim,
    id: 6000 + index,
    onChainId: 500 + index,
    title: "Homepage proof " + index,
    isAccepted: false,
  })),
];

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
    return publicResponse(url, bounties, claims);
  },
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
