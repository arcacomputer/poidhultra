import { getCloudflareContext } from '@opennextjs/cloudflare';
export async function communityProxy(request: Request, path: string) {
  let env: any = process.env;
  try {
    env = { ...env, ...getCloudflareContext().env };
  } catch {}
  if (env.PREVIEW_MODE === 'true' && !['GET', 'HEAD'].includes(request.method))
    return Response.json(
      {
        error:
          'This preview is read-only while shared community launch checks are completed.',
      },
      { status: 503 }
    );
  const origin = env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    request.headers.get('origin') !== origin
  )
    return Response.json({ error: 'Origin mismatch' }, { status: 403 });
  const headers = new Headers();
  for (const name of [
    'content-type',
    'cookie',
    'idempotency-key',
    'if-none-match',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-poidh-origin', origin);
  headers.set('x-poidh-proxy-key', env.COMMUNITY_PROXY_KEY ?? '');
  if (!['GET', 'HEAD'].includes(request.method)) headers.set('origin', origin);
  const url = new URL(path, env.COMMUNITY_API_URL ?? 'http://localhost:8787');
  if (!url.search) url.search = new URL(request.url).search;
  const init: RequestInit = {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method)
      ? undefined
      : await request.arrayBuffer(),
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  };
  try {
    const response = env.COMMUNITY
      ? await env.COMMUNITY.fetch(new Request(url, init))
      : await fetch(url, init);
    const outgoing = new Headers();
    for (const name of [
      'content-type',
      'set-cookie',
      'cache-control',
      'etag',
      'content-security-policy',
      'x-content-type-options',
    ]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    if (!path.startsWith('/media/')) outgoing.set('cache-control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        error:
          'The community service is unavailable. Please try again shortly.',
      },
      { status: 503 }
    );
  }
}
