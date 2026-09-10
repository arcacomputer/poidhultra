import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createCommunityProxy } from '@poidh/client/server-proxy';
import { UpstreamPublicAPI } from '@poidh/client/upstream';

let upstream: UpstreamPublicAPI | undefined;

export async function communityProxy(request: Request, path: string) {
  let env: any = process.env;
  try {
    env = { ...env, ...getCloudflareContext().env };
  } catch {}
  // The optional source changes public protocol reads only. Session cookies and
  // community writes still go through the domain-bound community proxy.
  if (env.PREVIEW_MODE === 'true' && env.UPSTREAM_INDEXER_URL) {
    if (
      !upstream ||
      upstream.origin !== new URL(env.UPSTREAM_INDEXER_URL).origin
    )
      upstream = new UpstreamPublicAPI({ url: env.UPSTREAM_INDEXER_URL });
    const response = await upstream.handle(request, path);
    if (response) return response;
  }
  return createCommunityProxy({
    origin: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    apiURL: env.COMMUNITY_API_URL ?? 'http://localhost:8787',
    proxyKey: env.COMMUNITY_PROXY_KEY ?? '',
    readOnly: env.PREVIEW_MODE === 'true',
    service: env.COMMUNITY,
  })(request, path);
}
