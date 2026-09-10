const json = (schema: unknown) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const parameter = (
  name: string,
  where = "query",
  required = false,
  schema: unknown = { type: "string" }
) => ({ name, in: where, required, schema });
const cursor = [
  parameter("cursor"),
  parameter("limit", "query", false, {
    type: "integer",
    minimum: 1,
    maximum: 100,
  }),
];
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const page = (schema: unknown) => ({
  type: "object",
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array", items: schema },
    nextCursor: { type: ["string", "null"] },
  },
});
const operation = (summary: string, schema: unknown, write = false) => ({
  summary,
  ...(write
    ? {
        security: [{ session: [] }],
        parameters: [
          parameter("Origin", "header", true),
          parameter("Idempotency-Key", "header", true),
        ],
      }
    : {}),
  responses: {
    "200": { description: "Success", content: json(schema) },
    "400": { description: "Invalid input", content: json(ref("Error")) },
    "401": { description: "A domain-bound SIWE session is required" },
    "403": { description: "Origin or ownership check failed" },
    "409": { description: "Stale version or idempotency conflict" },
    "503": {
      description:
        "Dependency unavailable; safe to retry idempotent operations",
    },
  },
});
const record = {
  type: "object",
  required: [
    "id",
    "kind",
    "author",
    "data",
    "version",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    kind: { enum: ["profile", "album", "comment", "reaction", "notification"] },
    author: ref("Address"),
    bountyId: { type: ["string", "null"] },
    parentId: { type: ["string", "null"] },
    data: { type: "object" },
    version: ref("UInt"),
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    deletedAt: { type: ["string", "null"], format: "date-time" },
    moderated: { type: "boolean" },
  },
};
const bounty = {
  type: "object",
  required: ["id", "chainId", "onChainId", "displayId", "amount", "archive"],
  properties: {
    id: ref("BountyKey"),
    chainId: { enum: [1, 8453, 42161, 666666666] },
    contract: ref("Address"),
    onChainId: ref("UInt"),
    displayId: ref("UInt"),
    amount: ref("UInt"),
    createdAt: ref("UInt"),
    title: { type: "string" },
    description: { type: "string" },
    issuer: ref("Address"),
    status: { enum: ["open", "voting", "completed", "cancelled"] },
    multiplayer: { type: "boolean" },
    claimCount: { type: "integer" },
    archive: { type: "boolean" },
    archiveAsOf: { type: ["string", "null"] },
  },
};
const claim = {
  type: "object",
  properties: {
    id: ref("BountyKey"),
    bountyId: ref("BountyKey"),
    onChainId: ref("UInt"),
    issuer: ref("Address"),
    owner: ref("Address"),
    title: { type: "string" },
    description: { type: "string" },
    uri: { type: "string" },
    accepted: { type: "boolean" },
    createdAt: ref("UInt"),
  },
};
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "poidh community",
    version: "1.0.0",
    license: { name: "MIT", identifier: "MIT" },
    description:
      "Each frontend proxies /api/v1 through its own origin. The proxy supplies X-Poidh-Origin and its private X-Poidh-Proxy-Key. Never expose a proxy key to browser code. All blockchain integers and versions are canonical decimal strings. Sessions are independent per origin; records are shared. Public reads do not require authentication.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "poidh_session" },
    },
    schemas: {
      UInt: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
      Address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
      BountyKey: {
        type: "string",
        pattern: "^(1|8453|42161|666666666):0x[0-9a-f]{40}:(0|[1-9][0-9]*)$",
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
      Record: record,
      Bounty: bounty,
      Claim: claim,
    },
  },
  paths: {
    "/auth/challenge": {
      post: {
        ...operation("Create a five-minute SIWE challenge", {}, false),
        requestBody: body({
          type: "object",
          required: ["address", "chainId"],
          properties: {
            address: ref("Address"),
            chainId: { enum: [1, 8453, 42161] },
          },
        }),
      },
    },
    "/auth/verify": {
      post: {
        ...operation(
          "Consume a signed challenge once and set a seven-day session",
          {}
        ),
        requestBody: body({
          type: "object",
          required: ["message", "signature"],
          properties: {
            message: { type: "string" },
            signature: { type: "string" },
          },
        }),
      },
    },
    "/auth/session": {
      get: operation("Current wallet for this origin, or null", {
        type: ["object", "null"],
      }),
    },
    "/auth/logout": { post: operation("Revoke this session", {}, true) },
    "/bounties": {
      get: {
        ...operation("Browse visible bounties", page(ref("Bounty"))),
        parameters: [
          ...cursor,
          ...["chain", "status", "issuer", "q", "archive"].map((n) =>
            parameter(n)
          ),
        ],
      },
    },
    "/bounties/{id}": {
      parameters: [parameter("id", "path", true)],
      get: operation("Read a bounty", ref("Bounty")),
    },
    "/bounties/{id}/claims": {
      parameters: [parameter("id", "path", true)],
      get: {
        ...operation("Paginate proofs", page(ref("Claim"))),
        parameters: cursor,
      },
    },
    "/profiles/{address}/proofs": {
      parameters: [parameter("address", "path", true)],
      get: {
        ...operation("Proofs created or owned", page(ref("Claim"))),
        parameters: [...cursor, parameter("mode")],
      },
    },
    "/activity": {
      get: {
        ...operation(
          "Latest protocol events, amounts serialized as strings",
          page({ type: "object" })
        ),
        parameters: cursor,
      },
    },
    "/leaderboard": {
      get: {
        ...operation("Protocol reward rankings", page({ type: "object" })),
        parameters: cursor,
      },
    },
    "/legacy": {
      get: {
        ...operation("Resolve a historical path", {}),
        parameters: [parameter("path", "query", true)],
      },
    },
    "/archive": {
      get: operation(
        "Timestamped historical snapshots and their provenance",
        {}
      ),
    },
    "/records": {
      get: {
        ...operation("Public community records", page(ref("Record"))),
        parameters: [
          ...cursor,
          parameter("kind", "query", true),
          ...["bountyId", "author", "parentId"].map((n) => parameter(n)),
        ],
      },
      post: {
        ...operation("Create an owned community record", ref("Record"), true),
        requestBody: body({
          type: "object",
          required: ["kind", "data"],
          properties: {
            kind: { enum: ["comment", "profile", "album", "reaction"] },
            bountyId: ref("BountyKey"),
            parentId: { type: "string" },
            data: { type: "object" },
          },
        }),
      },
    },
    "/records/{id}": {
      parameters: [parameter("id", "path", true)],
      get: operation("Read one public record", ref("Record")),
      patch: {
        ...operation(
          "Update with optimistic version check",
          ref("Record"),
          true
        ),
        requestBody: body({
          type: "object",
          required: ["version", "data"],
          properties: { version: ref("UInt"), data: { type: "object" } },
        }),
      },
      delete: {
        ...operation("Delete and emit a tombstone", {}, true),
        requestBody: body({
          type: "object",
          required: ["version"],
          properties: { version: ref("UInt") },
        }),
      },
    },
    "/reactions": {
      get: {
        ...operation(
          "Complete reaction counts and this session’s reactions",
          {}
        ),
        parameters: [parameter("bountyId", "query", true)],
      },
    },
    "/changes": {
      get: {
        ...operation(
          "Ordered upserts and tombstones; repeat the returned cursor",
          {}
        ),
        parameters: [parameter("after"), parameter("limit")],
      },
    },
    "/notifications": {
      get: {
        ...operation(
          "Private notifications for this session",
          page(ref("Record"))
        ),
        security: [{ session: [] }],
        parameters: cursor,
      },
    },
    "/notifications/{id}/read": {
      parameters: [parameter("id", "path", true)],
      post: operation("Mark a private notification read", ref("Record"), true),
    },
    "/moderation/{id}": {
      parameters: [parameter("id", "path", true)],
      post: {
        ...operation("Moderator: hide or restore a record", {}, true),
        requestBody: body({
          type: "object",
          required: ["hidden", "reason"],
          properties: {
            hidden: { type: "boolean" },
            reason: { type: "string", minLength: 10 },
          },
        }),
      },
    },
    "/moderation/protocol/{kind}/{id}": {
      parameters: [
        parameter("id", "path", true),
        parameter("kind", "path", true),
      ],
      post: {
        ...operation("Moderator: hide or restore indexed content", {}, true),
        requestBody: body({
          type: "object",
          required: ["hidden", "reason"],
          properties: {
            hidden: { type: "boolean" },
            reason: { type: "string", minLength: 10 },
          },
        }),
      },
    },
    "/uploads": {
      post: {
        ...operation("Upload immutable proof bytes, at most 10 MiB", {}),
        security: [{ session: [] }],
        requestBody: {
          required: true,
          content: Object.fromEntries(
            ["image/png", "image/jpeg", "image/webp", "image/gif"].map((t) => [
              t,
              { schema: { type: "string", format: "binary" } },
            ])
          ),
        },
      },
    },
    "/metadata": {
      post: {
        ...operation("Store immutable NFT metadata", {}),
        security: [{ session: [] }],
        requestBody: body({
          type: "object",
          required: ["name", "description", "image"],
          properties: {
            name: { type: "string", maxLength: 120 },
            description: { type: "string", maxLength: 5000 },
            image: { type: "string" },
            external_url: { type: "string" },
            attributes: { type: "array", items: { type: "object" } },
          },
        }),
      },
    },
  },
};
