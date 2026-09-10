import {
  bounties as bountySource,
  claims as claimSource,
  visibleBounty,
  visibleClaim,
} from "./queries";
import { openapi } from "./openapi";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { parseSiweMessage } from "viem/siwe";
import type { Hex } from "viem";
import { challenge, digest, randomToken, verifyChallenge } from "@poidh/auth";
import type { Database, SQL } from "@poidh/database";
import { serial } from "@poidh/database";
import {
  address,
  bountyKey,
  uint,
  deployments,
  legacyDeployments,
  resolveLegacyURL,
  key,
  type CommunityRecord,
} from "@poidh/protocol";
import { detectImage, portableURI, type ObjectStore } from "@poidh/storage";

export type Options = {
  db: Database;
  storage: ObjectStore;
  origins: string[];
  proxyKeys: Record<string, string>;
  publicStorageURL: string;
  moderators: string[];
  now?: () => Date;
};
class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function assert(
  condition: unknown,
  status: number,
  message: string
): asserts condition {
  if (!condition) throw new APIError(status, message);
}
const cookie = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("poidh_session="))
    ?.slice(14);
const record = (row: any): CommunityRecord => ({
  id: row.id,
  kind: row.kind,
  author: row.author,
  bountyId: row.bounty_id,
  parentId: row.parent_id,
  data: row.data,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  moderated: row.moderated,
  version: String(row.version),
});
const optionalURL = z
  .string()
  .max(2048)
  .url()
  .refine((v) => v.startsWith("https://"))
  .nullable()
  .optional();
const schemas = {
  comment: z.object({ body: z.string().trim().min(1).max(5000) }).strict(),
  profile: z
    .object({
      name: z.string().trim().max(80),
      bio: z.string().max(1000),
      image: optionalURL,
      website: optionalURL,
    })
    .strict(),
  album: z
    .object({
      title: z.string().trim().min(1).max(120),
      description: z.string().max(2000),
      bounties: z.array(bountyKey).max(200),
    })
    .strict(),
  reaction: z.object({ type: z.enum(["upvote", "downvote"]) }).strict(),
};
const createSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.enum(["comment", "profile", "album", "reaction"]),
    bountyId: bountyKey.nullable().optional(),
    parentId: z.string().max(256).nullable().optional(),
    data: z.record(z.unknown()),
  })
  .strict();
const editSchema = z
  .object({ version: uint, data: z.record(z.unknown()) })
  .strict();
const limitOf = (value: string | undefined, max = 100) =>
  Math.min(max, Math.max(1, Number(value) || 30));

export function createAPI(options: Options) {
  const { db, storage } = options;
  const now = options.now ?? (() => new Date());
  const app = new Hono();
  app.use(
    "*",
    bodyLimit({
      maxSize: 10 * 1024 * 1024,
      onError: (c) => c.json({ error: "Request exceeds 10 MiB" }, 413),
    })
  );
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (
      c.req.path.startsWith("/api/v1/auth") ||
      c.req.path.includes("/notifications")
    )
      c.header("Cache-Control", "no-store");
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: "Invalid request", issues: error.issues }, 400);
    if (error instanceof APIError)
      return c.json({ error: error.message }, error.status as any);
    if ((error as any).code === "23505")
      return c.json({ error: "Record already exists" }, 409);
    if ((error as any).code === "23503")
      return c.json({ error: "Related record not found" }, 422);
    console.error("Community request failed", {
      name: error.name,
      code: (error as any).code,
    });
    return c.json({ error: "Service temporarily unavailable" }, 503);
  });
  async function client(request: Request) {
    const origin = request.headers.get("x-poidh-origin") ?? "";
    assert(options.origins.includes(origin), 403, "Unknown client origin");
    const expected = options.proxyKeys[origin];
    const provided = request.headers.get("x-poidh-proxy-key");
    assert(
      expected &&
        provided &&
        (await digest(expected)) === (await digest(provided)),
      403,
      "Invalid client proxy"
    );
    if (!["GET", "HEAD"].includes(request.method))
      assert(request.headers.get("origin") === origin, 403, "Origin mismatch");
    return origin;
  }
  async function session(request: Request, required = true) {
    const token = cookie(request);
    if (!token) {
      if (required) throw new APIError(401, "Sign in to continue");
      return null;
    }
    const origin = await client(request);
    const tokenHash = await digest(token);
    const { rows } = await db.query<{ address: string }>(
      "SELECT address FROM community.sessions WHERE token_hash=$1 AND origin=$2 AND expires_at>$3",
      [tokenHash, origin, now()]
    );
    if (!rows[0] && required) throw new APIError(401, "Session expired");
    return rows[0] ? { address: rows[0].address, origin, tokenHash } : null;
  }
  async function change(
    tx: SQL,
    row: any,
    operation: "upsert" | "delete" = "upsert"
  ) {
    const value = record(row);
    const removed =
      operation === "delete" || value.deletedAt || value.moderated;
    await tx.query(
      "INSERT INTO community.changes(kind,record_id,operation,version,data,recipient) VALUES($1,$2,$3,$4,$5,$6)",
      [
        row.kind,
        row.id,
        removed ? "delete" : "upsert",
        row.version,
        removed ? null : JSON.stringify(value),
        row.recipient,
      ]
    );
    return value;
  }
  async function write(
    c: any,
    fn: (tx: SQL, actor: string) => Promise<{ data: unknown; status?: number }>
  ) {
    const actor = await session(c.req.raw);
    const idempotency = c.req.header("idempotency-key");
    assert(
      idempotency && /^[a-zA-Z0-9:_-]{8,128}$/.test(idempotency),
      400,
      "Supply an Idempotency-Key"
    );
    const requestHash = await digest(
      c.req.method +
        " " +
        new URL(c.req.url).pathname +
        " " +
        (await c.req.text())
    );
    const scope = actor!.address;
    const result = await db.transaction((tx) =>
      serial(tx, "community-writes", async () => {
        const old = (
          await tx.query<any>(
            "SELECT request_hash,response,status FROM community.idempotency WHERE scope=$1 AND key=$2",
            [scope, idempotency]
          )
        ).rows[0];
        if (old) {
          assert(
            old.request_hash === requestHash,
            409,
            "Idempotency key reused for a different request"
          );
          return { data: old.response, status: old.status };
        }
        const result = await fn(tx, actor!.address);
        await tx.query(
          "INSERT INTO community.idempotency(scope,key,request_hash,response,status) VALUES($1,$2,$3,$4,$5)",
          [
            scope,
            idempotency,
            requestHash,
            JSON.stringify(result.data),
            result.status ?? 200,
          ]
        );
        return result;
      })
    );
    c.header("Cache-Control", "no-store");
    return c.json(result.data, result.status ?? 200);
  }
  const bountySelect = `SELECT id,chain_id AS "chainId",contract,on_chain_id::text AS "onChainId",display_id::text AS "displayId",issuer,title,description,amount::text,created_at::text AS "createdAt",status,multiplayer,claim_count AS "claimCount",archive,archive_as_of AS "archiveAsOf" FROM ${bountySource}`;
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/ready", async (c) => {
    await db.query("SELECT 1 FROM community.records LIMIT 1");
    await db.query("SELECT 1 FROM protocol_api.bounty LIMIT 1");
    return c.json({ status: "ready" });
  });
  app.get("/api/v1/openapi.json", (c) => c.json(openapi));
  app.get("/api/v1/archive", async (c) =>
    c.json({
      items: (
        await db.query(
          "SELECT id,source,captured_at,chain_id,block_number::text,block_hash,verified,provenance FROM archive.snapshots ORDER BY captured_at"
        )
      ).rows,
    })
  );
  app.get("/api/v1", (c) =>
    c.json({
      name: "poidh community",
      version: 1,
      docs: "/api/v1/openapi.json",
    })
  );
  app.post("/api/v1/auth/challenge", async (c) => {
    const origin = await client(c.req.raw);
    const input = z
      .object({ address, chainId: z.number().int() })
      .parse(await c.req.json());
    const value = challenge({ ...input, origin, now: now() });
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM community.challenges WHERE expires_at<$1", [
        now(),
      ]);
      await tx.query(
        "INSERT INTO community.challenges(nonce,origin,message,expires_at) VALUES($1,$2,$3,$4)",
        [
          value.nonce,
          origin,
          value.message,
          new Date(now().getTime() + 300_000),
        ]
      );
    });
    return c.json(value);
  });
  app.post("/api/v1/auth/verify", async (c) => {
    const origin = await client(c.req.raw);
    const input = z
      .object({
        message: z.string().max(4096),
        signature: z
          .string()
          .regex(/^0x[0-9a-fA-F]+$/)
          .max(2048),
      })
      .parse(await c.req.json());
    const nonce = parseSiweMessage(input.message).nonce;
    assert(nonce, 400, "Missing nonce");
    const expected = (
      await db.query<{ message: string }>(
        "SELECT message FROM community.challenges WHERE nonce=$1 AND origin=$2 AND expires_at>$3",
        [nonce, origin, now()]
      )
    ).rows[0];
    assert(expected, 401, "Challenge expired or already used");
    let verified;
    try {
      verified = await verifyChallenge({
        ...input,
        signature: input.signature as Hex,
        expectedMessage: expected.message,
        origin,
        now: now(),
      });
    } catch {
      throw new APIError(401, "Invalid SIWE signature or domain");
    }
    const token = randomToken();
    const hash = await digest(token);
    const expires = new Date(now().getTime() + 7 * 86400_000);
    await db.transaction(async (tx) => {
      const deleted = await tx.query(
        "DELETE FROM community.challenges WHERE nonce=$1 AND origin=$2 AND expires_at>$3 RETURNING nonce",
        [nonce, origin, now()]
      );
      assert(deleted.rows.length, 401, "Challenge already used");
      await tx.query(
        "INSERT INTO community.sessions(token_hash,origin,address,expires_at) VALUES($1,$2,$3,$4)",
        [hash, origin, verified.address, expires]
      );
    });
    c.header(
      "Set-Cookie",
      `poidh_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${
        origin.startsWith("https:") ? "; Secure" : ""
      }`
    );
    return c.json({
      address: verified.address,
      expiresAt: expires.toISOString(),
    });
  });
  app.get("/api/v1/auth/session", async (c) =>
    c.json(
      await session(c.req.raw, false).then((s) =>
        s ? { address: s.address } : null
      )
    )
  );
  app.post("/api/v1/auth/logout", async (c) => {
    const actor = await session(c.req.raw);
    await db.query("DELETE FROM community.sessions WHERE token_hash=$1", [
      actor!.tokenHash,
    ]);
    c.header(
      "Set-Cookie",
      "poidh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    );
    return c.json({ ok: true });
  });
  app.get("/api/v1/bounties", async (c) => {
    const args: unknown[] = [];
    const conditions = [visibleBounty];
    for (const [param, column] of [
      ["chain", "chain_id"],
      ["status", "status"],
      ["issuer", "issuer"],
    ] as const) {
      const value = c.req.query(param);
      if (value) {
        args.push(
          param === "chain"
            ? z.coerce.number().int().parse(value)
            : value.toLowerCase()
        );
        conditions.push(`${column}=$${args.length}`);
      }
    }
    const search = c.req.query("q");
    if (search) {
      args.push("%" + search.slice(0, 200) + "%");
      conditions.push(
        `(title ILIKE $${args.length} OR description ILIKE $${args.length})`
      );
    }
    if (c.req.query("archive") !== "true") conditions.push("archive=false");
    const cursor = c.req.query("cursor");
    if (cursor) {
      const value = z
        .tuple([z.string(), z.string()])
        .parse(JSON.parse(atob(cursor)));
      args.push(value[0], value[1]);
      conditions.push(
        `(created_at,id)<($${args.length - 1}::numeric,$${args.length})`
      );
    }
    const limit = limitOf(c.req.query("limit"));
    args.push(limit + 1);
    const { rows } = await db.query<any>(
      bountySelect +
        " WHERE " +
        conditions.join(" AND ") +
        ` ORDER BY created_at DESC,id DESC LIMIT $${args.length}`,
      args
    );
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return c.json({
      items,
      nextCursor:
        rows.length > limit && last
          ? btoa(JSON.stringify([last.createdAt, last.id]))
          : null,
    });
  });
  app.get("/api/v1/bounties/:id", async (c) => {
    const id = bountyKey.parse(c.req.param("id"));
    const { rows } = await db.query(
      bountySelect + " WHERE id=$1 AND " + visibleBounty,
      [id]
    );
    assert(rows[0], 404, "Bounty not found");
    return c.json(rows[0]);
  });
  app.get("/api/v1/bounties/:id/claims", async (c) => {
    const id = bountyKey.parse(c.req.param("id"));
    const cursor = c.req.query("cursor") ?? "";
    const limit = limitOf(c.req.query("limit"));
    const { rows } = await db.query<any>(
      `SELECT id,bounty_id AS "bountyId",on_chain_id::text AS "onChainId",issuer,owner,title,description,uri,accepted,created_at::text AS "createdAt" FROM ${claimSource} WHERE bounty_id=$1 AND id>$2 AND ${visibleClaim} ORDER BY id LIMIT $3`,
      [id, cursor, limit + 1]
    );
    return c.json({
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    });
  });
  app.get("/api/v1/claims/:id", async (c) => {
    const id = bountyKey.parse(c.req.param("id"));
    const { rows } = await db.query<any>(
      `SELECT id,bounty_id AS "bountyId",on_chain_id::text AS "onChainId",issuer,owner,title,description,uri,accepted,created_at::text AS "createdAt" FROM ${claimSource} WHERE id=$1 AND ${visibleClaim}`,
      [id]
    );
    assert(rows[0], 404, "Claim not found");
    return c.json(rows[0]);
  });
  app.get("/api/v1/activity", async (c) => {
    const args: unknown[] = [];
    let filter = "true";
    const cursor = c.req.query("cursor");
    if (cursor) {
      const pair = z.tuple([uint, z.string()]).parse(JSON.parse(atob(cursor)));
      args.push(...pair);
      filter = "(timestamp,id)<($1::numeric,$2)";
    }
    const limit = limitOf(c.req.query("limit"));
    args.push(limit + 1);
    const { rows } = await db.query<any>(
      `SELECT id,name,chain_id AS "chainId",timestamp::text,transaction_hash AS "transactionHash",contract,block_number::text AS "blockNumber",data FROM protocol_api.event WHERE ${filter} ORDER BY timestamp DESC,id DESC LIMIT $${args.length}`,
      args
    );
    return c.json({
      items: rows.slice(0, limit),
      nextCursor:
        rows.length > limit
          ? btoa(
              JSON.stringify([rows[limit - 1].timestamp, rows[limit - 1].id])
            )
          : null,
    });
  });
  app.get("/api/v1/profiles/:address/proofs", async (c) => {
    const owner = address.parse(c.req.param("address"));
    const cursor = c.req.query("cursor") ?? "";
    const mode = c.req.query("mode") === "owned" ? "owner" : "issuer";
    const limit = limitOf(c.req.query("limit"));
    const { rows } = await db.query<any>(
      `SELECT id,bounty_id AS "bountyId",on_chain_id::text AS "onChainId",issuer,owner,title,description,uri,accepted,created_at::text AS "createdAt" FROM ${claimSource} WHERE ${mode}=$1 AND id>$2 AND ${visibleClaim} ORDER BY id LIMIT $3`,
      [owner, cursor, limit + 1]
    );
    return c.json({
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    });
  });
  app.post("/api/v1/moderation/protocol/:kind/:id", async (c) => {
    const kind = z.enum(["bounty", "claim"]).parse(c.req.param("kind"));
    const id = bountyKey.parse(c.req.param("id"));
    const input = z
      .object({
        hidden: z.boolean(),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(await c.req.json());
    return write(c, async (tx, actor) => {
      assert(
        options.moderators.includes(actor),
        403,
        "Moderator access required"
      );
      await tx.query(
        "INSERT INTO community.protocol_moderation(id,kind,hidden,moderator,reason,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(id) DO UPDATE SET hidden=$3,moderator=$4,reason=$5,updated_at=now()",
        [id, kind, input.hidden, actor, input.reason]
      );
      await tx.query(
        "INSERT INTO community.protocol_moderation_log(id,kind,hidden,moderator,reason) VALUES($1,$2,$3,$4,$5)",
        [id, kind, input.hidden, actor, input.reason]
      );
      await tx.query(
        "INSERT INTO community.changes(kind,record_id,operation,version,data) VALUES($1,$2,$3,1,$4)",
        [
          "moderation",
          id,
          input.hidden ? "delete" : "upsert",
          JSON.stringify({ kind, hidden: input.hidden }),
        ]
      );
      return { data: { ok: true } };
    });
  });
  app.get("/api/v1/leaderboard", async (c) => {
    const limit = limitOf(c.req.query("limit"));
    const args: unknown[] = [];
    let filter = "true";
    const cursor = c.req.query("cursor");
    if (cursor) {
      const pair = z
        .tuple([uint, address, z.number().int()])
        .parse(JSON.parse(atob(cursor)));
      args.push(...pair);
      filter =
        "(score<$1::numeric OR (score=$1::numeric AND (address,chain_id)>($2,$3)))";
    }
    const excluded = [
      ...deployments.flatMap((d) => [
        d.address.toLowerCase(),
        d.nft.toLowerCase(),
      ]),
      ...legacyDeployments.map((d) => d.address.toLowerCase()),
      "0xddfb1a53e7b73dba09f79fca24765c593d447a80",
    ];
    args.push(excluded, limit + 1);
    const { rows } = await db.query<any>(
      `WITH ranked AS (SELECT *, (earned+paid)*1000+nfts*10000000000000000000 AS score FROM protocol_api.account) SELECT address,chain_id AS "chainId",earned::text,paid::text,nfts::text,score::text FROM ranked WHERE ${filter} AND NOT(address=ANY($${
        args.length - 1
      }::text[])) ORDER BY score DESC,address,chain_id LIMIT $${args.length}`,
      args
    );
    return c.json({
      items: rows.slice(0, limit),
      nextCursor:
        rows.length > limit
          ? btoa(
              JSON.stringify([
                rows[limit - 1].score,
                rows[limit - 1].address,
                rows[limit - 1].chainId,
              ])
            )
          : null,
    });
  });
  app.get("/api/v1/legacy", async (c) => {
    const path = z
      .string()
      .startsWith("/")
      .max(2048)
      .parse(c.req.query("path"));
    const imported = (
      await db.query(
        'SELECT bounty_id AS "bountyId",record_id AS "recordId" FROM community.legacy_urls WHERE path=$1',
        [path]
      )
    ).rows[0];
    if (imported) return c.json(imported);
    const parts = path.match(
      /^\/(mainnet|base|arbitrum|degen)\/bounty\/(\d+)\/?$/
    );
    assert(parts, 404, "Unknown historical URL");
    const found = resolveLegacyURL(parts[1], parts[2]);
    return c.json({
      bountyId: key(
        found.deployment.chainId,
        found.deployment.address,
        found.onChainId
      ),
    });
  });
  app.get("/api/v1/profiles", async (c) => {
    const addresses = z
      .array(address)
      .min(1)
      .max(100)
      .parse((c.req.query("addresses") ?? "").split(","));
    const { rows } = await db.query<any>(
      "SELECT * FROM community.records WHERE kind='profile' AND author=ANY($1::text[]) AND moderated=false AND deleted_at IS NULL ORDER BY author",
      [addresses]
    );
    return c.json({ items: rows.map(record) });
  });
  app.get("/api/v1/albums", async (c) => {
    const trending = c.req.query("trending") === "true";
    const contains = (c.req.query("contains") ?? "").trim().slice(0, 120);
    const cursor = c.req.query("cursor")
      ? z
          .tuple([uint, z.string().max(120)])
          .parse(JSON.parse(atob(c.req.query("cursor")!)))
      : null;
    const limit = limitOf(c.req.query("limit"));
    const { rows } = await db.query<any>(
      `WITH ranked AS (SELECT min(trim(r.data->>'title')) AS name,count(DISTINCT bounty.id)::int AS count,max(bounty.created_at)::text AS "latestTimestamp",${
        trending ? "max(bounty.created_at)" : "count(DISTINCT bounty.id)"
      } AS score
       FROM community.records r
       CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.data->'bounties')='array' THEN r.data->'bounties' ELSE '[]'::jsonb END) member(id)
       JOIN ${bountySource} ON bounty.id=member.id
       WHERE r.kind='album' AND r.deleted_at IS NULL AND r.moderated=false AND r.data->>'title' ILIKE $1
       AND ${visibleBounty} AND ($2=false OR (bounty.status='open' AND bounty.archive=false))
       GROUP BY lower(trim(r.data->>'title')))
       SELECT name,count,"latestTimestamp",score::text FROM ranked WHERE $3::numeric IS NULL OR score<$3::numeric OR (score=$3::numeric AND lower(name)>$4)
       ORDER BY score DESC,lower(name) LIMIT $5`,
      [
        "%" + contains + "%",
        trending,
        cursor?.[0] ?? null,
        cursor?.[1] ?? null,
        limit + 1,
      ]
    );
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return c.json({
      items: items.map(({ score, ...row }) => row),
      nextCursor:
        rows.length > limit && last
          ? btoa(JSON.stringify([last.score, last.name.toLowerCase()]))
          : null,
    });
  });
  app.get("/api/v1/records", async (c) => {
    const kind = z
      .enum(["comment", "profile", "album", "reaction"])
      .parse(c.req.query("kind"));
    const args: unknown[] = [kind];
    const filters = ["kind=$1", "deleted_at IS NULL", "moderated=false"];
    for (const [param, column] of [
      ["bountyId", "bounty_id"],
      ["author", "author"],
      ["parentId", "parent_id"],
    ] as const) {
      const value = c.req.query(param);
      if (value) {
        args.push(param === "author" ? address.parse(value) : value);
        filters.push(`${column}=$${args.length}`);
      }
    }
    const cursor = c.req.query("cursor");
    if (cursor) {
      const pair = z
        .tuple([z.string(), z.string()])
        .parse(JSON.parse(atob(cursor)));
      args.push(pair[0], pair[1]);
      filters.push(
        `(created_at,id)>($${args.length - 1}::timestamptz,$${args.length})`
      );
    }
    const limit = limitOf(c.req.query("limit"));
    args.push(limit + 1);
    const { rows } = await db.query<any>(
      "SELECT * FROM community.records WHERE " +
        filters.join(" AND ") +
        ` ORDER BY created_at,id LIMIT $${args.length}`,
      args
    );
    const items = rows.slice(0, limit).map(record);
    const last = items.at(-1);
    return c.json({
      items,
      nextCursor:
        rows.length > limit && last
          ? btoa(JSON.stringify([last.createdAt, last.id]))
          : null,
    });
  });
  app.get("/api/v1/reactions", async (c) => {
    const id = bountyKey.parse(c.req.query("bountyId"));
    const actor = await session(c.req.raw, false);
    const counts = (
      await db.query<any>(
        `SELECT parent_id,data->>'type' AS type,count(*)::int AS count FROM community.records WHERE kind='reaction' AND bounty_id=$1 AND deleted_at IS NULL AND moderated=false GROUP BY parent_id,data->>'type'`,
        [id]
      )
    ).rows;
    const mine = actor
      ? (
          await db.query<any>(
            "SELECT * FROM community.records WHERE kind='reaction' AND bounty_id=$1 AND author=$2 AND deleted_at IS NULL AND moderated=false",
            [id, actor.address]
          )
        ).rows.map(record)
      : [];
    const result: Record<string, { upvote: number; downvote: number }> = {};
    for (const r of counts) {
      result[r.parent_id] ??= { upvote: 0, downvote: 0 };
      if (r.type === "upvote" || r.type === "downvote")
        result[r.parent_id][r.type as "upvote" | "downvote"] = r.count;
    }
    c.header("Cache-Control", "no-store");
    return c.json({ counts: result, mine });
  });
  app.get("/api/v1/records/:id", async (c) => {
    const { rows } = await db.query(
      "SELECT * FROM community.records WHERE id=$1 AND kind<>'notification' AND deleted_at IS NULL AND moderated=false",
      [c.req.param("id")]
    );
    assert(rows[0], 404, "Record not found");
    return c.json(record(rows[0]));
  });
  app.post("/api/v1/records", async (c) => {
    const input = createSchema.parse(await c.req.json());
    const data = schemas[input.kind].parse(input.data);
    return write(c, async (tx, actor) => {
      const id =
        input.kind === "profile"
          ? `profile:${actor}`
          : input.kind === "reaction"
          ? `reaction:${input.parentId}:${actor}`
          : input.id ?? crypto.randomUUID();
      let parent: any;
      if (input.parentId) {
        parent = (
          await tx.query<any>(
            "SELECT * FROM community.records WHERE id=$1 AND deleted_at IS NULL AND moderated=false",
            [input.parentId]
          )
        ).rows[0];
        assert(parent, 422, "Parent not found");
        assert(
          parent.kind === "comment" &&
            parent.bounty_id === (input.bountyId ?? null),
          422,
          "Parent belongs to another conversation"
        );
      }
      if (input.kind === "comment") {
        assert(input.bountyId, 400, "A bounty is required");
        assert(
          (
            await tx.query(
              `SELECT id FROM ${bountySource} WHERE id=$1 AND ${visibleBounty}`,
              [input.bountyId]
            )
          ).rows.length,
          404,
          "Bounty not found"
        );
        const recent = (
          await tx.query<{ count: string }>(
            "SELECT count(*)::text FROM community.records WHERE author=$1 AND kind='comment' AND created_at>$2",
            [actor, new Date(now().getTime() - 300_000)]
          )
        ).rows[0];
        assert(Number(recent.count) < 20, 429, "Comment rate limit reached");
      }
      if (input.kind === "reaction")
        assert(parent, 422, "Reaction requires a comment");
      if (["album", "profile"].includes(input.kind))
        assert(
          !input.parentId && !input.bountyId,
          400,
          "Unexpected relationship"
        );
      const { rows } = await tx.query<any>(
        "INSERT INTO community.records(id,kind,author,bounty_id,parent_id,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          id,
          input.kind,
          actor,
          input.bountyId ?? null,
          input.parentId ?? null,
          JSON.stringify(data),
        ]
      );
      const value = await change(tx, rows[0]);
      if (input.kind === "comment") {
        const bounty = (
          await tx.query<{ issuer: string }>(
            `SELECT issuer FROM ${bountySource} WHERE id=$1`,
            [input.bountyId]
          )
        ).rows[0];
        for (const recipient of new Set(
          [bounty?.issuer, parent?.author].filter((a) => a && a !== actor)
        )) {
          const note = await tx.query<any>(
            "INSERT INTO community.records(id,kind,author,bounty_id,data,recipient) VALUES($1,'notification',$2,$3,$4,$5) RETURNING *",
            [
              crypto.randomUUID(),
              actor,
              input.bountyId,
              JSON.stringify({
                event: parent ? "reply" : "comment",
                recordId: id,
                read: false,
              }),
              recipient,
            ]
          );
          await change(tx, note.rows[0]);
        }
      }
      return { data: value, status: 201 };
    });
  });
  app.patch("/api/v1/records/:id", async (c) => {
    const input = editSchema.parse(await c.req.json());
    return write(c, async (tx, actor) => {
      const existing = (
        await tx.query<any>(
          "SELECT * FROM community.records WHERE id=$1 FOR UPDATE",
          [c.req.param("id")]
        )
      ).rows[0];
      assert(
        existing && existing.author === actor,
        403,
        "Only the author can edit this record"
      );
      assert(
        !existing.deleted_at &&
          !existing.moderated &&
          existing.kind !== "notification",
        409,
        "Record cannot be edited"
      );
      assert(
        String(existing.version) === input.version,
        409,
        "Record changed; refresh before editing"
      );
      const data = schemas[existing.kind as keyof typeof schemas].parse(
        input.data
      );
      const result = await tx.query<any>(
        "UPDATE community.records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [existing.id, JSON.stringify(data)]
      );
      return { data: await change(tx, result.rows[0]) };
    });
  });
  app.delete("/api/v1/records/:id", async (c) => {
    const input = z.object({ version: uint }).parse(await c.req.json());
    return write(c, async (tx, actor) => {
      const existing = (
        await tx.query<any>(
          "SELECT * FROM community.records WHERE id=$1 FOR UPDATE",
          [c.req.param("id")]
        )
      ).rows[0];
      assert(
        existing &&
          existing.author === actor &&
          existing.kind !== "notification",
        403,
        "Only the author can delete this record"
      );
      assert(String(existing.version) === input.version, 409, "Record changed");
      const result = await tx.query<any>(
        "UPDATE community.records SET deleted_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *",
        [existing.id]
      );
      await change(tx, result.rows[0], "delete");
      return { data: { id: existing.id, deleted: true } };
    });
  });
  app.post("/api/v1/moderation/:id", async (c) => {
    const input = z
      .object({
        hidden: z.boolean(),
        reason: z.string().trim().min(10).max(1000),
      })
      .parse(await c.req.json());
    return write(c, async (tx, actor) => {
      assert(
        options.moderators.includes(actor),
        403,
        "Moderator access required"
      );
      const result = await tx.query<any>(
        "UPDATE community.records SET moderated=$2,version=version+1,updated_at=now() WHERE id=$1 AND kind<>'notification' RETURNING *",
        [c.req.param("id"), input.hidden]
      );
      assert(result.rows[0], 404, "Record not found");
      await tx.query(
        "INSERT INTO community.moderation_log(record_id,moderator,reason,action) VALUES($1,$2,$3,$4)",
        [
          c.req.param("id"),
          actor,
          input.reason,
          input.hidden ? "hide" : "restore",
        ]
      );
      await change(tx, result.rows[0]);
      return { data: { ok: true } };
    });
  });
  app.get("/api/v1/changes", async (c) => {
    const actor = await session(c.req.raw, false);
    const after = uint.parse(c.req.query("after") ?? "0");
    const limit = limitOf(c.req.query("limit"));
    const { rows } = await db.query<any>(
      "SELECT sequence::text,kind,record_id AS id,operation,version::text,data FROM community.changes WHERE sequence>$1 AND (recipient IS NULL OR recipient=$2) ORDER BY sequence LIMIT $3",
      [after, actor?.address ?? null, limit]
    );
    return c.json({ items: rows, nextCursor: rows.at(-1)?.sequence ?? after });
  });
  app.get("/api/v1/notifications", async (c) => {
    const actor = await session(c.req.raw);
    const cursor = c.req.query("cursor") ?? "";
    const { rows } = await db.query(
      "SELECT * FROM community.records WHERE kind='notification' AND recipient=$1 AND id>$2 ORDER BY id LIMIT 100",
      [actor!.address, cursor]
    );
    return c.json({
      items: rows.map(record),
      nextCursor: rows.length === 100 ? (rows.at(-1) as any).id : null,
    });
  });
  app.post("/api/v1/notifications/:id/read", async (c) =>
    write(c, async (tx, actor) => {
      const { rows } = await tx.query<any>(
        "UPDATE community.records SET data=jsonb_set(data,'{read}','true'),updated_at=now(),version=version+1 WHERE id=$1 AND recipient=$2 AND kind='notification' RETURNING *",
        [c.req.param("id"), actor]
      );
      assert(rows[0], 404, "Notification not found");
      return { data: await change(tx, rows[0]) };
    })
  );
  async function saveObject(actor: string, bytes: Uint8Array, type: string) {
    const hash = await digest(bytes);
    await db.transaction((tx) =>
      serial(tx, "upload:" + actor, async () => {
        const old = (
          await tx.query(
            "SELECT digest FROM community.uploads WHERE digest=$1",
            [hash]
          )
        ).rows[0];
        if (old) return;
        const total = (
          await tx.query<{ total: string }>(
            "SELECT coalesce(sum(size),0)::text AS total FROM community.uploads WHERE author=$1 AND created_at>$2",
            [actor, new Date(now().getTime() - 86400_000)]
          )
        ).rows[0];
        assert(
          Number(total.total) + bytes.length <= 100 * 1024 * 1024,
          429,
          "Daily upload limit reached"
        );
        await storage.put(`sha256/${hash}`, bytes, type);
        await tx.query(
          "INSERT INTO community.uploads(digest,author,size,content_type) VALUES($1,$2,$3,$4) ON CONFLICT(digest) DO NOTHING",
          [hash, actor, bytes.length, type]
        );
      })
    );
    return {
      sha256: hash,
      url: `${options.publicStorageURL}/sha256/${hash}`,
      size: bytes.length,
      contentType: type,
    };
  }
  app.post("/api/v1/uploads", async (c) => {
    const actor = await session(c.req.raw);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const type = detectImage(bytes);
    assert(
      type && bytes.length > 0,
      415,
      "Use a JPEG, PNG, GIF, or WebP image"
    );
    return c.json(await saveObject(actor!.address, bytes, type), 201);
  });
  app.post("/api/v1/metadata", async (c) => {
    const actor = await session(c.req.raw);
    const input = z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(5000),
        image: z
          .string()
          .max(2048)
          .refine((v) => {
            try {
              portableURI(v);
              return true;
            } catch {
              return false;
            }
          }, "Use HTTPS or IPFS"),
        external_url: optionalURL,
        attributes: z
          .array(
            z.object({
              trait_type: z.string().max(100),
              value: z.union([z.string().max(1000), z.number().finite()]),
            })
          )
          .max(50)
          .default([]),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await saveObject(
        actor!.address,
        new TextEncoder().encode(JSON.stringify(input)),
        "application/json"
      ),
      201
    );
  });
  app.get("/media/sha256/:digest", async (c) => {
    const hash = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(c.req.param("digest"));
    const value = await storage.get(`sha256/${hash}`);
    assert(value, 404, "Object not found");
    return new Response(value.body as BodyInit, {
      headers: {
        "Content-Type": value.type,
        "Cache-Control": "public,max-age=31536000,immutable",
        ETag: `"${hash}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
  return app;
}
