import { getCloudflareContext } from '@opennextjs/cloudflare';
import { r2, type ObjectStore } from '@poidh/storage/objects';
import { MediaMirror } from '@poidh/storage/mirror';

let nodeStorage: ObjectStore | undefined;
let mirror: MediaMirror | undefined;
export async function mediaCache() {
  let context: ReturnType<typeof getCloudflareContext> | undefined;
  try {
    context = getCloudflareContext();
  } catch {}
  const env: any = { ...process.env, ...context?.env };
  let storage: ObjectStore;
  let fetcher: typeof fetch | undefined;
  if (env.REMOTE_MEDIA) {
    storage = r2(env.REMOTE_MEDIA);
  } else {
    if (!env.S3_BUCKET) throw new Error('Configure REMOTE_MEDIA or S3 storage');
    const [{ s3 }, { nodeMediaFetch }] = await Promise.all([
      import('@poidh/storage'),
      import('@poidh/storage/node-fetch'),
    ]);
    nodeStorage ??= s3({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
    storage = nodeStorage;
    fetcher = nodeMediaFetch;
  }
  mirror ??= new MediaMirror({
    storage,
    fetcher,
    localOrigin: new URL(env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
      .origin,
    blockedHosts: [
      new URL(env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').hostname,
    ],
  });
  return {
    storage,
    mirror,
    edge: context
      ? (globalThis.caches as unknown as { default: Cache }).default
      : undefined,
  };
}
