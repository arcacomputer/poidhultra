// Independently implemented from the licensed protocol's events. No upstream indexer source is reused.
import { ponder } from "ponder:registry";
import {
  bounty,
  claim,
  event as events,
  account,
  token,
  participation,
  vote,
} from "ponder:schema";
import {
  abi,
  nftAbi,
  deployments,
  legacyDeployments,
  key,
} from "@poidh/protocol";
import { zeroAddress } from "viem";
const json = (x: unknown) =>
  JSON.parse(
    JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
const lower = (value: string) => value.toLowerCase() as `0x${string}`;
async function accountDelta(
  context: any,
  address: string,
  field: "earned" | "paid" | "nfts",
  delta: bigint
) {
  if (lower(address) === zeroAddress) return;
  const id = `${context.chain.id}:${lower(address)}`;
  await context.db
    .insert(account)
    .values({
      id,
      chain_id: context.chain.id,
      address: lower(address),
      [field]: delta,
    })
    .onConflictDoUpdate((row: any) => ({ [field]: row[field] + delta }));
}
async function record(name: string, { event, context }: any) {
  const id = `${context.chain.id}:${event.block.number
    .toString()
    .padStart(20, "0")}:${event.log.logIndex.toString().padStart(8, "0")}`;
  if (await context.db.find(events, { id })) return false;
  await context.db
    .insert(events)
    .values({
      id,
      chain_id: context.chain.id,
      contract: lower(event.log.address),
      block_number: event.block.number,
      block_hash: event.block.hash,
      transaction_hash: event.transaction.hash,
      log_index: event.log.logIndex,
      name,
      data: json(event.args),
      timestamp: event.block.timestamp,
    });
  return true;
}
async function handle(name: string, input: any) {
  const { event, context } = input;
  if (!(await record(name, input))) return;
  const a = event.args;
  const chain = context.chain.id;
  const contract = lower(event.log.address);
  const deployment = deployments.find((d) => d.chainId === chain)!;
  const id = key(chain, contract, a.bountyId ?? a.id ?? 0n);
  if (name === "BountyCreated") {
    await context.db
      .insert(bounty)
      .values({
        id,
        chain_id: chain,
        contract,
        on_chain_id: a.id,
        display_id: a.id + BigInt(deployment.offset),
        issuer: lower(a.issuer),
        title: a.title,
        description: a.description,
        amount: a.amount,
        created_at: a.createdAt,
        status: "open",
        multiplayer: a.isOpenBounty,
        claim_count: 0,
        archive: false,
      });
    if (a.isOpenBounty)
      await context.db
        .insert(participation)
        .values({
          id: id + ":" + lower(a.issuer),
          bounty_id: id,
          address: lower(a.issuer),
          amount: a.amount,
        });
  } else if (name === "ClaimCreated") {
    const cid = key(chain, contract, a.id);
    const owned = await context.db.find(token, {
      id: key(chain, deployment.nft, a.id),
    });
    await context.db
      .insert(claim)
      .values({
        id: cid,
        chain_id: chain,
        bounty_id: id,
        on_chain_id: a.id,
        issuer: lower(a.issuer),
        owner: owned?.owner ?? lower(deployment.address),
        title: a.title,
        description: a.description,
        uri: a.imageUri,
        created_at: a.createdAt,
        accepted: false,
      });
    await context.db
      .update(bounty, { id })
      .set((row: any) => ({ claim_count: row.claim_count + 1 }));
  } else if (name === "BountyJoined") {
    await context.db
      .update(bounty, { id })
      .set({ amount: a.latestBountyBalance });
    await context.db
      .insert(participation)
      .values({
        id: id + ":" + lower(a.participant),
        bounty_id: id,
        address: lower(a.participant),
        amount: a.amount,
      })
      .onConflictDoUpdate((row: any) => ({ amount: row.amount + a.amount }));
  } else if (name === "WithdrawFromOpenBounty" || name === "RefundClaimed") {
    if (name === "WithdrawFromOpenBounty")
      await context.db
        .update(bounty, { id })
        .set({ amount: a.latestBountyAmount });
    await context.db
      .update(participation, { id: id + ":" + lower(a.participant) })
      .set({ amount: 0n });
  } else if (name === "BountyCancelled")
    await context.db.update(bounty, { id }).set({ status: "cancelled" });
  else if (name === "ClaimAccepted") {
    await context.db.update(bounty, { id }).set({ status: "completed" });
    await context.db
      .update(claim, { id: key(chain, contract, a.claimId) })
      .set({ accepted: true });
    await accountDelta(context, a.claimIssuer, "earned", a.payout);
    await accountDelta(context, a.bountyIssuer, "paid", a.bountyAmount);
  } else if (name === "VotingStarted") {
    await context.db.update(bounty, { id }).set({ status: "voting" });
    await context.db
      .insert(vote)
      .values({
        id: `${id}:${a.round}`,
        bounty_id: id,
        claim_id: a.claimId,
        round: a.round,
        yes: a.issuerYesWeight,
        no: 0n,
        deadline: a.deadline,
        resolved: false,
      });
  } else if (name === "VoteCast")
    await context.db
      .update(vote, { id: `${id}:${a.round}` })
      .set((row: any) =>
        a.support ? { yes: row.yes + a.weight } : { no: row.no + a.weight }
      );
  else if (name === "VotingResolved") {
    await context.db
      .update(vote, { id: `${id}:${a.round}` })
      .set({ yes: a.yes, no: a.no, resolved: true });
    if (!a.passed)
      await context.db.update(bounty, { id }).set({ status: "open" });
  }
}
for (const name of [
  "BountyCreated",
  "ClaimCreated",
  "BountyJoined",
  "WithdrawFromOpenBounty",
  "RefundClaimed",
  "BountyCancelled",
  "ClaimAccepted",
  "VotingStarted",
  "VoteCast",
  "VotingResolved",
  "Withdrawal",
  "WithdrawalTo",
] as const)
  ponder.on(`Poidh:${name}`, (input) => handle(name, input));
async function transfer(input: any, legacy = false) {
  const { event, context } = input;
  if (!(await record(legacy ? "LegacyNFTTransfer" : "NFTTransfer", input)))
    return;
  const { from, to, tokenId } = event.args;
  const dep = legacy
    ? legacyDeployments.find((d) => d.chainId === context.chain.id)!
    : deployments.find((d) => d.chainId === context.chain.id)!;
  const cid = key(context.chain.id, dep.address, tokenId);
  const id = key(context.chain.id, event.log.address, tokenId);
  await context.db
    .insert(token)
    .values({ id, owner: lower(to), claim_id: cid })
    .onConflictDoUpdate({ owner: lower(to) });
  if (await context.db.find(claim, { id: cid }))
    await context.db.update(claim, { id: cid }).set({ owner: lower(to) });
  await accountDelta(context, from, "nfts", -1n);
  await accountDelta(context, to, "nfts", 1n);
}
ponder.on("NFT:Transfer", (input) => transfer(input));
ponder.on("LegacyNFT:Transfer", (input) => transfer(input, true));
async function legacy(name: string, input: any) {
  const { event, context } = input;
  if (!(await record("Legacy" + name, input))) return;
  const a = event.args;
  const chain = context.chain.id;
  const contract = lower(event.log.address);
  const bid = a.bountyId ?? a.id;
  // Ponder pins these reads to the event block, caches RPC reads, and rolls back DB changes on reorganizations.
  const b = await context.client.readContract({
    abi,
    address: contract,
    functionName: "bounties",
    args: [bid],
  });
  const currentVote = await context.client.readContract({
    abi,
    address: contract,
    functionName: "bountyCurrentVotingClaim",
    args: [bid],
  });
  const participants = await context.client.readContract({
    abi,
    address: contract,
    functionName: "getParticipants",
    args: [bid],
  });
  const id = key(chain, contract, bid);
  const value = {
    id,
    chain_id: chain,
    contract,
    on_chain_id: bid,
    display_id: bid,
    issuer: lower(b[1]),
    title: b[2],
    description: b[3],
    amount: b[4],
    created_at: b[6],
    status:
      lower(b[5]) === lower(b[1])
        ? "cancelled"
        : lower(b[5]) !== zeroAddress
        ? "completed"
        : currentVote > 0n
        ? "voting"
        : "open",
    multiplayer: participants[0].length > 0,
    archive: true,
    archive_as_of: event.block.timestamp.toString(),
  };
  await context.db
    .insert(bounty)
    .values({ ...value, claim_count: 0 })
    .onConflictDoUpdate(value);
  if (name === "ClaimCreated") {
    const cid = key(chain, contract, a.id);
    const nft = "0xDdfb1A53E7b73Dba09f79FCA24765C593D447a80";
    const uri = await context.client.readContract({
      abi: nftAbi,
      address: nft,
      functionName: "tokenURI",
      args: [a.id],
    });
    const owned = await context.db.find(token, { id: key(chain, nft, a.id) });
    await context.db
      .insert(claim)
      .values({
        id: cid,
        chain_id: chain,
        bounty_id: id,
        on_chain_id: a.id,
        issuer: lower(a.issuer),
        owner: owned?.owner ?? contract,
        title: a.name,
        description: a.description,
        uri,
        created_at: a.createdAt,
        accepted: false,
      });
    await context.db
      .update(bounty, { id })
      .set((row: any) => ({ claim_count: row.claim_count + 1 }));
  }
  if (name === "ClaimAccepted") {
    await context.db
      .update(claim, { id: key(chain, contract, a.claimId) })
      .set({ accepted: true });
    await accountDelta(
      context,
      a.claimIssuer,
      "earned",
      BigInt(b[4]) - BigInt(a.fee)
    );
    await accountDelta(context, a.bountyIssuer, "paid", b[4]);
  }
}
for (const name of [
  "BountyCreated",
  "ClaimCreated",
  "ClaimAccepted",
  "BountyJoined",
  "ClaimSubmittedForVote",
  "BountyCancelled",
  "ResetVotingPeriod",
  "VoteClaim",
  "WithdrawFromOpenBounty",
] as const)
  ponder.on(`Legacy:${name}`, (input) => legacy(name, input));
