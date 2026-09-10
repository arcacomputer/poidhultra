# Continuous upstream maintenance

`upstream/registry.json` pins repository identities and integration branches. Numeric IDs survive renames. All files and complete Git commit ranges are compared. Repositories without reuse permission remain monitored and explicitly blocked for source import. New repositories published by the `picsoritdidnthappen` user receive one tracking issue per repository identity.

`upstream/incorporated/*.json` is read only from the default branch. A candidate PR can propose a new incorporated revision; it does not become effective before merge. `maintenance-state/status.json` is a separate reporting branch, published after checks. Failed checks preserve the prior successful heartbeat. `/maintenance` displays the last success and pending/blocked sources. A Cloudflare watchdog raises one incident after three hours without success, and closes it on recovery.

The hourly schedule runs at minute 17. Daily discovery runs at 05:43 UTC. GitHub schedules can be delayed or disabled, so the watchdog is independent. Manual dispatch also discovers repositories. Signed webhooks can be installed by Kenny later; HMAC signatures, repository IDs, and delivery IDs are checked before dispatch.

## Publisher setup

Create a GitHub App from `infra/github-app-manifest.json`, owned by Arca Computer, and install it only on `arcacomputer/poidhultra`. Store the App ID as `UPSTREAM_APP_ID` and private key as `UPSTREAM_APP_PRIVATE_KEY`. The watchdog uses the same scoped installation via encrypted Worker secrets. Never put the private key in source, workflow logs, or test jobs.

Require pull requests, at least one maintainer approval, CODEOWNER review, dismissed stale approvals, resolved conversations, and the three CI jobs on `main`. No bot bypass or automatic merge. The App token allows published PRs to trigger ordinary CI; imported code executes only in uncredentialed CI jobs. The preparation job fetches source and runs trusted Git operations, not install/build/test scripts from candidate branches.

## Candidate behavior

One branch `codex/upstream/<source>` is active per source. Straightforward changes use Git subtree merges. Conflicts produce a draft PR with a pending task and no incorporation advancement. A new observed revision does not overwrite an active maintainer branch. Once it is reviewed and merged, the next check prepares the remaining range. Enable branch deletion after merge, or delete the completed integration branch manually; an orphaned branch is a visible failure, never silently force-pushed.

For an adaptation, an on-demand coding agent or maintainer resolves the candidate, implements the behavior in adapters, records `integrated`, `adapted`, `intentionally-different`, or `pending` with reasons, and runs CI. Review must cover every commit in `upstream/tasks/<source>.json`. Never mark a partial range incorporated. Rewritten history reports both added and removed commits and requires explicit reconciliation. Do not reset the baseline automatically.

Contract source updates do not change `packages/protocol/src/index.ts` automatically. Deployment destinations require chain ID, bytecode, linked NFT contract and immutable-parameter verification. This is independent of importing the Solidity code.

## Local checks

Run `pnpm upstream:check` for a read-only report (public Git fetches update the local object database). Run `pnpm test` to test range detection, pagination/retries, rewritten history, and duplicate-selection rules. Publication requires an App installation token. Keep discovery success and incorporation separate when diagnosing pending work.

Sources: [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).
