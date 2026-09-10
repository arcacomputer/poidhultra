import {
  deployments,
  key,
  resolveLegacyURL,
  type CommunityRecord,
  type Page,
} from "@poidh/protocol";
import { APIError } from "./index";

export type LegacyRequest = <T>(
  path: string,
  method?: string,
  body?: unknown
) => Promise<T>;
export function legacyCommentId(value: string | number) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    throw new APIError(400, "Use a decimal string for large comment IDs");
  const id = String(value);
  if (!id || id.length > 256) throw new APIError(400, "Invalid comment ID");
  return /^(0|[1-9][0-9]*)$/.test(id) ? "original:comment:" + id : id;
}
export function legacyBountyKey(chainId: number, value: string | number) {
  const deployment = deployments.find((d) => d.chainId === chainId);
  if (
    !deployment ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  )
    throw new APIError(
      400,
      "Use a supported chain and an exact decimal bounty ID"
    );
  const resolved = resolveLegacyURL(deployment.slug, String(value));
  return key(chainId, resolved.deployment.address, resolved.onChainId);
}
export async function allRecords(
  request: LegacyRequest,
  params: Record<string, string>
) {
  const records: CommunityRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Page<CommunityRecord> = await request(
      "/records?" +
        new URLSearchParams({
          ...params,
          limit: "100",
          ...(cursor ? { cursor } : {}),
        })
    );
    records.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && (cursors.has(cursor) || records.length >= 10_000))
      throw new APIError(
        503,
        "This legacy response cannot be completed; use the paginated v1 client"
      );
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return records;
}
export function legacyCommunity(request: LegacyRequest) {
  async function profiles(addresses: string[]) {
    const unique = [...new Set(addresses.map((v) => v.toLowerCase()))];
    const found: CommunityRecord[] = [];
    for (let start = 0; start < unique.length; start += 100) {
      const response = await request<{ items: CommunityRecord[] }>(
        "/profiles?" +
          new URLSearchParams({
            addresses: unique.slice(start, start + 100).join(","),
          })
      );
      found.push(...response.items);
    }
    return unique.map((address) => {
      const record = found.find((r) => r.author === address);
      return {
        address,
        displayName: record?.data.name ?? null,
        pfpUrl: record?.data.image ?? null,
        // An owner-chosen profile name must never be presented as verified ENS.
        ens: null,
        degenName: null,
        wei: null,
        gwei: null,
        farcasterTag: null,
        farcasterFid: null,
        twitterTag: null,
        lastUpdated: record ? new Date(record.updatedAt) : null,
      };
    });
  }
  async function actor(expected?: string) {
    const value = await request<{ address: string } | null>("/auth/session");
    if (!value) throw new APIError(401, "Sign in with SIWE before writing");
    if (expected && value.address !== expected.toLowerCase())
      throw new APIError(
        403,
        "The signed-in wallet differs from the requested author"
      );
    return value.address;
  }
  return {
    profiles,
    async comments(input: { chainId: number; bountyId: string | number }) {
      const bountyId = legacyBountyKey(input.chainId, input.bountyId);
      const [comments, reactions] = await Promise.all([
        allRecords(request, { kind: "comment", bountyId }),
        request<{
          counts: Record<string, { upvote: number; downvote: number }>;
        }>("/reactions?" + new URLSearchParams({ bountyId })),
      ]);
      const authors = new Map(
        (await profiles(comments.map((c) => c.author))).map((p) => [
          p.address,
          p,
        ])
      );
      return comments.map((c) => ({
        ...c,
        body: c.data.body,
        userAddress: c.author,
        author: authors.get(c.author),
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        chainId: input.chainId,
        bountyId: String(input.bountyId),
        upvotes: reactions.counts[c.id]?.upvote ?? 0,
        downvotes: reactions.counts[c.id]?.downvote ?? 0,
      }));
    },
    async comment(input: {
      chainId: number;
      bountyId: string | number;
      address: string;
      text: string;
      parrentId?: string | number | null;
    }) {
      await actor(input.address);
      return request<CommunityRecord>("/records", "POST", {
        kind: "comment",
        bountyId: legacyBountyKey(input.chainId, input.bountyId),
        parentId:
          input.parrentId == null ? null : legacyCommentId(input.parrentId),
        data: { body: input.text },
      });
    },
    async rate(input: {
      chainId: number;
      commentId: string | number;
      address: string;
      type: "upvote" | "downvote";
    }) {
      const address = await actor(input.address);
      const id = legacyCommentId(input.commentId);
      const comment = await request<CommunityRecord>(
        "/records/" + encodeURIComponent(id)
      );
      if (
        comment.kind !== "comment" ||
        !comment.bountyId?.startsWith(input.chainId + ":")
      )
        throw new APIError(400, "Comment belongs to another chain");
      const existing = (
        await allRecords(request, {
          kind: "reaction",
          parentId: id,
          author: address,
        })
      )[0];
      return existing
        ? request<CommunityRecord>(
            "/records/" + encodeURIComponent(existing.id),
            "PATCH",
            { version: existing.version, data: { type: input.type } }
          )
        : request<CommunityRecord>("/records", "POST", {
            kind: "reaction",
            bountyId: comment.bountyId,
            parentId: id,
            data: { type: input.type },
          });
    },
    async albums(contains = "") {
      const albums: { album: string; count: { album: number } }[] = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const result: Page<{ name: string; count: number }> = await request(
          "/albums?" +
            new URLSearchParams({
              contains,
              limit: "100",
              ...(cursor ? { cursor } : {}),
            })
        );
        albums.push(
          ...result.items.map((r) => ({
            album: r.name,
            count: { album: r.count },
          }))
        );
        cursor = result.nextCursor;
        if (cursor && (seen.has(cursor) || albums.length >= 10_000))
          throw new APIError(
            503,
            "Use paginated album search for this collection"
          );
        if (cursor) seen.add(cursor);
      } while (cursor);
      return albums;
    },
    async trending(limit = 10) {
      const result = await request<{
        items: { name: string; count: number }[];
      }>(
        "/albums?" +
          new URLSearchParams({ trending: "true", limit: String(limit) })
      );
      return result.items;
    },
    async banComment(input: {
      id: string | number;
      address?: string;
      reason?: string;
    }) {
      await actor(input.address);
      return request(
        "/moderation/" + encodeURIComponent(legacyCommentId(input.id)),
        "POST",
        {
          hidden: true,
          reason:
            input.reason ??
            "Hidden through the original poidh client moderation adapter.",
        }
      );
    },
    async addToAlbum(input: {
      chainId: number;
      bountyId: string | number;
      album: string;
    }) {
      const address = await actor();
      const title = input.album.trim();
      if (!title || title.length > 120)
        throw new APIError(
          400,
          "Supply an album name between 1 and 120 characters"
        );
      const bountyId = legacyBountyKey(input.chainId, input.bountyId);
      const albums = await allRecords(request, {
        kind: "album",
        author: address,
      });
      const matches = albums.filter(
        (r) =>
          String(r.data.title).toLowerCase() === title.toLowerCase() ||
          r.id === input.album
      );
      if (matches.length > 1)
        throw new APIError(
          409,
          "More than one owned album has this name; use its album ID"
        );
      const album = matches[0];
      if (album && (album.data.bounties as string[]).includes(bountyId))
        return {
          bountyId: String(input.bountyId),
          chainId: input.chainId,
          album: album.data.title,
        };
      if (album)
        await request("/records/" + encodeURIComponent(album.id), "PATCH", {
          version: album.version,
          data: {
            ...album.data,
            bounties: [...(album.data.bounties as string[]), bountyId],
          },
        });
      else
        await request("/records", "POST", {
          kind: "album",
          data: { title, description: "", bounties: [bountyId] },
        });
      return {
        bountyId: String(input.bountyId),
        chainId: input.chainId,
        album: album?.data.title ?? title,
      };
    },
  };
}
