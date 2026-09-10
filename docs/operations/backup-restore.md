# Community backup and restore

`scripts/operations/database-backup.ts` captures community and archive schemas with PostgreSQL's native snapshot/dump format. It preserves record versions, moderation, provenance, legacy URLs, idempotency responses, notifications, deletion/update feed positions and sequence state. Sessions and SIWE challenges are excluded; users sign in again after restoration. Indexed history is rebuilt independently.

Use PostgreSQL 17 client tools, or set `PG_TOOLS_DOCKER_IMAGE=postgres:17-bookworm`. Set `DATABASE_URL` through a private environment file or secret manager. The script passes connection credentials through environment variables, not command arguments. Backup files are private and never belong in Git.

```sh
node --import tsx scripts/operations/database-backup.ts backup /private/backup-directory
# Point DATABASE_URL at a fresh restore database.
node --import tsx scripts/operations/database-backup.ts restore /private/backup-directory
```

The backup holds the application's migration and community-write locks before opening a repeatable-read snapshot. Run it in an announced maintenance window: writes wait while the snapshot and inventories are captured. Inventory hashing streams batches instead of retaining the entire database in memory. The restore refuses an existing community/archive schema and verifies the dump digest, every table's row count and content hash, and every sequence position. Reapply restricted database grants after restoring into a fresh deployment; dumps intentionally omit owners and grants.

Export immutable media after the database snapshot with `scripts/storage/portable.ts export <directory>`, then restore into a fresh S3-compatible target with `portable.ts import <directory>`. Keep media garbage collection disabled during capture; newly appended objects are harmless, but a referenced object must not be deleted. Verify SHA-256 keys, bytes and content types before moving the public media route.

The JSON community exporter/importer is for scoped migration and portable record exchange. It now preserves exact record versions, but it does not preserve the existing change-feed sequence or idempotency history. Use the native snapshot for rollback.

## Rehearsal evidence, 2026-09-10

An isolated Neon project used PostgreSQL 17 with the production-shaped 0.25–0.5 CU limits. Synthetic source and restore databases were separate from the production project. The real database round trip verified **12 data tables, 34 rows, all sequence positions**, and dump SHA-256 `6694f9478f54f49d43c79aa221c0b59b75bb38f612a28b7412bc536c94917da6`.

The Node API running against the restored Neon database verified parent/reaction/album relationships, moderation and deletion tombstones, exact record versions, continued writes after the saved feed cursor, idempotent replay, invalidated old sessions and successful new SIWE login. Two local immutable objects (an image and NFT metadata) restored with identical hashes, bytes and MIME types.

**The Cloudflare/R2 API round trip and Worker-version rollback are still pending.** The disposable Worker and R2 buckets were created, but automatic approval review blocked uploading the disposable database/proxy credentials to that Worker without explicit user authorization. The Node/local-storage alternative did not transmit those credentials to Cloudflare and does not count as a successful Cloudflare/R2 rehearsal.

The disposable Neon project, Worker and both empty R2 buckets were removed after the partial rehearsal. The production project and Workers were not changed. Private backup evidence remains outside the repository.

`scripts/operations/rehearse-cloud.ts` is the repeatable driver, and `tests/fixtures/cloud-rehearsal-worker.ts` is a token-protected fixture for disposable resources only. The driver requires private `settings.json` with the dedicated rehearsal origin/project/database/token/proxy-key fields. Commands are `prepare`, `seed`, `backup`, `restore-database`, `restore-objects`, and `verify`; select the restored database/bucket between restore phases. `REHEARSAL_LOCAL_API=true` runs the explicitly labeled Node/local-object variant, with `REHEARSAL_TARGET=restored` for verification. Never point this driver at production.

After a full Cloudflare rehearsal, record the prior and candidate Worker versions, exercise `wrangler rollback` in the disposable Worker, recheck the restored API, remove the disposable resources, and request maintainer acceptance. The production launch gate stays pending until that evidence exists and is reviewed.
