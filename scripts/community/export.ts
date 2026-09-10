import { writeFile } from "node:fs/promises";
import { postgres } from "../../packages/database/src/index";
if (!process.env.DATABASE_URL || !process.argv[2])
  throw new Error("Set DATABASE_URL and provide a private output path");
const db = postgres(process.env.DATABASE_URL);
try {
  const data = await db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const records = (
      await tx.query<any>(
        "SELECT * FROM community.records WHERE kind<>'notification' ORDER BY id"
      )
    ).rows;
    const urls = (
      await tx.query(
        'SELECT path,bounty_id AS "bountyId",record_id AS "recordId" FROM community.legacy_urls ORDER BY path'
      )
    ).rows;
    const protocolModeration = (
      await tx.query(
        'SELECT id,kind,hidden,moderator,reason,updated_at AS "updatedAt",provenance FROM community.protocol_moderation ORDER BY id'
      )
    ).rows;
    const moderation = (
      await tx.query(
        'SELECT record_id AS "recordId",moderator,reason,action,created_at AS "createdAt" FROM community.moderation_log ORDER BY id'
      )
    ).rows;
    return {
      version: 1,
      source: "poidhultra",
      exportedAt: new Date().toISOString(),
      records: records.map((r) => ({
        id: r.id,
        kind: r.kind,
        author: r.author,
        bountyId: r.bounty_id,
        parentId: r.parent_id,
        data: r.data,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
        deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
        moderated: r.moderated,
        version: String(r.version),
        legacyId: r.provenance?.legacyId ?? r.id,
        provenance: r.provenance ?? { source: "poidh-ultra" },
      })),
      legacyURLs: urls,
      moderation,
      protocolModeration,
    };
  });
  await writeFile(process.argv[2], JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    `Exported ${data.records.length} records without credentials, sessions, or delivery jobs`
  );
} finally {
  await db.close();
}
