import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "../../apps/community-api/node_modules/zod/index.js";
import {
  key,
  deployments,
  uint,
  address,
} from "../../packages/protocol/src/index";
import {
  postgres,
  type Database,
  serial,
} from "../../packages/database/src/index";
import { digest } from "../../packages/auth/src/index";
import { portableURI } from "../../packages/storage/src/index";
const bounty = z
  .object({
    onChainId: uint,
    issuer: address,
    title: z.string(),
    description: z.string(),
    amount: uint,
    createdAt: uint,
    status: z.enum(["open", "voting", "completed", "cancelled"]),
    multiplayer: z.boolean(),
  })
  .strict();
const claim = z
  .object({
    onChainId: uint,
    bountyId: uint,
    issuer: address,
    owner: address,
    title: z.string(),
    description: z.string(),
    uri: z.string().transform(portableURI),
    accepted: z.boolean(),
    createdAt: uint,
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    chainId: z.literal(666666666),
    source: z.string().url(),
    capturedAt: z.string().datetime(),
    blockNumber: uint.nullable(),
    blockHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .nullable(),
    bounties: z.array(bounty),
    claims: z.array(claim),
  })
  .strict();
export async function importArchive(
  db: Database,
  bytes: string,
  apply = false
) {
  const data = schema.parse(JSON.parse(bytes));
  const sha256 = await digest(bytes);
  const dep = deployments[3];
  const bids = new Set(data.bounties.map((b) => b.onChainId));
  const cids = new Set(data.claims.map((c) => c.onChainId));
  if (bids.size !== data.bounties.length || cids.size !== data.claims.length)
    throw new Error("Duplicate historical identifiers");
  for (const c of data.claims)
    if (!bids.has(c.bountyId))
      throw new Error("Historical proof has no bounty");
  if (Date.parse(data.capturedAt) > Date.now())
    throw new Error("Snapshot time is in the future");
  const report = {
    sha256,
    bounties: data.bounties.length,
    claims: data.claims.length,
    capturedAt: data.capturedAt,
    applied: false,
    verification: "requires independent source/block verification",
  };
  if (!apply) return report;
  return db.transaction((tx) =>
    serial(tx, "archive-import", async () => {
      if (
        (
          await tx.query("SELECT id FROM archive.snapshots WHERE id=$1", [
            sha256,
          ])
        ).rows.length
      )
        return { ...report, applied: true, repeated: true };
      if (
        (
          await tx.query(
            "SELECT id FROM archive.snapshots WHERE chain_id=666666666"
          )
        ).rows.length
      )
        throw new Error(
          "An archive is already installed; replacing history requires a separately reviewed migration"
        );
      await tx.query(
        "INSERT INTO archive.snapshots(id,source,captured_at,chain_id,block_number,block_hash,provenance) VALUES($1,$2,$3,666666666,$4,$5,$6)",
        [
          sha256,
          data.source,
          data.capturedAt,
          data.blockNumber,
          data.blockHash,
          JSON.stringify({ sha256, verification: "pending" }),
        ]
      );
      for (const b of data.bounties)
        await tx.query(
          "INSERT INTO archive.bounty VALUES($1,666666666,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13)",
          [
            key(dep.chainId, dep.address, b.onChainId),
            dep.address.toLowerCase(),
            b.onChainId,
            b.issuer,
            b.title,
            b.description,
            b.amount,
            b.createdAt,
            b.status,
            b.multiplayer,
            data.claims.filter((c) => c.bountyId === b.onChainId).length,
            data.capturedAt,
            sha256,
          ]
        );
      for (const c of data.claims)
        await tx.query(
          "INSERT INTO archive.claim VALUES($1,666666666,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            key(dep.chainId, dep.address, c.onChainId),
            key(dep.chainId, dep.address, c.bountyId),
            c.onChainId,
            c.issuer,
            c.owner,
            c.title,
            c.description,
            c.uri,
            c.accepted,
            c.createdAt,
            sha256,
          ]
        );
      return { ...report, applied: true };
    })
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error("Supply a snapshot file; --apply requires DATABASE_URL");
  const db = postgres(
    process.env.DATABASE_URL ?? "postgresql://localhost/unused"
  );
  try {
    console.log(
      await importArchive(
        db,
        await readFile(process.argv[2], "utf8"),
        process.argv.includes("--apply")
      )
    );
  } finally {
    await db.close();
  }
}
