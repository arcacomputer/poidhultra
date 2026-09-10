CREATE SCHEMA IF NOT EXISTS community;
CREATE TABLE IF NOT EXISTS community.challenges (
 nonce text PRIMARY KEY, origin text NOT NULL, message text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS community.sessions (
 token_hash text PRIMARY KEY, origin text NOT NULL, address text NOT NULL CHECK(address ~ '^0x[0-9a-f]{40}$'),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON community.sessions(expires_at);
CREATE TABLE IF NOT EXISTS community.records (
 id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('comment','profile','album','reaction','notification')),
 author text NOT NULL CHECK(author ~ '^0x[0-9a-f]{40}$'), bounty_id text,
 parent_id text REFERENCES community.records(id) DEFERRABLE INITIALLY DEFERRED,
 data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, moderated boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1,
 provenance jsonb, recipient text
);
CREATE INDEX IF NOT EXISTS records_bounty ON community.records(bounty_id,kind,created_at,id);
CREATE INDEX IF NOT EXISTS records_author ON community.records(author,kind);
CREATE INDEX IF NOT EXISTS records_recipient ON community.records(recipient,kind,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS profile_owner ON community.records(author) WHERE kind='profile';
CREATE UNIQUE INDEX IF NOT EXISTS reaction_owner ON community.records(author,parent_id) WHERE kind='reaction';
CREATE TABLE IF NOT EXISTS community.changes (
 sequence bigserial PRIMARY KEY, kind text NOT NULL, record_id text NOT NULL, operation text NOT NULL CHECK(operation IN('upsert','delete')),
 version bigint NOT NULL, data jsonb, recipient text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community.idempotency (
 scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL, status integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,key)
);
CREATE TABLE IF NOT EXISTS community.import_batches (
 id text PRIMARY KEY, source text NOT NULL, sha256 text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(), record_count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS community.legacy_urls (path text PRIMARY KEY,bounty_id text,record_id text REFERENCES community.records(id),provenance jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS community.moderation_log (
 id bigserial PRIMARY KEY,record_id text NOT NULL,moderator text NOT NULL,reason text NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community.uploads (
 digest text PRIMARY KEY,author text NOT NULL,size integer NOT NULL,content_type text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
