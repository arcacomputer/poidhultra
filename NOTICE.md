# Source attribution and reuse boundaries

Ultra's original code is licensed under the root MIT license. Imported files retain their upstream notices and Git history.

| Import                         | Source                                                                   | Basis                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/web`                     | picsoritdidnthappen/poidh-app, production branch `prod`                  | MIT; upstream source layout and full history retained                                    |
| `contracts/poidh-v3`           | picsoritdidnthappen/poidh-v3                                             | MIT; includes protocol documentation and tests                                           |
| `contracts/wei-names`          | picsoritdidnthappen/wei-names                                            | MIT; dependencies retain their own licenses                                              |
| `contracts/poidh-v2`           | picsoritdidnthappen/poidh-v2-contracts, `packages/evm/contracts` subtree | Solidity files declare SPDX MIT; unlicensed surrounding application code is not imported |
| `packages/protocol/src/abi.ts` | Licensed ABI from poidh-app                                              | MIT; transcribed into the shared protocol package                                        |

The frame and yukigesho/poidh-indexer repositories are monitored across all files. They have no declared reuse permission in the audited revisions. Their implementation is not imported. Ultra's indexer is independently implemented from licensed contracts, event declarations, public deployments, and documented protocol behavior. Monitor-only status does not mean their changes have been incorporated.

Protocol addresses and offsets are pinned facts, not automatic deployment instructions. The deployment verification report must be reviewed before transaction destinations change. Degen is a separate historical archive with source provenance and a capture time.

MIT licensing covers code; names and marks identify the original project and this independent client. Third-party packages, fonts, and contract dependencies retain their respective licenses. See each imported repository and the pnpm lockfile for dependency identity.
