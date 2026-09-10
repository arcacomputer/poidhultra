# Integrating poidh.xyz with the shared community

This is a reviewable integration path, not a claim that Kenny has installed it. His deployment and scoped data export remain launch prerequisites. The original site can keep its existing blockchain-read routers while switching community reads and writes together; do not run two writable community databases after cutover.

## Server connection

An original frontend running on Node or Vercel cannot reach Ultra's private Cloudflare service binding directly. `apps/community-api/wrangler.gateway.jsonc` supplies an optional public HTTP gateway to the same private API. Only `/api/v1` and immutable media paths are forwarded. The API still requires the origin's proxy key, a matching browser Origin, and its own SIWE session for authenticated operations. The gateway is prepared but has not been deployed.

Use the MIT source of `packages/client` and `packages/protocol` as local packages in the original project's workspace. Configure Next's `transpilePackages` for `@poidh/client` and `@poidh/protocol`. No proprietary authentication or social SDK is needed. The `@poidh/client/server-proxy` entry point has no Next.js or Cloudflare dependency.

Mount this handler in the original site's `/api/v1/[...path]` route. Set `COMMUNITY_API_URL` to the reviewed gateway URL and install the **poidh.xyz-specific** `COMMUNITY_PROXY_KEY` on its server through a secure handoff. Never reuse Ultra's proxy key or put either key in a public environment variable.

```ts
import { createCommunityProxy } from "@poidh/client/server-proxy";

const proxy = createCommunityProxy({
  origin: "https://poidh.xyz",
  apiURL: process.env.COMMUNITY_API_URL!,
  proxyKey: process.env.COMMUNITY_PROXY_KEY!,
});
const handler = (request: Request) =>
  proxy(request, new URL(request.url).pathname);
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
```

Use the same handler for `/media/sha256/[digest]` so immutable proof URLs retain the site's origin. The proxy carries query parameters, cookies, idempotency keys and response cookies; it replaces client-supplied proxy headers and rejects writes from other origins. Existing Ultra and preview deployments use this same portable implementation behind their Cloudflare environment adapter.

## Browser authentication and community calls

```ts
import { CommunityClient } from "@poidh/client";
const client = new CommunityClient("/api/v1");
const challenge = await client.challenge(address, chainId);
const signature = await signMessageAsync({ message: challenge.message });
await client.verify(challenge.message, signature);
```

The session is independent of the one on Ultra. Use `client.records`, `client.write`, and `client.changes` for profiles, albums, comments, reactions and updates/deletions. A mutation's idempotency key must survive retries; create it once for the user action, then reuse it until that action succeeds or is abandoned.

`@poidh/client/legacy-community` translates the original community shapes. Bind its request function to the same-origin typed client. For a mutation, bind one stable idempotency key:

```ts
import { legacyCommunity } from "@poidh/client/legacy-community";
const legacy = legacyCommunity((path, method = "GET", data) =>
  method === "GET"
    ? client.request(path)
    : client.write(path, method, data, mutationId)
);
```

| Original procedure    | Adapter             | Cutover behavior                                                                                                |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `comments.fetch`      | `legacy.comments`   | Reads all pages and complete reaction totals; includes imported parent IDs and profile data.                    |
| `comments.comment`    | `legacy.comment`    | SIWE author must match `address`; imported numeric `parrentId` maps to `original:comment:<id>`, including zero. |
| `comments.rate`       | `legacy.rate`       | Validates chain and author; edits the actor's existing reaction rather than duplicating it.                     |
| `albums.fetch`        | `legacy.albums`     | Searches names and returns `{album,count:{album}}`; follows every page.                                         |
| `albums.trending`     | `legacy.trending`   | Counts distinct visible open bounties and sorts by their latest creation timestamp.                             |
| `bounties.addToAlbum` | `legacy.addToAlbum` | Resolves an owned album by name or ID, or creates an owned collection; ambiguous names require an ID.           |
| `neynar.usersData`    | `legacy.profiles`   | Uses shared public profiles; an owner-chosen display name is never labeled verified ENS.                        |
| `admin.banComment`    | `legacy.banComment` | Uses the shared moderator role and records a moderation reason.                                                 |

Use opaque record IDs returned by the API in new UI state. Do not coerce them to numbers. Old decimal comment IDs are accepted for imported records; blockchain IDs and amounts stay exact decimal strings. The original album system stored one label per bounty without an owner; reviewed ownership mapping is still required before importing it into owned collections. Clearing a legacy label with an empty string requires an explicit collection edit in the new UI, not an unauthenticated global mutation.

## Remaining original-client audit

The complete tRPC bridge is **not** a drop-in replacement for every original procedure. Protocol/account/voting/refund procedures, price-based sorting, metadata rendering, old pagination shapes, and optional naming/passport interfaces require their own audit. `claims.fetch` now reads one claim rather than incorrectly returning a bounty's claim list. Callers must use canonical chain/contract/claim keys (or an explicit contract), because numeric claim IDs overlap between contract versions. `claims.fetchBountyClaims` is the separate paginated list. The typed claim response preserves its metadata URI; the client must resolve/display that metadata, as Ultra already does.

Before accepting the original-client gate: apply the scoped export, verify authors/relationships/moderation/timestamps and album ownership, exercise both origins with different sessions, create/edit/delete/react on both clients, verify change-feed catch-up, test offline retries, and audit every retained original procedure. No communication or deployment to Kenny's systems has been performed by this integration guide.
