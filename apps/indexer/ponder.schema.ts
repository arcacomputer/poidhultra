import { onchainTable, index } from "ponder";
export const bounty = onchainTable(
  "bounty",
  (t) => ({
    id: t.text().primaryKey(),
    chain_id: t.integer().notNull(),
    contract: t.hex().notNull(),
    on_chain_id: t.bigint().notNull(),
    display_id: t.bigint().notNull(),
    issuer: t.hex().notNull(),
    title: t.text().notNull(),
    description: t.text().notNull(),
    amount: t.bigint().notNull(),
    created_at: t.bigint().notNull(),
    status: t.text().notNull(),
    multiplayer: t.boolean().notNull(),
    claim_count: t.integer().notNull().default(0),
    archive: t.boolean().notNull().default(false),
    archive_as_of: t.text(),
  }),
  (t) => ({ created: index().on(t.created_at), issuer: index().on(t.issuer) })
);
export const claim = onchainTable(
  "claim",
  (t) => ({
    id: t.text().primaryKey(),
    chain_id: t.integer().notNull(),
    bounty_id: t.text().notNull(),
    on_chain_id: t.bigint().notNull(),
    issuer: t.hex().notNull(),
    owner: t.hex().notNull(),
    title: t.text().notNull(),
    description: t.text().notNull(),
    uri: t.text().notNull(),
    accepted: t.boolean().notNull().default(false),
    created_at: t.bigint().notNull(),
  }),
  (t) => ({ bounty: index().on(t.bounty_id) })
);
export const participation = onchainTable("participation", (t) => ({
  id: t.text().primaryKey(),
  bounty_id: t.text().notNull(),
  address: t.hex().notNull(),
  amount: t.bigint().notNull(),
}));
export const vote = onchainTable("vote", (t) => ({
  id: t.text().primaryKey(),
  bounty_id: t.text().notNull(),
  claim_id: t.bigint().notNull(),
  round: t.bigint().notNull(),
  yes: t.bigint().notNull(),
  no: t.bigint().notNull(),
  deadline: t.bigint().notNull(),
  resolved: t.boolean().notNull(),
}));
export const event = onchainTable("event", (t) => ({
  id: t.text().primaryKey(),
  chain_id: t.integer().notNull(),
  contract: t.hex().notNull(),
  block_number: t.bigint().notNull(),
  block_hash: t.hex().notNull(),
  transaction_hash: t.hex().notNull(),
  log_index: t.integer().notNull(),
  name: t.text().notNull(),
  data: t.json().notNull(),
  timestamp: t.bigint().notNull(),
}));
export const account = onchainTable("account", (t) => ({
  id: t.text().primaryKey(),
  chain_id: t.integer().notNull(),
  address: t.hex().notNull(),
  earned: t.bigint().notNull().default(0n),
  paid: t.bigint().notNull().default(0n),
  nfts: t.bigint().notNull().default(0n),
}));
export const token = onchainTable("token", (t) => ({
  id: t.text().primaryKey(),
  owner: t.hex().notNull(),
  claim_id: t.text().notNull(),
}));
