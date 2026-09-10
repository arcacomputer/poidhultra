# Implementation and deployment status

Updated 2026-09-10. This is a working implementation and read-only preview; it is not acceptance of the fully shared production launch.

## Available now

- Public MIT monorepo with full licensed subtree histories: https://github.com/arcacomputer/poidhultra.
- Read-only preview: https://poidh.arca.computer (also available on the existing workers.dev hostname). Real Ethereum, Base, and Arbitrum bounty/proof reads, profiles' proof collections, transaction history, and leaderboard estimates use [poidh's public API](https://indexer.poidh.xyz/swagger) through a replaceable adapter. Wallet transactions, SIWE writes, and community writes remain disabled. There are no deployed sample records; independent indexing and shared community integration remain pending.
- Bounty covers, proof images, and profile avatars use [persistent R2 image storage](image-storage.md) and same-origin Cloudflare edge caching. Original source references remain intact.
- Private Cloudflare community Worker with restricted Neon PostgreSQL access through Hyperdrive, SQL caching disabled, and R2 proof storage.
- Hourly/daily GitHub maintenance, App-authenticated publication, and a deployed Cloudflare watchdog. Two real manual runs succeeded and reused issues #1 and #2. The four licensed imports are current; frame and indexer source reuse remains blocked on licensing. The independent Ponder implementation does not incorporate unlicensed indexer source.
- A built and registered Cloudflare Container image. Indexing is deliberately disabled until archive RPC is configured and deployment verification passes.
- Node/PostgreSQL/S3 self-hosting, immutable storage exports, scoped community export/import tools, migration validation, and Degen archive import tooling.

## Validation evidence

[Initial full GitHub CI](https://github.com/arcacomputer/poidhultra/actions/runs/34481229659) passed all four jobs at commit `ce1f490957694aaa9cb0c9b6e84db8ffde57d56d`: regression/compatibility, Cloudflare/Node builds and browser tests, upstream contract tests, and real Ponder recovery.

Local checks passed:

- Seven maintenance/policy tests, including real subtree merge/conflict handling and repeat-check behavior.
- Six API/auth/import/protocol/watchdog suites; the subsequent media URL fix adds one adversarial regression test.
- 216 upstream Solidity tests (113 V3, excluding the RPC-dependent fork suite, and 103 wei-names tests).
- Six desktop/mobile Playwright tests plus live preview checks at 1440px and 390px: no horizontal overflow or JavaScript errors, read-only controls enforced, maintenance page loads.
- Real Ponder/Anvil/PostgreSQL integration: process restart, duplicate replay, reorganization replacement, and recovery after simulated RPC failure.
- Both Cloudflare and conventional Node web builds. A disposable Docker Compose stack served the Node frontend and shared API. SIWE, owned profile creation, proof upload, and MinIO export/restore passed, including identical restored bytes and MIME type.

GitHub CodeQL flagged a slow Markdown video-URL matcher; it was replaced with bounded extension classification and an adversarial regression test. Findings in imported wei-names standalone demo code and OpenZeppelin formal-verification tooling remain visible in GitHub for review. Those paths are not deployed by the active application. Do not equate a green build with a security audit.

The public API integration in [PR #5](https://github.com/arcacomputer/poidhultra/pull/5) passed 7 maintenance tests, 23 service tests (including 10 adapter cases), all 9 package typechecks, Node/OpenNext builds, and 6 additional desktop/mobile browser tests. A compiled native Cloudflare runtime test verifies fetch binding, redirect rejection, cross-request caching, and credential isolation. The live custom domain returned 200 for discovery, the Base display-ID 986 bounty and its proof, leaderboard, activity, session reads, and album reads; auth and community writes returned the expected 503. The public API is not evidence of independently verified indexing or community migration.

The homepage image update adds bounty covers and submitted proof thumbnails, lazy loading, shared metadata caching, and image failure fallbacks. Local checks passed 7 maintenance tests, 26 service tests, all 9 package typechecks, Node/OpenNext builds, and 8 desktop/mobile browser checks. The image tests use 2400-pixel fixtures and verify decoding, fixed aspect ratios, fallback behavior, navigation, and page width. Live browser verification confirmed both description images and submitted proof images in the three-column grid, with no horizontal overflow. Malformed URI text stays preserved without blocking other proof records; display URLs are validated separately.

The R2 image update in [PR #7](https://github.com/arcacomputer/poidhultra/pull/7) passed 7 maintenance tests, 30 service tests, all 9 package typechecks, Node/OpenNext builds, a native R2 persistence/cache test, and 10 desktop/mobile browser checks. Live validation of the first 12 open bounties found 9 available card images (7 distinct content hashes). All 9 returned same-origin stored image bytes matching their hashes, a repeated Cloudflare cache HIT, and a 304 conditional response. The remaining three cards have no available image among their first three proofs. A direct read from the remote R2 bucket independently verified the cover object's bytes. Public protocol reads still returned 200; auth/community writes remained blocked with 503.

## Deployment record

| Service                  | Revision / resource                                                          |
| ------------------------ | ---------------------------------------------------------------------------- |
| Preview Worker           | `a11de4d9-d6a2-42f5-8e63-003427a04f8b`                                       |
| Preview code             | `69985879ce6c724ccf0fe5519252fa50b7ea1de5`, persistent R2 image cache        |
| Previous preview         | `0b299cf6-4515-474f-96bf-8a246797c441` (homepage images from original hosts) |
| Preview read source      | `https://indexer.poidh.xyz`, preview write guards enabled                    |
| Pre-integration rollback | `c0b0bec3-6ed4-45f4-8c8a-c59ebd0dde01` (without public protocol reads)       |
| Community Worker         | `8a5886ee-aff9-4cc8-a543-1808b84f2549`                                       |
| Supervisor Worker        | `054fbc8f-7e03-43a9-b79e-aa0728a65f6f`                                       |
| Container image          | `sha256:394b64e1e318e813694f89cea3f2e143fb5faa0a0bfafca11552e84ab9a2b1d8`    |
| Neon project             | `damp-mouse-07534280`, PostgreSQL 17, AWS us-east-1, compute 0.25–0.5 CU     |
| Database migrations      | `001-community.sql`, `002-archive-and-moderation.sql`                        |
| R2                       | `poidh-ultra-proofs`, `poidh-ultra-next-cache`                               |

Credentials are stored outside the repository. The GitHub App is installed only on `arcacomputer/poidhultra`. No new bounty contracts were deployed. The custom domain hosts the user-authorized read-only preview; promotion to a fully shared, writable production service is pending. This integration changes only the web Worker, with no database migration or new cloud resources.

## Additional engineering completed for review

The launch-validation branch adds a Durable Object alarm fallback and stale-monitor detection; the compiled watchdog runs successfully in a local Cloudflare runtime with mocked network responses. Original community adapters now follow full comment/album pagination, count all reactions, preserve imported comment IDs, and enforce the signed-in author. A portable server proxy and optional HTTP gateway prepare original-site integration outside Cloudflare. The claim lookup now reads one canonical claim; the complete protocol-router audit is still pending.

A real isolated Neon backup/restore verified 12 tables, 34 rows, sequence state and record versions. The restored Node API passed continued edits, change-feed cursor, idempotency, new SIWE login, and two byte-identical local media objects. This does not satisfy the pending Cloudflare/R2 and Worker-version rollback portion. See [backup and restore evidence](backup-restore.md). These changes require review. The web adapters are included in the read-only preview; the corresponding community API and supervisor updates have not been promoted.

## Remaining launch prerequisites

1. Supply archive-capable Ethereum/Base/Arbitrum RPC URLs, finish pinned-contract verification, and backfill/reconcile the independent indexer. Public endpoints failed historical reads on Ethereum and Arbitrum. A generic RPC trial option and cost are recorded in the cost estimate; no RPC subscription was purchased.
2. Complete Kenny's original-client integration and audit every original procedure before cutover. The tRPC compatibility bridge is partial; it must not be represented as a drop-in replacement for every original interface.
3. Kenny supplies the scoped community export and verified album ownership mapping. Import, reconcile both clients, and preserve missing historical timestamps explicitly. No original user data has been imported and no synchronization with poidh.xyz is claimed.
4. Obtain and independently verify the timestamped Degen archive and legacy URL mappings.
5. Complete a production-shaped data restore/rollback rehearsal and maintainer acceptance of the recorded launch evidence. Local recovery tests do not satisfy that gate.

The production deploy command checks `infra/launch-gates.json` and refuses promotion while these prerequisites are pending. See the launch runbook for the exact sequence.
