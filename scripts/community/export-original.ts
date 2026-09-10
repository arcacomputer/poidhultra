// Run by the original database operator with a read-only scoped connection.
// Only the columns below are requested; sessions, credentials and notification jobs are never read.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { postgres } from "../../packages/database/src/index";
import {
  address,
  deployments,
  resolveLegacyURL,
  key,
} from "../../packages/protocol/src/index";
if (!process.env.SOURCE_DATABASE_URL || !process.argv[2] || !process.argv[3])
  throw new Error(
    "Set SOURCE_DATABASE_URL; arguments: <private-output.json> <reviewed-album-owners.json>"
  );
const owners = JSON.parse(await readFile(process.argv[3], "utf8"));
const db = postgres(process.env.SOURCE_DATABASE_URL);
const at = new Date().toISOString();
function identity(chain: number, id: string) {
  const d = deployments.find((d) => d.chainId === chain);
  if (!d) throw new Error("Unknown original chain");
  const r = resolveLegacyURL(d.slug, id);
  return key(chain, r.deployment.address, r.onChainId);
}
const timestamp = (v: unknown) => new Date(String(v)).toISOString();
const base = (id: string, kind: string, author: string, createdAt: string) => ({
  id,
  kind,
  author: address.parse(author),
  bountyId: null as string | null,
  parentId: null as string | null,
  data: {} as any,
  createdAt,
  updatedAt: createdAt,
  deletedAt: null as string | null,
  moderated: false,
  legacyId: id.split(":").at(-1)!,
  provenance: { source: "poidh.xyz", exportedAt: at } as Record<
    string,
    unknown
  >,
});
try {
  const bundle = await db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const comments = (
      await tx.query<any>(
        'SELECT id::text,bounty_id::text,chain_id,parent_id::text,user_address,body,created_at,deleted_at FROM "Comments" ORDER BY id'
      )
    ).rows;
    const profiles = (
      await tx.query<any>(
        'SELECT address,pfp_url,ens,degen_name,wei,gwei,"farcasterTag" AS farcaster_tag,"farcasterFid" AS farcaster_fid,"twitterTag" AS twitter_tag,last_updated FROM "UsersExtra" ORDER BY address'
      )
    ).rows;
    const reactions = (
      await tx.query<any>(
        'SELECT id::text,comment_id::text,type,address FROM "Reactions" ORDER BY id'
      )
    ).rows;
    const albums = (
      await tx.query<any>(
        "SELECT bounty_id::text,chain_id,album FROM \"BountiesExtra\" WHERE album<>'' ORDER BY album,chain_id,bounty_id"
      )
    ).rows;
    const bans = (
      await tx.query<any>(
        'SELECT id::text,chain_id,bounty_id::text,claim_id::text,banned_at,banned_by FROM "Ban" ORDER BY id'
      )
    ).rows;
    const records: any[] = [];
    const legacyURLs: any[] = [];
    const protocolModeration: any[] = [];
    for (const c of comments) {
      const r = base(
        "original:comment:" + c.id,
        "comment",
        c.user_address,
        timestamp(c.created_at)
      );
      r.bountyId = identity(c.chain_id, c.bounty_id);
      r.parentId = c.parent_id ? "original:comment:" + c.parent_id : null;
      r.data = { body: c.body };
      r.deletedAt = c.deleted_at ? timestamp(c.deleted_at) : null;
      r.provenance.originalTable = "Comments";
      records.push(r);
    }
    for (const p of profiles) {
      const r = base(
        "profile:" + p.address.toLowerCase(),
        "profile",
        p.address,
        timestamp(p.last_updated)
      );
      r.data = {
        name: p.wei ?? p.gwei ?? p.ens ?? p.degen_name ?? "",
        bio: "",
        image: p.pfp_url ?? null,
        website: null,
      };
      r.provenance = {
        ...r.provenance,
        originalTable: "UsersExtra",
        createdAtSource: "last_updated; original creation time unavailable",
        originalProfile: {
          ens: p.ens,
          degenName: p.degen_name,
          wei: p.wei,
          gwei: p.gwei,
          farcasterTag: p.farcaster_tag,
          farcasterFid: p.farcaster_fid,
          twitterTag: p.twitter_tag,
        },
      };
      records.push(r);
    }
    const reactionKeys = new Set();
    for (const v of reactions) {
      const parent = records.find(
        (r) => r.id === "original:comment:" + v.comment_id
      );
      if (!parent) throw new Error("Reaction parent is outside export");
      const pair = v.address.toLowerCase() + ":" + parent.id;
      if (reactionKeys.has(pair))
        throw new Error(
          "Duplicate original reactions require operator reconciliation: " +
            pair
        );
      reactionKeys.add(pair);
      const r = base("original:reaction:" + v.id, "reaction", v.address, at);
      r.parentId = parent.id;
      r.bountyId = parent.bountyId;
      r.data = { type: v.type };
      r.provenance = {
        ...r.provenance,
        originalTable: "Reactions",
        createdAtSource: "export capture time; source has no timestamp",
      };
      records.push(r);
    }
    for (const title of new Set(albums.map((a) => a.album))) {
      const owner = owners[title];
      if (!owner)
        throw new Error("Album has no verified owner mapping: " + title);
      const id =
        "original:album:" + createHash("sha256").update(title).digest("hex");
      const r = base(id, "album", owner, at);
      r.data = {
        title,
        description: "",
        bounties: albums
          .filter((a) => a.album === title)
          .map((a) => identity(a.chain_id, a.bounty_id)),
      };
      r.provenance = {
        ...r.provenance,
        originalTable: "BountiesExtra",
        originalAlbum: title,
        ownershipSource: "operator-reviewed mapping",
        createdAtSource: "export capture time; source has no timestamp",
      };
      records.push(r);
      legacyURLs.push({
        path: "/a/" + encodeURIComponent(title),
        bountyId: null,
        recordId: id,
      });
    }
    for (const b of bans) {
      const kind = b.claim_id ? "claim" : "bounty";
      if (!b.claim_id && !b.bounty_id) throw new Error("Ban has no target");
      let id: string;
      if (kind === "bounty") id = identity(b.chain_id, b.bounty_id);
      else {
        const c = (
          await tx.query<any>(
            'SELECT on_chain_id::text,bounty_id::text FROM "Claims" WHERE id=$1 AND chain_id=$2',
            [b.claim_id, b.chain_id]
          )
        ).rows[0];
        if (!c) throw new Error("Banned claim not found");
        const bounty = identity(b.chain_id, c.bounty_id).split(":");
        id = key(b.chain_id, bounty[1], c.on_chain_id);
      }
      protocolModeration.push({
        id,
        kind,
        hidden: true,
        moderator: address.parse(b.banned_by),
        reason: "Preserved from the original moderation database.",
        updatedAt: timestamp(b.banned_at),
        provenance: { source: "poidh.xyz", legacyBanId: b.id },
      });
    }
    return {
      version: 1,
      source: "poidh.xyz",
      exportedAt: at,
      records,
      legacyURLs,
      moderation: [],
      protocolModeration,
    };
  });
  await writeFile(process.argv[2], JSON.stringify(bundle, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    `Scoped export: ${bundle.records.length} community records, ${bundle.protocolModeration.length} protocol moderation decisions`
  );
} finally {
  await db.close();
}
