import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { Database } from "../packages/database/src/index";
import { key, deployments } from "../packages/protocol/src/index";
export const bountyId = key(8453, deployments[1].address, "9007199254740993");
export async function database() {
  const engine = new PGlite();
  await engine.exec(
    await readFile("packages/database/migrations/001-community.sql", "utf8")
  );
  await engine.exec(
    await readFile(
      "packages/database/migrations/002-archive-and-moderation.sql",
      "utf8"
    )
  );
  await engine.exec(`CREATE SCHEMA protocol_api;
 CREATE TABLE protocol_api.bounty (id text PRIMARY KEY,chain_id integer,contract text,on_chain_id numeric(78,0),display_id numeric(78,0),issuer text,title text,description text,amount numeric(78,0),created_at numeric(78,0),status text,multiplayer boolean,claim_count integer,archive boolean,archive_as_of text);
 CREATE TABLE protocol_api.claim(id text PRIMARY KEY,bounty_id text,on_chain_id numeric(78,0),issuer text,owner text,title text,description text,uri text,accepted boolean,created_at numeric(78,0));
 CREATE TABLE protocol_api.account(address text,chain_id integer,earned numeric(78,0),paid numeric(78,0),nfts numeric(78,0));
 CREATE TABLE protocol_api.event(id text PRIMARY KEY,name text,chain_id integer,timestamp numeric(78,0),transaction_hash text,contract text,block_number numeric(78,0),data jsonb);
 `);
  await engine.query(
    "INSERT INTO protocol_api.bounty VALUES($1,8453,$2,$3,$4,$5,'Test bounty','A protocol test',$6,1700000000,'open',true,0,false,null)",
    [
      bountyId,
      deployments[1].address,
      "9007199254740993",
      "9007199254741979",
      "0x0000000000000000000000000000000000000001",
      "9007199254740993123456789",
    ]
  );
  const db: Database = {
    query: (text, values) => engine.query(text, values) as any,
    transaction: (fn) =>
      engine.transaction((tx) =>
        fn({ query: (text, values) => tx.query(text, values) as any })
      ),
    close: () => engine.close(),
  };
  return db;
}
