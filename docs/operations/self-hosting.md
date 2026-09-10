# Self-hosting

Requirements: Node 22, pnpm 10.33.4, PostgreSQL 17, an S3-compatible object store, and RPC endpoints with access to the configured historical blocks. No Privy, Neynar, Pinata, Google upload function, Upstash, or Vercel account is required by the active application.

Install with `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env` and replace all example secrets. Make the web and API origin/key mappings agree exactly, including protocol and local port. Keep secrets out of `NEXT_PUBLIC_*`; public RPC URLs must not contain private keys. For process-based local development, pass environment files using Node's `--env-file` or your process supervisor.

Run `pnpm db:migrate` with a migration-capable connection. Run `pnpm --filter @poidh/indexer start` against a dedicated `DATABASE_SCHEMA`; it publishes `protocol_api` views only once indexing is ready. The community service needs read permission on those views and write permission on the `community` schema, not write permission on the indexed tables.

Start the API with `node --import tsx apps/community-api/src/node.ts` and the web with `pnpm --filter @poidh/web dev`. Production Node builds use `pnpm --filter @poidh/web build` and `pnpm --filter @poidh/web start`, or the standalone Docker image. Put the web behind a TLS reverse proxy. The API and database should remain private. The frontend uses a same-origin proxy; it is not a permissive cross-origin API gateway.

Docker Compose: `docker compose --env-file .env -f infra/node/compose.yaml up --build`. The storage-init service creates the `poidh-proofs` bucket before the API starts. Docker volumes retain PostgreSQL and object data. Pin image digests during production promotion. Container disk holds no authoritative chain state.

Use the same schema for process restarts. For a changed indexer, start a new schema, wait for `/ready`, verify results, then promote views. Never let two active indexer writers share a schema. Old indexed schemas can be retained for rollback. Do not run SQL migrations as part of a web build.

A portable export includes community records/provenance plus uploaded objects under `sha256/` and mirrored images, metadata, capture manifests, and source mappings under `remote/v1/`. Use `scripts/community/export.ts` for records and `scripts/storage/portable.ts export <directory>` to copy and verify objects. Exported objects keep their hashes. Route the same immutable URLs to restored storage; do not rewrite content at an existing key. Credentials, sessions, and notification delivery state are excluded from community exports.

The web process also needs the same `S3_*` configuration as the API. It persists remote bounty covers, proof images, and profile avatars before returning a same-origin image URL. Docker Compose supplies these settings to both services. The Node media fetcher pins a public IPv4 DNS result per HTTPS connection; private addresses and unsafe redirects are rejected. No Cloudflare account is needed for self-hosting. See [image storage](image-storage.md) for caching and export behavior.
