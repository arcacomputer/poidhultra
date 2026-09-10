'use client';
import { useState } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { ThumbsUp, ThumbsDown, Reply, Trash2, Pencil } from 'lucide-react';
import type { CommunityRecord } from '@poidh/protocol';
import { api, useSession } from './providers';
import { Empty, ErrorNotice, short } from './shell';
export function Comments({ bountyId }: { bountyId: string }) {
  const { address } = useAccount();
  const auth = useSession();
  const cache = useQueryClient();
  const [body, setBody] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [editing, setEditing] = useState<CommunityRecord | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const comments = useInfiniteQuery({
    queryKey: ['comments', bountyId],
    queryFn: ({ pageParam }) =>
      api.records({
        kind: 'comment',
        bountyId,
        limit: '50',
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 10_000,
  });
  const items = comments.data?.pages.flatMap((p) => p.items) ?? [];
  const reactions = useQuery({
    queryKey: ['reactions', bountyId],
    queryFn: () =>
      api.request<{
        counts: Record<string, { upvote: number; downvote: number }>;
        mine: CommunityRecord[];
      }>('/reactions?' + new URLSearchParams({ bountyId })),
    refetchInterval: 10_000,
  });
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await auth.signIn();
      await fn();
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['comments', bountyId] }),
        cache.invalidateQueries({ queryKey: ['reactions', bountyId] }),
      ]);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  async function react(comment: CommunityRecord, type: 'upvote' | 'downvote') {
    await action(async () => {
      const existing = reactions.data?.mine.find(
        (r) => r.parentId === comment.id && r.author === address?.toLowerCase()
      );
      if (existing)
        return api.write(
          '/records/' + encodeURIComponent(existing.id),
          'PATCH',
          { version: existing.version, data: { type } }
        );
      return api.write('/records', 'POST', {
        kind: 'reaction',
        bountyId,
        parentId: comment.id,
        data: { type },
      });
    });
  }
  return (
    <section className='comments'>
      <h2>Keep the conversation going.</h2>
      {error && <ErrorNotice error={error} />}
      <form
        className='stack'
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            if (editing)
              await api.write(
                '/records/' + encodeURIComponent(editing.id),
                'PATCH',
                { version: editing.version, data: { body } }
              );
            else
              await api.write('/records', 'POST', {
                kind: 'comment',
                bountyId,
                parentId: parent,
                data: { body },
              });
            setBody('');
            setEditing(null);
            setParent(null);
          });
        }}
      >
        <label className='field'>
          {editing
            ? 'Edit your comment'
            : parent
            ? 'Reply to this comment'
            : 'Share an idea or ask a question'}
          <textarea
            required
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder='A little encouragement goes a long way.'
          />
        </label>
        <div className='section-actions'>
          <button className='button button-small' disabled={busy || !address}>
            {busy ? 'Posting…' : editing ? 'Save changes' : 'Post comment'}
          </button>
          {(parent || editing) && (
            <button
              className='button button-small'
              type='button'
              onClick={() => {
                setParent(null);
                setEditing(null);
                setBody('');
              }}
            >
              Cancel
            </button>
          )}
          {!address && (
            <small className='muted'>Connect your wallet to join in.</small>
          )}
        </div>
      </form>
      {comments.isError ? (
        <ErrorNotice error={comments.error} retry={() => comments.refetch()} />
      ) : items.length ? (
        items.map((c) => (
          <article
            className={'comment ' + (c.parentId ? 'reply' : '')}
            key={c.id}
          >
            <div className='comment-meta'>
              <a href={'/account/' + c.author}>{short(c.author)}</a>
              <time dateTime={c.createdAt}>
                {new Date(c.createdAt).toLocaleDateString()}
              </time>
              {c.parentId && <span>reply</span>}
            </div>
            <p>{String(c.data.body)}</p>
            <div className='comment-actions'>
              <button
                disabled={busy || !address}
                aria-label='Upvote comment'
                onClick={() => react(c, 'upvote')}
              >
                <ThumbsUp size={12} />
                {reactions.data?.counts[c.id]?.upvote ?? 0}
              </button>
              <button
                disabled={busy || !address}
                aria-label='Downvote comment'
                onClick={() => react(c, 'downvote')}
              >
                <ThumbsDown size={12} />
                {reactions.data?.counts[c.id]?.downvote ?? 0}
              </button>
              <button
                onClick={() => {
                  setParent(c.id);
                  setEditing(null);
                }}
              >
                <Reply size={12} />
                Reply
              </button>
              {c.author === address?.toLowerCase() && (
                <>
                  <button
                    onClick={() => {
                      setEditing(c);
                      setBody(String(c.data.body));
                      setParent(null);
                    }}
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                  <button
                    className='danger'
                    disabled={busy}
                    onClick={() =>
                      action(() =>
                        api.write(
                          '/records/' + encodeURIComponent(c.id),
                          'DELETE',
                          { version: c.version }
                        )
                      )
                    }
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </article>
        ))
      ) : comments.isPending ? (
        <p className='muted'>Loading conversation…</p>
      ) : (
        <Empty title='A fresh conversation.'>
          Be the first to add something.
        </Empty>
      )}
      {comments.hasNextPage && (
        <button
          className='button'
          disabled={comments.isFetchingNextPage}
          onClick={() => comments.fetchNextPage()}
        >
          More comments
        </button>
      )}
    </section>
  );
}
