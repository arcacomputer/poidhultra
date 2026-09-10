# Launch and rollback

The shared production launch is not complete until every gate in `infra/launch-gates.json` has evidence and maintainer review. Do not mark a pending gate complete because code exists or a deployment builds.

## Promotion

1. Run CI without production secrets: upstream tests, community/auth/import checks, browser checks, Ponder recovery integration, OpenNext and container builds.
2. Verify the pinned existing contract destinations on each chain using `scripts/verify-deployments.ts`. Its pending results are blockers; never substitute a new deployment automatically.
3. Give the indexer a dedicated schema and direct Neon role. Give the community Worker only its restricted database role and R2 binding. Disable Hyperdrive SQL caching for authentication and community reads. Builds never execute migrations.
4. Backfill all supported contracts. Compare event/claim counts, balances, and URL boundaries against independent chain reads. Confirm indexer `/ready`, restart recovery, and data freshness before promotion. Archive-capable RPC is required by legacy state reads; a public endpoint's latest-state support is insufficient.
5. Kenny runs the scoped `scripts/community/export-original.ts` exporter with a read-only database connection and reviewed album ownership map. Dry-run and then apply `scripts/community/import.ts`. Reconcile authors, relationships, moderation, historical paths, counts, and exclusions. The original schema has no creation timestamps for reactions/albums: preserve that absence explicitly in provenance and review capture-time substitution before accepting the export.
6. Install the shared client/proxy in poidh.xyz and test both origins end to end against the same backend, each with a separate proxy key and SIWE session. Existing stateless signatures are not accepted as a replacement for SIWE. `compatibility.ts` supports the implemented bridge; all original procedures must be audited with Kenny before cutover.
7. Import and independently verify the Degen archive. An imported snapshot initially remains unverified. Keep its source/capture timestamp public and all Degen transactions disabled.
8. Record reviewed evidence in launch gates. Bind `poidh.arca.computer` only after the shared launch gates pass. Retain Worker version IDs, container image digest, database schema, migration revision, and export hashes in a release record.

## Monitoring

Hourly GitHub upstream checks publish `maintenance-state/status.json`. The Cloudflare watchdog reports a missing/stale successful check after three hours, including disabled GitHub schedules. Signed webhook delivery is an optional faster trigger after Kenny enables it. Webhook registration with upstream maintainers remains a coordination task.

Inspect Cloudflare Worker errors, Container `/health` and `/ready`, Ponder indexing errors/checkpoint lag, Neon compute/storage, and R2 operation counts during backfill. A healthy process alone does not prove the indexer has caught up. Keep the Container enabled only with working RPC credentials. Set account billing alerts before increasing the initial compute limits; the cost estimate excludes RPC charges.

## Rollback rehearsal

In a disposable environment, export community data and immutable objects, restore them to a fresh PostgreSQL database and S3 bucket, and compare hashes/counts. Run the API/browser smoke checks. Repointing the same media URL to verified restored objects preserves metadata references.

For a web/API regression, select the previous Cloudflare Worker version (`wrangler rollback <version-id>`). Keep migrations additive and compatible with that previous version. Do not roll back the database by deleting community edits. Reconcile data introduced after the restore point before switching a restored database into service.

For an indexer change, retain the old schema, backfill a new schema without switching live views, and compare results. Stop the old writer before promoting stable views with Ponder. Roll back by stopping the replacement writer and restarting the previous version/schema. PostgreSQL holds indexing checkpoints and reorg state; ephemeral container disk is disposable. Never run two writers against the same schema.

The local `tests/indexer-recovery.mjs` rehearses real restart, duplicate replay, reorg, and RPC outage recovery. It does not substitute for a production data restore rehearsal or Kenny's migration acceptance.
