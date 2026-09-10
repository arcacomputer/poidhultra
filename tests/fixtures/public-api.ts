// Synthetic API responses for tests, independently written from the documented
// interface. These records are never imported or deployed as production data.
export const creator = "0x0000000000000000000000000000000000000001";
export const owner = "0x0000000000000000000000000000000000000002";
export const publicBounties = Array.from({ length: 121 }, (_, i) => ({
  id: 986 + i,
  chainId: 8453,
  onChainId: i,
  createdAt: 1_700_000_000 + i,
  title: `Public mission ${i}`,
  description: i < 3 ? "Café 🌱 community garden" : "A public API test bounty",
  amount: "1234567890123456789",
  issuer: creator,
  inProgress: true,
  isJoinedBounty: false,
  isCanceled: false,
  isMultiplayer: true,
  isVoting: false,
  deadline: null,
}));
export const publicClaims = Array.from({ length: 101 }, (_, i) => ({
  id: 5317 + i,
  chainId: 8453,
  onChainId: i + 1,
  bountyId: 986,
  title: `Public proof ${i + 1}`,
  description: "A synthetic proof for integration tests",
  url: "https://proofs.test/proof.png",
  issuer: creator,
  owner,
  isAccepted: i === 0,
  isVoting: false,
}));
export const publicLeaders = [
  { address: creator, chainId: 8453, earned: 0.123456789, paid: 0.1, nfts: 1 },
  { address: owner, chainId: 1, earned: 0.02, paid: 0.01, nfts: 2 },
];

export function publicResponse(
  url: URL,
  bounties = publicBounties,
  claims = publicClaims,
  leaders = publicLeaders
): Response {
  const params = url.searchParams;
  const query = (rows: Record<string, unknown>[]) =>
    rows
      .filter((row) =>
        [...params].every(
          ([name, value]) =>
            ["offset", "limit", "include"].includes(name) ||
            String(row[name]).toLowerCase() === value.toLowerCase()
        )
      )
      .slice(
        Number(params.get("offset") ?? "0"),
        Number(params.get("offset") ?? "0") +
          Number(params.get("limit") ?? "50")
      );
  const detail = url.pathname.match(/^\/api\/v1\/bounties\/(\d+)\/(\d+)$/);
  if (detail) {
    const row = bounties.find(
      (r) => String(r.chainId) === detail[1] && String(r.id) === detail[2]
    );
    return Response.json(row ?? { error: "not found" }, {
      status: row ? 200 : 404,
    });
  }
  if (url.pathname === "/api/v1/bounties")
    return Response.json(query(bounties));
  if (url.pathname === "/api/v1/claims") return Response.json(query(claims));
  if (url.pathname === "/api/v1/leaderboard")
    return Response.json(query(leaders));
  if (url.pathname === "/api/v1/transactions")
    return Response.json(
      query([
        {
          chainId: 8453,
          bountyId: 986,
          claimId: null,
          tx: "0x" + "a".repeat(64),
          index: 7,
          timestamp: 1_700_000_000,
          action: "bounty created",
          address: creator,
        },
      ])
    );
  return Response.json({ error: "not found" }, { status: 404 });
}
