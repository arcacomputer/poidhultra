'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import {
  Camera,
  Plus,
  ArrowUpRight,
  Bell,
  Check,
  Folder,
  ArrowLeft,
} from 'lucide-react';
import {
  deployments,
  amountLabel,
  type CommunityRecord,
  type Page,
  type Claim,
  type LeaderboardEntry,
} from '@poidh/protocol';
import { upstreamPreview } from '@/utils/preview';
import { cachedImage } from '@/utils/proofImage';
import { api, useSession } from './providers';
import { Empty, ErrorNotice, short } from './shell';
import { Discovery, BountyCard } from './discovery';
import { WithdrawBalance } from './transactions';
export function Profile({ address }: { address: string }) {
  const account = useAccount();
  const auth = useSession();
  const cache = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const profile = useQuery({
    queryKey: ['profile', address],
    queryFn: () => api.records({ kind: 'profile', author: address }),
  });
  const record = profile.data?.items[0];
  const avatar = useQuery({
    queryKey: ['cached-avatar', address, record?.version],
    queryFn: ({ signal }) => cachedImage('profile', address, signal),
    enabled: !!record?.data.image,
    staleTime: 300_000,
    retry: 1,
  });
  const mine = account.address?.toLowerCase() === address.toLowerCase();
  return (
    <div className='content-page wide'>
      <Link href='/' className='breadcrumb'>
        <ArrowLeft size={14} />
        Back to bounties
      </Link>
      <div className='profile-heading'>
        <div className='profile-avatar'>
          {avatar.data ? (
            <img src={avatar.data} alt='Profile' referrerPolicy='no-referrer' />
          ) : (
            <Camera size={30} />
          )}
        </div>
        <div>
          <span className='eyebrow'>THE PEOPLE MAKING THINGS HAPPEN</span>
          <h1>{String(record?.data.name || short(address))}</h1>
          <small>{address}</small>
          <p>
            {String(record?.data.bio ?? 'A little curiosity goes a long way.')}
          </p>
          {!!record?.data.website && (
            <a
              className='text-link'
              href={String(record.data.website)}
              target='_blank'
              rel='noreferrer'
            >
              Website <ArrowUpRight size={13} />
            </a>
          )}
        </div>
        {mine && (
          <button
            className='button button-small'
            onClick={() => setEdit(!edit)}
          >
            Edit profile
          </button>
        )}
      </div>
      {profile.isError && <ErrorNotice error={profile.error} />}{' '}
      {edit && (
        <form
          className='form-panel stack'
          onSubmit={async (e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            setBusy(true);
            setError(null);
            try {
              await auth.signIn();
              const data = {
                name: values.get('name'),
                bio: values.get('bio'),
                image: values.get('image') || null,
                website: values.get('website') || null,
              };
              if (record)
                await api.write(
                  '/records/' + encodeURIComponent(record.id),
                  'PATCH',
                  { version: record.version, data }
                );
              else
                await api.write('/records', 'POST', { kind: 'profile', data });
              await cache.invalidateQueries({ queryKey: ['profile', address] });
              setEdit(false);
            } catch (e) {
              setError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className='field'>
            Display name
            <input
              name='name'
              defaultValue={String(record?.data.name ?? '')}
              maxLength={80}
            />
          </label>
          <label className='field'>
            Bio
            <textarea
              name='bio'
              defaultValue={String(record?.data.bio ?? '')}
              maxLength={1000}
            />
          </label>
          <label className='field'>
            Profile image URL
            <input
              name='image'
              type='url'
              placeholder='https://…'
              defaultValue={String(record?.data.image ?? '')}
            />
          </label>
          <label className='field'>
            Website
            <input
              name='website'
              type='url'
              placeholder='https://…'
              defaultValue={String(record?.data.website ?? '')}
            />
          </label>
          {error && <ErrorNotice error={error} />}
          <button className='button button-blue' disabled={busy}>
            Save profile
          </button>
        </form>
      )}
      {mine &&
        deployments
          .filter((d) => !d.archive)
          .map((d) => <WithdrawBalance key={d.chainId} deployment={d} />)}
      <ProfileProofs address={address.toLowerCase()} />
      <Discovery hero={false} issuer={address.toLowerCase()} />
    </div>
  );
}
export function Albums() {
  const [show, setShow] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = useSession();
  const cache = useQueryClient();
  const albums = useInfiniteQuery({
    queryKey: ['albums'],
    queryFn: ({ pageParam }) =>
      api.records({ kind: 'album', cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  return (
    <div className='content-page wide'>
      <div className='section-heading'>
        <div>
          <span className='eyebrow'>COLLECT A LITTLE INSPIRATION</span>
          <h1>Good ideas belong together.</h1>
        </div>
        <button className='button button-blue' onClick={() => setShow(!show)}>
          <Plus size={16} />
          Create album
        </button>
      </div>
      <p className='muted'>
        Collections of bounties, curated by the community.
      </p>
      {show && (
        <form
          className='form-panel stack'
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const values = new FormData(e.currentTarget);
            try {
              await auth.signIn();
              await api.write('/records', 'POST', {
                kind: 'album',
                data: {
                  title: values.get('title'),
                  description: values.get('description'),
                  bounties: [],
                },
              });
              await cache.invalidateQueries({ queryKey: ['albums'] });
              setShow(false);
            } catch (e) {
              setError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className='field'>
            Album title
            <input required name='title' maxLength={120} />
          </label>
          <label className='field'>
            Description
            <textarea name='description' maxLength={2000} />
          </label>
          {error && <ErrorNotice error={error} />}
          <button disabled={busy} className='button button-blue'>
            Save album
          </button>
        </form>
      )}
      {albums.isError ? (
        <ErrorNotice error={albums.error} retry={() => albums.refetch()} />
      ) : (
        <div className='bounty-grid'>
          {albums.data?.pages
            .flatMap((p) => p.items)
            .map((a) => (
              <Link
                className='bounty-card'
                href={'/a/' + encodeURIComponent(a.id)}
                key={a.id}
              >
                <Folder size={28} />
                <h2>{String(a.data.title)}</h2>
                <p className='muted'>{String(a.data.description)}</p>
                <span className='creator'>Curated by {short(a.author)}</span>
              </Link>
            ))}
        </div>
      )}
      {!albums.isPending &&
        !albums.isError &&
        !albums.data?.pages[0].items.length && (
          <Empty title='Make room for a good idea.'>
            Create the first album in this community.
          </Empty>
        )}
      {albums.hasNextPage && (
        <button className='button' onClick={() => albums.fetchNextPage()}>
          More albums
        </button>
      )}
    </div>
  );
}
export function Album({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['album', id],
    queryFn: () =>
      api.request<CommunityRecord>('/records/' + encodeURIComponent(id)),
  });
  const { address } = useAccount();
  const auth = useSession();
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const record = query.data;
  const mine = record?.author === address?.toLowerCase();
  const bounties = useQuery({
    queryKey: ['album-bounties', id, record?.version],
    queryFn: () =>
      Promise.all(
        ((record?.data.bounties as string[]) ?? []).map(async (id) => {
          try {
            return await api.bounty(id);
          } catch {
            return { id, unavailable: true } as const;
          }
        })
      ),
    enabled: !!record,
  });
  async function save(data: Record<string, unknown>) {
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      await auth.signIn();
      await api.write('/records/' + encodeURIComponent(record.id), 'PATCH', {
        version: record.version,
        data,
      });
      await query.refetch();
      setEdit(false);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  if (query.isError)
    return (
      <div className='content-page'>
        <ErrorNotice error={query.error} />
      </div>
    );
  return (
    <div className='content-page wide'>
      <Link href='/albums' className='breadcrumb'>
        <ArrowLeft size={14} />
        All albums
      </Link>
      <h1>{String(record?.data.title ?? 'Loading album…')}</h1>
      <p className='muted'>{String(record?.data.description ?? '')}</p>
      {error && <ErrorNotice error={error} />}
      {mine && record && (
        <>
          <div className='section-actions'>
            <button className='button' onClick={() => setEdit(!edit)}>
              Edit album
            </button>
            <button
              className='button button-danger'
              onClick={() => setDeleting(!deleting)}
            >
              Delete album
            </button>
          </div>
          {deleting && (
            <div className='notice'>
              <p>Delete this album? Its bounties will still be available.</p>
              <button
                className='button button-danger'
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await auth.signIn();
                    await api.write(
                      '/records/' + encodeURIComponent(id),
                      'DELETE',
                      { version: record.version }
                    );
                    router.push('/albums');
                  } catch (e) {
                    setError(e as Error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm deletion
              </button>
            </div>
          )}
          {edit && (
            <form
              className='form-panel stack'
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save({
                  ...record.data,
                  title: String(f.get('title')),
                  description: String(f.get('description')),
                });
              }}
            >
              <label className='field'>
                Album title
                <input
                  name='title'
                  required
                  maxLength={120}
                  defaultValue={String(record.data.title)}
                />
              </label>
              <label className='field'>
                Description
                <textarea
                  name='description'
                  maxLength={2000}
                  defaultValue={String(record.data.description)}
                />
              </label>
              <button className='button' disabled={busy}>
                Save changes
              </button>
            </form>
          )}
          <form
            className='form-panel stack'
            onSubmit={async (e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              setError(null);
              try {
                const link = String(values.get('url'));
                const path = link.startsWith('/')
                  ? link
                  : new URL(link).pathname;
                const mapped = await api.request<{ bountyId: string }>(
                  '/legacy?' + new URLSearchParams({ path })
                );
                await api.bounty(mapped.bountyId);
                await save({
                  ...record.data,
                  bounties: [
                    ...new Set([
                      ...(record.data.bounties as string[]),
                      mapped.bountyId,
                    ]),
                  ],
                });
              } catch (e) {
                setError(e as Error);
              }
            }}
          >
            <label className='field'>
              Add a bounty by URL
              <input
                name='url'
                placeholder='https://poidh.arca.computer/base/bounty/…'
                required
              />
            </label>
            <button className='button' disabled={busy}>
              <Plus size={15} />
              Add to album
            </button>
          </form>
        </>
      )}
      {bounties.isError ? (
        <ErrorNotice error={bounties.error} />
      ) : (
        <div className='bounty-grid'>
          {bounties.data?.map((b, i) => (
            <div key={b.id}>
              {'unavailable' in b ? (
                <Empty title='Bounty unavailable' />
              ) : (
                <BountyCard bounty={b} index={i} />
              )}{' '}
              {mine && record && (
                <button
                  className='button button-small'
                  disabled={busy}
                  onClick={() =>
                    save({
                      ...record.data,
                      bounties: (record.data.bounties as string[]).filter(
                        (id) => id !== b.id
                      ),
                    })
                  }
                >
                  Remove from album
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {bounties.data?.length === 0 && (
        <Empty title='An album of possibilities.'>
          Add bounties to start this collection.
        </Empty>
      )}
    </div>
  );
}
export function ProfileProofs({ address }: { address: string }) {
  const [mode, setMode] = useState('created');
  const query = useInfiniteQuery({
    queryKey: ['profile-proofs', address, mode],
    queryFn: ({ pageParam }) =>
      api.request<Page<Claim>>(
        '/profiles/' +
          address +
          '/proofs?' +
          new URLSearchParams({ mode, cursor: pageParam })
      ),
    initialPageParam: '',
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section>
      <h2>The proof is in the doing.</h2>
      <div className='tabs'>
        <button
          className={mode === 'created' ? 'selected' : ''}
          onClick={() => setMode('created')}
        >
          Submitted proofs
        </button>
        <button
          className={mode === 'owned' ? 'selected' : ''}
          onClick={() => setMode('owned')}
        >
          Collected proofs
        </button>
      </div>
      {query.isError ? (
        <ErrorNotice error={query.error} />
      ) : (
        <div className='bounty-grid'>
          {items.map((c) => (
            <Link
              className='bounty-card'
              key={c.id}
              href={notificationURL(c.bountyId)}
            >
              <Camera size={24} />
              <h3>{c.title}</h3>
              <p>{c.description}</p>
              <span className='chip'>
                {c.accepted ? 'Accepted' : 'Submitted'}
              </span>
            </Link>
          ))}
        </div>
      )}
      {!query.isPending && !query.isError && !items.length && (
        <Empty title='A story waiting to happen.' />
      )}
      {query.hasNextPage && (
        <button className='button' onClick={() => query.fetchNextPage()}>
          More proofs
        </button>
      )}
    </section>
  );
}
export function Activity() {
  const query = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) =>
      api.request<
        Page<{
          id: string;
          name: string;
          chainId: number;
          timestamp: string;
          transactionHash: string;
          contract: string;
          data: Record<string, string>;
        }>
      >('/activity?' + new URLSearchParams({ cursor: pageParam })),
    initialPageParam: '',
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const explorers: Record<number, string> = {
    1: 'https://etherscan.io',
    8453: 'https://basescan.org',
    42161: 'https://arbiscan.io',
  };
  return (
    <div className='content-page'>
      <span className='eyebrow'>
        {upstreamPreview
          ? 'PUBLIC TRANSACTION HISTORY'
          : 'THE LATEST GOOD THINGS'}
      </span>
      <h1>Something is always happening.</h1>
      {upstreamPreview && (
        <p className='muted'>
          Browse historical transactions in the order provided by poidh’s public
          API.
        </p>
      )}
      {query.isError ? (
        <ErrorNotice error={query.error} retry={() => query.refetch()} />
      ) : (
        items.map((e) => (
          <article className='notification' key={e.id}>
            <Camera size={22} />
            <div>
              <h3>{e.name.replace(/([a-z])([A-Z])/g, '$1 $2')}</h3>
              <small>
                {deployments.find((d) => d.chainId === e.chainId)?.name} ·{' '}
                {new Date(Number(e.timestamp) * 1000).toLocaleString()}
              </small>
              {e.data.title && <p>{e.data.title}</p>}
              {(e.data.bountyId ||
                (e.name === 'BountyCreated' && e.data.id)) && (
                <p>
                  <Link
                    className='text-link'
                    href={notificationURL(
                      `${e.chainId}:${e.contract}:${
                        e.data.bountyId ?? e.data.id
                      }`
                    )}
                  >
                    View bounty
                  </Link>
                </p>
              )}
            </div>
            {explorers[e.chainId] && (
              <a
                aria-label='View transaction'
                href={explorers[e.chainId] + '/tx/' + e.transactionHash}
                target='_blank'
                rel='noreferrer'
              >
                <ArrowUpRight size={18} />
              </a>
            )}
          </article>
        ))
      )}
      {!query.isPending && !query.isError && !items.length && (
        <Empty title='Good things are on their way.' />
      )}
      {query.hasNextPage && (
        <button className='button' onClick={() => query.fetchNextPage()}>
          {upstreamPreview ? 'More activity' : 'Earlier activity'}
        </button>
      )}
    </div>
  );
}
export function Leaderboard() {
  const query = useInfiniteQuery({
    queryKey: ['leaderboard'],
    queryFn: ({ pageParam }) =>
      api.request<Page<LeaderboardEntry>>(
        '/leaderboard?' + new URLSearchParams({ cursor: pageParam })
      ),
    initialPageParam: '',
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className='content-page'>
      <span className='eyebrow'>BIG IDEAS. BIGGER IMPACT.</span>
      <h1>The people behind the proof.</h1>
      <p className='muted'>
        Protocol rewards, funded bounties, and collected proofs.
      </p>
      {rows.some((r) => r.approximateAmounts) && (
        <p className='notice'>
          Amounts and ranking are approximate estimates from poidh’s public API.
          Bounty rewards retain their exact onchain amounts.
        </p>
      )}
      {query.isError ? (
        <ErrorNotice error={query.error} retry={() => query.refetch()} />
      ) : (
        <div className='table-scroll'>
          <table className='leaderboard-table'>
            <thead>
              <tr>
                <th>Creator</th>
                <th>Network</th>
                <th>Earned</th>
                <th>Funded</th>
                <th>Proofs held</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.address + ':' + r.chainId}>
                  <td>
                    <Link href={'/account/' + r.address}>
                      {short(r.address)}
                    </Link>
                  </td>
                  <td>
                    {deployments.find((d) => d.chainId === r.chainId)?.name}
                  </td>
                  <td>
                    {r.approximateAmounts
                      ? r.approximateAmounts.earned === null
                        ? '—'
                        : '≈ ' +
                          Number(r.approximateAmounts.earned).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 6 }
                          ) +
                          ' ETH'
                      : r.earned === null
                      ? '—'
                      : amountLabel(r.earned, 6) + ' ETH'}
                  </td>
                  <td>
                    {r.approximateAmounts
                      ? r.approximateAmounts.paid === null
                        ? '—'
                        : '≈ ' +
                          Number(r.approximateAmounts.paid).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 6 }
                          ) +
                          ' ETH'
                      : r.paid === null
                      ? '—'
                      : amountLabel(r.paid, 6) + ' ETH'}
                  </td>
                  <td>{r.nfts ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!query.isPending && !query.isError && !rows.length && (
        <Empty title='Every great story starts somewhere.'>
          The leaderboard appears as indexed rewards arrive.
        </Empty>
      )}
      {query.hasNextPage && (
        <button className='button' onClick={() => query.fetchNextPage()}>
          More creators
        </button>
      )}
    </div>
  );
}
function notificationURL(id: string) {
  const [chain, contract, onChainId] = id.split(':');
  const d = deployments.find((d) => d.chainId === Number(chain));
  if (!d) return '/';
  const display = (
    BigInt(onChainId) +
    (contract === d.address.toLowerCase() ? BigInt(d.offset) : 0n)
  ).toString();
  return `/${d.slug}/bounty/${display}`;
}
export function Notifications() {
  const { address } = useAccount();
  const auth = useSession();
  const [error, setError] = useState<Error | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['notifications', auth.address],
    queryFn: ({ pageParam }) =>
      api.request<Page<CommunityRecord>>(
        '/notifications?' + new URLSearchParams({ cursor: pageParam })
      ),
    initialPageParam: '',
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    enabled: !!auth.address,
    refetchInterval: 15_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className='content-page'>
      <span className='eyebrow'>STAY IN THE LOOP</span>
      <h1>Your corner of poidh.</h1>
      {!auth.address ? (
        <div className='notice'>
          <p>Sign in to see replies and activity on your bounties.</p>
          <button
            className='button button-blue'
            disabled={!address || auth.busy}
            onClick={() => auth.signIn().catch((e) => setError(e))}
          >
            Sign in with your wallet
          </button>
        </div>
      ) : query.isError ? (
        <ErrorNotice error={query.error} />
      ) : items.length ? (
        items.map((n) => (
          <article
            className={'notification ' + (n.data.read ? 'read' : '')}
            key={n.id}
          >
            <Bell size={22} />
            <div>
              <p>
                {short(n.author)}{' '}
                {n.data.event === 'reply'
                  ? 'replied to your comment'
                  : 'commented on your bounty'}
                .
              </p>
              <time dateTime={n.createdAt}>
                {new Date(n.createdAt).toLocaleString()}
              </time>
              {n.bountyId && (
                <p>
                  <Link
                    className='text-link'
                    href={notificationURL(n.bountyId)}
                  >
                    View activity <ArrowUpRight size={13} />
                  </Link>
                </p>
              )}
            </div>
            <button
              className='icon-button'
              aria-label='Mark as read'
              onClick={async () => {
                try {
                  await api.write(
                    '/notifications/' + encodeURIComponent(n.id) + '/read',
                    'POST',
                    {}
                  );
                  await query.refetch();
                } catch (e) {
                  setError(e as Error);
                }
              }}
            >
              <Check size={18} />
            </button>
          </article>
        ))
      ) : (
        <Empty title='You’re all caught up.'>
          We’ll keep the good news here.
        </Empty>
      )}
      {query.hasNextPage && (
        <button className='button' onClick={() => query.fetchNextPage()}>
          Earlier notifications
        </button>
      )}
      {error && <ErrorNotice error={error} />}
    </div>
  );
}
