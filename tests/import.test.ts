import test from "node:test";
import assert from "node:assert/strict";
import { database, bountyId } from "./service-helpers";
import { importBundle } from "../scripts/community/import";
test("imports preserve relationships, moderation, provenance, and timestamps; repeats are harmless", async () => {
  const db = await database();
  const base = {
    kind: "comment",
    author: "0x0000000000000000000000000000000000000001",
    bountyId,
    parentId: null,
    data: { body: "Original" },
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    deletedAt: null,
    moderated: false,
    provenance: { source: "original export" },
  };
  const bundle = {
    version: 1,
    source: "poidh.xyz",
    exportedAt: "2026-09-10T00:00:00.000Z",
    records: [
      { ...base, id: "old:1", legacyId: "1" },
      {
        ...base,
        id: "old:2",
        legacyId: "2",
        parentId: "old:1",
        moderated: true,
      },
    ],
    legacyURLs: [{ path: "/base/bounty/986", bountyId, recordId: null }],
    moderation: [
      {
        recordId: "old:2",
        moderator: base.author,
        reason: "Preserved moderation",
        action: "hide",
        createdAt: base.createdAt,
      },
    ],
  };
  try {
    const dry = await importBundle(db, JSON.stringify(bundle));
    assert.equal(dry.applied, false);
    assert.equal(
      (await db.query("SELECT * FROM community.records")).rows.length,
      0
    );
    const applied = await importBundle(db, JSON.stringify(bundle), {
      apply: true,
    });
    assert.equal(applied.records, 2);
    assert.equal(
      ((await importBundle(db, JSON.stringify(bundle), { apply: true })) as any)
        .repeated,
      true
    );
    const rows = (
      await db.query<any>("SELECT * FROM community.records ORDER BY id")
    ).rows;
    assert.equal(rows[1].parent_id, "old:1");
    assert.equal(rows[1].moderated, true);
    assert.equal(rows[0].provenance.legacyId, "1");
    assert.equal(new Date(rows[0].created_at).toISOString(), base.createdAt);
    const changes = (
      await db.query<any>(
        "SELECT operation,data FROM community.changes ORDER BY sequence"
      )
    ).rows;
    assert.equal(changes[1].operation, "delete");
    assert.equal(changes[1].data, null);
    await assert.rejects(
      importBundle(
        db,
        JSON.stringify({
          ...bundle,
          records: [{ ...bundle.records[0], parentId: "missing" }],
        })
      ),
      /parent/
    );
    await assert.rejects(
      importBundle(
        db,
        JSON.stringify({
          ...bundle,
          records: [{ ...bundle.records[0], data: { session: "not allowed" } }],
        })
      ),
      /Credential/
    );
  } finally {
    await db.close();
  }
});
