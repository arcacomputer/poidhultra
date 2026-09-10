import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postgres, type SQL } from "../../packages/database/src/index";

const excluded = ["community.sessions", "community.challenges"];
const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
async function inventory(db: SQL) {
  const tables = (
    await db.query<{ schema: string; name: string }>(
      "SELECT schemaname AS schema,tablename AS name FROM pg_tables WHERE schemaname IN ('community','archive') ORDER BY schemaname,tablename"
    )
  ).rows;
  const result: { table: string; rows: number; sha256: string }[] = [];
  for (const { schema, name } of tables) {
    const table = schema + "." + name;
    if (excluded.includes(table)) continue;
    const hash = createHash("sha256");
    let count = 0;
    await db.query(
      `DECLARE poidh_backup_inventory NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS row FROM ${quote(
        schema
      )}.${quote(name)} t ORDER BY to_jsonb(t)::text`
    );
    for (;;) {
      const rows = (
        await db.query<{ row: string }>(
          "FETCH 1000 FROM poidh_backup_inventory"
        )
      ).rows;
      for (const row of rows) {
        if (count++) hash.update("\n");
        hash.update(row.row);
      }
      if (rows.length < 1000) break;
    }
    await db.query("CLOSE poidh_backup_inventory");
    result.push({ table, rows: count, sha256: hash.digest("hex") });
  }
  const names = (
    await db.query<{ schemaname: string; sequencename: string }>(
      "SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('community','archive') ORDER BY schemaname,sequencename"
    )
  ).rows;
  const sequences = [];
  for (const { schemaname, sequencename } of names) {
    const state = (
      await db.query<{ last_value: string; is_called: boolean }>(
        `SELECT last_value::text,is_called FROM ${quote(schemaname)}.${quote(
          sequencename
        )}`
      )
    ).rows[0];
    sequences.push({ name: schemaname + "." + sequencename, ...state });
  }
  return { tables: result, sequences };
}
async function pgTool(
  tool: "pg_dump" | "pg_restore",
  url: string,
  args: string[],
  file: string
) {
  const parsed = new URL(url);
  const credentials = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE: parsed.searchParams.get("sslmode") ?? "require",
    PGCONNECT_TIMEOUT: "30",
  };
  const docker = process.env.PG_TOOLS_DOCKER_IMAGE;
  const command = docker ? "docker" : tool;
  const arguments_ = docker
    ? [
        "run",
        "--rm",
        "-i",
        ...Object.keys(credentials).flatMap((key) => ["-e", key]),
        docker,
        tool,
        ...args,
      ]
    : args;
  const child = spawn(command, arguments_, {
    env: { ...process.env, ...credentials },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let error = "";
  child.stderr.on("data", (data) => {
    error = (error + String(data)).slice(-4_000);
  });
  const done = new Promise<void>((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`${tool} failed (${code}): ${error}`))
    );
  });
  if (tool === "pg_dump") {
    child.stdin.end();
    await Promise.all([
      done,
      pipeline(
        child.stdout,
        createWriteStream(file, { mode: 0o600, flags: "wx" })
      ),
    ]);
  } else {
    child.stdout.resume();
    await Promise.all([done, pipeline(createReadStream(file), child.stdin)]);
  }
}
export async function backupDatabase(url: string, directory: string) {
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = postgres(url, { max: 1 });
  try {
    // This private one-connection pool holds session locks before BEGIN, so its
    // repeatable-read snapshot cannot predate a writer we had to wait for.
    await db.query(
      "SELECT pg_advisory_lock(782619),pg_advisory_lock(hashtextextended('community-writes',0))"
    );
    const manifest = await db.transaction(async (tx) => {
      await tx.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      const snapshot = (
        await tx.query<{ id: string }>("SELECT pg_export_snapshot() AS id")
      ).rows[0].id;
      const state = await inventory(tx);
      const migrations = (
        await tx.query<{ name: string; applied_at: Date }>(
          "SELECT name,applied_at FROM public.ultra_migrations ORDER BY name"
        )
      ).rows;
      await pgTool(
        "pg_dump",
        url,
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          "--schema=community",
          "--schema=archive",
          `--snapshot=${snapshot}`,
          ...excluded.map((t) => `--exclude-table-data=${t}`),
        ],
        resolve(dir, "community.dump")
      );
      return {
        version: 1,
        capturedAt: new Date().toISOString(),
        excluded,
        migrations,
        ...state,
        dumpSha256: await fileHash(resolve(dir, "community.dump")),
      };
    });
    await writeFile(
      resolve(dir, "database-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600, flag: "wx" }
    );
    return manifest;
  } finally {
    try {
      await db.query("SELECT pg_advisory_unlock_all()");
    } finally {
      await db.close();
    }
  }
}
export async function restoreDatabase(url: string, directory: string) {
  const dir = resolve(directory);
  const manifest = JSON.parse(
    await readFile(resolve(dir, "database-manifest.json"), "utf8")
  );
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.migrations) ||
    JSON.stringify(manifest.excluded) !== JSON.stringify(excluded)
  )
    throw new Error("Unsupported backup manifest");
  if ((await fileHash(resolve(dir, "community.dump"))) !== manifest.dumpSha256)
    throw new Error("Backup digest mismatch");
  const db = postgres(url, { max: 1 });
  try {
    const existing = (
      await db.query(
        "SELECT nspname FROM pg_namespace WHERE nspname IN ('community','archive') UNION ALL SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='ultra_migrations'"
      )
    ).rows;
    if (existing.length)
      throw new Error(
        "Restore requires an empty target database; existing schemas are never replaced"
      );
    await pgTool(
      "pg_restore",
      url,
      [
        "--dbname",
        new URL(url).pathname.slice(1),
        "--no-owner",
        "--no-acl",
        "--single-transaction",
        "--exit-on-error",
      ],
      resolve(dir, "community.dump")
    );
    await db.transaction(async (tx) => {
      await tx.query(
        "CREATE TABLE public.ultra_migrations (name text PRIMARY KEY,applied_at timestamptz DEFAULT now())"
      );
      for (const migration of manifest.migrations)
        await tx.query(
          "INSERT INTO public.ultra_migrations(name,applied_at) VALUES($1,$2)",
          [migration.name, migration.applied_at]
        );
    });
    const state = await db.transaction(async (tx) => {
      await tx.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      return inventory(tx);
    });
    if (
      JSON.stringify(state.tables) !== JSON.stringify(manifest.tables) ||
      JSON.stringify(state.sequences) !== JSON.stringify(manifest.sequences)
    )
      throw new Error(
        "Restored data or sequence inventory does not match the backup"
      );
    for (const table of excluded) {
      const count = (
        await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${table}`
        )
      ).rows[0].count;
      if (count !== "0")
        throw new Error("Authentication state was unexpectedly restored");
    }
    return {
      verified: true,
      tables: state.tables.length,
      rows: state.tables.reduce((n, t) => n + t.rows, 0),
      dumpSha256: manifest.dumpSha256,
    };
  } finally {
    await db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL || !process.argv[3])
    throw new Error(
      "Set DATABASE_URL; use database-backup.ts backup|restore <private-directory>"
    );
  const command = process.argv[2];
  const result =
    command === "backup"
      ? await backupDatabase(process.env.DATABASE_URL, process.argv[3])
      : command === "restore"
      ? await restoreDatabase(process.env.DATABASE_URL, process.argv[3])
      : (() => {
          throw new Error("Expected backup or restore");
        })();
  console.log(
    JSON.stringify({
      operation: command,
      ...("verified" in result
        ? result
        : {
            capturedAt: result.capturedAt,
            dumpSha256: result.dumpSha256,
            tables: result.tables.length,
          }),
    })
  );
}
