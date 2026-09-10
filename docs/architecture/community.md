# Shared community data

Code synchronization and community data synchronization are separate systems. Both sites use the versioned REST API and independent SIWE sessions through their own same-origin proxy. The web adapter is `apps/web/src/utils/communityProxy.ts`; the typed client is `packages/client`. Kenny can mount that proxy in poidh.xyz and adopt the typed client incrementally. The `apps/web/src/trpc/compatibility.ts` bridge covers bounty reads, claims, comments, reactions, albums, profile lookups, and comment moderation; unsupported original procedures must be translated before cutover.

Proxy secrets are unique per origin. The API validates the proxy and the browser Origin for writes. SIWE challenges include the exact domain and URI, have a five-minute expiry, and are consumed atomically. Session tokens are random, stored as SHA-256 hashes, bound to the origin, and expire after seven days. Contract-wallet login is not enabled in the first EOA implementation. Bounty transactions remain independent of community login.

Author mutations require a session and Idempotency-Key. Reusing a key for a different request fails. Edits and deletions require the current record version. A database transaction serializes community writes, parent validation, change-feed publication, and idempotency responses; readers cannot skip an event because a lower sequence commits late. Notifications are scoped to their recipient. Hidden/deleted community records produce public tombstones, not copies of their removed text.

## Kenny's scoped export

Agree a read-only export window and migration mapping. `scripts/community/import.ts` validates a version-1 bundle with records, parent IDs, canonical bounty keys, authors, original timestamps, moderation, provenance, and legacy URLs. IDs and chain amounts are decimal strings. Every source ID remains in `legacyId` and provenance. Missing owners or ambiguous historical URL mappings must be resolved before import; do not invent authors.

`node --import tsx scripts/community/import.ts export.json` is a validation-only dry run. Add `--apply` with a migration connection after reviewing the report. Imports are atomic and insert-only. Identical repeated bundles are idempotent; a conflicting newer bundle cannot overwrite a subsequent community edit. Store exports privately, not in this repository.

Do not export passwords, private keys, API secrets, session/credential tables, or old notification delivery queues. Bootstrap visible data through public APIs where available, but public reads cannot reconstruct deleted content, moderation, private metadata, or missing history. `scripts/community/reconcile.ts` follows the versioned deletion/update feed after Kenny installs the shared API. It fails explicitly when that endpoint is unavailable.

A fully shared production launch requires Kenny's deployed proxy/client integration, a verified scoped import, reconciled relationships/URLs/moderation, and a two-client acceptance test. Until then, an Ultra preview must be identified as an independent environment and must not claim community synchronization is live.
