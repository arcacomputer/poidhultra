import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { postgres } from "../../packages/database/src/index";
import { migrate } from "../../packages/database/src/migrate";
import { backupDatabase, restoreDatabase } from "./database-backup";
import { key, deployments } from "../../packages/protocol/src/index";
import { createAPI } from "../../apps/community-api/src/app";

// Run only with the dedicated disposable project/buckets described in the
// runbook. No production connection is accepted by this rehearsal driver.
const directory = resolve(process.env.REHEARSAL_DIRECTORY ?? "");
const settings = JSON.parse(
  await readFile(resolve(directory, "settings.json"), "utf8")
);
if (
  !settings.origin.includes("poidh-ultra-rehearsal.") ||
  !settings.projectId ||
  !settings.databaseURL.includes("/source?")
)
  throw new Error("Expected an isolated rehearsal configuration");
const account = privateKeyToAccount(
  ("0x" + "1".padStart(64, "0")) as `0x${string}`
);
const bountyId = key(8453, deployments[1].address, "9007199254740993");
const local = process.env.REHEARSAL_LOCAL_API === "true";
const restored = process.env.REHEARSAL_TARGET === "restored";
const localDB = local
  ? postgres(restored ? settings.restoredDatabaseURL : settings.databaseURL)
  : null;
const objectDirectory = resolve(
  directory,
  restored ? "objects-restored" : "objects-source"
);
if (local) await mkdir(objectDirectory, { recursive: true, mode: 0o700 });
const localStorage = {
  async put(key: string, bytes: Uint8Array, type: string) {
    if (!/^sha256\/[a-f0-9]{64}$/.test(key))
      throw new Error("Invalid object key");
    const name = key.slice(7);
    await writeFile(resolve(objectDirectory, name), bytes, { mode: 0o600 });
    await writeFile(
      resolve(objectDirectory, name + ".json"),
      JSON.stringify({ key, size: bytes.length, type }),
      { mode: 0o600 }
    );
  },
  async get(key: string) {
    if (!/^sha256\/[a-f0-9]{64}$/.test(key)) return null;
    try {
      const meta = JSON.parse(
        await readFile(resolve(objectDirectory, key.slice(7) + ".json"), "utf8")
      );
      return {
        body: new Uint8Array(
          await readFile(resolve(objectDirectory, key.slice(7)))
        ),
        type: meta.type,
      };
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  },
};
const localAPI = localDB
  ? createAPI({
      db: localDB,
      storage: localStorage,
      origins: [settings.origin],
      proxyKeys: { [settings.origin]: settings.proxyKey },
      publicStorageURL: settings.origin + "/media",
      moderators: [account.address.toLowerCase()],
    })
  : null;
async function send(url: string, options: RequestInit) {
  if (!localAPI) return fetch(url, options);
  const path = new URL(url).pathname;
  if (path === "/ops/objects") {
    const items = await Promise.all(
      (await readdir(objectDirectory))
        .filter((p) => p.endsWith(".json"))
        .map(async (p) =>
          JSON.parse(await readFile(resolve(objectDirectory, p), "utf8"))
        )
    );
    return Response.json({ items, cursor: null });
  }
  if (path.startsWith("/ops/objects/") && options.method === "PUT") {
    const request = new Request(url, options);
    await localStorage.put(
      path.slice("/ops/objects/".length),
      new Uint8Array(await request.arrayBuffer()),
      request.headers.get("content-type")!
    );
    return new Response(null, { status: 204 });
  }
  return localAPI.fetch(new Request(url, options));
}
let cookie = "";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function call(
  path: string,
  method = "GET",
  data?: unknown,
  idempotencyKey?: string
) {
  const binary = data instanceof Uint8Array;
  const response = await send(settings.origin + path, {
    method,
    headers: {
      authorization: `Bearer ${settings.token}`,
      origin: settings.origin,
      "x-poidh-origin": settings.origin,
      "x-poidh-proxy-key": settings.proxyKey,
      "content-type": binary ? "image/png" : "application/json",
      cookie,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body:
      data === undefined
        ? undefined
        : binary
        ? (data as BodyInit)
        : JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `${method} ${path}: ${response.status} ${await response.text()}`
    );
  return response;
}
async function json(
  path: string,
  method = "GET",
  data?: unknown,
  idem?: string
) {
  return (await call(path, method, data, idem)).json() as Promise<any>;
}
async function login() {
  const challenge = await json("/api/v1/auth/challenge", "POST", {
    address: account.address,
    chainId: 8453,
  });
  const signature = await account.signMessage({ message: challenge.message });
  const response = await call("/api/v1/auth/verify", "POST", {
    message: challenge.message,
    signature,
  });
  cookie = response.headers.get("set-cookie")!.split(";")[0];
}
async function fixture(url: string) {
  const db = postgres(url);
  try {
    await db.query(`CREATE SCHEMA protocol_api;
      CREATE TABLE protocol_api.bounty (id text PRIMARY KEY,chain_id integer,contract text,on_chain_id numeric(78,0),display_id numeric(78,0),issuer text,title text,description text,amount numeric(78,0),created_at numeric(78,0),status text,multiplayer boolean,claim_count integer,archive boolean,archive_as_of text);
      CREATE TABLE protocol_api.claim(id text PRIMARY KEY,bounty_id text,on_chain_id numeric(78,0),issuer text,owner text,title text,description text,uri text,accepted boolean,created_at numeric(78,0));`);
    await db.query(
      "INSERT INTO protocol_api.bounty VALUES($1,8453,$2,9007199254740993,9007199254741979,$3,'Synthetic restore fixture','Disposable rehearsal only',9007199254740993123456789,1700000000,'open',true,0,false,null)",
      [
        bountyId,
        deployments[1].address,
        "0x0000000000000000000000000000000000000002",
      ]
    );
  } finally {
    await db.close();
  }
}
const command = process.argv[2];
try {
  if (command === "prepare") {
    const db = postgres(settings.databaseURL);
    try {
      await migrate(db);
      await db.query("CREATE DATABASE restored");
    } finally {
      await db.close();
    }
    await fixture(settings.databaseURL);
    const restore = new URL(settings.databaseURL);
    restore.pathname = "/restored";
    settings.restoredDatabaseURL = restore.toString();
    await writeFile(
      resolve(directory, "settings.json"),
      JSON.stringify(settings),
      { mode: 0o600 }
    );
    console.log("Prepared isolated source and empty restore databases");
  } else if (command === "seed") {
    await login();
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    );
    const upload = await json("/api/v1/uploads", "POST", png);
    const metadata = await json("/api/v1/metadata", "POST", {
      name: "Rehearsal proof",
      description: "Synthetic data",
      image: upload.url,
    });
    const profile = await json(
      "/api/v1/records",
      "POST",
      {
        kind: "profile",
        data: {
          name: "Restore rehearsal",
          bio: "Synthetic data",
          image: upload.url,
        },
      },
      "rehearsal-profile-create"
    );
    const edited = await json(
      `/api/v1/records/${profile.id}`,
      "PATCH",
      {
        version: profile.version,
        data: { ...profile.data, bio: "Edited before the backup" },
      },
      "rehearsal-profile-edit"
    );
    const album = await json(
      "/api/v1/records",
      "POST",
      {
        kind: "album",
        data: {
          title: "Restore fixture",
          description: "Synthetic",
          bounties: [bountyId],
        },
      },
      "rehearsal-album-create"
    );
    const comment = await json(
      "/api/v1/records",
      "POST",
      { kind: "comment", bountyId, data: { body: "Original parent" } },
      "rehearsal-comment-create"
    );
    const reply = await json(
      "/api/v1/records",
      "POST",
      {
        kind: "comment",
        bountyId,
        parentId: comment.id,
        data: { body: "Original reply" },
      },
      "rehearsal-reply-create"
    );
    await json(
      "/api/v1/records",
      "POST",
      {
        kind: "reaction",
        bountyId,
        parentId: comment.id,
        data: { type: "upvote" },
      },
      "rehearsal-reaction-create"
    );
    const removed = await json(
      "/api/v1/records",
      "POST",
      { kind: "comment", bountyId, data: { body: "Will become a tombstone" } },
      "rehearsal-delete-create"
    );
    await json(
      `/api/v1/records/${removed.id}`,
      "DELETE",
      { version: removed.version },
      "rehearsal-delete-apply"
    );
    await json(
      `/api/v1/moderation/${reply.id}`,
      "POST",
      { hidden: true, reason: "Synthetic moderation test" },
      "rehearsal-moderate-reply"
    );
    const db = postgres(settings.databaseURL);
    try {
      await db.query(
        "INSERT INTO community.legacy_urls(path,bounty_id,record_id,provenance) VALUES('/base/bounty/9007199254741979',$1,$2,'{\"source\":\"rehearsal\"}')",
        [bountyId, comment.id]
      );
    } finally {
      await db.close();
    }
    const feed = await json("/api/v1/changes?after=0&limit=100");
    await writeFile(
      resolve(directory, "expected.json"),
      JSON.stringify({
        edited,
        album,
        comment,
        reply,
        removed,
        upload,
        metadata,
        cookie,
        feed,
      }),
      { mode: 0o600 }
    );
    console.log(
      "Seeded signed-in edits, relationships, moderation, deletion, notifications, proof and metadata"
    );
  } else if (command === "backup") {
    await backupDatabase(settings.databaseURL, resolve(directory, "backup"));
    const objects = [];
    let cursor: string | null = null;
    do {
      const page = await json(
        "/ops/objects" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : "")
      );
      for (const item of page.items) {
        const response = await call("/media/" + item.key);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const sha256 = hash(bytes);
        assert.equal(item.key, "sha256/" + sha256);
        assert.equal(response.headers.get("content-type"), item.type);
        await writeFile(resolve(directory, "backup", sha256), bytes, {
          mode: 0o600,
        });
        objects.push({ ...item, sha256 });
      }
      cursor = page.cursor;
    } while (cursor);
    await writeFile(
      resolve(directory, "backup", "manifest.json"),
      JSON.stringify({ version: 1, objects }),
      { mode: 0o600 }
    );
    console.log(
      JSON.stringify({ backup: "verified", objects: objects.length })
    );
  } else if (command === "restore-database") {
    const report = await restoreDatabase(
      settings.restoredDatabaseURL,
      resolve(directory, "backup")
    );
    await fixture(settings.restoredDatabaseURL);
    await writeFile(
      resolve(directory, "database-result.json"),
      JSON.stringify(report),
      { mode: 0o600 }
    );
    console.log(JSON.stringify(report));
  } else if (command === "restore-objects") {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "backup", "manifest.json"), "utf8")
    );
    for (const item of manifest.objects) {
      const bytes = await readFile(resolve(directory, "backup", item.sha256));
      assert.equal(hash(bytes), item.sha256);
      const response = await send(
        settings.origin + "/ops/objects/" + item.key,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${settings.token}`,
            "content-type": item.type,
          },
          body: bytes,
        }
      );
      assert.equal(response.status, 204);
    }
    console.log(
      `Restored verified immutable objects into the separate ${
        local ? "local" : "R2"
      } target`
    );
  } else if (command === "verify") {
    const expected = JSON.parse(
      await readFile(resolve(directory, "expected.json"), "utf8")
    );
    for (const item of [expected.edited, expected.album, expected.comment])
      assert.deepEqual(await json(`/api/v1/records/${item.id}`), item);
    for (const kind of ["upload", "metadata"]) {
      const object = expected[kind];
      const response = await call(new URL(object.url).pathname);
      assert.equal(
        hash(new Uint8Array(await response.arrayBuffer())),
        object.sha256
      );
      assert.equal(response.headers.get("content-type"), object.contentType);
    }
    const feed = await json("/api/v1/changes?after=0&limit=100");
    assert.deepEqual(feed, expected.feed);
    cookie = expected.cookie;
    assert.equal(await json("/api/v1/auth/session"), null);
    await login();
    const continued = await json(
      `/api/v1/records/${expected.edited.id}`,
      "PATCH",
      {
        version: expected.edited.version,
        data: { ...expected.edited.data, bio: "Edited after restore" },
      },
      "rehearsal-after-restore"
    );
    assert.equal(
      continued.version,
      String(BigInt(expected.edited.version) + 1n)
    );
    const after = await json(
      "/api/v1/changes?after=" + expected.feed.nextCursor + "&limit=100"
    );
    assert.ok(after.items.some((x: any) => x.id === expected.edited.id));
    const replay = await json(
      `/api/v1/records/${expected.edited.id}`,
      "PATCH",
      { version: "1", data: expected.edited.data },
      "rehearsal-profile-edit"
    );
    assert.deepEqual(replay, expected.edited);
    console.log(
      JSON.stringify({
        restoredAPI: "verified",
        apiRuntime: local ? "Node" : "Cloudflare",
        storage: local ? "local" : "R2",
        versions: "preserved",
        cursor: "continued",
        session: "reauthenticated",
        idempotency: "preserved",
        media: "byte-identical",
      })
    );
  } else
    throw new Error(
      "Use prepare, seed, backup, restore-database, restore-objects or verify"
    );
} finally {
  await localDB?.close();
}
