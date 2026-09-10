# poidh Ultra

An MIT-licensed monorepo for a modern poidh client, independently implemented indexing, shared community services, and maintainer-reviewed upstream maintenance.

Production target: **https://poidh.arca.computer**. The shared production launch is gated on original-client integration, a verified community migration, historical backfill, and the deployment checks in [the launch runbook](docs/operations/launch.md).

[Read-only Cloudflare preview](https://poidh-ultra-preview.lf-e32.workers.dev). It disables wallet transactions and community writes while launch prerequisites are pending. Unavailable indexed data is reported explicitly; this preview has no sample records in its database.

## Repository

| Path                 | Purpose                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web`           | Upstream Next.js source layout, upgraded to Next.js 16; Ultra interface and same-origin API adapters |
| `apps/community-api` | Versioned Hono API, Cloudflare Worker and conventional Node entrypoints                              |
| `apps/indexer`       | Independently implemented Ponder indexing; PostgreSQL is durable state                               |
| `apps/supervisor`    | Cloudflare Container supervision, signed webhook receiver, missed-check watchdog                     |
| `packages`           | Protocol identities/ABIs, authentication, typed client, database, and storage adapters               |
| `contracts`          | Licensed subtree imports; existing deployments remain the transaction destinations                   |
| `upstream`           | Source registry, incorporated revisions, reviewed differences, and integration accounting            |
| `infra`              | Cloudflare and self-hosted Node/PostgreSQL/S3 deployment configuration                               |

## Local development

Use Node 22 and pnpm 10.33.4:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Configure database, object storage, RPC endpoints, and matching origin/proxy keys.
node --env-file=.env --import tsx packages/database/src/migrate.ts
node --env-file=.env --import tsx apps/community-api/src/node.ts
# In a separate terminal:
pnpm --filter @poidh/web dev
```

The app contains no production fixtures. A fresh database has no community records. Indexing requires archive-capable RPC endpoints for historical contract reads. See [self-hosting](docs/operations/self-hosting.md) for Docker Compose, persistent volumes, runtime configuration, and portable exports.

```sh
pnpm check
pnpm --filter @poidh/web build
pnpm --filter @poidh/web build:cloudflare
pnpm test:e2e
# With Anvil, compiled V3 contracts, and a disposable PostgreSQL database:
INDEXER_TEST_DATABASE_URL=postgresql://... pnpm test:indexer
```

Blockchain identifiers, monetary amounts, and database versions cross the API as decimal strings. New proof files and metadata use immutable SHA-256 keys. Existing IPFS and HTTPS references retain their original values.

## Upstream maintenance

GitHub Actions checks every configured production branch hourly at minute 17, observes staging branches/PRs/releases, and discovers new repositories daily. Licensed changes enter one update PR per source. Conflicts and undeclared licensing remain visible. Opening a PR does not advance the incorporated revision on `main`. A repository-scoped GitHub App publishes PRs; no permanent AI agent or AI provider is required. A maintainer reviews every update before merging.

See [maintenance operations](docs/operations/upstream.md), [community integration](docs/architecture/community.md), [cost estimate](docs/operations/cost-estimate.md), and [source attribution](NOTICE.md).

Core workflows use injected wallets, SIWE, configurable RPC, PostgreSQL, and portable object storage. Optional social and naming integrations can be disabled. Legacy frontend source is retained to make upstream merges tractable; active routes use the shared API.
