'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useAccount, useReadContracts } from 'wagmi';
import {
  abi,
  deployments,
  resolveLegacyURL,
  key,
  amountLabel,
  type Claim,
  type Deployment,
} from '@poidh/protocol';
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Users,
  Upload,
  Check,
} from 'lucide-react';
import { zeroAddress } from 'viem';
import { readOnlyPreview } from '@/utils/preview';
import { mediaURL, proofImage } from '@/utils/proofImage';
import { api, useSession } from './providers';
import { Comments } from './comments';
import { ErrorNotice, Empty, short } from './shell';
import {
  useTransaction,
  TransactionStatus,
  NativeAmount,
  parseAmount,
  WithdrawBalance,
} from './transactions';
function ClaimCard({
  claim,
  canChoose,
  requiresVote,
  transaction,
}: {
  claim: Claim;
  canChoose: boolean;
  requiresVote: boolean;
  transaction: ReturnType<typeof useTransaction>;
}) {
  const metadata = useQuery({
    queryKey: ['proof-image', claim.uri],
    queryFn: ({ signal }) => proofImage(claim.uri, signal),
    retry: 1,
    staleTime: 3600_000,
  });
  const image = metadata.data;
  return (
    <article className='claim-card'>
      {image ? (
        <img
          className='claim-image'
          src={image}
          alt={'Proof: ' + claim.title}
          loading='lazy'
          referrerPolicy='no-referrer'
        />
      ) : (
        <div className='empty'>
          <Camera size={28} />
          <small>
            {metadata.isError || metadata.data === null
              ? 'Proof preview unavailable'
              : 'Loading proof…'}
          </small>
        </div>
      )}
      <h3>{claim.title}</h3>
      <p>{claim.description}</p>
      <Link className='creator' href={'/account/' + claim.issuer}>
        {short(claim.issuer)}
      </Link>
      {mediaURL(claim.uri) && (
        <a href={mediaURL(claim.uri)!} target='_blank' rel='noreferrer'>
          Original proof <ArrowUpRight size={12} />
        </a>
      )}
      {claim.accepted && (
        <span className='chip'>
          <Check size={12} />
          Accepted proof
        </span>
      )}
      {canChoose && (
        <button
          className='button button-small'
          disabled={transaction.busy}
          onClick={() =>
            transaction.send(
              requiresVote ? 'submitClaimForVote' : 'acceptClaim',
              [
                BigInt(claim.bountyId.split(':').at(-1)!),
                BigInt(claim.onChainId),
              ]
            )
          }
        >
          {requiresVote ? 'Put to a vote' : 'Accept this proof'}
        </button>
      )}
    </article>
  );
}
function SubmitProof({
  bountyId,
  onChainId,
  deployment,
  transaction,
}: {
  bountyId: string;
  onChainId: string;
  deployment: Deployment;
  transaction: ReturnType<typeof useTransaction>;
}) {
  const auth = useSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [restored, setRestored] = useState(false);
  const draftKey = 'poidh:claim:' + bountyId;
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      if (draft) {
        setTitle(draft.title ?? '');
        setDescription(draft.description ?? '');
        setUploaded(draft.uploaded ?? '');
      }
    } catch {}
    setRestored(true);
  }, [draftKey]);
  useEffect(() => {
    if (restored)
      localStorage.setItem(
        draftKey,
        JSON.stringify({ title, description, uploaded })
      );
  }, [title, description, uploaded, restored, draftKey]);
  return (
    <form
      className='form-panel stack'
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          setPhase('Signing in…');
          await auth.signIn();
          let image = uploaded;
          if (!image) {
            if (!file) throw new Error('Choose an image for your proof.');
            setPhase('Saving your proof…');
            image = (await api.upload(file)).url;
            setUploaded(image);
          }
          setPhase('Saving metadata…');
          const metadata = await api.metadata({
            name: title,
            description,
            image,
            external_url: window.location.href,
          });
          setPhase('');
          const result = await transaction.send('createClaim', [
            BigInt(onChainId),
            title,
            description,
            metadata.url,
          ]);
          if (result) {
            localStorage.removeItem(draftKey);
            setTitle('');
            setDescription('');
            setUploaded('');
            setFile(null);
          }
        } catch (e) {
          setError(e as Error);
        } finally {
          setPhase('');
        }
      }}
    >
      <h2>Your work. Your proof.</h2>
      <label className='field'>
        Submission title
        <input
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className='field'>
        Tell the story
        <textarea
          required
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className='field'>
        Proof image
        <input
          type='file'
          accept='image/jpeg,image/png,image/gif,image/webp'
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setUploaded('');
          }}
          required={!uploaded}
        />
        <small>
          JPEG, PNG, GIF, or WebP. Maximum 10 MiB. Your upload is immutable.
        </small>
      </label>
      {uploaded && (
        <p className='notice'>
          Your image is saved. You can retry the transaction without uploading
          again.
        </p>
      )}
      {error && <ErrorNotice error={error} />}
      <button
        className='button button-blue'
        disabled={!!phase || transaction.busy}
      >
        <Upload size={16} />
        {phase || 'Submit proof'}
      </button>
      <small className='muted'>
        Your draft is saved on this device. Proof metadata will be public.
      </small>
    </form>
  );
}
export function BountyDetail({
  slug,
  display,
}: {
  slug: string;
  display: string;
}) {
  let resolved;
  try {
    resolved = resolveLegacyURL(slug, display);
  } catch {
    return (
      <div className='content-page'>
        <Empty title='This bounty address isn’t valid.' />
      </div>
    );
  }
  return <BountyView slug={slug} display={display} resolved={resolved} />;
}
function BountyView({
  slug,
  display,
  resolved,
}: {
  slug: string;
  display: string;
  resolved: ReturnType<typeof resolveLegacyURL>;
}) {
  const deployment = deployments.find((d) => d.slug === slug)!;
  const archive = resolved.deployment.archive;
  const id = key(
    resolved.deployment.chainId,
    resolved.deployment.address,
    resolved.onChainId
  );
  const { address } = useAccount();
  const tx = useTransaction(deployment);
  const [amount, setAmount] = useState('');
  const [actionError, setActionError] = useState<Error | null>(null);
  const [showProof, setShowProof] = useState(false);
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    if (readOnlyPreview) return;
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ['bounty', id],
    queryFn: () => api.bounty(id),
    refetchInterval: 12_000,
  });
  const claims = useInfiniteQuery({
    queryKey: ['claims', id],
    queryFn: ({ pageParam }) => api.claims(id, pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 12_000,
  });
  const base = {
    abi,
    address: deployment.address,
    chainId: deployment.chainId as 1 | 8453 | 42161,
  } as const;
  const chain = useReadContracts({
    contracts: [
      { ...base, functionName: 'bounties', args: [BigInt(resolved.onChainId)] },
      {
        ...base,
        functionName: 'bountyCurrentVotingClaim',
        args: [BigInt(resolved.onChainId)],
      },
      {
        ...base,
        functionName: 'bountyVotingTracker',
        args: [BigInt(resolved.onChainId)],
      },
      {
        ...base,
        functionName: 'everHadExternalContributor',
        args: [BigInt(resolved.onChainId)],
      },
      {
        ...base,
        functionName: 'getParticipants',
        args: [BigInt(resolved.onChainId)],
      },
      { ...base, functionName: 'MIN_CONTRIBUTION' },
    ],
    query: { enabled: !archive && !readOnlyPreview, refetchInterval: 12_000 },
  });
  const onchain = chain.data?.[0].result;
  const currentVote = chain.data?.[1].result ?? 0n;
  const voting = chain.data?.[2].result;
  const everHad = chain.data?.[3].result;
  const participants = chain.data?.[4].result;
  const minimum = chain.data?.[5].result;
  const b = query.data;
  const issuer = onchain?.[1]?.toLowerCase() ?? b?.issuer;
  const isIssuer = address?.toLowerCase() === issuer;
  const claimer = onchain?.[5]?.toLowerCase();
  const active = onchain
    ? claimer === zeroAddress
    : b?.status === 'open' || b?.status === 'voting';
  const cancelled = onchain ? claimer === issuer : b?.status === 'cancelled';
  const open = participants ? participants[0].length > 0 : !!b?.multiplayer;
  const contributor =
    participants?.[0].findIndex(
      (a) => a.toLowerCase() === address?.toLowerCase()
    ) ?? -1;
  const contribution = contributor >= 0 ? participants![1][contributor] : 0n;
  const status =
    archive || readOnlyPreview
      ? b?.status
      : cancelled
      ? 'cancelled'
      : !active
      ? 'completed'
      : currentVote > 0n
      ? 'voting'
      : 'open';
  const deadline = voting?.[2] ?? 0n;
  return (
    <div className='content-page'>
      <Link href='/' className='breadcrumb'>
        <ArrowLeft size={15} />
        All bounties
      </Link>
      {query.isError && !onchain ? (
        <ErrorNotice error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <div className='detail-grid'>
            <section>
              <div className='section-actions'>
                <span className='chip'>
                  {deployment.name} · #{display}
                </span>
                <span className={'status status-' + status}>
                  {status ?? 'Loading'}
                </span>
              </div>
              <h1 className='detail-title'>
                {onchain?.[2] ?? b?.title ?? 'Loading bounty…'}
              </h1>
              {issuer && (
                <Link className='creator' href={'/account/' + issuer}>
                  Created by {short(issuer)}
                </Link>
              )}
              <p className='detail-description'>
                {onchain?.[3] ?? b?.description}
              </p>
              {archive && (
                <p className='notice'>
                  Historical archive. This deployment is read-only here.
                  {b?.archiveAsOf
                    ? ' Snapshot: ' +
                      (b.archiveAsOf.match(/^\d+$/)
                        ? new Date(Number(b.archiveAsOf) * 1000).toISOString()
                        : b.archiveAsOf)
                    : ''}
                </p>
              )}
              <h2 className='claims-heading'>Proof in the making</h2>
              {claims.isError ? (
                <ErrorNotice
                  error={claims.error}
                  retry={() => claims.refetch()}
                />
              ) : claims.data?.pages[0].items.length ? (
                <div className='claims-list'>
                  {claims.data.pages
                    .flatMap((p) => p.items)
                    .map((c) => (
                      <ClaimCard
                        key={c.id}
                        claim={c}
                        canChoose={
                          !readOnlyPreview &&
                          !archive &&
                          !!active &&
                          isIssuer &&
                          currentVote === 0n &&
                          everHad !== undefined
                        }
                        requiresVote={open && !!everHad}
                        transaction={tx}
                      />
                    ))}
                </div>
              ) : (
                <Empty title='This story is waiting for its first proof.'>
                  Take on the challenge and show what you made happen.
                </Empty>
              )}
              {claims.hasNextPage && (
                <button
                  className='button'
                  onClick={() => claims.fetchNextPage()}
                >
                  More proofs
                </button>
              )}
              {showProof && !archive && !readOnlyPreview && (
                <SubmitProof
                  bountyId={id}
                  onChainId={resolved.onChainId}
                  deployment={deployment}
                  transaction={tx}
                />
              )}
              <Comments bountyId={id} />
            </section>
            <aside className='reward-panel'>
              <span className='eyebrow'>THE REWARD</span>
              <div className='amount'>
                {amountLabel(
                  (onchain?.[4] ?? BigInt(b?.amount ?? '0')).toString(),
                  6
                )}{' '}
                <small>{deployment.archive ? 'DEGEN' : 'ETH'}</small>
              </div>
              <span className='chip'>
                {open ? <Users size={13} /> : <Camera size={13} />}{' '}
                {open ? 'Community funded' : 'Solo bounty'}
              </span>
              <hr />
              {readOnlyPreview && (
                <p className='notice'>
                  Read-only preview. Browse the bounty and its proofs here.
                  <a
                    className='text-link'
                    href={`https://poidh.xyz/${slug}/bounty/${display}`}
                    target='_blank'
                    rel='noreferrer'
                  >
                    Open on poidh.xyz ↗
                  </a>
                </p>
              )}
              {!archive && !readOnlyPreview && (
                <>
                  {chain.isError && <ErrorNotice error={chain.error} />}
                  <TransactionStatus
                    transaction={tx}
                    chainId={deployment.chainId}
                  />
                  {actionError && <ErrorNotice error={actionError} />}
                  <div className='stack'>
                    {active && currentVote === 0n && (
                      <>
                        {!isIssuer && (
                          <button
                            className='button button-blue'
                            disabled={!address}
                            onClick={() => setShowProof(!showProof)}
                          >
                            {showProof
                              ? 'Close submission'
                              : 'Submit your proof'}
                          </button>
                        )}
                        {open && !isIssuer && (
                          <>
                            <NativeAmount
                              label='Add to the reward'
                              value={amount}
                              onChange={setAmount}
                              minimum={minimum}
                            />
                            <button
                              className='button'
                              disabled={tx.busy || !address}
                              onClick={() => {
                                try {
                                  setActionError(null);
                                  void tx.send(
                                    'joinOpenBounty',
                                    [BigInt(resolved.onChainId)],
                                    parseAmount(amount)
                                  );
                                } catch (e) {
                                  setActionError(e as Error);
                                }
                              }}
                            >
                              Contribute
                            </button>
                            {contribution > 0n && (
                              <button
                                className='button'
                                disabled={tx.busy}
                                onClick={() =>
                                  tx.send('withdrawFromOpenBounty', [
                                    BigInt(resolved.onChainId),
                                  ])
                                }
                              >
                                Withdraw contribution
                              </button>
                            )}
                          </>
                        )}
                        {isIssuer && (
                          <button
                            className='button button-danger'
                            disabled={tx.busy}
                            onClick={() =>
                              tx.send(
                                open ? 'cancelOpenBounty' : 'cancelSoloBounty',
                                [BigInt(resolved.onChainId)]
                              )
                            }
                          >
                            Cancel bounty
                          </button>
                        )}
                      </>
                    )}
                    {currentVote > 0n && (
                      <>
                        <h3>Voting on proof #{currentVote.toString()}</h3>
                        <p className='muted'>
                          Yes: {amountLabel((voting?.[0] ?? 0n).toString(), 6)}{' '}
                          ETH
                          <br />
                          No: {amountLabel(
                            (voting?.[1] ?? 0n).toString(),
                            6
                          )}{' '}
                          ETH
                        </p>
                        <small>
                          {deadline
                            ? new Date(Number(deadline) * 1000).toLocaleString()
                            : ''}
                        </small>
                        {BigInt(Math.floor(time / 1000)) < deadline ? (
                          <>
                            <button
                              className='button'
                              disabled={
                                !address ||
                                isIssuer ||
                                contribution === 0n ||
                                tx.busy
                              }
                              onClick={() =>
                                tx.send('voteClaim', [
                                  BigInt(resolved.onChainId),
                                  true,
                                ])
                              }
                            >
                              Vote yes
                            </button>
                            <button
                              className='button'
                              disabled={
                                !address ||
                                isIssuer ||
                                contribution === 0n ||
                                tx.busy
                              }
                              onClick={() =>
                                tx.send('voteClaim', [
                                  BigInt(resolved.onChainId),
                                  false,
                                ])
                              }
                            >
                              Vote no
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className='button button-blue'
                              disabled={!address || tx.busy}
                              onClick={() =>
                                tx.send('resolveVote', [
                                  BigInt(resolved.onChainId),
                                ])
                              }
                            >
                              Resolve vote
                            </button>
                            {voting && voting[0] <= voting[1] && (
                              <button
                                className='button'
                                disabled={!address || tx.busy}
                                onClick={() =>
                                  tx.send('resetVotingPeriod', [
                                    BigInt(resolved.onChainId),
                                  ])
                                }
                              >
                                Reset failed vote
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                    {cancelled && open && !isIssuer && contribution > 0n && (
                      <button
                        className='button'
                        disabled={tx.busy}
                        onClick={() =>
                          tx.send('claimRefundFromCancelledOpenBounty', [
                            BigInt(resolved.onChainId),
                          ])
                        }
                      >
                        Claim your refund
                      </button>
                    )}
                    {!address && (
                      <small>Connect a wallet to participate.</small>
                    )}
                  </div>
                  <WithdrawBalance deployment={deployment} />
                </>
              )}
              <hr />
              <small>
                Rewards and refunds use poidh’s existing contracts. After
                acceptance, withdraw the credited balance to your wallet.
              </small>
              <p>
                <a
                  className='text-link'
                  href={'https://docs.poidh.xyz/'}
                  target='_blank'
                  rel='noreferrer'
                >
                  How bounties work <ArrowUpRight size={12} />
                </a>
              </p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
