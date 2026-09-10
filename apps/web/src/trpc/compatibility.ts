import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import { communityProxy } from '@/utils/communityProxy';
import {
  deployments,
  resolveLegacyURL,
  key,
  type Bounty,
  type CommunityRecord,
} from '@poidh/protocol';
const t = initTRPC
  .context<{ request: Request }>()
  .create({ transformer: superjson });
const p = t.procedure;
const input = z.record(z.any());
async function request(
  ctx: { request: Request },
  path: string,
  method = 'GET',
  data?: unknown
) {
  const headers = new Headers(ctx.request.headers);
  headers.set('content-type', 'application/json');
  if (method !== 'GET' && !headers.has('idempotency-key'))
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Supply Idempotency-Key; sign in with /api/v1/auth before writing.',
    });
  const res = await communityProxy(
    new Request(ctx.request.url, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    '/api/v1' + path
  );
  const result = await res.json();
  if (!res.ok)
    throw new TRPCError({
      code:
        res.status === 401
          ? 'UNAUTHORIZED'
          : res.status === 403
          ? 'FORBIDDEN'
          : res.status === 404
          ? 'NOT_FOUND'
          : res.status === 409
          ? 'CONFLICT'
          : 'BAD_REQUEST',
      message: result.error,
    });
  return result;
}
function identity(chainId: number, id: string | number) {
  const dep = deployments.find((d) => d.chainId === chainId);
  if (!dep) throw new TRPCError({ code: 'BAD_REQUEST' });
  if (typeof id === 'number' && !Number.isSafeInteger(id))
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Use a decimal string for large IDs',
    });
  const r = resolveLegacyURL(dep.slug, String(id));
  return key(chainId, r.deployment.address, r.onChainId);
}
function legacy(b: Bounty) {
  return {
    ...b,
    id: b.displayId,
    onChainId: b.onChainId,
    title: b.title,
    inProgress: b.status === 'open' || b.status === 'voting',
    isCanceled: b.status === 'cancelled',
    isVoting: b.status === 'voting',
    isMultiplayer: b.multiplayer,
    hasClaims: b.claimCount > 0,
    hasParticipants: b.multiplayer,
    extra: { album: '' },
    amountSort: b.amount,
  };
}
export const compatibilityRouter = t.router({
  bounties: t.router({
    fetch: p
      .input(input)
      .query(async ({ input: i, ctx }) =>
        legacy(await request(ctx, '/bounties/' + identity(i.chainId, i.id)))
      ),
    fetchAll: p.input(input).query(async ({ input: i, ctx }) => {
      const result = await request(
        ctx,
        '/bounties?' +
          new URLSearchParams({
            status:
              i.status === 'past'
                ? 'completed'
                : i.status === 'progress'
                ? 'voting'
                : 'open',
            limit: String(i.limit ?? 10),
            ...(typeof i.cursor === 'string' ? { cursor: i.cursor } : {}),
          })
      );
      return { ...result, items: result.items.map(legacy) };
    }),
    fetchTransactions: p
      .input(input)
      .query(({ ctx }) => request(ctx, '/activity')),
    isNewlyCreated: p.input(input).query(async ({ input: i, ctx }) => {
      const d = deployments.find((d) => d.chainId === i.chainId);
      if (!d) return null;
      try {
        return legacy(
          await request(
            ctx,
            '/bounties/' + key(i.chainId, d.address, String(i.id))
          )
        );
      } catch {
        return null;
      }
    }),
    addToAlbum: p.input(input).mutation(async ({ input: i, ctx }) => {
      const album = await request(
        ctx,
        '/records/' + encodeURIComponent(i.album)
      );
      if (album.kind !== 'album')
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Use an album ID',
        });
      return request(ctx, '/records/' + encodeURIComponent(album.id), 'PATCH', {
        version: album.version,
        data: {
          ...album.data,
          bounties: [
            ...new Set([
              ...(album.data.bounties ?? []),
              identity(i.chainId, i.bountyId),
            ]),
          ],
        },
      });
    }),
  }),
  claims: t.router({
    fetch: p.input(input).query(async ({ input: i, ctx }) => {
      const result = await request(
        ctx,
        '/bounties/' + identity(i.chainId, i.bountyId) + '/claims'
      );
      return result.items.map((c: any) => ({
        ...c,
        bountyId: i.bountyId,
        chainId: i.chainId,
        url: c.uri,
        isAccepted: c.accepted,
      }));
    }),
  }),
  comments: t.router({
    fetch: p.input(input).query(async ({ input: i, ctx }) => {
      const bountyId = identity(i.chainId, i.bountyId);
      const [comments, reactions] = await Promise.all([
        request(
          ctx,
          '/records?' +
            new URLSearchParams({ kind: 'comment', bountyId, limit: '100' })
        ),
        request(
          ctx,
          '/records?' +
            new URLSearchParams({ kind: 'reaction', bountyId, limit: '100' })
        ),
      ]);
      return comments.items.map((c: CommunityRecord) => ({
        ...c,
        body: c.data.body,
        userAddress: c.author,
        author: { address: c.author },
        createdAt: new Date(c.createdAt),
        chainId: i.chainId,
        bountyId: i.bountyId,
        upvotes: reactions.items.filter(
          (r: CommunityRecord) =>
            r.parentId === c.id && r.data.type === 'upvote'
        ).length,
        downvotes: reactions.items.filter(
          (r: CommunityRecord) =>
            r.parentId === c.id && r.data.type === 'downvote'
        ).length,
      }));
    }),
    comment: p
      .input(input)
      .mutation(({ input: i, ctx }) =>
        request(ctx, '/records', 'POST', {
          kind: 'comment',
          bountyId: identity(i.chainId, i.bountyId),
          parentId: i.parrentId ? String(i.parrentId) : null,
          data: { body: i.text },
        })
      ),
    rate: p.input(input).mutation(async ({ input: i, ctx }) => {
      const comment = await request(
        ctx,
        '/records/' + encodeURIComponent(i.commentId)
      );
      const actor = await request(ctx, '/auth/session');
      const records = await request(
        ctx,
        '/records?' +
          new URLSearchParams({
            kind: 'reaction',
            parentId: String(i.commentId),
            author: actor?.address ?? '',
          })
      );
      const existing = records.items[0];
      return existing
        ? request(ctx, '/records/' + encodeURIComponent(existing.id), 'PATCH', {
            version: existing.version,
            data: { type: i.type },
          })
        : request(ctx, '/records', 'POST', {
            kind: 'reaction',
            bountyId: comment.bountyId,
            parentId: comment.id,
            data: { type: i.type },
          });
    }),
  }),
  albums: t.router({
    fetch: p
      .input(input)
      .query(({ input: i, ctx }) =>
        request(ctx, '/records/' + encodeURIComponent(i.album))
      ),
    trending: p.query(({ ctx }) => request(ctx, '/records?kind=album')),
  }),
  neynar: t.router({
    usersData: p.input(input).query(async ({ input: i, ctx }) =>
      Promise.all(
        (i.addresses as string[]).map(async (address) => {
          const result = await request(
            ctx,
            '/records?' +
              new URLSearchParams({ kind: 'profile', author: address })
          );
          const data = result.items[0]?.data;
          return {
            address,
            pfpUrl: data?.image ?? null,
            ens: data?.name ?? null,
            farcasterTag: null,
            twitterTag: null,
          };
        })
      )
    ),
  }),
  admin: t.router({
    banComment: p
      .input(input)
      .mutation(({ input: i, ctx }) =>
        request(ctx, '/moderation/' + encodeURIComponent(i.id), 'POST', {
          hidden: true,
          reason:
            i.reason ??
            'Hidden through the original poidh client moderation adapter.',
        })
      ),
  }),
});
