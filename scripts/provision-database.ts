// One-time role provisioning. Secrets are written only to the specified private directory.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { postgres } from "../packages/database/src/index";
import { migrate } from "../packages/database/src/migrate";
const input = process.argv[2],
  output = process.argv[3];
if (!input || !output)
  throw new Error(
    "Usage: provision-database.ts <private-neon-response.json> <private-output-directory>"
  );
const creation = JSON.parse(await readFile(input, "utf8"));
const ownerURL = creation.connection_uris?.[0]?.connection_uri;
if (!ownerURL) throw new Error("Creation response has no connection URI");
await mkdir(output, { mode: 0o700, recursive: true });
const db = postgres(ownerURL);
try {
  await migrate(db);
  const secrets: Record<string, string> = {};
  await db.transaction(async (tx) => {
    for (const role of ["poidh_api", "poidh_indexer"]) {
      const existing = (
        await tx.query("SELECT rolname FROM pg_roles WHERE rolname=$1", [role])
      ).rows;
      if (existing.length)
        throw new Error(
          "Role already exists; do not rotate credentials implicitly: " + role
        );
      const password = randomBytes(32).toString("hex");
      await tx.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      const url = new URL(ownerURL);
      url.username = role;
      url.password = password;
      secrets[role] = url.toString();
    }
    await tx.query("GRANT poidh_indexer TO poidh_owner");
    await tx.query("GRANT CREATE ON DATABASE poidh TO poidh_indexer");
    await tx.query(
      "CREATE SCHEMA IF NOT EXISTS protocol_api AUTHORIZATION poidh_indexer"
    );
    await tx.query(
      "GRANT USAGE ON SCHEMA community,archive,protocol_api TO poidh_api"
    );
    await tx.query(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA community TO poidh_api"
    );
    await tx.query(
      "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA community TO poidh_api"
    );
    await tx.query(
      "GRANT SELECT ON ALL TABLES IN SCHEMA archive,protocol_api TO poidh_api"
    );
    await tx.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA community GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO poidh_api"
    );
    await tx.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA community GRANT USAGE,SELECT ON SEQUENCES TO poidh_api"
    );
    await tx.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE poidh_indexer IN SCHEMA protocol_api GRANT SELECT ON TABLES TO poidh_api"
    );
  });
  const ultraKey = randomBytes(32).toString("hex");
  const originalKey = randomBytes(32).toString("hex");
  await writeFile(
    output + "/community.json",
    JSON.stringify({
      DATABASE_URL: secrets.poidh_api,
      PROXY_KEYS: JSON.stringify({
        "https://poidh.arca.computer": ultraKey,
        "https://poidh.xyz": originalKey,
      }),
    }),
    { mode: 0o600 }
  );
  await writeFile(
    output + "/web.json",
    JSON.stringify({ COMMUNITY_PROXY_KEY: ultraKey }),
    { mode: 0o600 }
  );
  await writeFile(
    output + "/indexer.json",
    JSON.stringify({ DATABASE_URL: secrets.poidh_indexer }),
    { mode: 0o600 }
  );
  await writeFile(output + "/original-proxy-key.txt", originalKey, {
    mode: 0o600,
  });
  console.log(
    "Migrations applied; isolated API/indexer roles and per-origin proxy keys saved privately."
  );
} finally {
  await db.close();
}
