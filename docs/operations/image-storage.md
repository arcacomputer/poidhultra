# Image storage and delivery

The active Ultra interface resolves bounty covers, proof images, and profile avatars through `/api/media/{bounty|claim|profile}/{id}`. The resolver obtains the image source from the corresponding public record. It never accepts a caller-supplied remote URL. Original record URLs and descriptions remain unchanged.

The web Worker's `REMOTE_MEDIA` binding uses the existing `poidh-ultra-proofs` R2 bucket. Successful reads store the image before returning `/media/remote/sha256/<digest>`. The browser only requests this same-origin image URL. It has a SHA-256 ETag, a one-year immutable cache policy, and a Cloudflare Cache API copy. `X-Poidh-Media-Cache: STORE` means an R2/S3 read; `HIT` means the response came from the local Cloudflare edge cache. Cache eviction only requires another R2 read, never an original-host download.

## Durable layout

| Prefix                 | Contents                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| `sha256/`              | Existing proof uploads and NFT metadata, unchanged                           |
| `remote/v1/images/`    | Image bytes, keyed by SHA-256                                                |
| `remote/v1/metadata/`  | Captured NFT metadata, keyed by SHA-256                                      |
| `remote/v1/manifests/` | Immutable source/provenance/capture records, keyed by SHA-256                |
| `remote/v1/sources/`   | Source URL and resolution-mode lookup, published after the immutable objects |

Identical image content shares one object key. Captures record the source, final source after redirects, image URL, capture time, content type, size, and content hashes. Source mappings refresh on a read after 24 hours. A failed refresh retains the previous stored image and backs off for one minute per active process. Changes produce a new immutable image URL; older copies remain intact.

This is on-demand capture of images the application displays, including cards below the fold as users browse. It does not claim that every historical proof has already been downloaded. No original-host fallback is sent to browsers. Unsupported, unavailable, and oversized files show the existing unavailable-image state, with card proof fallbacks where available.

## Bounds and portability

JPEG, PNG, GIF, WebP, and AVIF image signatures are accepted; SVG/HTML and executable formats are rejected. Images are limited to 20 MiB, metadata to 1 MiB, fetches to 20 seconds per source, and redirects to three. Downloads are limited to two concurrent captures per Worker instance. Remote requests omit credentials and referrers. Host validation rejects literal IPs, local hostnames, credentials, and alternate ports. Node pins a public A record for the actual HTTPS connection; Workers use public-only fetch. Locally uploaded image/metadata URLs read their stored objects directly.

R2 credentials are not exposed to clients. The Node deployment uses the same adapter against S3-compatible storage. `scripts/storage/portable.ts export <directory>` includes both prefixes, verifies hashes and media relationships, and writes manifest version 2. Import accepts versions 1 and 2, validates the complete export before writing, and restores source pointers last. If the source changes during an export and a referenced image is missing, export fails explicitly and should be retried. Do not configure an expiry rule that deletes mirrored images while retaining their source mappings.

Public immutable URLs can remain in browser/edge caches after a record is hidden, like existing proof uploads. A media takedown must remove the relevant objects/mappings and purge the cached URL; hiding a profile alone stops future resolver discovery but does not revoke already-distributed files.

## Cost

No new bucket or paid image-transformation service is provisioned. R2 Standard storage is $0.015/GB-month before allowances: an additional 50 GB is $0.75/month. Class A operations are $4.50/million and Class B operations $0.36/million; R2 egress is free. Account-wide allowances and existing Workers charges affect the actual bill. Source capture normally writes an image, a capture manifest, a source mapping, and (for NFT metadata) a metadata object. Reads served from the edge avoid another R2 object read. [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), checked 2026-09-10.

## Validation

Service tests cover origin outages, fresh instances, concurrent requests, immutable revisions, local uploaded metadata, credential isolation, private-address/redirect rejection, invalid/oversized media, and export relationships. The native Cloudflare runtime test writes actual emulated R2 objects, restarts the Worker, disables its origin, and verifies image bytes plus edge HIT and conditional GET. Desktop/mobile browser tests use the Node S3 adapter and check stored homepage, proof, and avatar images without direct remote image requests.

## Live deployment evidence, 2026-09-10

Worker `a11de4d9-d6a2-42f5-8e63-003427a04f8b` serves `poidh.arca.computer` with `REMOTE_MEDIA` bound to `poidh-ultra-proofs`. Among the first 12 open bounty cards, 9 available images were captured as 7 distinct stored objects. Every checked image returned a matching content hash, repeat edge-cache HIT, and conditional 304. The first cover was also downloaded directly from the remote R2 bucket: 746,264 bytes, SHA-256 `78bbbaecb79ed1cbe81b32014ad029b0d6853fc5138aa5c1b0da5805781dacfd`. Browser verification showed decoded same-origin card images and no horizontal overflow.

The previous Worker version `0b299cf6-4515-474f-96bf-8a246797c441` remains a rollback target. Rolling back the web Worker does not delete captured media. This image deployment does not complete the separately tracked full production data-restore/rollback launch gate.
