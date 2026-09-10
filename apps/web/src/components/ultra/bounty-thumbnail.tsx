'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, ImageOff } from 'lucide-react';
import type { Bounty, Claim, Page } from '@poidh/protocol';
import { mediaURL, proofImage } from '@/utils/proofImage';
import { api } from './providers';

export function BountyThumbnail({
  bounty,
  cover,
  href,
}: {
  bounty: Bounty;
  cover: string | null;
  href: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [near, setNear] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const direct = cover && !coverFailed ? cover : null;
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const claims = useQuery({
    queryKey: ['bounty-thumbnail-proofs', bounty.id],
    queryFn: ({ signal }) =>
      api.request<Page<Claim>>(
        '/bounties/' + encodeURIComponent(bounty.id) + '/claims?limit=3',
        { signal }
      ),
    enabled: near && !direct && bounty.claimCount !== 0,
    staleTime: 60_000,
    retry: 1,
  });
  const candidates = (claims.data?.items ?? [])
    .filter((claim) => mediaURL(claim.uri))
    .sort((a, b) => Number(b.accepted) - Number(a.accepted));
  const candidate = candidates[candidateIndex];
  const metadata = useQuery({
    queryKey: ['proof-image', candidate?.uri],
    queryFn: ({ signal }) => proofImage(candidate!.uri, signal),
    enabled: near && !direct && !!candidate,
    staleTime: 3600_000,
    retry: false,
  });
  useEffect(() => {
    if (candidate && (metadata.isError || metadata.data === null))
      setCandidateIndex((index) => index + 1);
  }, [candidate, metadata.isError, metadata.data]);
  const image = direct ?? metadata.data;
  const loading =
    !near ||
    (!image && bounty.claimCount !== 0 && claims.isPending) ||
    (!!candidate && !metadata.isError && metadata.isPending);
  const empty =
    bounty.claimCount === 0 ||
    (claims.isSuccess && claims.data.items.length === 0);
  const label = direct
    ? 'Bounty image'
    : candidate?.accepted
    ? 'Accepted proof'
    : 'Submitted proof';
  return (
    <Link
      ref={ref}
      href={href}
      className='bounty-thumbnail'
      aria-label={`View bounty: ${bounty.title}`}
    >
      {image ? (
        <>
          <img
            key={direct ?? candidate?.id}
            src={image}
            alt={`${label}: ${bounty.title}`}
            width={640}
            height={400}
            loading='lazy'
            decoding='async'
            referrerPolicy='no-referrer'
            onError={() => {
              if (direct) setCoverFailed(true);
              else setCandidateIndex((index) => index + 1);
            }}
          />
          <span className='thumbnail-label'>{label}</span>
        </>
      ) : (
        <div
          className={'thumbnail-placeholder' + (loading ? ' is-loading' : '')}
        >
          {empty || loading ? <Camera size={32} /> : <ImageOff size={28} />}
          <span>
            {loading
              ? 'Loading image…'
              : empty
              ? 'Awaiting the first proof'
              : 'Image preview unavailable'}
          </span>
        </div>
      )}
    </Link>
  );
}
