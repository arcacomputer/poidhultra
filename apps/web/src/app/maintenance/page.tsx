import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default async function Maintenance() {
  let status: any = null;
  let error = false;
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/arcacomputer/poidhultra/maintenance-state/status.json',
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) }
    );
    if (response.ok) status = await response.json();
    else error = true;
  } catch {
    error = true;
  }
  const overdue =
    !status?.lastSuccessfulCheck ||
    Date.now() - Date.parse(status.lastSuccessfulCheck) > 3 * 3600_000;
  return (
    <div className='content-page'>
      <span className='eyebrow'>OPEN SOURCE, KEPT ACCOUNTABLE</span>
      <h1>Upstream maintenance.</h1>
      <p className='muted'>
        Every original source is watched. Updates enter Ultra through reviewed
        pull requests. An open PR is still pending.
      </p>
      <div className={'notice ' + (overdue ? 'error' : '')}>
        <strong>
          {error
            ? 'Maintenance status is unavailable'
            : overdue
            ? 'The last successful check is overdue'
            : 'Upstream checks are current'}
        </strong>
        <p>
          Last successful check:{' '}
          {status?.lastSuccessfulCheck ?? 'Not published yet'}
        </p>
      </div>
      <div className='maintenance-cards'>
        {status?.sources?.map((s: any) => (
          <article className='maintenance-card' key={s.source}>
            <h3>
              <Link href={'https://github.com/' + s.repository}>
                {s.repository}
              </Link>
            </h3>
            <span className='chip'>{s.status}</span>
            <dl>
              <dt>Observed revision</dt>
              <dd>
                <code>{s.observedRevision ?? 'Unknown'}</code>
              </dd>
              <dt>Incorporated revision</dt>
              <dd>
                <code>{s.incorporatedRevision ?? 'Not yet incorporated'}</code>
              </dd>
            </dl>
            {s.error && <p className='error'>{s.error}</p>}
            {s.pullRequest && (
              <Link className='text-link' href={s.pullRequest}>
                Review pending integration ↗
              </Link>
            )}
            {s.issue && (
              <Link className='text-link' href={s.issue}>
                Open integration task ↗
              </Link>
            )}
          </article>
        ))}
      </div>
      <p className='muted'>
        Cloudflare and Neon hosting, domain-bound authentication, and immutable
        storage are recorded intentional differences. Contract source updates
        never change transaction destinations automatically.
      </p>
      <Link
        className='text-link'
        href='https://github.com/arcacomputer/poidhultra/actions'
      >
        View maintenance runs ↗
      </Link>
    </div>
  );
}
