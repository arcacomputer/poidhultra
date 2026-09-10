# Public protocol data in the read-only preview

Kenny supplied [poidh's public API documentation](https://indexer.poidh.xyz/swagger); its machine-readable specification is at `/openapi/doc`. The independently implemented `@poidh/client/upstream` adapter uses that documented interface. It does not import upstream indexer source or replace the independent Ponder implementation.

## What is connected

In preview mode, the web server handles selected same-origin `/api/v1` GET requests through the configured public source:

| Ultra route                 | Public API data                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `/bounties`                 | Complete bounty scan, local status/network/issuer/search filtering, newest-first cursor pagination |
| `/bounties/:key`            | One bounty by chain and historical display ID                                                      |
| `/bounties/:key/claims`     | Paginated proofs for that bounty                                                                   |
| `/claims/:key`              | Proof identified by chain, pinned contract version, and on-chain ID                                |
| `/profiles/:address/proofs` | Proofs created or owned by the address                                                             |
| `/activity`                 | Transaction history in the source's order                                                          |
| `/leaderboard`              | Ranked public leaderboard estimates                                                                |

Ethereum, Base, and Arbitrum use Ultra's pinned deployment registry and existing URL offsets. Bounty IDs are checked against the returned on-chain ID. Claim identity follows its associated bounty's contract version, so overlapping legacy/V3 claim IDs do not collide. Source changes cannot activate a contract deployment.

Every successful adapted response has `X-Poidh-Data-Source: upstream-api` and a `source` object with the origin and fetch timestamp. The UI identifies the public source. These reads never receive site cookies, proxy keys, authorization headers, wallet signatures, or database credentials. Only unauthenticated GETs are sent to the source; redirects are refused.

## Accuracy and availability

- Bounty amounts stay exact decimal wei strings. Unsafe JSON numbers and inconsistent identities fail explicitly. The source's retained `isVoting` or `inProgress` flags cannot override cancellation or completion.
- The source omits proof creation timestamps and bounty proof counts. The adapter returns `null` and the interface does not invent a date or show an unknown count as zero. Existing HTTPS/IPFS proof references are preserved.
- Leaderboard ETH totals arrive as floating-point estimates. Exact `earned`/`paid` fields remain `null`; estimates live in `approximateAmounts` as decimal text and the UI marks them with `≈`. Rankings are approximate too. These values must never be used in transactions or accounting.
- Activity is historical transaction data in source order, not a promise of a newest-first feed. No block number is invented. The source offers no verified block checkpoint, reorg watermark, atomic pagination snapshot, or deletion feed.
- Bounty/leaderboard scans request at most four 100-row pages concurrently, with a 20,000-row cap, a 30-second scan budget checked between batches, 10-second request timeouts, and an 8 MiB response cap. Duplicate pages and contradictory end pages fail instead of returning a known incomplete list. The source can still change between requests; scans are not atomic chain snapshots.
- Complete scans are cached in each server instance for 60 seconds; response results for 10 seconds. Identical concurrent requests coalesce. The cache is bounded to 64 entries and HTTP responses use `no-store`. A cache miss repeats the scan, so upstream availability and Worker subrequest capacity matter as usage grows. An expired leaderboard pagination snapshot returns 409 and requires a refresh. Proof/activity pages follow upstream offset pagination and may move when source records change.
- Upstream failures remain visible as unavailable responses. This API currently supplies no verified Degen archive; Degen requests report that gap rather than an empty historical record.

## Community and launch boundaries

Comments, reactions, albums, profile metadata, moderation, notifications, authentication, and writes still use the community service. The public indexer API does not provide a shared community backend or a migration export. Preview write guards remain enabled, and bounty pages offer a link to the original site. They do not perform contract reads or expose transaction controls.

Kenny's original-client integration, scoped export, verified import, independent historical backfill, and the remaining launch gates are still prerequisites for the fully shared production launch. Connecting public reads does not satisfy those gates.

## Configuration, validation, and rollback

Build with `NEXT_PUBLIC_READ_ONLY_PREVIEW=true` and `NEXT_PUBLIC_UPSTREAM_READS=true`; run with `PREVIEW_MODE=true` and `UPSTREAM_INDEXER_URL=https://indexer.poidh.xyz`. The URL must be an HTTPS origin without credentials, path, or query. Local HTTP loopback origins are accepted only for development tests. The regular Node build and Cloudflare deployment use the same adapter; no API key or additional hosted service is needed.

The preview deployment script builds with those public flags, binds `poidh.arca.computer` to `poidh-ultra-preview`, and supplies the server configuration:

```sh
UPSTREAM_INDEXER_URL=https://indexer.poidh.xyz node scripts/deploy-preview.mjs
```

The existing community proxy configuration is still required for community/auth reads. To remove the public source, redeploy with `UPSTREAM_INDEXER_URL` unset; the script builds without the upstream UI flag and protocol reads return to the community service's independently indexed views. Keep preview write guards on until launch acceptance. For a faulty release, roll back `poidh-ultra-preview` to the recorded previous Worker version. No database migration or imported data needs undoing.

`pnpm check` includes synthetic interface tests for pagination, source identity, large integers, unknown fields, failure recovery, and credential isolation. For desktop/mobile checks of the compiled application:

```sh
NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_READ_ONLY_PREVIEW=true NEXT_PUBLIC_UPSTREAM_READS=true pnpm --filter @poidh/web build
pnpm test:e2e:upstream
```

These tests use an isolated local HTTP fixture, exercise the actual adapter, verify search/proof pagination and leaderboard labels, and assert that writes and bounty RPC requests stay disabled. Fixtures and test credentials are never deployed. Live smoke checks separately verify the documented service without sending credentials.
