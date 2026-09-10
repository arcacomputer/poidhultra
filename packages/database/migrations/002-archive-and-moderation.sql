-- Historical data is immutable, separately identified, and never fed to transaction builders.
CREATE SCHEMA IF NOT EXISTS archive;
CREATE TABLE archive.snapshots (
 id text PRIMARY KEY, source text NOT NULL, captured_at timestamptz NOT NULL,
 chain_id integer NOT NULL CHECK(chain_id=666666666), block_number numeric(78,0),
 block_hash text, verified boolean NOT NULL DEFAULT false, provenance jsonb NOT NULL
);
CREATE TABLE archive.bounty (
 id text PRIMARY KEY, chain_id integer NOT NULL CHECK(chain_id=666666666), contract text NOT NULL,
 on_chain_id numeric(78,0) NOT NULL, display_id numeric(78,0) NOT NULL, issuer text NOT NULL,
 title text NOT NULL, description text NOT NULL, amount numeric(78,0) NOT NULL,
 created_at numeric(78,0) NOT NULL, status text NOT NULL, multiplayer boolean NOT NULL,
 claim_count integer NOT NULL, archive boolean NOT NULL DEFAULT true CHECK(archive),
 archive_as_of text NOT NULL, snapshot_id text NOT NULL REFERENCES archive.snapshots(id)
);
CREATE TABLE archive.claim (
 id text PRIMARY KEY, chain_id integer NOT NULL CHECK(chain_id=666666666), bounty_id text NOT NULL REFERENCES archive.bounty(id),
 on_chain_id numeric(78,0) NOT NULL, issuer text NOT NULL, owner text NOT NULL, title text NOT NULL,
 description text NOT NULL, uri text NOT NULL, accepted boolean NOT NULL, created_at numeric(78,0) NOT NULL,
 snapshot_id text NOT NULL REFERENCES archive.snapshots(id)
);
CREATE TABLE community.protocol_moderation (
 id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('bounty','claim')), hidden boolean NOT NULL,
 moderator text NOT NULL, reason text NOT NULL, updated_at timestamptz NOT NULL,
 provenance jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE community.protocol_moderation_log (
 sequence bigserial PRIMARY KEY, id text NOT NULL, kind text NOT NULL, hidden boolean NOT NULL,
 moderator text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX archive_bounty_created ON archive.bounty(created_at,id);
