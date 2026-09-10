import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "../../apps/community-api/node_modules/zod/index.js";
import {
  postgres,
  type Database,
  serial,
} from "../../packages/database/src/index";
import { digest } from "../../packages/auth/src/index";
import { address, bountyKey } from "../../packages/protocol/src/index";
const item = z
  .object({
    id: z.string().min(1).max(256),
    kind: z.enum(["comment", "profile", "album", "reaction"]),
    author: address,
    bountyId: bountyKey.nullable(),
    parentId: z.string().nullable(),
    data: z.record(z.unknown()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().nullable(),
    moderated: z.boolean(),
    legacyId: z.string(),
    provenance: z.record(z.unknown()),
  })
  .strict();
export const bundleSchema = z
  .object({
    version: z.literal(1),
    source: z.enum(["poidh.xyz", "poidhultra"]),
    exportedAt: z.string().datetime(),
    records: z.array(item),
    legacyURLs: z.array(
      z.object({
        path: z.string().startsWith("/"),
        bountyId: bountyKey.nullable(),
        recordId: z.string().nullable(),
      })
    ),
    protocolModeration: z
      .array(
        z.object({
          id: bountyKey,
          kind: z.enum(["bounty", "claim"]),
          hidden: z.boolean(),
          moderator: address,
          reason: z.string(),
          updatedAt: z.string().datetime(),
          provenance: z.record(z.unknown()),
        })
      )
      .default([]),
    moderation: z.array(
      z.object({
        recordId: z.string(),
        moderator: address,
        reason: z.string(),
        action: z.enum(["hide", "restore"]),
        createdAt: z.string().datetime(),
      })
    ),
  })
  .strict();
const secretNames =
  /^(password|private.?key|secret|session|token|credential|notification.?job|delivery.?job)$/i;
function noCredentials(value: unknown) {
  if (value && typeof value === "object")
    for (const [name, v] of Object.entries(value)) {
      if (secretNames.test(name))
        throw new Error("Credential or delivery data is not allowed: " + name);
      noCredentials(v);
    }
}
export async function importBundle(
  db: Database,
  bytes: string,
  { apply = false }: { apply?: boolean } = {}
) {
  const bundle = bundleSchema.parse(JSON.parse(bytes));
  noCredentials(bundle);
  const ids = new Set<string>();
  const profiles = new Set<string>();
  const reactions = new Set<string>();
  for (const row of bundle.records) {
    if (ids.has(row.id)) throw new Error("Duplicate ID: " + row.id);
    ids.add(row.id);
    if (Date.parse(row.updatedAt) < Date.parse(row.createdAt))
      throw new Error("Invalid timestamp order");
    if (row.kind === "profile") {
      if (profiles.has(row.author)) throw new Error("Duplicate profile owner");
      profiles.add(row.author);
    }
    if (row.kind === "reaction") {
      const key = row.author + ":" + row.parentId;
      if (reactions.has(key)) throw new Error("Duplicate reaction owner");
      reactions.add(key);
    }
    for (const field of ["image", "website"])
      if (
        typeof row.data[field] === "string" &&
        !/^https:\/\//.test(row.data[field] as string)
      )
        throw new Error("Invalid profile URL");
  }
  for (const row of bundle.records) {
    if (row.parentId) {
      const parent = bundle.records.find((r) => r.id === row.parentId);
      if (
        !parent ||
        parent.kind !== "comment" ||
        parent.bountyId !== row.bountyId
      )
        throw new Error("Broken parent relationship: " + row.id);
      let p = parent;
      const seen = new Set([row.id]);
      while (p) {
        if (seen.has(p.id)) throw new Error("Cyclic parent relationship");
        seen.add(p.id);
        p = bundle.records.find((r) => r.id === p.parentId)!;
      }
    }
  }
  for (const url of bundle.legacyURLs)
    if (url.recordId && !ids.has(url.recordId))
      throw new Error("Missing URL target");
  for (const mod of bundle.moderation)
    if (!ids.has(mod.recordId)) throw new Error("Missing moderation target");
  const hash = await digest(bytes);
  const report = {
    source: bundle.source,
    sha256: hash,
    records: bundle.records.length,
    relationships: bundle.records.filter((r) => r.parentId).length,
    moderated: bundle.records.filter((r) => r.moderated).length,
    deleted: bundle.records.filter((r) => r.deletedAt).length,
    legacyURLs: bundle.legacyURLs.length,
    applied: false,
  };
  if (!apply) return report;
  return db.transaction((tx) =>
    serial(tx, "community-writes", async () => {
      const batch = (
        await tx.query<{ sha256: string }>(
          "SELECT sha256 FROM community.import_batches WHERE id=$1",
          [hash]
        )
      ).rows[0];
      if (batch) return { ...report, applied: true, repeated: true };
      // Import is deliberately insert-only. Reconciliation must never overwrite a newer community edit.
      for (const row of bundle.records) {
        await tx.query(
          "INSERT INTO community.records(id,kind,author,bounty_id,parent_id,data,created_at,updated_at,deleted_at,moderated,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            row.id,
            row.kind,
            row.author,
            row.bountyId,
            row.parentId,
            JSON.stringify(row.data),
            row.createdAt,
            row.updatedAt,
            row.deletedAt,
            row.moderated,
            JSON.stringify({
              ...row.provenance,
              source: bundle.source,
              legacyId: row.legacyId,
              exportedAt: bundle.exportedAt,
              batch: hash,
            }),
          ]
        );
      }
      for (const row of bundle.records) {
        const hidden = !!row.deletedAt || row.moderated;
        await tx.query(
          "INSERT INTO community.changes(kind,record_id,operation,version,data) VALUES($1,$2,$3,1,$4)",
          [
            row.kind,
            row.id,
            hidden ? "delete" : "upsert",
            hidden
              ? null
              : JSON.stringify({
                  id: row.id,
                  kind: row.kind,
                  author: row.author,
                  bountyId: row.bountyId,
                  parentId: row.parentId,
                  data: row.data,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  deletedAt: row.deletedAt,
                  moderated: row.moderated,
                  version: "1",
                }),
          ]
        );
      }
      for (const url of bundle.legacyURLs)
        await tx.query(
          "INSERT INTO community.legacy_urls(path,bounty_id,record_id,provenance) VALUES($1,$2,$3,$4)",
          [
            url.path,
            url.bountyId,
            url.recordId,
            JSON.stringify({ source: bundle.source, batch: hash }),
          ]
        );
      for (const m of bundle.protocolModeration) {
        await tx.query(
          "INSERT INTO community.protocol_moderation(id,kind,hidden,moderator,reason,updated_at,provenance) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            m.id,
            m.kind,
            m.hidden,
            m.moderator,
            m.reason,
            m.updatedAt,
            JSON.stringify(m.provenance),
          ]
        );
        await tx.query(
          "INSERT INTO community.protocol_moderation_log(id,kind,hidden,moderator,reason,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [m.id, m.kind, m.hidden, m.moderator, m.reason, m.updatedAt]
        );
      }
      for (const mod of bundle.moderation)
        await tx.query(
          "INSERT INTO community.moderation_log(record_id,moderator,reason,action,created_at) VALUES($1,$2,$3,$4,$5)",
          [mod.recordId, mod.moderator, mod.reason, mod.action, mod.createdAt]
        );
      await tx.query(
        "INSERT INTO community.import_batches(id,source,sha256,record_count) VALUES($1,$2,$3,$4)",
        [hash, bundle.source, hash, bundle.records.length]
      );
      return { ...report, applied: true, repeated: false };
    })
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Usage: node --import tsx scripts/community/import.ts export.json [--apply]"
    );
  const bytes = await readFile(path, "utf8");
  const apply = process.argv.includes("--apply");
  const db = apply ? postgres(process.env.DATABASE_URL ?? "") : null;
  try {
    console.log(
      JSON.stringify(
        await importBundle(db as Database, bytes, { apply }),
        null,
        2
      )
    );
  } finally {
    await db?.close();
  }
}
