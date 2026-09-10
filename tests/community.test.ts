import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { createAPI } from "../apps/community-api/src/app";
import { database, bountyId } from "./service-helpers";
import { digest } from "../packages/auth/src/index";
const origin = "https://poidh.arca.computer";
const other = "https://poidh.xyz";
const alice = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const bob = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`);

test("SIWE, ownership, replay, idempotency, cross-client updates and tombstones", async () => {
  const db = await database();
  const objects = new Map();
  const app = createAPI({
    db,
    origins: [origin, other],
    proxyKeys: { [origin]: "test-ultra", [other]: "test-original" },
    moderators: [],
    publicStorageURL: origin + "/media",
    storage: {
      put: async (k, b, t) => {
        objects.set(k, { body: b, type: t });
      },
      get: async (k) => objects.get(k) ?? null,
    },
  });
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
    domain = origin,
    idempotencyKey = "request-one"
  ) =>
    app.request("https://community.test/api/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-poidh-origin": domain,
        "x-poidh-proxy-key": domain === origin ? "test-ultra" : "test-original",
        origin: domain,
        ...(cookie ? { cookie } : {}),
        "idempotency-key": idempotencyKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function signIn(account: typeof alice, domain = origin) {
    const challenge = (await (
      await request(
        "/auth/challenge",
        "POST",
        { address: account.address, chainId: 8453 },
        undefined,
        domain
      )
    ).json()) as any;
    const signature = await account.signMessage({ message: challenge.message });
    const result = await request(
      "/auth/verify",
      "POST",
      { message: challenge.message, signature },
      undefined,
      domain
    );
    assert.equal(result.status, 200);
    return {
      cookie: result.headers.get("set-cookie")!.split(";")[0],
      challenge,
      signature,
    };
  }
  try {
    const a = await signIn(alice);
    const b = await signIn(bob);
    const a2 = await signIn(alice, other);
    assert.equal(
      (
        await request("/auth/verify", "POST", {
          message: a.challenge.message,
          signature: a.signature,
        })
      ).status,
      401
    );
    assert.equal(
      (await request("/auth/session", "GET", undefined, a.cookie, other))
        .status,
      200
    );
    assert.equal(
      await (
        await request("/auth/session", "GET", undefined, a.cookie, other)
      ).json(),
      null
    );
    const input = { kind: "comment", bountyId, data: { body: "A real proof" } };
    const first = await request("/records", "POST", input, a.cookie);
    assert.equal(first.status, 201, await first.clone().text());
    const created = (await first.json()) as any;
    const repeat = await request("/records", "POST", input, a.cookie);
    assert.equal(((await repeat.json()) as any).id, created.id);
    assert.equal(
      (
        await request(
          "/records",
          "POST",
          { ...input, data: { body: "Changed" } },
          a.cookie
        )
      ).status,
      409
    );
    assert.equal(
      (
        await request(
          "/records/" + created.id,
          "PATCH",
          { version: "1", data: { body: "Hijacked" } },
          b.cookie,
          origin,
          "request-bob"
        )
      ).status,
      403
    );
    const updated = await request(
      "/records/" + created.id,
      "PATCH",
      { version: "1", data: { body: "Updated from original client" } },
      a2.cookie,
      other,
      "request-edit"
    );
    assert.equal(updated.status, 200, await updated.clone().text());
    const seen = (await (
      await request("/records/" + created.id, "GET", undefined, a.cookie)
    ).json()) as any;
    assert.equal(seen.data.body, "Updated from original client");
    assert.equal(seen.version, "2");
    assert.equal(
      (
        await request(
          "/records/" + created.id,
          "PATCH",
          { version: "1", data: { body: "Stale" } },
          a.cookie,
          origin,
          "request-stale"
        )
      ).status,
      409
    );
    assert.equal(
      (
        await request(
          "/records/" + created.id,
          "DELETE",
          { version: "2" },
          a.cookie,
          origin,
          "request-delete"
        )
      ).status,
      200
    );
    const feed = (await (await request("/changes")).json()) as any;
    assert.deepEqual(
      feed.items
        .filter((x: any) => x.id === created.id)
        .map((x: any) => x.operation),
      ["upsert", "upsert", "delete"]
    );
    assert.equal(feed.items.at(-1).data, null);
    assert.equal((await request("/records/" + created.id)).status, 404);
    const bounties = (await (await request("/bounties")).json()) as any;
    assert.equal(bounties.items[0].onChainId, "9007199254740993");
    assert.equal(bounties.items[0].amount, "9007199254740993123456789");
    assert.equal((await request("/records", "POST", input)).status, 401);
  } finally {
    await db.close();
  }
});

test("proof uploads are content-addressed and reject executable files", async () => {
  const db = await database();
  const store = new Map();
  const token = "upload-test-session";
  await db.query(
    "INSERT INTO community.sessions(token_hash,origin,address,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [await digest(token), origin, alice.address.toLowerCase()]
  );
  const app = createAPI({
    db,
    origins: [origin],
    proxyKeys: { [origin]: "test-key" },
    moderators: [],
    publicStorageURL: origin + "/media",
    storage: {
      put: async (k, b, t) => {
        store.set(k, { body: b, type: t });
      },
      get: async (k) => store.get(k) ?? null,
    },
  });
  const headers = {
    "x-poidh-origin": origin,
    "x-poidh-proxy-key": "test-key",
    origin,
    cookie: "poidh_session=" + token,
  };
  try {
    const bad = await app.request("/api/v1/uploads", {
      method: "POST",
      headers,
      body: '<svg onload="alert(1)"></svg>',
    });
    assert.equal(bad.status, 415);
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 1, 2, 3,
    ]);
    const upload = () =>
      app.request("/api/v1/uploads", { method: "POST", headers, body: bytes });
    const first = (await (await upload()).json()) as any;
    const retry = (await (await upload()).json()) as any;
    assert.equal(first.url, retry.url);
    assert.equal(store.size, 1);
    assert.equal(first.sha256, await digest(bytes));
    const media = await app.request("/media/sha256/" + first.sha256);
    assert.match(media.headers.get("cache-control")!, /immutable/);
    assert.equal(media.status, 200);
  } finally {
    await db.close();
  }
});

test("moderation hides indexed content; reaction totals cover every page; archive is timestamped", async () => {
  const { importArchive } = await import("../scripts/archive/import");
  const db = await database();
  const token = "moderator-session";
  const actor = alice.address.toLowerCase();
  await db.query(
    "INSERT INTO community.sessions(token_hash,origin,address,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [await digest(token), origin, actor]
  );
  const app = createAPI({
    db,
    origins: [origin],
    proxyKeys: { [origin]: "test-key" },
    moderators: [actor],
    publicStorageURL: origin + "/media",
    storage: { put: async () => {}, get: async () => null },
  });
  const headers = {
    "Content-Type": "application/json",
    "x-poidh-origin": origin,
    "x-poidh-proxy-key": "test-key",
    origin,
    cookie: "poidh_session=" + token,
    "Idempotency-Key": "moderation-test",
  };
  try {
    const hidden = await app.request(
      "/api/v1/moderation/protocol/bounty/" + bountyId,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          hidden: true,
          reason: "Test preservation of original moderation.",
        }),
      }
    );
    assert.equal(hidden.status, 200, await hidden.clone().text());
    assert.equal(
      (await app.request("/api/v1/bounties/" + bountyId)).status,
      404
    );
    assert.equal(
      ((await (await app.request("/api/v1/bounties")).json()) as any).items
        .length,
      0
    );
    await db.query(
      "INSERT INTO community.records(id,kind,author,bounty_id,data) VALUES('parent','comment',$1,$2,'{\"body\":\"An existing comment\"}')",
      [actor, bountyId]
    );
    for (let i = 1; i <= 101; i++)
      await db.query(
        "INSERT INTO community.records(id,kind,author,bounty_id,parent_id,data) VALUES($1,'reaction',$2,$3,'parent','{\"type\":\"upvote\"}')",
        ["r" + i, "0x" + i.toString(16).padStart(40, "0"), bountyId]
      );
    const summary = (await (
      await app.request("/api/v1/reactions?bountyId=" + bountyId)
    ).json()) as any;
    assert.equal(summary.counts.parent.upvote, 101);
    const snapshot = {
      version: 1,
      chainId: 666666666,
      source: "https://poidh.xyz",
      capturedAt: "2026-09-01T00:00:00.000Z",
      blockNumber: null,
      blockHash: null,
      bounties: [
        {
          onChainId: "1",
          issuer: actor,
          title: "Historical Degen bounty",
          description: "Preserved",
          amount: "900719925474099312345",
          createdAt: "1700000000",
          status: "completed",
          multiplayer: false,
        },
      ],
      claims: [
        {
          onChainId: "2",
          bountyId: "1",
          issuer: actor,
          owner: actor,
          title: "Original proof",
          description: "Unchanged",
          uri: "ipfs://bafy-original",
          accepted: true,
          createdAt: "1700000010",
        },
      ],
    };
    const bytes = JSON.stringify(snapshot);
    const report = await importArchive(db, bytes, true);
    assert.equal(report.applied, true);
    assert.equal(
      ((await importArchive(db, bytes, true)) as any).repeated,
      true
    );
    const history = (await (
      await app.request("/api/v1/bounties?archive=true&chain=666666666")
    ).json()) as any;
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].archive, true);
    assert.equal(history.items[0].archiveAsOf, snapshot.capturedAt);
    assert.equal(history.items[0].amount, snapshot.bounties[0].amount);
    const spec = (await (
      await app.request("/api/v1/openapi.json")
    ).json()) as any;
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/records/{id}"].patch);
  } finally {
    await db.close();
  }
});
