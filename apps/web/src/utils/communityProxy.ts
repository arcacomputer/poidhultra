import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createCommunityProxy } from '@poidh/client/server-proxy';

export async function communityProxy(request: Request, path: string) {
  let env: any = process.env;
  try {
    env = { ...env, ...getCloudflareContext().env };
  } catch {}
  return createCommunityProxy({
    origin: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    apiURL: env.COMMUNITY_API_URL ?? 'http://localhost:8787',
    proxyKey: env.COMMUNITY_PROXY_KEY ?? '',
    readOnly: env.PREVIEW_MODE === 'true',
    service: env.COMMUNITY,
  })(request, path);
}
