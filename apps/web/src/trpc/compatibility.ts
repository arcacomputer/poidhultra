import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';
import { communityProxy } from '@/utils/communityProxy';
import { APIError } from '@poidh/client';
import { legacyCommunity } from '@poidh/client/legacy-community';
import {
  deployments,
  resolveLegacyURL,
  key,
  type Bounty,
  bountyKey,
} from '@poidh/protocol';
const t = initTRPC
  .context<{ request: Request }>()
  .create({ transformer: superjson });
const p = t.procedure.use(async ({ next }) => {
  const result = await next();
  const error = !result.ok ? result.error.cause : undefined;
  if (error instanceof APIError)
    throw new TRPCError({
      code:
        error.status === 401
          ? 'UNAUTHORIZED'
          : error.status === 403
          ? 'FORBIDDEN'
          : error.status === 409
          ? 'CONFLICT'
          : error.status === 503
          ? 'SERVICE_UNAVAILABLE'
          : 'BAD_REQUEST',
      message: error.message,
    });
  return result;
});
function community(ctx: { request: Request }) {
  return legacyCommunity((path, method, data) =>
    request(ctx, path, method, data)
  );
}
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
        res.status === 503
          ? 'SERVICE_UNAVAILABLE'
          : res.status === 429
          ? 'TOO_MANY_REQUESTS'
          : res.status === 401
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
      } catch (error) {
        if (error instanceof TRPCError && error.code === 'NOT_FOUND')
          return null;
        throw error;
      }
    }),
    addToAlbum: p
      .input(input)
      .mutation(({ input: i, ctx }) => community(ctx).addToAlbum(i as any)),
  }),
  claims: t.router({
    fetch: p.input(input).query(async ({ input: i, ctx }) => {
      if (typeof i.claimId === 'number' && !Number.isSafeInteger(i.claimId))
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Use a decimal string for large claim IDs',
        });
      const id =
        typeof i.claimId === 'string' && i.claimId.includes(':')
          ? bountyKey.parse(i.claimId)
          : i.contract || i.chainId === 1
          ? key(
              i.chainId,
              i.contract ?? deployments[0].address,
              String(i.claimId)
            )
          : (() => {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message:
                  'Pass the canonical claim ID from fetchBountyClaims, or provide its contract. Numeric IDs can overlap between contract versions.',
              });
            })();
      if (Number(id.split(':')[0]) !== i.chainId)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Claim belongs to another chain',
        });
      return request(ctx, '/claims/' + encodeURIComponent(id));
    }),
    fetchBountyClaims: p.input(input).query(async ({ input: i, ctx }) => {
      const result = await request(
        ctx,
        '/bounties/' +
          identity(i.chainId, i.bountyId) +
          '/claims?' +
          new URLSearchParams({
            limit: String(i.limit ?? 10),
            ...(i.cursor ? { cursor: String(i.cursor) } : {}),
          })
      );
      return {
        nextCursor: result.nextCursor,
        items: result.items.map((c: any) => ({
          ...c,
          bountyId: i.bountyId,
          chainId: i.chainId,
          url: c.uri,
          isAccepted: c.accepted,
        })),
      };
    }),
  }),
  comments: t.router({
    fetch: p
      .input(input)
      .query(({ input: i, ctx }) => community(ctx).comments(i as any)),
    comment: p
      .input(input)
      .mutation(({ input: i, ctx }) => community(ctx).comment(i as any)),
    rate: p
      .input(input)
      .mutation(({ input: i, ctx }) => community(ctx).rate(i as any)),
  }),
  albums: t.router({
    fetch: p
      .input(z.object({ contains: z.string().max(120) }))
      .query(({ input: i, ctx }) => community(ctx).albums(i.contains)),
    trending: p
      .input(
        z
          .object({ limit: z.number().int().min(1).max(100).optional() })
          .optional()
      )
      .query(({ input: i, ctx }) => community(ctx).trending(i?.limit)),
  }),
  neynar: t.router({
    usersData: p
      .input(z.object({ addresses: z.array(z.string()).max(100) }))
      .query(({ input: i, ctx }) => community(ctx).profiles(i.addresses)),
  }),
  admin: t.router({
    banComment: p
      .input(input)
      .mutation(({ input: i, ctx }) => community(ctx).banComment(i as any)),
  }),
});
