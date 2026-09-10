# Production cost estimate

Estimate checked 2026-09-10, before provisioning. USD, 730 hours/month. No resources have been purchased by this document.

| Resource                | Assumption                                                     | Monthly estimate                       |
| ----------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Cloudflare Workers Paid | Web, API, supervisor; modest launch traffic                    | $5 base, plus usage                    |
| Indexer Container       | One standard-1: 4 GiB RAM, 8 GB ephemeral disk, up to 0.5 vCPU | ~$29 fixed RAM/disk + $3–26 active CPU |
| Neon Launch compute     | One always-active 0.25–0.5 CU compute                          | $19.35–38.69                           |
| Neon storage/history    | 20 GB data, up to 10 GB retained changes                       | ~$9                                    |
| R2 proofs/cache         | 50 GB after the 10 GB allowance; modest requests               | ~$0.60 + operations                    |
| Durable Objects/logging | Supervisor and cache activity                                  | Reserve $2–10                          |

Plan around **$65–120/month** for initial hosting. Backfill, traffic spikes, longer history, more stored proofs, and larger containers can increase this. This is an engineering estimate, not a fixed bill. Set billing alerts and inspect resource usage during backfill before changing capacity.

RPC endpoints are configurable and are not included in this estimate. Public endpoints can throttle historical reads. An existing node, independently operated open-source nodes, or paid generic RPC capacity can be selected without changing application logic. Do not enable a proprietary identity or social provider to make the core application work.

The indexer keeps Neon active; scale-to-zero savings should not be assumed. Use a direct Neon connection for the long-running indexer, and a restricted connection via Hyperdrive for API requests. Benchmark container placement versus the Neon region before choosing production placement.

Sources: [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Neon pricing](https://neon.com/pricing). Rates may change. No production credentials belong in builds or tests.

## Archive RPC option

Before buying RPC capacity, try existing archive-capable endpoints or a small capped backfill trial. As checked on 2026-09-10, [Alchemy's published pricing](https://www.alchemy.com/pricing) lists full archive data, a 30 million CU monthly free tier, and pay-as-you-go at $0.45 per million CU for the first 300 million. For budgeting, 100 million CU would cost $45 at that paid rate; actual backfill usage must be measured. Configure plain JSON-RPC URLs, without adding an Alchemy SDK or any proprietary application dependency. An account/key and verified Ethereum, Base, and Arbitrum historical reads are still required. No RPC subscription has been provisioned.
