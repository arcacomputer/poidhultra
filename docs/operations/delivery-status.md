# Implementation and deployment status

Updated 2026-09-10. This is a working implementation and read-only preview; it is not acceptance of the fully shared production launch.

## Available now

- Public MIT monorepo with full licensed subtree histories: https://github.com/arcacomputer/poidhultra.
- Read-only preview: https://poidh-ultra-preview.lf-e32.workers.dev. Wallet transactions, SIWE writes, and community writes are disabled in this deployment. The database contains no sample records; indexed reads remain unavailable until backfill.
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

## Deployment record

| Service             | Revision / resource                                                       |
| ------------------- | ------------------------------------------------------------------------- |
| Preview Worker      | `c0b0bec3-6ed4-45f4-8c8a-c59ebd0dde01`                                    |
| Community Worker    | `8a5886ee-aff9-4cc8-a543-1808b84f2549`                                    |
| Supervisor Worker   | `054fbc8f-7e03-43a9-b79e-aa0728a65f6f`                                    |
| Container image     | `sha256:394b64e1e318e813694f89cea3f2e143fb5faa0a0bfafca11552e84ab9a2b1d8` |
| Neon project        | `damp-mouse-07534280`, PostgreSQL 17, AWS us-east-1, compute 0.25–0.5 CU  |
| Database migrations | `001-community.sql`, `002-archive-and-moderation.sql`                     |
| R2                  | `poidh-ultra-proofs`, `poidh-ultra-next-cache`                            |

Credentials are stored outside the repository. The GitHub App is installed only on `arcacomputer/poidhultra`. No new bounty contracts were deployed. The production domain has not been promoted.

## Remaining launch prerequisites

1. Supply archive-capable Ethereum/Base/Arbitrum RPC URLs, finish pinned-contract verification, and backfill/reconcile the independent indexer. Public endpoints failed historical reads on Ethereum and Arbitrum. A generic RPC trial option and cost are recorded in the cost estimate; no RPC subscription was purchased.
2. Complete Kenny's original-client integration and audit every original procedure before cutover. The tRPC compatibility bridge is partial; it must not be represented as a drop-in replacement for every original interface.
3. Kenny supplies the scoped community export and verified album ownership mapping. Import, reconcile both clients, and preserve missing historical timestamps explicitly. No original user data has been imported and no synchronization with poidh.xyz is claimed.
4. Obtain and independently verify the timestamped Degen archive and legacy URL mappings.
5. Complete a production-shaped data restore/rollback rehearsal and maintainer acceptance of the recorded launch evidence. Local recovery tests do not satisfy that gate.

The production deploy command checks `infra/launch-gates.json` and refuses promotion while these prerequisites are pending. See the launch runbook for the exact sequence.
