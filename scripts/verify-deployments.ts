import { createPublicClient, http, keccak256, parseAbi } from "viem";
import { writeFile, mkdir } from "node:fs/promises";
import {
  deployments,
  legacyDeployments,
  abi,
} from "../packages/protocol/src/index";
const urls: Record<number, string | undefined> = {
  1: process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
  8453: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
  42161: process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
};
const results = await Promise.all(
  deployments
    .filter((d) => !d.archive)
    .map(async (d) => {
      const client = createPublicClient({
        transport: http(urls[d.chainId], { timeout: 15_000, retryCount: 1 }),
      });
      try {
        const chain = await client.getChainId();
        if (chain !== d.chainId) throw new Error("RPC chain ID mismatch");
        const block = await client.getBlock({ blockTag: "finalized" });
        const [code, nftCode, nft, minBounty, minContribution] =
          await Promise.all([
            client.getBytecode({
              address: d.address,
              blockNumber: block.number,
            }),
            client.getBytecode({ address: d.nft, blockNumber: block.number }),
            client.readContract({
              address: d.address,
              abi,
              functionName: "poidhNft",
              blockNumber: block.number,
            }),
            client.readContract({
              address: d.address,
              abi,
              functionName: "MIN_BOUNTY_AMOUNT",
              blockNumber: block.number,
            }),
            client.readContract({
              address: d.address,
              abi,
              functionName: "MIN_CONTRIBUTION",
              blockNumber: block.number,
            }),
          ]);
        if (!code || code === "0x" || !nftCode || nftCode === "0x")
          throw new Error("Deployment bytecode missing");
        if (nft.toLowerCase() !== d.nft.toLowerCase())
          throw new Error("Linked NFT does not match");
        const legacy = legacyDeployments.find((l) => l.chainId === d.chainId);
        const legacyCount = legacy
          ? await client.readContract({
              address: legacy.address,
              abi: parseAbi(["function bountyCounter() view returns(uint256)"]),
              functionName: "bountyCounter",
              blockNumber: BigInt(legacy.endBlock),
            })
          : 0n;
        if (legacy && legacyCount !== BigInt(d.offset))
          throw new Error(
            `Legacy URL boundary mismatch: count ${legacyCount} vs offset ${d.offset}`
          );
        return {
          chainId: chain,
          address: d.address,
          nft: d.nft,
          verifiedAt: new Date().toISOString(),
          block: block.number.toString(),
          blockHash: block.hash,
          bytecodeHash: keccak256(code),
          nftBytecodeHash: keccak256(nftCode),
          minimumBounty: minBounty.toString(),
          minimumContribution: minContribution.toString(),
          legacyCount: legacyCount.toString(),
          status: "verified",
        };
      } catch (error) {
        return {
          chainId: d.chainId,
          address: d.address,
          status: "pending",
          reason: (error as any).shortMessage ?? (error as Error).message,
        };
      }
    })
);
await mkdir("upstream/reports", { recursive: true });
await writeFile(
  "upstream/reports/deployments.json",
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) +
    "\n"
);
console.log(
  JSON.stringify(
    results.map((r) => ({
      chainId: r.chainId,
      status: r.status,
      ...("reason" in r
        ? { reason: r.reason }
        : { block: r.block, legacyCount: r.legacyCount }),
    })),
    null,
    2
  )
);
if (results.some((r) => r.status !== "verified")) process.exitCode = 1;
