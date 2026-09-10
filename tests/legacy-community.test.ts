import test from "node:test";
import assert from "node:assert/strict";
import { database, bountyId } from "./service-helpers";
import { createAPI } from "../apps/community-api/src/app";
import { digest } from "../packages/auth/src/index";
import { APIError } from "../packages/client/src/index";
import {
  allRecords,
  legacyCommentId,
  legacyCommunity,
  type LegacyRequest,
} from "../packages/client/src/legacy-community";

test("original community adapters preserve pages, imported IDs, ownership and album search shapes", async () => {
  const db = await database();
  const actor = "0x0000000000000000000000000000000000000001";
  const origin = "https://poidh.xyz";
  const app = createAPI({
    db,
    storage: { get: async () => null, put: async () => {} },
    origins: [origin],
    proxyKeys: { [origin]: "test-proxy" },
    publicStorageURL: origin + "/media",
    moderators: [actor],
  });
  let writes = 0;
  const request: LegacyRequest = async (path, method = "GET", data) => {
    const response = await app.request("https://community.test/api/v1" + path, {
      method,
      headers: {
        "content-type": "application/json",
        origin,
        "x-poidh-origin": origin,
        "x-poidh-proxy-key": "test-proxy",
        cookie: "poidh_session=test-session",
        "idempotency-key": "legacy-test-" + ++writes,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body: any = await response.json();
    if (!response.ok) throw new APIError(response.status, body.error);
    return body;
  };
  const adapter = legacyCommunity(request);
  try {
    const claimId = bountyId.replace(/:[0-9]+$/, ":9007199254740994");
    await db.query(
      "INSERT INTO protocol_api.claim VALUES($1,$2,9007199254740994,$3,$3,'Proof','Exact claim lookup','ipfs://preserved-metadata',false,1700000000)",
      [claimId, bountyId, actor]
    );
    const proof: any = await request("/claims/" + encodeURIComponent(claimId));
    assert.equal(proof.id, claimId);
    assert.equal(proof.onChainId, "9007199254740994");
    assert.equal(proof.uri, "ipfs://preserved-metadata");
    await assert.rejects(
      request(
        "/claims/" +
          encodeURIComponent(
            claimId.replace("9007199254740994", "9007199254740995")
          )
      ),
      /Claim not found/
    );
    await db.query(
      "INSERT INTO community.sessions(token_hash,origin,address,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [await digest("test-session"), origin, actor]
    );
    await db.query(
      "INSERT INTO community.records(id,kind,author,data) VALUES('profile:test','profile',$1,$2)",
      [
        actor,
        JSON.stringify({
          name: "owner-chosen.eth",
          bio: "",
          image: "https://example.com/image.png",
        }),
      ]
    );
    for (let i = 0; i < 101; i++) {
      await db.query(
        "INSERT INTO community.records(id,kind,author,bounty_id,data,created_at) VALUES($1,'comment',$2,$3,$4,'2020-01-01')",
        [
          "original:comment:" + i,
          actor,
          bountyId,
          JSON.stringify({ body: "Comment " + i }),
        ]
      );
      await db.query(
        "INSERT INTO community.records(id,kind,author,data) VALUES($1,'album',$2,$3)",
        [
          "album:" + i,
          actor,
          JSON.stringify({
            title: "Rehearsal " + String(i).padStart(3, "0"),
            description: "",
            bounties: [bountyId],
          }),
        ]
      );
    }
    for (let i = 2; i < 132; i++)
      await db.query(
        "INSERT INTO community.records(id,kind,author,bounty_id,parent_id,data) VALUES($1,'reaction',$2,$3,'original:comment:0','{\"type\":\"upvote\"}')",
        ["vote:" + i, "0x" + i.toString(16).padStart(40, "0"), bountyId]
      );
    const input = { chainId: 8453, bountyId: "9007199254741979" };
    const comments = await adapter.comments(input);
    assert.equal(comments.length, 101);
    assert.equal(new Set(comments.map((c) => c.id)).size, 101);
    assert.equal(
      comments.find((c) => c.id === "original:comment:0")!.upvotes,
      130
    );
    assert.equal(comments[0].author?.displayName, "owner-chosen.eth");
    assert.equal(comments[0].author?.ens, null);
    const albums = await adapter.albums("Rehearsal");
    assert.equal(albums.length, 101);
    assert.deepEqual(albums[0], {
      album: "Rehearsal 000",
      count: { album: 1 },
    });
    assert.equal((await adapter.trending(3)).length, 3);
    const created = await adapter.comment({
      ...input,
      address: actor,
      text: "Reply from the original client",
      parrentId: 0,
    });
    assert.equal(created.parentId, "original:comment:0");
    const reaction = await adapter.rate({
      chainId: 8453,
      commentId: "0",
      address: actor,
      type: "downvote",
    });
    assert.equal(reaction.parentId, "original:comment:0");
    const changed = await adapter.rate({
      chainId: 8453,
      commentId: "0",
      address: actor,
      type: "upvote",
    });
    assert.equal(changed.id, reaction.id);
    assert.equal(changed.version, "2");
    await assert.rejects(
      adapter.rate({
        chainId: 1,
        commentId: "0",
        address: actor,
        type: "upvote",
      }),
      /another chain/
    );
    await assert.rejects(
      adapter.comment({
        ...input,
        address: "0x0000000000000000000000000000000000000002",
        text: "wrong author",
      }),
      /differs/
    );
    const added = await adapter.addToAlbum({
      ...input,
      album: "New named album",
    });
    assert.equal(added.album, "New named album");
    assert.equal((await adapter.albums("New named")).length, 1);
    await adapter.banComment({ id: 0, address: actor });
    assert.equal(
      (await adapter.comments(input)).some(
        (c) => c.id === "original:comment:0"
      ),
      false
    );
  } finally {
    await db.close();
  }
});

test("legacy adapters refuse unsafe numeric IDs and stalled pagination", async () => {
  assert.throws(
    () => legacyCommentId(Number.MAX_SAFE_INTEGER + 1),
    /decimal string/
  );
  assert.equal(
    legacyCommentId("9007199254740993"),
    "original:comment:9007199254740993"
  );
  await assert.rejects(
    allRecords(
      (async () => ({ items: [], nextCursor: "stuck" })) as LegacyRequest,
      { kind: "comment" }
    ),
    /cannot be completed/
  );
});
