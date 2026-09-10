import { z } from "zod";
export { default as abi } from "./abi";
export const uint = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((v) => BigInt(v) < 2n ** 256n, "uint256 overflow");
export const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as `0x${string}`);
export const chainId = z.union([
  z.literal(1),
  z.literal(8453),
  z.literal(42161),
  z.literal(666666666),
]);
export const bountyKey = z
  .string()
  .regex(/^(1|8453|42161|666666666):0x[0-9a-f]{40}:(0|[1-9][0-9]*)$/);
export const deployments = [
  {
    chainId: 1,
    slug: "mainnet",
    name: "Ethereum",
    address: "0xE731dFadBFf20542E10D09D26Fc71445C70d4232",
    nft: "0x9c5F45D5e1382e4058D334d93C6c01442012a4D9",
    startBlock: 25088349,
    offset: "0",
    version: 3,
    archive: false,
  },
  {
    chainId: 8453,
    slug: "base",
    name: "Base",
    address: "0x5555fa783936c260f77385b4e153b9725fef1719",
    nft: "0x27E117Cc9A8DA363442e7Bd0618939E3EEEACF6A",
    startBlock: 41026079,
    offset: "986",
    version: 3,
    archive: false,
  },
  {
    chainId: 42161,
    slug: "arbitrum",
    name: "Arbitrum",
    address: "0x5555fa783936c260f77385b4e153b9725fef1719",
    nft: "0x27E117Cc9A8DA363442e7Bd0618939E3EEEACF6A",
    startBlock: 423059298,
    offset: "180",
    version: 3,
    archive: false,
  },
  {
    chainId: 666666666,
    slug: "degen",
    name: "Degen archive",
    address: "0x18e5585ca7ce31b90bc8bb7aaf84152857ce243f",
    nft: "0x39f04b7897dcaf9dc454e433f43fb1c3bb528e11",
    startBlock: 0,
    offset: "0",
    version: 2,
    archive: true,
  },
] as const;
export const legacyDeployments = [
  {
    chainId: 8453,
    slug: "base",
    address: "0xb502c5856F7244DccDd0264A541Cc25675353D39",
    startBlock: 14542727,
    endBlock: 39265657,
    version: 2,
    offset: "0",
    archive: true,
  },
  {
    chainId: 42161,
    slug: "arbitrum",
    address: "0x0Aa50ce0d724cc28f8F7aF4630c32377B4d5c27d",
    startBlock: 211898523,
    endBlock: 409717812,
    version: 2,
    offset: "0",
    archive: true,
  },
] as const;
export type Deployment = (typeof deployments)[number];
export function key(chain: number, contract: string, id: string | bigint) {
  return bountyKey.parse(
    `${chain}:${contract.toLowerCase()}:${uint.parse(String(id))}`
  );
}
export function displayId(chain: number, id: string) {
  const d = deployments.find((d) => d.chainId === chain);
  if (!d) throw new Error("Unsupported chain");
  return (BigInt(uint.parse(id)) + BigInt(d.offset)).toString();
}
export function resolveLegacyURL(slug: string, id: string) {
  const d = deployments.find((d) => d.slug === slug);
  if (!d) throw new Error("Unsupported chain");
  const value = BigInt(uint.parse(id));
  const legacy = legacyDeployments.find(
    (l) => l.chainId === d.chainId && value < BigInt(d.offset)
  );
  return {
    deployment: legacy ?? d,
    onChainId: (legacy || d.archive
      ? value
      : value - BigInt(d.offset)
    ).toString(),
  };
}
export type Bounty = {
  id: string;
  chainId: number;
  contract: string;
  onChainId: string;
  displayId: string;
  issuer: string;
  title: string;
  description: string;
  amount: string;
  createdAt: string;
  status: "open" | "voting" | "completed" | "cancelled";
  multiplayer: boolean;
  claimCount: number | null;
  image?: string | null;
  archive: boolean;
  archiveAsOf?: string | null;
};
export type Claim = {
  id: string;
  bountyId: string;
  onChainId: string;
  issuer: string;
  owner: string;
  title: string;
  description: string;
  uri: string;
  accepted: boolean;
  createdAt: string | null;
};
export type ProtocolReadSource = {
  kind: "upstream-api";
  url: string;
  fetchedAt: string;
};
export type LeaderboardEntry = {
  address: string;
  chainId: number;
  earned: string | null;
  paid: string | null;
  nfts: string | null;
  approximateAmounts?: { earned: string | null; paid: string | null };
};
export type CommunityRecord = {
  id: string;
  kind: "comment" | "profile" | "album" | "reaction" | "notification";
  author: string;
  bountyId: string | null;
  parentId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  moderated: boolean;
  version: string;
};
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  source?: ProtocolReadSource;
};
export type Change = {
  sequence: string;
  kind: string;
  id: string;
  operation: "upsert" | "delete";
  version: string;
  data: CommunityRecord | null;
};
export function amountLabel(wei: string, decimals = 4) {
  const n = BigInt(uint.parse(wei));
  const whole = n / 10n ** 18n;
  const fraction = (n % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .slice(0, decimals)
    .replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""}`;
}
export { legacyAbi, nftAbi } from "./legacy-abi";
