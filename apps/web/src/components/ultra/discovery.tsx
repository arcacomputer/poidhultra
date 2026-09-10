'use client';
import Link from 'next/link';
import { useState, useDeferredValue } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  Search,
  Camera,
  Globe,
  Users,
  Plus,
  SlidersHorizontal,
  Check,
} from 'lucide-react';
import { deployments, amountLabel, type Bounty } from '@poidh/protocol';
import { api } from './providers';
import { Empty, ErrorNotice, short } from './shell';
export function bountyURL(b: Bounty) {
  return `/${
    deployments.find((d) => d.chainId === b.chainId)?.slug ?? 'base'
  }/bounty/${b.displayId}`;
}
export function BountyCard({
  bounty: b,
  index = 0,
}: {
  bounty: Bounty;
  index?: number;
}) {
  const chain = deployments.find((d) => d.chainId === b.chainId);
  return (
    <article className='bounty-card'>
      <div className='card-top'>
        <span className={'chain-dot chain-' + (chain?.slug ?? 'base')} />
        <span>{chain?.name}</span>
        <span className={'status status-' + b.status}>{b.status}</span>
      </div>
      <Link href={bountyURL(b)} className='card-title'>
        <h3>{b.title}</h3>
        <ArrowUpRight size={22} />
      </Link>
      <p className='card-description'>{b.description}</p>
      <div className='card-tags'>
        <span>
          {b.multiplayer ? <Users size={13} /> : <Camera size={13} />}{' '}
          {b.multiplayer ? 'Open bounty' : 'Solo bounty'}
        </span>
        <span>
          {b.claimCount} {b.claimCount === 1 ? 'proof' : 'proofs'}
        </span>
      </div>
      <div className='card-bottom'>
        <Link className='creator' href={'/account/' + b.issuer}>
          <span className={'avatar avatar-' + (index % 4)} />
          {short(b.issuer)}
        </Link>
        <strong>
          {amountLabel(b.amount)}{' '}
          <small>{b.chainId === 666666666 ? 'DEGEN' : 'ETH'}</small>
        </strong>
      </div>
    </article>
  );
}
export function Discovery({
  hero = true,
  issuer,
  albumIds,
}: {
  hero?: boolean;
  issuer?: string;
  albumIds?: string[];
}) {
  const [status, setStatus] = useState('open');
  const [chain, setChain] = useState('');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);
  const [archive, setArchive] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['bounties', { status, chain, q, issuer, archive }],
    queryFn: ({ pageParam }) =>
      api.bounties({
        status,
        ...(chain ? { chain } : {}),
        ...(q ? { q } : {}),
        ...(issuer ? { issuer } : {}),
        ...(archive ? { archive: 'true' } : {}),
        cursor: pageParam,
        limit: '12',
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (b) => !albumIds || albumIds.includes(b.id)
  );
  return (
    <>
      {hero && (
        <section className='hero'>
          <div className='hero-copy'>
            <span className='eyebrow'>
              <span className='live-dot' /> A little incentive. Endless
              possibilities.
            </span>
            <h1>
              Make it happen.
              <br />
              <span>Show the proof.</span>
            </h1>
            <p>
              Put a bounty on your big idea. Let the internet bring it to life.
              Reward the people who make it real.
            </p>
            <div className='hero-actions'>
              <Link href='/create' className='button button-blue'>
                <Plus size={19} />
                Create a bounty
              </Link>
              <a href='#bounties' className='text-link'>
                Find your next mission <ArrowRight size={17} />
              </a>
            </div>
            <div className='hero-caption'>
              <Globe size={15} /> Open to everyone. Powered by you.
            </div>
          </div>
          <div className='hero-art' aria-hidden='true'>
            <div className='orbit orbit-one' />
            <div className='orbit orbit-two' />
            <span className='star star-one'>✳</span>
            <span className='star star-two'>✦</span>
            <div className='proof-frame'>
              <div className='proof-window'>
                <Camera size={88} strokeWidth={1.2} />
                <div className='proof-grid' />
                <span className='viewfinder tl' />
                <span className='viewfinder tr' />
                <span className='viewfinder bl' />
                <span className='viewfinder br' />
              </div>
              <div className='proof-caption'>
                <span>
                  LESS TALK.
                  <br />
                  MORE PROOF.
                </span>
                <ArrowUpRight size={35} />
              </div>
            </div>
            <div className='proof-sticker'>
              <Check size={18} />
              proof of a good time
            </div>
            <div className='floating-note'>ideas → action → proof</div>
          </div>
        </section>
      )}
      <section id='bounties' className='discovery page-width'>
        <div className='section-heading'>
          <div>
            <span className='eyebrow'>THE OPPORTUNITY BOARD</span>
            <h2>
              {issuer
                ? 'Bounties by this creator'
                : hero
                ? 'Small missions. Big possibilities.'
                : 'Find something worth doing.'}
            </h2>
          </div>
          <Link href='/create' className='text-link'>
            Post a bounty <Plus size={16} />
          </Link>
        </div>
        <div className='filter-bar'>
          <div className='tabs' role='tablist' aria-label='Bounty status'>
            {[
              ['open', 'Open bounties'],
              ['voting', 'In voting'],
              ['completed', 'Completed'],
              ['cancelled', 'Cancelled'],
            ].map(([value, label]) => (
              <button
                role='tab'
                aria-selected={status === value}
                className={status === value ? 'selected' : ''}
                key={value}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className='chain-select'>
            <SlidersHorizontal size={15} />
            <span className='sr-only'>Filter by network</span>
            <select value={chain} onChange={(e) => setChain(e.target.value)}>
              <option value=''>All networks</option>
              {deployments
                .filter((d) => !d.archive)
                .map((d) => (
                  <option key={d.chainId} value={d.chainId}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className='search-row'>
          <label className='search-box'>
            <Search size={18} />
            <input
              aria-label='Search bounties'
              placeholder='Find a mission, idea, or a little inspiration…'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className='archive-toggle'>
            <input
              type='checkbox'
              checked={archive}
              onChange={(e) => setArchive(e.target.checked)}
            />
            Include history
          </label>
        </div>
        {query.isPending ? (
          <div className='bounty-grid' aria-label='Loading bounties'>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div className='skeleton-card' key={i} />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorNotice error={query.error} retry={() => query.refetch()} />
        ) : items.length ? (
          <div className='bounty-grid'>
            {items.map((b, i) => (
              <BountyCard key={b.id} bounty={b} index={i} />
            ))}
          </div>
        ) : (
          <Empty title='The next great mission could be yours.'>
            No bounties match these filters. Try another network or create
            something new.
          </Empty>
        )}
        {query.hasNextPage && (
          <div className='load-more'>
            <button
              className='button'
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'More missions'}
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </section>
      {hero && (
        <section className='how-it-works page-width'>
          <div>
            <span className='eyebrow'>FROM “WHAT IF” TO “DID THAT”</span>
            <h2>
              Good things happen
              <br />
              when you put it out there.
            </h2>
            <Link href='https://docs.poidh.xyz/' className='text-link'>
              Meet poidh <ArrowUpRight size={17} />
            </Link>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Put an idea out there.</h3>
                <p>
                  Create a bounty and add a reward. Make it solo or let others
                  chip in.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Make it real.</h3>
                <p>
                  Anyone can take on the challenge and submit proof of their
                  work.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Reward the proof.</h3>
                <p>
                  Pick the winning submission. The creator earns the reward; you
                  collect the proof.
                </p>
              </div>
            </li>
          </ol>
        </section>
      )}
    </>
  );
}
