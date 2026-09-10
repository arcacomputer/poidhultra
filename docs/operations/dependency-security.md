# Dependency security review

Prepared 2026-09-10 for maintainer review. Workspace overrides apply to Ultra's pnpm graph while preserving the imported contract source and history. This change does not advance an upstream incorporation record.

GitHub reported 13 high-severity findings in the initial workspace lockfile. With the proposed overrides, `pnpm audit --json` reports **zero high and zero critical** findings in that workspace graph. It still reports five moderate and two low findings. Repository-wide Dependabot findings also include separate, unused upstream npm lockfiles; those are outside the workspace audit and remain open.

| Dependency            | Patched version selected |
| --------------------- | ------------------------ |
| @hono/node-server 1.x | 1.19.15                  |
| Axios 1.x             | 1.20.0                   |
| deepmerge-ts          | 8.0.0                    |
| drizzle-orm           | 0.45.2                   |
| glob 10.x             | 10.5.0                   |
| Kysely                | 0.28.17                  |
| mysql2                | 3.23.1                   |
| semver 7.x            | 7.8.5                    |
| sharp 0.35.x          | 0.35.4                   |
| Vite                  | 6.4.3                    |
| ws 8.x                | 8.21.3                   |

The larger dependency upgrades require actual integration testing. Local regression/type checks, OpenNext/Node builds, and real Ponder restart/reorganization/RPC-outage recovery pass with these versions. Required GitHub CI repeats those checks and browser validation. CI rejects future high/critical workspace audit findings. Optional upstream interfaces must be revalidated before enabling them.

Primary advisories include [Drizzle identifier escaping](https://github.com/advisories/GHSA-gpj5-g38j-94v9), [Kysely JSON path escaping](https://github.com/advisories/GHSA-pv5w-4p9q-p3v2), [deepmerge recursive graphs](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), and [Vite path handling](https://github.com/advisories/GHSA-fx2h-pf6j-xcff). The lockfile, integration tests, and audit output determine acceptance; version overrides alone do not prove compatibility or exploitability.

## Remaining findings

- `elliptic`, `uuid`, and `stream-json` are reached through retained Farcaster/Lens/Solana integrations. These integrations are disabled in Ultra's active routes. Elliptic has no published patched version in the current advisory.
- `decode-uri-component` is reached through the unused WalletConnect/Reown connector stack. Ultra uses injected wallets.
- `csv-parse` remains in retained upstream CSV tooling; shared-community imports use the strict JSON importer.
- `@tootallnate/once` is in the inherited Jest/jsdom development dependency chain.
- Repository-wide findings include a critical Handlebars advisory in the imported OpenZeppelin formal-verification tooling's npm lockfile, plus high findings in upstream documentation/demo tooling. Ultra's builds do not install those npm lockfiles; Solidity validation uses Foundry. Keep the alerts visible and review them before using those tools.

These are reachability observations, not dismissed findings or a completed security audit. Upstream maintainers can supply dependency updates, or an on-demand adaptation can replace inactive dependencies. No existing contract destination or deployed contract bytecode is changed by this dependency PR.
