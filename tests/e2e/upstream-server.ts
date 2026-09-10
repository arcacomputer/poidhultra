import { serve } from "../../apps/community-api/node_modules/@hono/node-server/dist/index.mjs";
import {
  publicResponse,
  publicBounties,
  publicClaims,
} from "../fixtures/public-api";
import { MediaMirror } from "../../packages/storage/src/mirror";
import { fixtureMediaFetch, memoryStore } from "../fixtures/media";

const { storage, objects } = memoryStore();
const mirror = new MediaMirror({ storage, fetcher: fixtureMediaFetch });
for (const [url, metadata] of [
  ["https://proofs.test/cover.png", false],
  ["https://proofs.test/fallback.png", true],
  ["https://proofs.test/proof.png", true],
  ["https://proofs.test/good-metadata", true],
  ["https://proofs.test/avatar.png", false],
] as const)
  await mirror.capture(url, metadata);

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
    // S3-compatible read fixture. The Node app must read persisted objects; a
    // browser route interception would hide a broken server-side storage path.
    if (url.pathname.startsWith("/media-test/")) {
      const object = objects.get(
        decodeURIComponent(url.pathname.slice("/media-test/".length))
      );
      return object
        ? new Response(object.body as BodyInit, {
            headers: { "Content-Type": object.type },
          })
        : new Response("<Error><Code>NoSuchKey</Code></Error>", {
            status: 404,
          });
    }
    if (url.pathname === "/api/v1/auth/session") return Response.json(null);
    if (
      url.pathname === "/api/v1/records" &&
      url.searchParams.get("kind") === "profile"
    )
      return Response.json({
        items: [
          {
            id: "profile-1",
            kind: "profile",
            author: "0x0000000000000000000000000000000000000001",
            data: {
              name: "Test creator",
              image: "https://proofs.test/avatar.png",
            },
            deletedAt: null,
            moderated: false,
            version: "1",
          },
        ],
        nextCursor: null,
      });
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
