import test from "node:test";
import assert from "node:assert/strict";
import { UpstreamPublicAPI } from "../packages/client/src/upstream";
import { createCommunityProxy } from "../packages/client/src/server-proxy";
import {
  deployments,
  key,
  legacyDeployments,
} from "../packages/protocol/src/index";
import {
  publicResponse,
  publicBounties,
  publicClaims,
  publicLeaders,
  creator,
} from "./fixtures/public-api";

const base = deployments.find((d) => d.chainId === 8453)!;
const id = key(8453, base.address, "0");
function setup(handler = publicResponse, extra = {}) {
  const calls: { url: URL; options?: RequestInit }[] = [];
  const api = new UpstreamPublicAPI({
    url: "https://indexer.test",
    ...extra,
    fetcher: async (input, options) => {
      const url = new URL(String(input));
      calls.push({ url, options });
      return handler(url);
    },
  });
  const read = async (path: string, headers: Record<string, string> = {}) => {
    const response = await api.handle(
      new Request("https://ultra.test/api/v1" + path, { headers })
    );
    assert.ok(response);
    return { response, body: await response.json() };
  };
  return { api, read, calls };
}
test("complete scans support newest-first pagination, Unicode search and exact wei", async () => {
  const { read, calls } = setup();
  const first = await read("/bounties?limit=100");
  assert.equal(first.response.status, 200);
  assert.equal(first.body.items.length, 100);
  assert.equal(first.body.items[0].title, "Public mission 120");
  assert.equal(first.body.items[0].amount, "1234567890123456789");
  assert.equal(first.body.items[0].claimCount, null);
  const next = await read(
    "/bounties?limit=100&cursor=" + encodeURIComponent(first.body.nextCursor)
  );
  assert.equal(next.body.items.length, 21);
  assert.equal(
    new Set([...first.body.items, ...next.body.items].map((r) => r.id)).size,
    121
  );
  assert.equal(next.body.nextCursor, null);
  const search = "/bounties?limit=1&q=" + encodeURIComponent("Café 🌱");
  const unicode = await read(search);
  assert.equal(unicode.body.items[0].title, "Public mission 2");
  const unicodeNext = await read(
    search + "&cursor=" + encodeURIComponent(unicode.body.nextCursor)
  );
  assert.equal(unicodeNext.body.items[0].title, "Public mission 1");
  const wrong = await read(
    "/bounties?chain=1&cursor=" + encodeURIComponent(first.body.nextCursor)
  );
  assert.equal(wrong.response.status, 400);
  assert.equal(calls.length, 4, "all list filters share one complete scan");
});
test("legacy and V3 IDs resolve to pinned contracts and terminal status takes precedence", async () => {
  const fixtures = [
    {
      ...publicBounties[0],
      id: 985,
      onChainId: 985,
      isCanceled: true,
      isVoting: true,
    },
    { ...publicBounties[0], inProgress: false, isVoting: true },
    {
      ...publicBounties[0],
      chainId: 42161,
      id: 180,
      onChainId: 0,
      isVoting: true,
    },
  ];
  const { read } = setup((url) => publicResponse(url, fixtures));
  const legacyId = key(8453, legacyDeployments[0].address, "985");
  const legacy = await read("/bounties/" + legacyId);
  assert.equal(legacy.body.id, legacyId);
  assert.equal(legacy.body.status, "cancelled");
  assert.equal(legacy.body.archive, true);
  assert.equal((await read("/bounties/" + id)).body.status, "completed");
  const voting = await read("/bounties?status=voting");
  assert.equal(
    voting.body.items[0].id,
    key(42161, deployments[2].address, "0")
  );
  assert.equal(
    (await read("/bounties/" + key(8453, legacyDeployments[0].address, "986")))
      .response.status,
    404
  );
});
test("all proof pages retain NFT ownership, metadata references, and absent timestamps", async () => {
  const { read } = setup();
  const first = await read(`/bounties/${id}/claims?limit=100`);
  const second = await read(
    `/bounties/${id}/claims?limit=100&cursor=${encodeURIComponent(
      first.body.nextCursor
    )}`
  );
  assert.equal(first.body.items.length, 100);
  assert.equal(second.body.items.length, 1);
  assert.equal(second.body.items[0].onChainId, "101");
  assert.equal(first.body.items[0].createdAt, null);
  assert.equal(first.body.items[0].uri, publicClaims[0].url);
  assert.equal(first.body.items[0].owner, publicClaims[0].owner);
  const single = await read("/claims/" + key(8453, base.address, "1"));
  assert.equal(single.body.bountyId, id);
  const owned = await read(
    `/profiles/${publicClaims[0].owner}/proofs?mode=owned`
  );
  assert.equal(owned.body.items[0].id, first.body.items[0].id);
});
test("claims with overlapping onchain IDs are disambiguated by their bounty deployment", async () => {
  const claims = [
    publicClaims[0],
    {
      ...publicClaims[0],
      id: 1,
      bountyId: 4,
      url: "ipfs://unchanged-proof-reference",
    },
  ];
  const { read } = setup((url) => publicResponse(url, publicBounties, claims));
  const legacy = await read(
    "/claims/" + key(8453, legacyDeployments[0].address, "1")
  );
  assert.equal(
    legacy.body.bountyId,
    key(8453, legacyDeployments[0].address, "4")
  );
  assert.equal(legacy.body.uri, "ipfs://unchanged-proof-reference");
});
test("malformed proof URI text does not hide other submissions", async () => {
  const claims = publicClaims.map((claim, index) => ({
    ...claim,
    url: index === 0 ? "A description entered in the URI field" : claim.url,
  }));
  const { read } = setup((url) => publicResponse(url, publicBounties, claims));
  const page = await read(`/bounties/${id}/claims?limit=3`);
  assert.equal(page.response.status, 200);
  assert.equal(page.body.items.length, 3);
  assert.equal(page.body.items[0].uri, claims[0].url);
  assert.equal(page.body.items[1].uri, publicClaims[1].url);
});
test("unsafe upstream integers, numeric wei, deployment mismatches and duplicate pages fail visibly", async () => {
  for (const bad of [
    { ...publicBounties[0], id: 9007199254740992 },
    { ...publicBounties[0], amount: 1000000000000000000 },
    { ...publicBounties[0], onChainId: 999 },
    { ...publicBounties[0], isCanceled: null },
  ]) {
    const { read } = setup((url) =>
      publicResponse(url, [bad] as typeof publicBounties)
    );
    assert.equal((await read("/bounties")).response.status, 503);
  }
  const repeated = setup(() =>
    Response.json(Array.from({ length: 100 }, () => publicBounties[0]))
  );
  assert.equal((await repeated.read("/bounties")).response.status, 503);
  const large = {
    ...publicBounties[0],
    id: "9007199254741980",
    onChainId: "9007199254740994",
  };
  const exact = setup((url) =>
    publicResponse(url, [large] as unknown as typeof publicBounties)
  );
  assert.equal(
    (await exact.read("/bounties")).body.items[0].onChainId,
    "9007199254740994"
  );
});
test("cookies, proxy keys and authorization never reach upstream, and writes remain blocked", async () => {
  const { api, read, calls } = setup();
  await read("/bounties", {
    cookie: "poidh_session=private",
    authorization: "Bearer private",
    "x-poidh-proxy-key": "private",
  });
  for (const call of calls) {
    const headers = new Headers(call.options?.headers);
    for (const name of [
      "cookie",
      "authorization",
      "x-poidh-proxy-key",
      "origin",
    ])
      assert.equal(headers.get(name), null);
    assert.equal(call.options?.method, "GET");
    assert.equal(call.options?.credentials, "omit");
    assert.equal(call.options?.redirect, "manual");
    assert.equal(call.url.origin, "https://indexer.test");
  }
  const before = calls.length;
  const request = new Request("https://ultra.test/api/v1/records", {
    method: "POST",
    body: "{}",
  });
  assert.equal(await api.handle(request), null);
  const proxy = createCommunityProxy({
    origin: "https://ultra.test",
    apiURL: "https://community.test",
    proxyKey: "private",
    readOnly: true,
    service: {
      fetch: async () => {
        throw new Error("Must not write");
      },
    },
  });
  assert.equal((await proxy(request, "/api/v1/records")).status, 503);
  assert.equal(calls.length, before);
  assert.equal(
    await api.handle(new Request("https://ultra.test/api/v1/auth/session")),
    null
  );
});
test("failures recover, concurrent reads coalesce, and data is refreshed after expiry", async () => {
  let fail = true,
    now = 1_700_000_000_000;
  const { read, calls } = setup(
    (url) =>
      fail
        ? Response.json({ error: "failure" }, { status: 500 })
        : publicResponse(url),
    { now: () => now, cacheMs: 1000 }
  );
  assert.equal((await read("/bounties")).response.status, 503);
  fail = false;
  const pages = await Promise.all([read("/bounties"), read("/bounties")]);
  assert.ok(pages.every((p) => p.response.status === 200));
  assert.equal(calls.length, 8);
  now += 11_000;
  await read("/bounties");
  assert.equal(calls.length, 12);
});
test("leaderboard monetary estimates never masquerade as raw integer balances", async () => {
  let now = 1_700_000_000_000;
  const { read } = setup(publicResponse, { now: () => now, cacheMs: 1000 });
  const first = await read("/leaderboard?limit=1");
  assert.equal(first.body.items[0].address, creator);
  assert.equal(first.body.items[0].earned, null);
  assert.equal(first.body.items[0].paid, null);
  assert.equal(first.body.items[0].approximateAmounts.earned, "0.123456789");
  const second = await read(
    "/leaderboard?limit=1&cursor=" + encodeURIComponent(first.body.nextCursor)
  );
  assert.equal(second.body.items[0].address, publicLeaders[1].address);
  now += 11_000;
  assert.equal(
    (
      await read(
        "/leaderboard?limit=1&cursor=" +
          encodeURIComponent(first.body.nextCursor)
      )
    ).response.status,
    409
  );
});
test("unavailable Degen history stays explicit, and activity keeps its correct bounty link", async () => {
  const { read, calls } = setup();
  assert.equal(
    (await read("/bounties?chain=666666666&archive=true")).response.status,
    503
  );
  assert.equal(calls.length, 0);
  const activity = await read("/activity");
  assert.equal(activity.body.items[0].data.bountyId, "0");
  assert.equal(activity.body.items[0].blockNumber, null);
  assert.equal(activity.body.items[0].contract, base.address.toLowerCase());
});
test("untrusted upstream origins cannot embed credentials or redirect targets", () => {
  for (const url of [
    "http://example.test",
    "https://user:secret@example.test",
    "https://example.test/api",
    "https://example.test?target=elsewhere",
  ])
    assert.throws(() => new UpstreamPublicAPI({ url }));
});
